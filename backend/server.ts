import type { IncomingMessage, ServerResponse } from "node:http";

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";

import type { Status } from "../shared/metadata.ts";

import { clearSession, converse } from "./assistant.ts";
import { bootstrap } from "./bootstrap.ts";
import { catalogSummary, emptyCatalog, readVideo, sourceStatus, sourceSummaries } from "./catalog.ts";
import { database } from "./database.ts";
import { filters, retrieve } from "./search.ts";
import { assistanceConfigured, model } from "./settings.ts";
import { Failure, text } from "./validation.ts";

const frontendPath = resolve("dist/frontend");
const development = process.argv.includes("--development");
const publicOrigins = origins("PUBLIC_ORIGINS");
const frameAncestors = origins("FRAME_ANCESTORS");
const framePolicy = frameAncestors.length ? frameAncestors.join(" ") : "'none'";

const media: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
};

let activeChats = 0;

function origins(name: string): string[] {
    const value = process.env[name]?.trim();

    if (!value) {
        return [];
    }

    try {
        return value.split(",").map((entry) => {
            const value = entry.trim();
            const url = new URL(value);

            if (
                !["http:", "https:"].includes(url.protocol) ||
                url.username ||
                url.password ||
                url.hostname.includes("*") ||
                (value !== url.origin && value !== `${url.origin}/`)
            ) {
                throw new Error("Invalid origin.");
            }

            return url.origin;
        });
    } catch {
        throw new Error(
            `${name} must contain comma-separated HTTP(S) origins without credentials, paths, or wildcards.`,
        );
    }
}

function json(response: ServerResponse, value: unknown, status = 200): void {
    response.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
    });

    response.end(JSON.stringify(value));
}

async function body(request: IncomingMessage): Promise<unknown> {
    if (!request.headers["content-type"]?.startsWith("application/json")) {
        throw new Failure("Send an application/json request.", 415);
    }

    let length = 0;
    const chunks: Buffer[] = [];

    for await (const chunk of request) {
        const buffer = Buffer.from(chunk);
        length += buffer.length;

        if (length > 12000) {
            throw new Failure("Request body is too large.", 413);
        }

        chunks.push(buffer);
    }

    try {
        return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
        throw new Failure("Invalid JSON request.");
    }
}

const server = createServer(async (request, response) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");

    response.setHeader(
        "Content-Security-Policy",
        `default-src 'self'; script-src 'self' 'sha256-jO5NLPn5mlneHjNesqDf9CPOef5fsk/8tDA0vR9DrO4='; style-src 'self'; img-src 'self' https://*.ytimg.com; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors ${framePolicy}`,
    );

    try {
        const url = new URL(request.url || "/", "http://localhost");

        if (url.pathname.startsWith("/api/")) {
            if (!["GET", "POST", "DELETE"].includes(request.method || "")) {
                throw new Failure("Method not allowed.", 405);
            }

            if (request.method !== "GET" && request.headers.origin) {
                let origin;

                try {
                    origin = new URL(request.headers.origin);
                } catch {
                    throw new Failure("Cross-origin mutations are not allowed.", 403);
                }

                const validOrigin =
                    ["http:", "https:"].includes(origin.protocol) && origin.origin === request.headers.origin;

                const localDevelopment = development && origin.origin === "http://127.0.0.1:5173";

                const sameOrigin = publicOrigins.length
                    ? publicOrigins.includes(origin.origin)
                    : origin.origin === `http://${request.headers.host}`;

                if (!validOrigin || (!sameOrigin && !localDevelopment)) {
                    throw new Failure("Cross-origin mutations are not allowed.", 403);
                }
            }

            if (url.pathname === "/api/status" && request.method === "GET") {
                const coverage = emptyCatalog().sources.map(sourceStatus);

                const status: Status = {
                    catalog: "missing",
                    error: null,
                    total: 0,
                    unavailable: 0,
                    unknownAvailability: 0,
                    pending: 0,

                    categories: [...new Set(coverage.map((source) => source.category))].map((name) => ({
                        name,
                        count: 0,
                    })),

                    sources: coverage,
                    ingestion: null,
                    suggestions: [],
                    assistance: { configured: assistanceConfigured, model },
                };

                try {
                    const { indexedPublicationRange: _, ...summary } = catalogSummary();
                    Object.assign(status, summary, { sources: summary.sources.map(sourceStatus) });
                    status.catalog = summary.ingestion || summary.total ? "ready" : "missing";
                } catch {
                    status.catalog = "error";

                    status.error =
                        "Catalog could not be loaded. Check its format and storage permissions; existing data has not been overwritten.";
                }

                json(response, status);

                return;
            }

            if (url.pathname.startsWith("/api/chat/") && request.method === "DELETE") {
                const identifier = url.pathname.slice("/api/chat/".length);

                if (!/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(identifier)) {
                    throw new Failure("Invalid conversation identifier.");
                }

                clearSession(identifier);
                response.writeHead(204);
                response.end();

                return;
            }

            try {
                database();
            } catch {
                throw new Failure("Catalog could not be loaded. Check its format and storage permissions.", 503);
            }

            if (url.pathname === "/api/sources" && request.method === "GET") {
                json(response, sourceSummaries());

                return;
            }

            if (url.pathname === "/api/search" && request.method === "GET") {
                const query = text(url.searchParams.get("query") || "", 2000);
                const semantic = url.searchParams.get("semantic");

                if (semantic !== null && semantic !== "true" && semantic !== "false") {
                    throw new Failure("Semantic must be true or false.");
                }

                const selection = filters({
                    ...Object.fromEntries(url.searchParams),
                    categories: url.searchParams.getAll("categories"),
                    playlists: url.searchParams.getAll("playlists"),
                });

                const page = Number(url.searchParams.get("page") || "1");

                if (!Number.isSafeInteger(page) || page < 1 || page > 100000) {
                    throw new Failure("Invalid results page.");
                }

                const controller = new AbortController();
                response.once("close", () => controller.abort());

                const { results, total, notice, coverage } = await retrieve(
                    query ? [query] : [],
                    selection,
                    12,
                    (page - 1) * 12,
                    { semantic: semantic === "true", signal: controller.signal },
                );

                if (coverage !== null) {
                    response.setHeader("X-Archive-Semantic-Coverage", coverage);
                }

                response.setHeader("X-Archive-Retrieval-Status", notice);
                json(response, { results, total, page, notice });

                return;
            }

            if (url.pathname.startsWith("/api/videos/") && request.method === "GET") {
                const identifier = url.pathname.slice("/api/videos/".length);

                if (!/^[\w-]{11}$/.test(identifier)) {
                    throw new Failure("Invalid video identifier.");
                }

                const video = readVideo(identifier);

                if (!video || video.availability !== "available") {
                    throw new Failure("Video metadata is unavailable in this catalog.", 404);
                }

                json(response, video);

                return;
            }

            if (url.pathname === "/api/chat" && request.method === "POST") {
                if (activeChats >= 4) {
                    throw new Failure("Archie is handling several requests. Try again shortly.", 429);
                }

                activeChats++;

                try {
                    json(response, await converse(await body(request)));
                } finally {
                    activeChats--;
                }

                return;
            }

            throw new Failure("API route not found.", 404);
        }

        if (request.method !== "GET" && request.method !== "HEAD") {
            throw new Failure("Method not allowed.", 405);
        }

        const pathname = decodeURIComponent(url.pathname);
        const file = resolve(frontendPath, pathname === "/" ? "index.html" : `.${pathname}`);

        if (!file.startsWith(frontendPath + sep)) {
            throw new Failure("Invalid asset path.", 400);
        }

        let details;

        try {
            details = await stat(file);
        } catch {
            throw new Failure("Frontend asset not found. Run npm run build before production start.", 404);
        }

        if (!details.isFile()) {
            throw new Failure("Asset not found.", 404);
        }

        response.writeHead(200, {
            "Content-Type": media[extname(file)] || "application/octet-stream",
            "Content-Length": details.size,

            "Cache-Control": pathname.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache",
        });

        if (request.method === "HEAD") {
            response.end();
        } else {
            createReadStream(file)
                .on("error", () => response.destroy())
                .pipe(response);
        }
    } catch (error) {
        if (!response.headersSent) {
            json(
                response,
                {
                    error:
                        error instanceof Failure
                            ? error.message
                            : "Request failed. Check local configuration and try again.",
                },
                error instanceof Failure ? error.status : 500,
            );
        } else {
            response.destroy();
        }
    }
});

server.requestTimeout = 15000;
server.headersTimeout = 10000;
const port = Number(process.env.PORT || 3001);
const host = process.env.HOST || "127.0.0.1";

if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535.");
}

server.on("error", () => {
    console.error("Server could not start. Check HOST, PORT, and whether the port is in use.");
    process.exitCode = 1;
});

await bootstrap();

server.listen(port, host, () => console.log(`ArchiveMateAI backend: http://${host}:${port}`));
