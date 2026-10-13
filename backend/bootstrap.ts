import { execFile } from "node:child_process";
import { createHash, createPrivateKey, sign } from "node:crypto";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { mkdir, mkdtemp, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";

import { embeddingIdentity, embeddingModel, embeddingRevision } from "./model.ts";
import { preparationRevision } from "./passages.ts";
import { catalogPath } from "./settings.ts";
import { object, text } from "./validation.ts";

const execute = promisify(execFile);
const tokenEndpoint = "https://oauth2.googleapis.com/token";

async function accessToken(): Promise<string> {
    let assertion: string;

    try {
        const credentials = object(JSON.parse(process.env.DRIVE_CREDENTIALS || ""));

        if (credentials.type !== "service_account") {
            throw new Error("Expected a service account.");
        }

        const issued = Math.floor(Date.now() / 1000);
        const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");

        const claims = Buffer.from(
            JSON.stringify({
                iss: text(credentials.client_email, 320),
                scope: "https://www.googleapis.com/auth/drive.readonly",
                aud: tokenEndpoint,
                iat: issued,
                exp: issued + 3600,
            }),
        ).toString("base64url");

        const payload = `${header}.${claims}`;
        const key = createPrivateKey(text(credentials.private_key, 10000));
        assertion = `${payload}.${sign("RSA-SHA256", Buffer.from(payload), key).toString("base64url")}`;
    } catch {
        throw new Error("DRIVE_CREDENTIALS must contain a valid service-account JSON key.");
    }

    const response = await fetch(tokenEndpoint, {
        method: "POST",
        body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
        redirect: "error",
        signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
        throw new Error(`Drive authentication failed (${response.status}). Check the service-account key.`);
    }

    const token = text(object(await response.json()).access_token, 10000);

    if (!token) {
        throw new Error("Drive authentication returned no access token.");
    }

    return token;
}

async function checksum(path: string): Promise<string> {
    const hash = createHash("sha256");

    for await (const bytes of createReadStream(path)) {
        hash.update(bytes);
    }

    return hash.digest("hex");
}

async function validate(directory: string): Promise<void> {
    const connection = new DatabaseSync(join(directory, "catalog.sqlite"), { readOnly: true });
    let snapshot: Record<string, unknown>;

    try {
        const row = connection.prepare("SELECT data FROM state WHERE name = 'neighbors'").get();
        snapshot = object(JSON.parse(text(row?.data, 10000)));

        if (
            connection.prepare("PRAGMA user_version").get()?.user_version !== 6 ||
            snapshot.identity !== embeddingIdentity ||
            snapshot.revision !== preparationRevision ||
            !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/iu.test(text(snapshot.snapshot, 36)) ||
            !/^[\da-f]{64}$/u.test(text(snapshot.checksum, 64))
        ) {
            throw new Error("Snapshot catalog and semantic index are incompatible. Rebuild the snapshot locally.");
        }
    } finally {
        connection.close();
    }

    if ((await checksum(join(directory, `catalog.sqlite.${snapshot.snapshot}.neighbors`))) !== snapshot.checksum) {
        throw new Error("Snapshot neighbor index does not match its catalog.");
    }

    for (const file of ["config.json", "tokenizer.json", "tokenizer_config.json", "onnx/model_quantized.onnx"]) {
        const details = await stat(join(directory, "models", embeddingModel, embeddingRevision, file));

        if (!details.isFile() || details.size === 0) {
            throw new Error("Snapshot is missing required model files.");
        }
    }
}

export async function bootstrap(): Promise<void> {
    const identifier = process.env.DRIVE_FILE_ID?.trim();

    if (!identifier) {
        return;
    }

    if (existsSync(catalogPath)) {
        console.info("Using the existing catalog; Drive restoration skipped.");

        return;
    }

    const expected = process.env.DRIVE_SHA256?.trim().toLowerCase();
    const directory = dirname(catalogPath);

    if (!/^[\w-]+$/.test(identifier) || !expected || !/^[\da-f]{64}$/.test(expected)) {
        throw new Error("Set DRIVE_FILE_ID to the file ID and DRIVE_SHA256 to the archive's SHA256 checksum.");
    }

    if (basename(catalogPath) !== "catalog.sqlite") {
        throw new Error("Drive restoration requires CATALOG_PATH to end in catalog.sqlite.");
    }

    if (existsSync(directory)) {
        throw new Error(
            "Catalog directory already exists without its database. Choose a new directory; nothing was overwritten.",
        );
    }

    await execute("tar", ["--version"]);
    const token = await accessToken();
    const cache = join(dirname(directory), ".cache");
    await mkdir(cache, { recursive: true });
    const temporary = await mkdtemp(join(cache, "archive-"));

    try {
        const archive = join(temporary, "archive.tar.gz");
        console.info("Downloading the private Drive snapshot...");
        const signal = AbortSignal.timeout(30 * 60 * 1000);

        const response = await fetch(`https://www.googleapis.com/drive/v3/files/${identifier}?alt=media`, {
            headers: { Authorization: `Bearer ${token}` },
            redirect: "error",
            signal,
        });

        if (!response.ok || !response.body) {
            throw new Error(
                `Drive download failed (${response.status}). Enable the Drive API and share the file with the service account as Viewer.`,
            );
        }

        await pipeline(response.body, createWriteStream(archive, { flags: "wx", mode: 0o600 }), { signal });

        if ((await checksum(archive)) !== expected) {
            throw new Error("Drive snapshot checksum mismatch. The existing archive has not been changed.");
        }

        const options = { maxBuffer: 16 * 1024 * 1024 };
        const listing = await execute("tar", ["-tzf", archive], options);
        const names = listing.stdout.trimEnd().split(/\r?\n/);

        if (
            names.some(
                (name) =>
                    !/^data\/(?:models(?:\/[\w./-]*)?|catalog\.sqlite(?:\.[\da-f-]{36}\.neighbors)?)?$/iu.test(name) ||
                    name.split("/").some((part) => part === "." || part === ".."),
            )
        ) {
            throw new Error(
                "Snapshot must contain only data/catalog.sqlite, its neighbor index, and data/models; no journals, locks, or unsafe paths.",
            );
        }

        const types = await execute("tar", ["-tvzf", archive], options);

        if (
            types.stdout
                .trimEnd()
                .split(/\r?\n/)
                .some((line) => !/^[d-]/.test(line))
        ) {
            throw new Error(
                "Snapshot contains links or special files; only regular files and directories are allowed.",
            );
        }

        console.info("Restoring and validating the archive snapshot...");
        await execute("tar", ["-xzf", archive, "-C", temporary, "--no-same-owner", "--no-same-permissions"], options);
        const restored = join(temporary, "data");
        await validate(restored);
        await rename(restored, directory);
        console.info("Archive snapshot ready.");
    } finally {
        await rm(temporary, { recursive: true, force: true });
    }
}
