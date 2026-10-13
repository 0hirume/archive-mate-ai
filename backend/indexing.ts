import { MultiBar } from "cli-progress";
import { mkdir, open, rm } from "node:fs/promises";
import { dirname } from "node:path";

import { parseVideo } from "./catalog.ts";
import { database } from "./database.ts";
import { embed, prepareVideo, semanticCoverage } from "./embeddings.ts";
import { embeddingDimensions, embeddingIdentity, loadExtraction, loadTokenizer, modelDirectory } from "./model.ts";
import { saveNeighbors } from "./neighbors.ts";
import { preparationRevision, preparePassages, sourceFingerprint } from "./passages.ts";
import { catalogPath } from "./settings.ts";
import { sources } from "./sources.ts";

function elapsed(seconds: number): string {
    const minutes = Math.floor(seconds / 60);

    return minutes >= 60
        ? `${Math.floor(minutes / 60)}h ${minutes % 60}m`
        : minutes
          ? `${minutes}m ${Math.floor(seconds % 60)}s`
          : `${Math.floor(seconds)}s`;
}

async function index(): Promise<void> {
    const arguments_ = process.argv.slice(2);
    const limitOption = arguments_.find((value) => value.startsWith("--limit="));
    const inferencesOption = arguments_.find((value) => value.startsWith("--maximum-inferences="));
    const categoryOption = arguments_.find((value) => value.startsWith("--category="));
    const limit = limitOption ? Number(limitOption.slice("--limit=".length)) : -1;

    const maximumInferences = inferencesOption
        ? Number(inferencesOption.slice("--maximum-inferences=".length))
        : Infinity;

    const category = categoryOption?.slice("--category=".length) || "";
    const dryRun = arguments_.includes("--dry-run");
    const preparation = arguments_.includes("--prepare");
    const download = arguments_.includes("--download");
    const status = arguments_.includes("--status");
    const neighbors = arguments_.includes("--neighbors");

    if (
        new Set(arguments_).size !== arguments_.length ||
        arguments_.some(
            (value) =>
                ![
                    "--status",
                    "--dry-run",
                    "--prepare",
                    "--download",
                    "--neighbors",
                    limitOption,
                    inferencesOption,
                    categoryOption,
                ].includes(value),
        ) ||
        ["--limit=", "--maximum-inferences=", "--category="].some(
            (prefix) => arguments_.filter((value) => value.startsWith(prefix)).length > 1,
        ) ||
        (limitOption !== undefined && (!Number.isSafeInteger(limit) || limit < 1)) ||
        (inferencesOption !== undefined && (!Number.isSafeInteger(maximumInferences) || maximumInferences < 1)) ||
        (categoryOption !== undefined && !sources.some((source) => source.category === category)) ||
        Number(dryRun) + Number(preparation) + Number(download) + Number(status) + Number(neighbors) > 1 ||
        ((status || download || neighbors) && arguments_.length > 1) ||
        ((dryRun || preparation) && inferencesOption !== undefined) ||
        (dryRun && limitOption !== undefined)
    ) {
        throw new Error(
            "Use bun run index to process all missing or stale available metadata; optional --limit=<positive integer>, --maximum-inferences=<positive integer>, and --category=<exact category> bound the work. Other modes: --status, --dry-run, --prepare, --download, --neighbors. The neighbors mode builds native retrieval from saved vectors without embeddings. All embeddings run locally; only --download permits model downloads.",
        );
    }

    if (download) {
        const extraction = await loadExtraction(true);
        console.info(JSON.stringify({ modelDirectory, downloaded: true, identity: embeddingIdentity }));
        await extraction.dispose();

        return;
    }

    const connection = database();

    if (status) {
        const report = connection.prepare("SELECT data FROM state WHERE name = 'indexing'").get();

        console.info(
            JSON.stringify({ coverage: semanticCoverage(), lastRun: report ? JSON.parse(String(report.data)) : null }),
        );

        return;
    }

    if (neighbors) {
        console.info("Building native neighbor retrieval from saved local vectors.");
        console.info(JSON.stringify({ neighbors: saveNeighbors() }));

        return;
    }

    const tokenizer = await loadTokenizer().catch(() => {
        throw new Error(
            "Local tokenizer is missing or unreadable. Run bun run index --download explicitly before preparing or indexing metadata.",
        );
    });

    const selection = category ? "AND videos.identifier IN (SELECT video FROM memberships WHERE category = ?)" : "";
    const selectionParameters = category ? [category] : [];

    const pending = preparation
        ? "(preparations.revision IS NULL OR preparations.revision != ?)"
        : `(
        preparations.revision IS NULL OR preparations.revision != ? OR EXISTS (
            SELECT 1 FROM passages LEFT JOIN vectors
                ON vectors.fingerprint = passages.fingerprint AND vectors.identity = ?
            WHERE passages.video = videos.identifier AND vectors.fingerprint IS NULL
        )
    )`;

    const pendingParameters = preparation ? [preparationRevision] : [preparationRevision, embeddingIdentity];

    const pendingVideos = Number(
        connection
            .prepare(`
        SELECT COUNT(*) AS total FROM videos LEFT JOIN preparations ON preparations.video = videos.identifier
        WHERE videos.availability = 'available' ${selection} AND ${pending}
    `)
            .get(...selectionParameters, ...pendingParameters)!.total,
    );

    const cached = new Set(
        connection
            .prepare("SELECT fingerprint FROM vectors WHERE identity = ?")
            .all(embeddingIdentity)
            .map((row) => String(row.fingerprint)),
    );

    if (dryRun) {
        const missing = new Set<string>();
        let videos = 0;
        let passages = 0;
        let titleOnly = 0;
        let characters = 0;
        let bytes = 0;
        let tokens = 0;

        for (const row of connection
            .prepare(`SELECT videos.data FROM videos WHERE availability = 'available' ${selection} ORDER BY identifier`)
            .iterate(...selectionParameters)) {
            const video = parseVideo(JSON.parse(String(row.data)));
            const prepared = preparePassages(video, tokenizer);
            videos++;
            passages += prepared.length;

            if (!prepared.some((passage) => passage.field === "description")) {
                titleOnly++;
            }

            for (const passage of prepared) {
                if (cached.has(passage.fingerprint) || missing.has(passage.fingerprint)) {
                    continue;
                }

                missing.add(passage.fingerprint);
                characters += passage.content.length;
                bytes += Buffer.byteLength(passage.content);
                tokens += tokenizer.encode(passage.content).length;
            }
        }

        console.info(
            JSON.stringify({
                mode: "dry-run",
                coverage: semanticCoverage(),
                category: category || null,
                availableVideos: videos,
                titleOnlyVideos: titleOnly,
                preparedPassages: passages,
                pendingVideos,
                missingUniquePassages: missing.size,
                inputCharacters: characters,
                inputUtf8Bytes: bytes,
                inputTokens: tokens,
                vectorBytes: missing.size * embeddingDimensions * 4,
                embeddingApiCostUsd: 0,

                assumptions:
                    "Exact pinned local tokenizer counts include document prefixes, category context, special tokens, and overlap. Model inputs never exceed 512 tokens. No embeddings are computed by dry-run. Disk estimate covers missing vector payloads, not SQLite/provenance overhead.",
            }),
        );

        return;
    }

    const selected = connection
        .prepare(`
        SELECT videos.identifier FROM videos LEFT JOIN preparations ON preparations.video = videos.identifier
        WHERE videos.availability = 'available' ${selection} AND ${pending}
        ORDER BY videos.identifier LIMIT ?
    `)
        .all(...selectionParameters, ...pendingParameters, limit)
        .map((row) => String(row.identifier));

    await mkdir(dirname(catalogPath), { recursive: true });
    const lockPath = `${catalogPath}.embedding.lock`;

    const lock = await open(lockPath, "wx").catch(() => {
        throw new Error(
            "Embedding lock exists or storage is unavailable. Confirm no indexing process is running before removing a stale lock.",
        );
    });

    const controller = new AbortController();
    const interrupt = () => controller.abort();
    process.once("SIGINT", interrupt);
    process.once("SIGTERM", interrupt);

    const report = {
        identity: embeddingIdentity,
        category: category || null,
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        outcome: "running",
        selectedVideos: selected.length,
        pendingVideos,
        processedVideos: 0,
        completedVideos: 0,
        attemptedInferences: 0,
        savedVectors: 0,
        maximumInferences: Number.isFinite(maximumInferences) ? maximumInferences : null,
        failure: "",
    };

    let publishedAt = 0;

    const availableVideos = Number(
        connection
            .prepare(`SELECT COUNT(*) AS total FROM videos WHERE availability = 'available' ${selection}`)
            .get(...selectionParameters)!.total,
    );

    const cachedVideos = availableVideos - pendingVideos;
    const started = Date.now();
    let cachedPassages = 0;
    let passageTotal = 0;
    let passageCompleted = 0;
    let progress: MultiBar | null = null;
    let heartbeat: NodeJS.Timeout | undefined;
    let updateProgress: (() => void) | undefined;

    function checkpoint(publish = true): void {
        report.updatedAt = new Date().toISOString();

        connection
            .prepare(
                "INSERT INTO state(name, data) VALUES ('indexing', ?) ON CONFLICT(name) DO UPDATE SET data = excluded.data",
            )
            .run(JSON.stringify(report));

        if (preparation && publish && (Date.now() - publishedAt >= 5000 || report.outcome !== "running")) {
            console.info(JSON.stringify(report));
            publishedAt = Date.now();
        }

        updateProgress?.();
    }

    try {
        await lock.writeFile(String(process.pid));
        checkpoint();

        if (!preparation) {
            progress = process.stderr.isTTY
                ? new MultiBar({
                      format: (_options, parameters, payload) =>
                          `${payload.label} ${parameters.value}/${parameters.total} | ${payload.status}`.slice(
                              0,
                              Math.max(1, (process.stderr.columns || 80) - 1),
                          ),
                  })
                : null;

            const videosProgress = progress?.create(selected.length, 0, { label: "Videos", status: "Starting" });
            const passagesProgress = progress?.create(0, 0, { label: "Passages", status: "Starting" });

            updateProgress = () => {
                const seconds = Math.max(1, (Date.now() - started) / 1000);
                const speed = report.completedVideos / seconds;
                const remaining = selected.length - report.completedVideos;
                const estimate = remaining ? (speed ? elapsed(Math.ceil(remaining / speed)) : "--") : "0s";
                const timing = `ETA ${estimate} | ${speed.toFixed(1)}/s | ${elapsed(seconds)} elapsed`;
                const saved = `${cachedPassages} reused passages | ${report.savedVectors} saved vectors`;

                videosProgress?.update(report.completedVideos, {
                    status: `ETA ${estimate} | ${speed.toFixed(1)}/s | ${cachedVideos} cached`,
                });

                passagesProgress?.setTotal(passageTotal);

                passagesProgress?.update(passageCompleted, {
                    status: `${report.savedVectors} vectors saved | ${elapsed(seconds)} elapsed | saved ${elapsed(Math.max(0, (Date.now() - Date.parse(report.updatedAt)) / 1000))} ago`,
                });

                if (!progress && Date.now() - publishedAt >= 5000) {
                    console.info(
                        `Indexing ${report.completedVideos}/${selected.length} videos complete | ${cachedVideos} cached videos | current video passages ${passageCompleted}/${passageTotal} | ${saved} | ${timing}`,
                    );

                    publishedAt = Date.now();
                }
            };

            updateProgress();
            heartbeat = setInterval(updateProgress, 1000);
        }

        for (const identifier of selected) {
            if (controller.signal.aborted) {
                break;
            }

            const row = connection
                .prepare("SELECT data FROM videos WHERE identifier = ? AND availability = 'available'")
                .get(identifier);

            if (!row) {
                continue;
            }

            const video = parseVideo(JSON.parse(String(row.data)));
            const passages = preparePassages(video, tokenizer);
            passageTotal = passages.length;
            passageCompleted = 0;
            connection.exec("BEGIN IMMEDIATE");

            try {
                prepareVideo(video, passages);
                connection.exec("COMMIT");
            } catch (error) {
                connection.exec("ROLLBACK");
                throw error;
            }

            report.processedVideos++;

            if (!preparation) {
                for (const passage of passages) {
                    if (controller.signal.aborted) {
                        break;
                    }

                    if (cached.has(passage.fingerprint)) {
                        cachedPassages++;
                        passageCompleted++;
                        continue;
                    }

                    if (report.attemptedInferences >= maximumInferences) {
                        break;
                    }

                    report.attemptedInferences++;
                    const result = await embed(passage.content, controller.signal);
                    cached.add(passage.fingerprint);

                    if (result.computed) {
                        report.savedVectors++;
                    } else {
                        cachedPassages++;
                    }

                    passageCompleted++;
                    checkpoint(false);
                }

                const current = connection
                    .prepare("SELECT fingerprint FROM preparations WHERE video = ?")
                    .get(identifier);

                if (
                    current?.fingerprint === sourceFingerprint(video) &&
                    passages.length &&
                    passages.every((passage) => cached.has(passage.fingerprint))
                ) {
                    report.completedVideos++;
                }

                if (report.attemptedInferences >= maximumInferences) {
                    break;
                }
            }

            checkpoint();
        }

        report.outcome = controller.signal.aborted
            ? "interrupted"
            : report.processedVideos < selected.length ||
                (!preparation && report.completedVideos < selected.length) ||
                selected.length < pendingVideos
              ? "bounded"
              : "finished";

        if (controller.signal.aborted) {
            process.exitCode = 2;
        }
    } catch (error) {
        report.outcome = controller.signal.aborted ? "interrupted" : "failed";
        report.failure = error instanceof Error ? error.message : "Local indexing failed; saved vectors were retained.";
        process.exitCode = 1;
    } finally {
        clearInterval(heartbeat);
        process.removeListener("SIGINT", interrupt);
        process.removeListener("SIGTERM", interrupt);

        try {
            try {
                updateProgress?.();
            } finally {
                progress?.stop();
                updateProgress = undefined;
            }

            checkpoint();
            const coverage = semanticCoverage();

            if (!preparation && report.outcome !== "interrupted" && report.outcome !== "failed") {
                console.info("Updating native neighbor retrieval from saved local vectors.");

                try {
                    console.info(JSON.stringify({ neighbors: saveNeighbors() }));
                } catch (error) {
                    report.outcome = "failed";

                    report.failure =
                        error instanceof Error ? error.message : "Native neighbor snapshot could not be saved.";

                    process.exitCode = 1;
                    checkpoint();
                }
            }

            if (preparation) {
                console.info(JSON.stringify({ coverage }));
            } else {
                const seconds = Math.max(1, (Date.now() - started) / 1000);

                console.info(
                    `\nIndexing ${report.outcome}${category ? ` | ${category}` : ""}\nVideos: ${report.completedVideos}/${selected.length} complete, ${report.processedVideos} processed, ${pendingVideos} pending at start\nVectors: ${report.savedVectors} saved, ${cachedPassages} cached passages, ${report.attemptedInferences}${report.maximumInferences === null ? "" : `/${report.maximumInferences}`} attempted inferences\nTime: ${elapsed(seconds)} elapsed, ${(report.completedVideos / seconds).toFixed(1)} videos/s\nCoverage: ${coverage.indexed}/${coverage.total} videos indexed, ${coverage.embedded}/${coverage.passages} passages embedded\nCatalog: ${catalogPath}${report.failure ? `\nFailure: ${report.failure}` : ""}${report.outcome === "finished" ? "" : "\nSaved work retained; rerun bun run index to resume."}`,
                );
            }
        } finally {
            await lock.close();
            await rm(lockPath, { force: true });
        }
    }
}

await index().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Local embedding indexing failed.");
    process.exitCode = 1;
});
