import { MultiBar } from "cli-progress";
import { spawn } from "node:child_process";
import { appendFile, mkdir, open, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { stripVTControlCharacters } from "node:util";

import type { Coverage, Ingestion, Video } from "../shared/metadata.ts";

import { readCatalog, sourceChapters, writeCatalog } from "./catalog.ts";
import { catalogPath } from "./settings.ts";
import { sources } from "./sources.ts";
import { choice, date, instant, integer, list, object, text } from "./validation.ts";

const progress = process.stderr.isTTY
    ? new MultiBar({
          format: (_options, parameters, payload) => {
              const line = `${payload.label} ${parameters.value}/${parameters.total} | ${payload.status}`;

              return line.slice(0, Math.max(1, (process.stderr.columns || 80) - 1));
          },
      })
    : null;

function log(message: string): void {
    if (!progress) {
        process.stdout.write(`${message}\n`);
    }
}

class ExtractionFailure extends Error {
    terminal: boolean;

    constructor(message: string, terminal = false) {
        super(message);
        this.terminal = terminal;
    }
}

class StorageFailure extends Error {}

const warningGroups = new Map<string, { count: number; example: string }>();
let diagnosticWrites = Promise.resolve();
let diagnosticBatches = 0;

async function diagnostic(value: unknown): Promise<void> {
    diagnosticWrites = diagnosticWrites
        .then(() =>
            appendFile(`${catalogPath}.log`, JSON.stringify({ time: new Date().toISOString(), detail: value }) + "\n"),
        )
        .catch((error: unknown) => {
            throw new StorageFailure(
                `Cannot save ingestion diagnostics: ${error instanceof Error ? error.message : String(error)}`,
            );
        });

    await diagnosticWrites;
}

function warning(identifier: string, reason: string): void {
    const group = warningGroups.get(reason) || { count: 0, example: identifier };
    group.count++;
    warningGroups.set(reason, group);
}

function elapsed(seconds: number): string {
    const minutes = Math.floor(seconds / 60);

    return minutes >= 60
        ? `${Math.floor(minutes / 60)}h ${minutes % 60}m`
        : minutes
          ? `${minutes}m ${Math.floor(seconds % 60)}s`
          : `${Math.floor(seconds)}s`;
}

function thumbnails(value: unknown): Video["thumbnails"] {
    const images: Video["thumbnails"] = [];

    for (const item of list(value ?? [], 10000)) {
        const thumbnail = object(item);
        const url = new URL(text(thumbnail.url, 2000));

        if (
            url.protocol !== "https:" ||
            !["i.ytimg.com", "i1.ytimg.com", "i2.ytimg.com", "i3.ytimg.com", "i4.ytimg.com"].includes(url.hostname) ||
            url.username ||
            url.password ||
            url.port
        ) {
            continue;
        }

        const width = integer(thumbnail.width ?? 0);
        const height = integer(thumbnail.height ?? 0);

        if (!images.some((thumbnail) => thumbnail.url === url.href)) {
            images.push({ url: url.href, width, height });
        }
    }

    return images.sort((first, second) => second.width - first.width).slice(0, 10);
}

function metadata(record: Record<string, unknown>, video: Video): Video {
    if (text(record.id, 11) !== video.identifier || (record._type != null && record._type !== "video")) {
        throw new ExtractionFailure("yt-dlp returned unexpected or flat video metadata.");
    }

    let publishedAt: string | null = video.publishedAt;

    if (record.timestamp !== null && record.timestamp !== undefined) {
        const timestamp = record.timestamp;

        if (typeof timestamp !== "number" || !Number.isFinite(timestamp) || timestamp < 0) {
            throw new ExtractionFailure("yt-dlp returned an invalid publication timestamp.");
        }

        publishedAt = instant(new Date(timestamp * 1000).toISOString());
    } else if (record.upload_date !== null && record.upload_date !== undefined) {
        const supplied = text(record.upload_date, 8);

        if (!/^\d{8}$/.test(supplied)) {
            throw new ExtractionFailure("yt-dlp returned an invalid upload date.");
        }

        const publication = date(`${supplied.slice(0, 4)}-${supplied.slice(4, 6)}-${supplied.slice(6)}`);

        publishedAt = `${publication}T00:00:00.000Z`;
    }

    let duration: string | null = video.duration;

    if (record.duration !== null && record.duration !== undefined) {
        if (
            typeof record.duration !== "number" ||
            !Number.isFinite(record.duration) ||
            record.duration < 0 ||
            record.duration > Number.MAX_SAFE_INTEGER
        ) {
            throw new ExtractionFailure("yt-dlp returned an invalid duration.");
        }

        duration = `PT${record.duration}S`;
    }

    const broadcast =
        record.live_status == null
            ? null
            : choice(record.live_status, ["not_live", "is_live", "is_upcoming", "was_live", "post_live"]);

    const live =
        broadcast === "is_live"
            ? "live"
            : broadcast === "is_upcoming"
              ? "upcoming"
              : broadcast === null
                ? "unknown"
                : "none";

    const availability =
        record.availability == null
            ? null
            : choice(record.availability, [
                  "public",
                  "unlisted",
                  "private",
                  "premium_only",
                  "subscriber_only",
                  "needs_auth",
              ]);

    const description = text(record.description ?? video.description, 100000);
    const images = thumbnails(record.thumbnails);

    return {
        ...video,
        title: text(record.title ?? video.title, 1000),
        description,
        channel: text(record.channel ?? video.channel, 1000),
        channelIdentifier: text(record.channel_id ?? video.channelIdentifier, 100),
        publishedAt,
        duration,
        language: video.language,
        audioLanguage: record.language == null ? video.audioLanguage : text(record.language, 100),
        thumbnails: images.length ? images : video.thumbnails,
        live,

        availability:
            availability === "private" ||
            availability === "premium_only" ||
            availability === "subscriber_only" ||
            availability === "needs_auth"
                ? "unavailable"
                : availability === "public" || availability === "unlisted"
                  ? "available"
                  : "unknown",

        availabilityReason:
            availability === null
                ? "The extractor did not report availability."
                : availability === "public" || availability === "unlisted"
                  ? null
                  : `yt-dlp reports restricted access: ${availability}.`,

        ingestedAt: new Date().toISOString(),
        details: "complete",
        chapters: live === "none" ? sourceChapters(description, duration) : [],
    };
}

async function extract(
    urls: string[],
    playlist: boolean,
    label: string,
    consume: (record: Record<string, unknown>) => Promise<void>,
): Promise<string | null> {
    const child = spawn(
        "yt-dlp",
        [
            "--ignore-config",
            "--no-plugin-dirs",
            "--no-remote-components",
            "--no-js-runtimes",
            "--js-runtimes",
            `node:${process.execPath}`,
            "--simulate",
            "--skip-download",
            "--no-cache-dir",
            "--no-progress",
            "--encoding",
            "utf-8",
            "--socket-timeout",
            "20",
            "--extractor-retries",
            "2",
            "--retries",
            "2",
            ...(playlist
                ? ["--dump-single-json", "--flat-playlist", "--yes-playlist"]
                : [
                      "--no-playlist",
                      "--no-flat-playlist",
                      "--ignore-no-formats-error",
                      "--extractor-args",
                      "youtube:skip=hls,dash,translated_subs;player_skip=js",
                      "--print",
                      "%(.{id,_type,title,description,channel,channel_id,timestamp,upload_date,duration,live_status,availability,language,thumbnails})j",
                  ]),
            "--",
            ...urls,
        ],
        { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
    );

    let failure: ExtractionFailure | null = null;
    let closed = false;
    let warnings = false;
    let outputBytes = 0;
    let errorBytes = 0;
    const diagnostics: Buffer[] = [];
    let records = 0;
    const started = Date.now();
    const lineLimit = (playlist ? 64 : 1) * 1024 * 1024;
    const outputLimit = (playlist ? 64 : 16) * 1024 * 1024;

    function stop(message: string): void {
        failure ??= new ExtractionFailure(message);
        child.kill();
    }

    const completion = new Promise<number | null>((resolve) => {
        child.on("error", (error: NodeJS.ErrnoException) => {
            failure = new ExtractionFailure(
                error.code === "ENOENT" || error.code === "EACCES"
                    ? "yt-dlp is not executable on PATH. Install it and restart the ingestion environment."
                    : "yt-dlp could not be started. Existing records were retained.",
                true,
            );
        });

        child.on("close", (code) => {
            closed = true;
            resolve(code);
        });
    });

    const idleMilliseconds = playlist ? 180000 : 90000;

    const idle = setTimeout(
        () => stop("yt-dlp exceeded the metadata idle timeout. Existing records were retained."),
        idleMilliseconds,
    );

    const deadline = setTimeout(
        () => stop("yt-dlp exceeded the extraction time limit. Existing records were retained."),
        playlist ? 180000 : urls.length * 90000,
    );

    const progress = setInterval(() => {
        log(
            `${label} | ${playlist ? "waiting for playlist listing" : `${records} metadata records received`} | ${Math.round((Date.now() - started) / 1000)}s elapsed`,
        );
    }, 10000);

    child.stderr.on("data", (chunk: Buffer) => {
        errorBytes += chunk.length;
        warnings ||= Boolean(chunk.toString("utf8").trim());

        if (errorBytes <= 1024 * 1024) {
            diagnostics.push(chunk);
        }

        if (errorBytes > 1024 * 1024) {
            stop("yt-dlp exceeded the diagnostic output limit. Existing records were retained.");
        }
    });

    async function receive(line: Buffer): Promise<void> {
        if (!line.toString("utf8").trim()) {
            return;
        }

        let record: Record<string, unknown>;

        try {
            record = object(JSON.parse(line.toString("utf8")));
        } catch {
            throw new ExtractionFailure("yt-dlp returned malformed metadata.");
        }

        await consume(record);
        records++;
        idle.refresh();
    }

    try {
        let buffered: Buffer[] = [];
        let bufferedBytes = 0;

        for await (const chunk of child.stdout) {
            if (failure) {
                break;
            }

            const bytes = chunk as Buffer;
            outputBytes += bytes.length;

            if (outputBytes > outputLimit) {
                throw new ExtractionFailure(
                    "yt-dlp exceeded the metadata output limit. Existing records were retained.",
                );
            }

            let offset = 0;

            while (offset < bytes.length) {
                const newline = bytes.indexOf(10, offset);
                const end = newline === -1 ? bytes.length : newline;
                const part = bytes.subarray(offset, end);
                bufferedBytes += part.length;

                if (bufferedBytes > lineLimit) {
                    throw new ExtractionFailure("yt-dlp returned an oversized metadata record.");
                }

                buffered.push(part);

                if (newline === -1) {
                    break;
                }

                await receive(Buffer.concat(buffered, bufferedBytes));
                buffered = [];
                bufferedBytes = 0;
                offset = newline + 1;
            }
        }

        if (!failure && bufferedBytes) {
            await receive(Buffer.concat(buffered, bufferedBytes));
        }

        const code = await completion;

        if (failure) {
            throw failure;
        }

        if (code !== 0) {
            return "yt-dlp extraction failed. Access, network, or extractor errors do not establish that footage was deleted.";
        }

        if (!records) {
            throw new ExtractionFailure("yt-dlp returned no metadata.");
        }

        return playlist && warnings ? "yt-dlp reported playlist warnings; coverage may be incomplete." : null;
    } catch (error) {
        throw error instanceof StorageFailure ? error : failure || error;
    } finally {
        clearTimeout(idle);
        clearTimeout(deadline);
        clearInterval(progress);

        if (!closed) {
            child.kill();
            await completion;
        }

        if (diagnostics.length) {
            diagnosticBatches++;

            await diagnostic({
                batch: label,
                stderr: stripVTControlCharacters(Buffer.concat(diagnostics).toString("utf8")),
            });
        }
    }
}

async function ingest(): Promise<void> {
    const arguments_ = process.argv.slice(2);

    const workerOption = arguments_.find((argument) => argument.startsWith("--workers="));
    const workers = workerOption ? Number(workerOption.slice("--workers=".length)) : 4;

    if (
        arguments_.some(
            (argument) => argument !== "--subset" && argument !== "--refresh" && argument !== workerOption,
        ) ||
        !Number.isInteger(workers) ||
        workers < 1 ||
        workers > 8
    ) {
        throw new Error("Supported options: --subset, --refresh, --workers=1..8.");
    }

    log(
        `Starting metadata import | ${workers} parallel workers | ${arguments_.includes("--refresh") ? "synchronizing playlist listings; reusing completed details" : "resuming saved listings and details"}`,
    );

    await mkdir(dirname(catalogPath), { recursive: true });
    const lockPath = `${catalogPath}.lock`;

    let summary = "";

    const lock = await open(lockPath, "wx").catch(() => {
        throw new Error(
            "Ingestion lock exists or storage is unavailable. Ensure no ingestion is running before removing a stale catalog lock.",
        );
    });

    try {
        await lock.writeFile(String(process.pid));
        const catalog = readCatalog();
        const subset = arguments_.includes("--subset");

        const selected = subset ? [sources[0]!, sources[9]!, sources[19]!] : sources;
        const playlists = progress?.create(selected.length, 0, { label: "Playlists", status: "Starting" });
        let listed = 0;
        let saved = 0;
        const videos = new Map(catalog.videos.map((video) => [video.identifier, video]));
        const changed = new Map<string, Video>();
        const fetched = new Map<string, string | null>();
        const observed = new Set<string>();

        const report: Ingestion = {
            startedAt: new Date().toISOString(),
            finishedAt: new Date().toISOString(),
            phase: "listing",
            entries: 0,
            uniqueVideos: 0,
            duplicates: 0,
            unavailable: 0,
            requests: 0,
            failures: 0,
            complete: false,
        };

        const indexed = selected.map((source) => {
            const previous = catalog.sources.find((entry) => entry.identifier === source.identifier)!;

            const listing =
                !arguments_.includes("--refresh") &&
                previous.listing &&
                previous.listing.identifiers.every((identifier) =>
                    videos
                        .get(identifier)
                        ?.memberships.some((membership) => membership.playlistIdentifier === source.identifier),
                )
                    ? previous.listing
                    : null;

            const coverage: Coverage = {
                ...previous,
                status: "partial",
                entries: listing ? previous.entries : 0,
                expected: listing ? previous.expected : null,
                listing,
                unavailable: 0,
                attemptedAt: report.startedAt,
                error: null,
            };

            return { coverage, identifiers: new Set<string>(listing?.identifiers), failed: false };
        });

        let saving = Promise.resolve();
        let pendingSave: Promise<void> | null = null;
        let storageFailure: StorageFailure | null = null;

        async function checkpoint(force = true): Promise<void> {
            if (storageFailure) {
                throw storageFailure;
            }

            if (!force && (pendingSave || Date.now() - saved < 10000)) {
                return pendingSave || Promise.resolve();
            }

            saving = saving
                .then(() => {
                    for (const state of indexed) {
                        state.coverage.unavailable = [...state.identifiers].filter(
                            (identifier) => videos.get(identifier)!.availability === "unavailable",
                        ).length;
                    }

                    catalog.sources = catalog.sources.map(
                        (source) =>
                            indexed.find((state) => state.coverage.identifier === source.identifier)?.coverage ||
                            source,
                    );

                    report.uniqueVideos = observed.size;

                    report.unavailable = [...observed].filter(
                        (identifier) => videos.get(identifier)!.availability === "unavailable",
                    ).length;

                    report.finishedAt = new Date().toISOString();
                    catalog.ingestion = { ...report };
                    writeCatalog(catalog, [...changed.values()]);
                    changed.clear();
                    saved = Date.now();
                })
                .catch((error: unknown) => {
                    storageFailure =
                        error instanceof StorageFailure
                            ? error
                            : new StorageFailure(
                                  `Checkpoint could not be saved; previous catalog retained: ${error instanceof Error ? error.message : String(error)}`,
                              );

                    throw storageFailure;
                });

            pendingSave = saving;

            void saving.then(
                () => {
                    pendingSave = null;
                },
                () => {
                    pendingSave = null;
                },
            );

            return saving;
        }

        let terminalFailure: string | null = null;
        await checkpoint();

        for (const state of indexed) {
            const coverage = state.coverage;
            playlists?.update(listed, { status: `Reading ${coverage.category}` });

            if (coverage.listing) {
                report.entries += coverage.entries;
                report.duplicates += coverage.entries - state.identifiers.size;

                for (const identifier of state.identifiers) {
                    if (observed.has(identifier)) {
                        report.duplicates++;
                    }

                    observed.add(identifier);
                }

                log(
                    `${coverage.identifier} | ${coverage.category} | reusing saved listing | ${coverage.entries} entries | listed ${coverage.listing.completedAt}`,
                );

                await checkpoint();
                playlists?.update(++listed, { status: `Cached: ${coverage.category}` });
                continue;
            }

            try {
                if (terminalFailure) {
                    throw new ExtractionFailure(terminalFailure, true);
                }

                log(`${coverage.identifier} | ${coverage.category} | listing playlist`);
                const playlists: Record<string, unknown>[] = [];
                report.requests++;

                const error = await extract(
                    [`https://www.youtube.com/playlist?list=${coverage.identifier}`],
                    true,
                    `${coverage.identifier} | listing playlist`,
                    async (record) => {
                        if (playlists.length) {
                            throw new ExtractionFailure("yt-dlp returned multiple playlists.");
                        }

                        playlists.push(record);
                    },
                );

                const playlist = playlists[0];

                if (!playlist) {
                    throw new ExtractionFailure(error || "yt-dlp returned no playlist metadata.");
                }

                if (text(playlist.id, 100) !== coverage.identifier || playlist._type !== "playlist") {
                    throw new ExtractionFailure("yt-dlp returned an unexpected playlist.");
                }

                coverage.expected = playlist.playlist_count == null ? null : integer(playlist.playlist_count);
                const entries = list(playlist.entries, 1000000);

                if (error) {
                    state.failed = true;
                    report.failures++;
                    coverage.error = error;
                }

                log(`${coverage.identifier} | ${entries.length}/${coverage.expected ?? "unknown"} entries listed`);

                for (let offset = 0; offset < entries.length; offset += 25) {
                    for (const item of entries.slice(offset, offset + 25)) {
                        coverage.entries++;
                        report.entries++;

                        try {
                            const entry = object(item);
                            const identifier = text(entry.id, 11);

                            if (!/^[\w-]{11}$/.test(identifier)) {
                                throw new ExtractionFailure("yt-dlp returned an invalid video identifier.");
                            }

                            const title = text(entry.title ?? "", 1000);
                            const channel = text(entry.channel ?? entry.uploader ?? "", 1000);
                            const channelIdentifier = text(entry.channel_id ?? entry.uploader_id ?? "", 100);
                            const images = thumbnails(entry.thumbnails);

                            const availability =
                                entry.availability == null
                                    ? null
                                    : choice(entry.availability, [
                                          "public",
                                          "unlisted",
                                          "private",
                                          "premium_only",
                                          "subscriber_only",
                                          "needs_auth",
                                      ]);

                            const restricted =
                                availability !== null && availability !== "public" && availability !== "unlisted";

                            let video = videos.get(identifier);

                            if (!video) {
                                video = {
                                    identifier,
                                    title,
                                    description: "",
                                    channel,
                                    channelIdentifier,
                                    publishedAt: null,
                                    duration: null,
                                    language: null,
                                    audioLanguage: null,
                                    thumbnails: images,
                                    url: `https://www.youtube.com/watch?v=${identifier}`,
                                    ingestedAt: report.startedAt,
                                    details: "pending",
                                    availability: restricted ? "unavailable" : "unknown",

                                    availabilityReason: restricted
                                        ? `yt-dlp reports restricted access: ${availability}.`
                                        : "Video details are still being collected; availability has not been confirmed.",

                                    live: "unknown",
                                    memberships: [],
                                    chapters: [],
                                };
                            } else if (video.details === "pending") {
                                video = {
                                    ...video,
                                    title: title || video.title,
                                    channel: channel || video.channel,
                                    channelIdentifier: channelIdentifier || video.channelIdentifier,
                                    thumbnails: images.length ? images : video.thumbnails,
                                };
                            }

                            if (!video.memberships.some((entry) => entry.playlistIdentifier === coverage.identifier)) {
                                video.memberships.push({
                                    playlistIdentifier: coverage.identifier,
                                    category: coverage.category,
                                    addedAt: null,
                                });
                            }

                            videos.set(identifier, video);
                            changed.set(identifier, video);

                            if (observed.has(identifier)) {
                                report.duplicates++;
                            }

                            observed.add(identifier);
                            state.identifiers.add(identifier);
                        } catch (error) {
                            state.failed = true;
                            report.failures++;

                            coverage.error =
                                error instanceof ExtractionFailure
                                    ? error.message
                                    : "A playlist entry could not be validated; previous records were retained.";
                        }
                    }
                }

                if (coverage.expected === null || coverage.entries !== coverage.expected) {
                    state.failed = true;
                    report.failures++;

                    coverage.error =
                        coverage.expected === null
                            ? "The playlist total was not reported; source completeness could not be confirmed."
                            : "Playlist entry count differs from the reported total. Entries may be hidden or the playlist may have changed; refresh this source.";
                }

                if (!state.failed) {
                    coverage.listing = {
                        completedAt: new Date().toISOString(),
                        identifiers: [...state.identifiers],
                    };
                }
            } catch (error) {
                if (error instanceof StorageFailure) {
                    throw error;
                }

                state.failed = true;
                report.failures++;
                coverage.status = coverage.entries ? "partial" : "failed";

                coverage.error =
                    error instanceof ExtractionFailure
                        ? error.message
                        : "Playlist metadata could not be validated; previous records were retained.";

                if (error instanceof ExtractionFailure && error.terminal) {
                    terminalFailure = error.message;
                }
            }

            await checkpoint();
            playlists?.update(++listed, { status: coverage.error || coverage.category });

            if (coverage.error) {
                warning(coverage.identifier, coverage.error);
                await diagnostic({ playlist: coverage.identifier, warning: coverage.error });
            }
        }

        report.phase = "enriching";
        await checkpoint();

        const identifiers = [...observed].filter((identifier) => {
            const video = videos.get(identifier)!;

            if (
                video.details === "complete" &&
                (video.availability === "unavailable" || (video.live !== "live" && video.live !== "upcoming"))
            ) {
                fetched.set(identifier, null);

                return false;
            }

            return true;
        });

        log(
            `Index ready | ${observed.size} unique videos | ${observed.size - identifiers.length} cached | ${identifiers.length} to extract`,
        );

        let next = 0;
        let completed = 0;
        const started = Date.now();

        const videosProgress = progress?.create(identifiers.length, 0, {
            label: "Videos",
            status: `${observed.size - identifiers.length} cached`,
        });

        const heartbeat = setInterval(() => {
            const seconds = Math.max(1, (Date.now() - started) / 1000);

            videosProgress?.update(completed, {
                status: `ETA ${completed ? elapsed(((identifiers.length - completed) * seconds) / completed) : "--"} | ${(completed / seconds).toFixed(1)}/s | ${report.failures} issues | saved ${saved ? elapsed((Date.now() - saved) / 1000) : "--"} ago`,
            });

            playlists?.update({ status: `${observed.size - identifiers.length} cached | ${elapsed(seconds)} elapsed` });
        }, 1000);

        async function work(): Promise<void> {
            while (next < identifiers.length) {
                if (storageFailure) {
                    throw storageFailure;
                }

                const offset = next;
                next += 25;

                const pending = new Map(
                    identifiers.slice(offset, offset + 25).map((identifier) => [identifier, videos.get(identifier)!]),
                );

                const received = new Set<string>();
                const label = `Video details ${offset + 1}-${offset + pending.size}/${identifiers.length}`;
                let batchError: string | null = terminalFailure;
                log(`${label} | fetching ${pending.size} video records`);

                if (!terminalFailure) {
                    try {
                        report.requests++;

                        batchError = await extract(
                            [...pending.values()].map((video) => video.url),
                            false,
                            label,
                            async (record) => {
                                if (storageFailure) {
                                    throw storageFailure;
                                }

                                const identifier = text(record.id, 11);
                                const video = pending.get(identifier);

                                if (!video || received.has(identifier)) {
                                    throw new ExtractionFailure(
                                        "yt-dlp returned an unexpected or duplicate video record.",
                                    );
                                }

                                received.add(identifier);

                                try {
                                    const updated = metadata(record, video);
                                    videos.set(identifier, updated);
                                    changed.set(identifier, updated);

                                    fetched.set(identifier, null);
                                } catch {
                                    fetched.set(
                                        identifier,
                                        "Video metadata could not be validated; existing records were retained.",
                                    );
                                }

                                await checkpoint(false);

                                completed++;
                                const seconds = Math.max(1, (Date.now() - started) / 1000);
                                const remaining = Math.ceil(((identifiers.length - completed) * seconds) / completed);

                                log(
                                    `${completed}/${identifiers.length} | ${identifier} | ${fetched.get(identifier) || "metadata received"} | ${(completed / seconds).toFixed(2)} videos/s | elapsed ${Math.round(seconds)}s | estimated remaining ${remaining}s`,
                                );
                            },
                        );
                    } catch (error) {
                        if (error instanceof StorageFailure) {
                            storageFailure = error;
                            throw error;
                        }

                        batchError =
                            error instanceof ExtractionFailure
                                ? error.message
                                : "Video metadata extraction failed; existing records were retained.";

                        if (error instanceof ExtractionFailure && error.terminal) {
                            terminalFailure = error.message;
                        }
                    }
                }

                for (const identifier of pending.keys()) {
                    if (!received.has(identifier)) {
                        completed++;
                    }

                    if (!fetched.has(identifier) || (batchError && fetched.get(identifier) === null)) {
                        fetched.set(
                            identifier,
                            batchError || "yt-dlp returned no metadata for this video; existing records were retained.",
                        );
                    }

                    if (fetched.get(identifier)) {
                        report.failures++;
                        warning(identifier, fetched.get(identifier)!);
                    }
                }

                const issues = [...pending.keys()]
                    .filter((identifier) => fetched.get(identifier))
                    .map((identifier) => ({ identifier, reason: fetched.get(identifier) }));

                if (issues.length) {
                    await diagnostic({ batch: label, issues });
                }

                await checkpoint(false);
                log(`${label} | batch complete | ${report.failures} issues`);
            }
        }

        const outcomes = await Promise.allSettled(Array.from({ length: workers }, () => work())).finally(() =>
            clearInterval(heartbeat),
        );

        videosProgress?.update(completed, { status: `${report.failures} issues | finishing` });

        for (const outcome of outcomes) {
            if (outcome.status === "rejected") {
                throw outcome.reason;
            }
        }

        for (const state of indexed) {
            for (const identifier of state.identifiers) {
                const failure = fetched.get(identifier);

                if (failure) {
                    state.failed = true;
                    state.coverage.error = failure;
                }
            }

            if (!state.failed) {
                state.coverage.status = "complete";
                state.coverage.completedAt = new Date().toISOString();
            }

            log(
                `${state.coverage.identifier} | ${state.coverage.category} | ${state.coverage.status} | ${state.coverage.entries}/${state.coverage.expected ?? "unknown"} entries${state.coverage.error ? ` | ${state.coverage.error}` : ""}`,
            );
        }

        report.phase = "finished";

        report.complete =
            selected.length === sources.length &&
            indexed.every((state) => state.coverage.status === "complete") &&
            report.failures === 0;

        await checkpoint();

        summary = `\nImport ${report.failures ? "finished with unresolved metadata" : "finished"}\nPlaylists: ${selected.length} processed, ${indexed.filter((state) => state.coverage.status === "complete").length} complete\nVideos: ${observed.size} unique, ${observed.size - identifiers.length} cached, ${completed} processed\nUnresolved metadata issues: ${report.failures}\nCatalog: ${catalogPath}`;

        if (report.failures) {
            process.exitCode = 2;
        }
    } finally {
        progress?.stop();

        if (summary) {
            console.info(summary);
        }

        for (const [reason, group] of warningGroups) {
            console.info(`${group.count} affected | ${reason} | example: ${group.example}`);
        }

        if (diagnosticBatches) {
            console.info(
                `${diagnosticBatches} extractor batches wrote diagnostics; see the log for playback warnings and extraction errors.`,
            );
        }

        if (warningGroups.size || diagnosticBatches) {
            console.info(`Full diagnostics: ${catalogPath}.log`);
        }

        await lock.close();
        await rm(lockPath, { force: true });
    }
}

await ingest().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Ingestion failed.");
    process.exitCode = 1;
});
