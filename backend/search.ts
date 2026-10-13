import type { SQLInputValue } from "node:sqlite";

import type { Filters, RetrievalOptions, Result, Video } from "../shared/metadata.ts";
import type { NeighborIndex } from "./neighbors.ts";
import type { Evidence } from "./passages.ts";

import { orders } from "../shared/metadata.ts";
import { parseVideo } from "./catalog.ts";
import { database } from "./database.ts";
import { embed, semanticCoverage } from "./embeddings.ts";
import { embeddingIdentity } from "./model.ts";
import { neighborIndex } from "./neighbors.ts";
import { preparationRevision, preparePassages } from "./passages.ts";
import { sources } from "./sources.ts";
import { choice, date, Failure, list, object, text } from "./validation.ts";

const ignored: Record<string, true> = Object.fromEntries(
    "a an and are as at be by can could coverage find for from help i in is it latest look me metadata news of on or please recent search show the this to video videos want was with ang at mga ng sa si tungkol hanap pakihanap"
        .split(" ")
        .map((word) => [word, true]),
);

const candidateLimit = 120;
const maximumNeighbors = 4096;

interface Hit {
    identifier: string;
    published: string;
    title: Uint8Array | undefined;
    duration: number | null;
    keyword: number;
    semantic: number | null;
    score: number;
}

export function filters(value: unknown): Filters {
    const record = object(value);

    const categories = [
        ...new Set(
            list(record.categories === undefined ? [] : record.categories, sources.length).map((value) =>
                text(value, 200),
            ),
        ),
    ];

    if (categories.some((category) => !sources.some((source) => source.category === category))) {
        throw new Failure("Unknown source category.");
    }

    const playlists = [...new Set(list(record.playlists ?? [], sources.length).map((value) => text(value, 100)))];

    if (playlists.some((identifier) => !sources.some((source) => source.identifier === identifier))) {
        throw new Failure("Unknown source playlist.");
    }

    const from = date(record.from ?? "");
    const until = date(record.until ?? "");

    if (from && until && from > until) {
        throw new Failure("The publication start date must not follow the end date.");
    }

    return {
        categories,
        playlists,
        from,
        until,
        order: choice(record.order ?? "relevance", orders),
    };
}

function normalize(value: string): string {
    return value
        .normalize("NFKD")
        .replace(/\p{M}/gu, "")
        .toLocaleLowerCase("en")
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .trim();
}

function keywordPassages(video: Pick<Video, "title" | "description" | "memberships">, tokens: string[]) {
    return preparePassages(video)
        .map((passage) => {
            const words = new Set(normalize(passage.excerpt).split(" "));

            return { passage, score: tokens.reduce((score, token) => score + Number(words.has(token)), 0) };
        })
        .filter((match) => match.score > 0)
        .sort((first, second) => second.score - first.score || first.passage.start - second.passage.start);
}

export async function retrieve(
    terms: string[],
    selection: Filters,
    limit = 12,
    offset = 0,
    options: RetrievalOptions & { query?: string; signal?: AbortSignal } = {},
): Promise<{
    results: Result[];
    total: number;
    passages: Record<string, Evidence[]>;
    notice: string;
    coverage: string | null;
}> {
    const tokens = [
        ...new Set(terms.flatMap((term) => normalize(term).split(" ")).filter((token) => token && !ignored[token])),
    ].slice(0, 40);

    const phrases = terms
        .map(normalize)
        .filter((phrase) => phrase.includes(" ") && tokens.some((token) => phrase.split(" ").includes(token)));

    const query = tokens.length ? [...tokens, ...phrases].map((term) => `"${term}"`).join(" OR ") : "";
    const intent = (options.query ?? terms.join(" ")).trim();
    const conditions = ["videos.availability = 'available'"];
    const parameters: SQLInputValue[] = [];

    if (selection.categories.length) {
        conditions.push(`EXISTS (
            SELECT 1 FROM memberships WHERE video = videos.identifier AND category IN (${selection.categories.map(() => "?").join(", ")})
        )`);
        parameters.push(...selection.categories);
    }

    if (selection.playlists.length) {
        conditions.push(`EXISTS (
            SELECT 1 FROM memberships WHERE video = videos.identifier AND playlist IN (${selection.playlists.map(() => "?").join(", ")})
        )`);
        parameters.push(...selection.playlists);
    }

    if (selection.from) {
        conditions.push("substr(videos.published, 1, 10) >= ?");
        parameters.push(selection.from);
    }

    if (selection.until) {
        conditions.push("substr(videos.published, 1, 10) <= ?");
        parameters.push(selection.until);
    }

    const connection = database();

    const sorting: Record<Filters["order"], string> = {
        relevance: "published IS NULL OR published = '', published DESC",
        latest: "published IS NULL OR published = '', published DESC",
        oldest: "published IS NULL OR published = '', published ASC",
        shortest: "duration IS NULL, duration ASC",
        longest: "duration IS NULL, duration DESC",
        titleAscending: "title_sort ASC",
        titleDescending: "title_sort DESC",
    };

    const sortKeys =
        selection.order === "shortest" || selection.order === "longest"
            ? ", videos.duration"
            : selection.order === "titleAscending" || selection.order === "titleDescending"
              ? ", videos.title_sort"
              : "";

    const where = conditions.join(" AND ");
    let vector: Float32Array | null = null;
    let native: NeighborIndex | null = null;
    let coverage: string | null = null;
    let notice = "";

    if (options.semantic && intent) {
        try {
            native = neighborIndex();
            const status = semanticCoverage();
            coverage = `${status.indexed}/${status.total} complete videos; ${status.embedded}/${status.passages} prepared passages; ${native.index.size()} native vectors`;

            if (native.pending) {
                notice = `Native index is catching up: ${native.pending} saved changes remain. `;
            }

            if (native.rejected) {
                notice += "Invalid saved vectors were excluded. ";
            }

            if (!status.embedded || !native.index.size()) {
                notice += "Semantic index is empty. Showing keyword matches.";
            } else {
                vector = (await embed(`query: ${intent}`, options.signal)).vector;
            }
        } catch {
            notice =
                "Semantic search is unavailable. Build or refresh the saved-vector index with bun run index --neighbors. Showing keyword matches.";
        }
    }

    if (options.signal?.aborted) {
        throw new Failure("Search was interrupted.", 504);
    }

    connection.exec("BEGIN");

    try {
        const passages: Record<string, Evidence[]> = {};

        if (!intent) {
            const total = Number(
                connection.prepare(`SELECT COUNT(*) AS total FROM videos WHERE ${where}`).get(...parameters)!.total,
            );

            const rows = connection
                .prepare(
                    `SELECT data FROM videos WHERE ${where} ORDER BY ${sorting[selection.order]}, identifier LIMIT ? OFFSET ?`,
                )
                .all(...parameters, limit, offset);

            const results = rows.map((row) => ({
                video: parseVideo(JSON.parse(String(row.data))),
                explanation: "Indexed collection entry. Metadata only; review the original video to confirm relevance.",
            }));

            connection.exec("COMMIT");

            return { results, total, passages, notice, coverage };
        }

        const keywordSource = `
            FROM videos JOIN footage ON footage.rowid = videos.rowid
            WHERE ${where} AND footage MATCH ?
        `;
        const keywordParameters = [...parameters, query];

        const keywordTotal = query
            ? Number(connection.prepare(`SELECT COUNT(*) AS total ${keywordSource}`).get(...keywordParameters)!.total)
            : 0;

        const keywordOrder =
            selection.order === "relevance"
                ? "bm25(footage, 6, 1, 3), videos.published DESC"
                : sorting[selection.order];

        const metadata = connection.prepare("SELECT data FROM videos WHERE identifier = ?");

        function materialize(data: unknown, keyword: boolean, semantic: boolean, evidence: Evidence[] = []): Result {
            const video = parseVideo(JSON.parse(String(data)));
            const matched = [...evidence, ...keywordPassages(video, tokens).map((match) => match.passage)];

            passages[video.identifier] = matched
                .filter(
                    (passage, position) =>
                        passage.field === "description" &&
                        video[passage.field].slice(passage.start, passage.finish) === passage.excerpt &&
                        matched.findIndex(
                            (other) =>
                                other.field === passage.field &&
                                other.start === passage.start &&
                                other.finish === passage.finish,
                        ) === position,
                )
                .slice(0, 4);

            const constituent =
                keyword && semantic
                    ? "keyword and semantic relevance"
                    : semantic
                      ? "multilingual semantic relevance"
                      : "keyword relevance";

            return { video, explanation: `Ranked by ${constituent} in source metadata.` };
        }

        function keywordResults(): Result[] {
            if (!query) {
                return [];
            }

            return connection
                .prepare(
                    `SELECT videos.identifier ${keywordSource} ORDER BY ${keywordOrder}, videos.identifier LIMIT ? OFFSET ?`,
                )
                .all(...keywordParameters, limit, offset)
                .map((row) => materialize(metadata.get(String(row.identifier))!.data, true, false));
        }

        if (!vector || !native) {
            const results = keywordResults();
            connection.exec("COMMIT");

            return { results, total: keywordTotal, passages, notice, coverage };
        }

        const hits = new Map<string, Hit>();

        if (query) {
            const rows = connection
                .prepare(`
                SELECT videos.identifier, videos.published${sortKeys}
                ${keywordSource}
                ORDER BY ${keywordOrder}, videos.identifier LIMIT ?
            `)
                .all(...keywordParameters, candidateLimit);

            let rank = 0;

            for (const row of rows) {
                const identifier = String(row.identifier);

                hits.set(identifier, {
                    identifier,
                    published: String(row.published || ""),
                    title: row.title_sort as Uint8Array | undefined,
                    duration: row.duration == null ? null : Number(row.duration),
                    keyword: ++rank,
                    semantic: null,
                    score: 1 / (60 + rank),
                });
            }
        }

        let evidenceSource = "";
        let evidenceParameters: SQLInputValue[] = [];
        let neighborCount = 0;

        try {
            let requested = Math.min(native.index.size(), candidateLimit * 4);
            let semantic: Hit[] = [];

            while (requested > 0) {
                if (options.signal?.aborted) {
                    throw new Failure("Search was interrupted.", 504);
                }

                const neighbors = native.index.search(vector, requested, 1);

                if (neighbors.keys.length !== neighbors.distances.length) {
                    throw new Error("Native neighbor results are inconsistent.");
                }

                if (!neighbors.keys.length) {
                    break;
                }

                neighborCount = neighbors.keys.length;
                evidenceParameters = [];

                for (const [position, key] of neighbors.keys.entries()) {
                    const distance = neighbors.distances[position]!;

                    if (key <= 0n || !Number.isSafeInteger(Number(key)) || !Number.isFinite(distance)) {
                        throw new Error("Native neighbor results contain an invalid key or distance.");
                    }

                    evidenceParameters.push(key, 1 - distance);
                }

                evidenceSource = `WITH candidates(identifier, similarity) AS (
                    VALUES ${Array.from({ length: neighborCount }, () => "(?, ?)").join(", ")}
                )`;

                const rows = connection
                    .prepare(`
                    ${evidenceSource}
                    SELECT videos.identifier, videos.published${sortKeys}, MAX(candidates.similarity) AS similarity
                    FROM candidates CROSS JOIN identifiers ON identifiers.identifier = candidates.identifier AND identifiers.identity = ?
                    CROSS JOIN passages ON passages.fingerprint = identifiers.fingerprint
                    CROSS JOIN preparations ON preparations.video = passages.video
                    CROSS JOIN videos ON videos.identifier = passages.video
                    WHERE ${where} AND preparations.revision = ?
                    GROUP BY videos.identifier
                    ORDER BY similarity DESC, videos.published DESC, videos.identifier LIMIT ?
                `)
                    .all(...evidenceParameters, embeddingIdentity, ...parameters, preparationRevision, candidateLimit);

                semantic = rows.map((row) => ({
                    identifier: String(row.identifier),
                    published: String(row.published || ""),
                    title: row.title_sort instanceof Uint8Array ? row.title_sort : undefined,
                    duration: row.duration == null ? null : Number(row.duration),
                    keyword: 0,
                    semantic: Number(row.similarity),
                    score: 0,
                }));

                if (semantic.length >= candidateLimit || requested >= Math.min(native.index.size(), maximumNeighbors)) {
                    break;
                }

                requested = Math.min(requested * 2, native.index.size(), maximumNeighbors);
            }

            for (const [position, match] of semantic.entries()) {
                const hit = hits.get(match.identifier) || match;
                hit.semantic = match.semantic;
                hit.score += 1 / (60 + position + 1);
                hits.set(match.identifier, hit);
            }
        } catch (error) {
            if (options.signal?.aborted) {
                throw error;
            }

            notice = "Semantic index could not be read. Showing keyword matches.";
            const results = keywordResults();
            connection.exec("COMMIT");

            return { results, total: keywordTotal, passages, notice, coverage };
        }

        const compare = (first: string, second: string) => (first < second ? -1 : first > second ? 1 : 0);

        const ordered = [...hits.values()].sort((first, second) => {
            let order = 0;

            if (selection.order === "latest" || selection.order === "oldest") {
                order =
                    Number(!first.published) - Number(!second.published) ||
                    compare(first.published, second.published) * (selection.order === "latest" ? -1 : 1);
            } else if (selection.order === "shortest" || selection.order === "longest") {
                order =
                    Number(first.duration === null) - Number(second.duration === null) ||
                    ((first.duration ?? 0) - (second.duration ?? 0)) * (selection.order === "longest" ? -1 : 1);
            } else if (selection.order === "titleAscending" || selection.order === "titleDescending") {
                order = Buffer.compare(first.title!, second.title!) * (selection.order === "titleDescending" ? -1 : 1);
            }

            return (
                order ||
                (selection.order === "relevance"
                    ? second.score - first.score || compare(second.published, first.published)
                    : 0) ||
                compare(first.identifier, second.identifier)
            );
        });

        const semanticPassages = evidenceSource
            ? connection.prepare(`
            ${evidenceSource}
            SELECT passages.start, passages.finish, passages.excerpt
            FROM candidates JOIN identifiers ON identifiers.identifier = candidates.identifier AND identifiers.identity = ?
            JOIN passages ON passages.fingerprint = identifiers.fingerprint
            WHERE passages.video = ? AND passages.field = 'description'
            ORDER BY candidates.similarity DESC, passages.position LIMIT 4
        `)
            : null;

        const results: Result[] = ordered.slice(offset, offset + limit).map((hit) => {
            const row = metadata.get(hit.identifier)!;

            const evidence: Evidence[] =
                hit.semantic !== null && semanticPassages
                    ? semanticPassages.all(...evidenceParameters, embeddingIdentity, hit.identifier).map((passage) => ({
                          field: "description",
                          start: Number(passage.start),
                          finish: Number(passage.finish),
                          excerpt: String(passage.excerpt),
                      }))
                    : [];

            return materialize(row.data, Boolean(hit.keyword), hit.semantic !== null, evidence);
        });

        connection.exec("COMMIT");

        return { results, total: ordered.length, passages, notice, coverage };
    } catch (error) {
        connection.exec("ROLLBACK");
        throw error;
    }
}
