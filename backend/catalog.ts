import type { Catalog, Chapter, Coverage, Ingestion, SourceStatus, SourceSummary, Video } from "../shared/metadata.ts";

import { database } from "./database.ts";
import { searchRevision, searchableDescription } from "./passages.ts";
import { durationSeconds, titleKey } from "./sort.ts";
import { sources } from "./sources.ts";
import { choice, instant, integer, list, nullableText, object, text } from "./validation.ts";

export function emptyCatalog(): Catalog {
    return {
        version: 1,
        videos: [],
        ingestion: null,

        sources: sources.map((source) => ({
            ...source,
            status: "pending",
            entries: 0,
            expected: null,
            unavailable: 0,
            attemptedAt: null,
            completedAt: null,
            listing: null,
            error: null,
        })),
    };
}

export { durationSeconds } from "./sort.ts";

export function sourceChapters(description: string, duration: string | null): Chapter[] {
    const length = durationSeconds(duration);

    if (length === null || length <= 0) {
        return [];
    }

    const chapters: Chapter[] = [];

    for (const line of description.split(/\r?\n/)) {
        const match = line.match(/^\s*(?:[-•]\s*)?(\d{1,3}:\d{2}(?::\d{2})?)\s+(?:[-–—]\s*)?(.+?)\s*$/);

        if (!match) {
            continue;
        }

        const components = match[1]!.split(":").map(Number);

        if (components.slice(1).some((component) => component > 59)) {
            continue;
        }

        const seconds = components.reduce((total, component) => total * 60 + component, 0);

        if (seconds >= length || chapters.some((chapter) => chapter.seconds === seconds)) {
            continue;
        }

        chapters.push({ seconds, title: match[2]! });
    }

    return chapters.sort((first, second) => first.seconds - second.seconds);
}

export function parseVideo(value: unknown): Video {
    const record = object(value);
    const identifier = text(record.identifier, 11);

    if (!/^[\w-]{11}$/.test(identifier)) {
        throw new Error("Invalid catalog video identifier.");
    }

    const title = text(record.title, 1000);
    const description = text(record.description, 100000);
    const duration = nullableText(record.duration, 100);
    const ingestedAt = instant(record.ingestedAt);

    if (!ingestedAt) {
        throw new Error("Missing ingestion date.");
    }

    const thumbnails = list(record.thumbnails, 10).map((item) => {
        const thumbnail = object(item);
        const url = new URL(text(thumbnail.url, 2000));

        if (
            url.protocol !== "https:" ||
            !url.hostname.endsWith(".ytimg.com") ||
            Boolean(url.username || url.password || url.port)
        ) {
            throw new Error("Invalid catalog thumbnail.");
        }

        return {
            url: url.href,
            width: integer(thumbnail.width),
            height: integer(thumbnail.height),
        };
    });

    return {
        identifier,
        title,
        description,
        duration,
        thumbnails,
        channel: text(record.channel, 1000),
        channelIdentifier: text(record.channelIdentifier, 100),
        publishedAt: instant(record.publishedAt),
        language: nullableText(record.language, 100),
        audioLanguage: nullableText(record.audioLanguage, 100),
        url: `https://www.youtube.com/watch?v=${identifier}`,

        details: choice(
            record.details ??
                (record.availability === "unknown" && !description && !record.channel && !thumbnails.length
                    ? "pending"
                    : "complete"),
            ["pending", "complete"],
        ),

        availability: choice(record.availability, ["available", "unavailable", "unknown"]),
        live: choice(record.live, ["none", "live", "upcoming", "unknown"]),
        ingestedAt,
        availabilityReason: nullableText(record.availabilityReason),

        memberships: list(record.memberships, 1000).map((item) => {
            const membership = object(item);
            const playlistIdentifier = text(membership.playlistIdentifier, 100);
            const source = sources.find((source) => source.identifier === playlistIdentifier);

            if (!source || source.category !== membership.category) {
                throw new Error("Invalid catalog source membership.");
            }

            return {
                playlistIdentifier,
                category: source.category,
                addedAt: instant(membership.addedAt),
            };
        }),

        chapters: record.live === "none" ? sourceChapters(description, duration) : [],
    };
}

function parseCoverage(value: unknown): Coverage {
    const record = object(value);
    const identifier = text(record.identifier, 100);
    const source = sources.find((source) => source.identifier === identifier);

    if (!source || source.category !== record.category) {
        throw new Error("Invalid catalog source.");
    }

    let listing: Coverage["listing"] = null;

    if (record.listing != null) {
        const saved = object(record.listing);
        const completedAt = instant(saved.completedAt);

        const identifiers = list(saved.identifiers, 1000000).map((value) => {
            const identifier = text(value, 11);

            if (!/^[\w-]{11}$/.test(identifier)) {
                throw new Error("Invalid saved playlist identifier.");
            }

            return identifier;
        });

        if (
            !completedAt ||
            new Set(identifiers).size !== identifiers.length ||
            record.expected !== record.entries ||
            identifiers.length > integer(record.entries)
        ) {
            throw new Error("Invalid completed playlist listing.");
        }

        listing = { completedAt, identifiers };
    }

    return {
        ...source,
        status: choice(record.status, ["complete", "partial", "failed", "pending"]),
        entries: integer(record.entries),
        expected: record.expected === null ? null : integer(record.expected),
        unavailable: integer(record.unavailable),
        attemptedAt: instant(record.attemptedAt),
        completedAt: instant(record.completedAt),
        listing,
        error: nullableText(record.error),
    };
}

function parseIngestion(value: unknown): Ingestion | null {
    if (value === null) {
        return null;
    }

    const record = object(value);
    const startedAt = instant(record.startedAt);
    const finishedAt = instant(record.finishedAt);

    if (!startedAt || !finishedAt || typeof record.complete !== "boolean") {
        throw new Error("Invalid ingestion report.");
    }

    return {
        startedAt,
        finishedAt,
        phase: choice(record.phase ?? "finished", ["listing", "enriching", "finished"]),
        complete: record.complete,
        entries: integer(record.entries),
        uniqueVideos: integer(record.uniqueVideos),
        duplicates: integer(record.duplicates),
        unavailable: integer(record.unavailable),
        requests: integer(record.requests),
        failures: integer(record.failures),
    };
}

export function parseCatalog(value: unknown): Catalog {
    const record = object(value);

    if (record.version !== 1) {
        throw new Error("Unsupported catalog version.");
    }

    const videos = list(record.videos).map(parseVideo);

    if (new Set(videos.map((video) => video.identifier)).size !== videos.length) {
        throw new Error("Duplicate catalog video identifiers.");
    }

    const coverage = list(record.sources, sources.length).map(parseCoverage);

    if (new Set(coverage.map((source) => source.identifier)).size !== coverage.length) {
        throw new Error("Duplicate catalog sources.");
    }

    return {
        version: 1,
        videos,
        ingestion: parseIngestion(record.ingestion),

        sources: emptyCatalog().sources.map(
            (source) => coverage.find((entry) => entry.identifier === source.identifier) || source,
        ),
    };
}

export function readCatalog(): Catalog {
    const connection = database();

    const coverage = connection
        .prepare("SELECT data FROM sources")
        .all()
        .map((row) => parseCoverage(JSON.parse(String(row.data))));

    const ingestion = connection.prepare("SELECT data FROM state WHERE name = 'ingestion'").get();

    return {
        version: 1,

        videos: connection
            .prepare("SELECT data FROM videos ORDER BY rowid")
            .all()
            .map((row) => parseVideo(JSON.parse(String(row.data)))),

        sources: emptyCatalog().sources.map(
            (source) => coverage.find((entry) => entry.identifier === source.identifier) || source,
        ),

        ingestion: ingestion ? parseIngestion(JSON.parse(String(ingestion.data))) : null,
    };
}

export function writeCatalog(catalog: Catalog, changed: Video[]): void {
    const connection = database();
    const source = connection.prepare(`
        INSERT INTO sources(identifier, data) VALUES (?, ?)
        ON CONFLICT(identifier) DO UPDATE SET data = excluded.data WHERE data != excluded.data
    `);
    const video = connection.prepare(`
        INSERT INTO videos(identifier, title, description, categories, published, availability, details, data, duration, title_sort, search_revision)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(identifier) DO UPDATE SET
            title = excluded.title, description = excluded.description, categories = excluded.categories,
            published = excluded.published, availability = excluded.availability,
            details = excluded.details, data = excluded.data,
            duration = excluded.duration, title_sort = excluded.title_sort, search_revision = excluded.search_revision
        WHERE data != excluded.data OR search_revision != excluded.search_revision
    `);
    const remove = connection.prepare("DELETE FROM memberships WHERE video = ?");

    const membership = connection.prepare(
        "INSERT INTO memberships(video, playlist, category, added) VALUES (?, ?, ?, ?)",
    );

    connection.exec("BEGIN IMMEDIATE");

    try {
        for (const coverage of catalog.sources) {
            const validated = parseCoverage(coverage);
            source.run(validated.identifier, JSON.stringify(validated));
        }

        for (const entry of changed) {
            const validated = parseVideo(entry);
            const categories = [...new Set(validated.memberships.map((membership) => membership.category))].join(" ");

            const result = video.run(
                validated.identifier,
                validated.title.normalize("NFKD"),
                searchableDescription(validated.description),
                categories.normalize("NFKD"),
                validated.publishedAt,
                validated.availability,
                validated.details,
                JSON.stringify(validated),
                durationSeconds(validated.duration),
                titleKey(validated.title),
                searchRevision,
            );

            if (result.changes) {
                remove.run(validated.identifier);

                for (const entry of validated.memberships) {
                    membership.run(validated.identifier, entry.playlistIdentifier, entry.category, entry.addedAt);
                }
            }
        }

        connection
            .prepare(`
            INSERT INTO state(name, data) VALUES ('ingestion', ?)
            ON CONFLICT(name) DO UPDATE SET data = excluded.data
        `)
            .run(JSON.stringify(parseIngestion(catalog.ingestion)));

        connection.exec("COMMIT");
    } catch (error) {
        connection.exec("ROLLBACK");
        throw error;
    }
}

export function catalogSummary() {
    const connection = database();

    const counts = connection
        .prepare(`
        SELECT COUNT(*) AS total,
            MIN(published) AS first, MAX(published) AS last
        FROM videos WHERE availability = 'available'
    `)
        .get()!;

    const categories = connection
        .prepare(`
        SELECT category, COUNT(DISTINCT video) AS total FROM memberships
        JOIN videos ON videos.identifier = memberships.video
        WHERE availability = 'available' GROUP BY category
    `)
        .all();

    const coverage = connection
        .prepare("SELECT data FROM sources")
        .all()
        .map((row) => parseCoverage(JSON.parse(String(row.data))));

    const ingestion = connection.prepare("SELECT data FROM state WHERE name = 'ingestion'").get();

    return {
        total: Number(counts.total),

        pending: Number(
            connection.prepare("SELECT COUNT(*) AS total FROM videos WHERE details = 'pending'").get()!.total,
        ),

        unavailable: Number(
            connection.prepare("SELECT COUNT(*) AS total FROM videos WHERE availability = 'unavailable'").get()!.total,
        ),

        unknownAvailability: Number(
            connection.prepare("SELECT COUNT(*) AS total FROM videos WHERE availability = 'unknown'").get()!.total,
        ),

        sources: emptyCatalog().sources.map(
            (source) => coverage.find((entry) => entry.identifier === source.identifier) || source,
        ),

        ingestion: ingestion ? parseIngestion(JSON.parse(String(ingestion.data))) : null,

        categories: [...new Set(sources.map((source) => source.category))].map((name) => ({
            name,
            count: Number(categories.find((category) => category.category === name)?.total || 0),
        })),

        suggestions: connection
            .prepare(`
            SELECT json_extract(data, '$.title') AS title FROM videos
            WHERE availability = 'available' ORDER BY published DESC, identifier LIMIT 4
        `)
            .all()
            .map((row) => String(row.title)),

        indexedPublicationRange: [counts.first, counts.last].filter(
            (value): value is string => typeof value === "string",
        ),
    };
}

export function sourceStatus(source: Coverage): SourceStatus {
    const { listing, ...status } = source;

    return {
        ...status,
        listing: listing ? { completedAt: listing.completedAt, count: listing.identifiers.length } : null,
    };
}

export function sourceSummaries(): SourceSummary[] {
    const connection = database();
    connection.exec("BEGIN");

    try {
        const coverage = catalogSummary().sources;

        const counts = connection
            .prepare(`
            SELECT playlist, COUNT(*) AS total,
                SUM(availability = 'available') AS searchable,
                MIN(published) AS first, MAX(published) AS last
            FROM memberships JOIN videos ON videos.identifier = memberships.video GROUP BY playlist
        `)
            .all();

        const years = connection
            .prepare(`
            SELECT playlist, substr(published, 1, 4) AS year, COUNT(*) AS total,
                SUM(availability = 'available') AS searchable
            FROM memberships JOIN videos ON videos.identifier = memberships.video
            WHERE published IS NOT NULL GROUP BY playlist, year ORDER BY year
        `)
            .all();

        const summaries = coverage.map((source): SourceSummary => {
            const count = counts.find((row) => row.playlist === source.identifier);

            return {
                ...sourceStatus(source),
                videos: Number(count?.total ?? 0),
                searchable: Number(count?.searchable ?? 0),

                publication:
                    count?.first && count.last ? { from: String(count.first), until: String(count.last) } : null,

                years: years
                    .filter((row) => row.playlist === source.identifier)
                    .map((row) => ({
                        year: String(row.year),
                        count: Number(row.total),
                        searchable: Number(row.searchable),
                    })),
            };
        });

        connection.exec("COMMIT");

        return summaries;
    } catch (error) {
        connection.exec("ROLLBACK");
        throw error;
    }
}

export function readVideo(identifier: string): Video | null {
    const row = database().prepare("SELECT data FROM videos WHERE identifier = ?").get(identifier);

    return row ? parseVideo(JSON.parse(String(row.data))) : null;
}
