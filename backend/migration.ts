import { mkdir, open, readFile, rm, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { parseCatalog, writeCatalog } from "./catalog.ts";
import { database } from "./database.ts";
import { catalogPath } from "./settings.ts";

async function migrate(): Promise<void> {
    if (process.argv.length !== 3) {
        throw new Error("Usage: bun run migrate <catalog.json>. CATALOG_PATH selects the destination SQLite database.");
    }

    const original = resolve(process.argv[2]!);

    if (original === catalogPath) {
        throw new Error("The migration destination must differ from the original JSON catalog.");
    }

    await mkdir(dirname(catalogPath), { recursive: true });
    const lockPath = `${catalogPath}.lock`;
    const lock = await open(lockPath, "wx");

    try {
        const sourceLock = await stat(`${original}.lock`).catch((error: NodeJS.ErrnoException) => {
            if (error.code !== "ENOENT") {
                throw error;
            }

            return null;
        });

        if (sourceLock) {
            throw new Error("The source catalog has an ingestion lock. Finish ingestion before migrating.");
        }

        const before = await stat(original);
        const catalog = parseCatalog(JSON.parse(await readFile(original, "utf8")));
        const after = await stat(original);

        if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
            throw new Error("The source catalog changed during migration. Stop ingestion and retry.");
        }

        const connection = database();

        if (
            connection
                .prepare("SELECT 1 FROM videos UNION ALL SELECT 1 FROM sources UNION ALL SELECT 1 FROM state LIMIT 1")
                .get()
        ) {
            throw new Error("Destination catalog is not empty. Existing data has not been overwritten.");
        }

        const videos = new Map(catalog.videos.map((video) => [video.identifier, video]));

        for (const source of catalog.sources) {
            if (!source.listing) {
                continue;
            }

            for (const identifier of source.listing.identifiers) {
                const video = videos.get(identifier);

                if (!video?.memberships.some((membership) => membership.playlistIdentifier === source.identifier)) {
                    throw new Error(`Saved playlist ${source.identifier} references missing metadata or membership.`);
                }
            }

            source.unavailable = source.listing.identifiers.filter(
                (identifier) => videos.get(identifier)!.availability === "unavailable",
            ).length;
        }

        writeCatalog(catalog, catalog.videos);
        const expectedMemberships = catalog.videos.reduce((total, video) => total + video.memberships.length, 0);
        const savedVideos = Number(connection.prepare("SELECT COUNT(*) AS total FROM videos").get()!.total);
        const savedMemberships = Number(connection.prepare("SELECT COUNT(*) AS total FROM memberships").get()!.total);
        const savedSources = Number(connection.prepare("SELECT COUNT(*) AS total FROM sources").get()!.total);

        if (
            savedVideos !== catalog.videos.length ||
            savedMemberships !== expectedMemberships ||
            savedSources !== catalog.sources.length
        ) {
            throw new Error("Migration record counts do not match. The original JSON catalog is unchanged.");
        }

        connection.exec("INSERT INTO footage(footage, rank) VALUES ('integrity-check', 1)");

        if (
            connection.prepare("PRAGMA integrity_check").get()!.integrity_check !== "ok" ||
            connection.prepare("PRAGMA foreign_key_check").all().length
        ) {
            throw new Error("Database integrity check failed. The original JSON catalog is unchanged.");
        }

        console.info(
            `Migrated ${savedVideos} videos, ${savedMemberships} memberships, and ${savedSources} sources to ${catalogPath}.`,
        );

        console.info(
            `Coverage: ${catalog.sources.filter((source) => source.status === "complete").length} complete sources; ${catalog.ingestion?.failures ?? 0} unresolved metadata issues.`,
        );

        console.info(`Original JSON retained unchanged: ${original}`);
    } finally {
        await lock.close();
        await rm(lockPath, { force: true });
    }
}

await migrate().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Catalog migration failed.");
    process.exitCode = 1;
});
