import type { SQLInputValue } from "node:sqlite";

import type { Filters, RetrievalOptions, Result, Video } from "../shared/metadata.ts";
import type { Evidence } from "./passages.ts";

import { orders } from "../shared/metadata.ts";
import { parseVideo } from "./catalog.ts";
import { database } from "./database.ts";
import { decodeVector, embed, semanticCoverage } from "./embeddings.ts";
import { embeddingIdentity } from "./model.ts";
import { preparationRevision, preparePassages } from "./passages.ts";
import { sources } from "./sources.ts";
import { choice, date, Failure, list, object, text } from "./validation.ts";

const ignored: Record<string, true> = Object.fromEntries(
    "a an and are as at be by can could coverage find for from help i in is it latest look me metadata news of on or please recent search show the this to video videos want was with ang at mga ng sa si tungkol hanap pakihanap"
        .split(" ")
        .map((word) => [word, true]),
);

const semanticCandidateLimit = 120;

interface Hit {
    identifier: string;
    published: string;
    title: Uint8Array | undefined;
    duration: number | null;
    keyword: number;
    semantic: number | null;
    score: number;
    passages: { passage: Evidence; score: number }[];
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

    const phrases = terms.map(normalize).filter((phrase) => phrase.includes(" "));
    const query = [...tokens, ...phrases].map((term) => `"${term}"`).join(" OR ");
    const intent = (options.query ?? terms.join(" ")).trim();
    const conditions = ["videos.availability = 'available'"];
    const parameters: SQLInputValue[] = [];

    if (selection.categories.length) {
        conditions.push(`videos.identifier IN (
            SELECT video FROM memberships WHERE category IN (${selection.categories.map(() => "?").join(", ")})
        )`);
        parameters.push(...selection.categories);
    }

    if (selection.playlists.length) {
        conditions.push(`videos.identifier IN (
            SELECT video FROM memberships WHERE playlist IN (${selection.playlists.map(() => "?").join(", ")})
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
    let coverage: string | null = null;
    let notice = "";

    if (options.semantic && intent) {
        try {
            const status = semanticCoverage();
            coverage = `${status.indexed}/${status.total} complete videos; ${status.embedded}/${status.passages} prepared passages`;

            if (!status.embedded) {
                notice = "Semantic index is empty. Showing keyword matches.";
            } else {
                vector = (await embed(`query: ${intent}`, options.signal)).vector;
            }
        } catch {
            notice = "Semantic search is unavailable. Showing keyword matches.";
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

        const hits = new Map<string, Hit>();

        if (query) {
            const rows = connection
                .prepare(`
                SELECT videos.identifier, videos.published, videos.title, videos.description, videos.categories${sortKeys}
                FROM videos JOIN footage ON footage.rowid = videos.rowid
                WHERE ${where} AND footage MATCH ?
                ORDER BY bm25(footage, 6, 1, 3), videos.published DESC, videos.identifier
            `)
                .iterate(...parameters, query);

            let rank = 0;

            for (const row of rows) {
                const title = String(row.title);
                const words = new Set(normalize(`${title} ${String(row.categories)}`).split(" "));

                if (
                    !tokens.some((token) => words.has(token)) &&
                    !keywordPassages({ title, description: String(row.description), memberships: [] }, tokens).length
                ) {
                    continue;
                }

                rank++;
                const identifier = String(row.identifier);

                hits.set(identifier, {
                    identifier,
                    published: String(row.published || ""),
                    title: row.title_sort as Uint8Array | undefined,
                    duration: row.duration == null ? null : Number(row.duration),
                    keyword: rank,
                    semantic: null,
                    score: 1 / (60 + rank),
                    passages: [],
                });
            }
        }

        let invalidVectors = 0;

        if (vector) {
            try {
                const semantic = new Map<string, Hit>();

                const rows = connection
                    .prepare(`
                    SELECT videos.identifier, videos.published${sortKeys}, passages.field, passages.start, passages.finish, passages.excerpt, vectors.vector
                    FROM videos JOIN preparations ON preparations.video = videos.identifier
                    JOIN passages ON passages.video = videos.identifier
                    JOIN vectors ON vectors.fingerprint = passages.fingerprint AND vectors.identity = ?
                    WHERE ${where} AND preparations.revision = ?
                    ORDER BY videos.identifier, passages.position
                `)
                    .iterate(embeddingIdentity, ...parameters, preparationRevision);

                for (const row of rows) {
                    let candidate: Float32Array;

                    try {
                        candidate = decodeVector(row.vector);
                    } catch {
                        invalidVectors++;
                        continue;
                    }

                    let similarity = 0;

                    for (let position = 0; position < vector.length; position++) {
                        similarity += vector[position]! * candidate[position]!;
                    }

                    const identifier = String(row.identifier);

                    const hit: Hit = semantic.get(identifier) || {
                        identifier,
                        published: String(row.published || ""),
                        title: row.title_sort as Uint8Array | undefined,
                        duration: row.duration == null ? null : Number(row.duration),
                        keyword: 0,
                        semantic: null,
                        score: 0,
                        passages: [],
                    };

                    hit.semantic = Math.max(hit.semantic ?? -Infinity, similarity);

                    hit.passages.push({
                        passage: {
                            field: choice(row.field, ["title", "description"]),
                            start: Number(row.start),
                            finish: Number(row.finish),
                            excerpt: String(row.excerpt),
                        },

                        score: similarity,
                    });

                    semantic.set(identifier, hit);
                }

                const ordered = [...semantic.values()]
                    .sort(
                        (first, second) =>
                            (second.semantic ?? -Infinity) - (first.semantic ?? -Infinity) ||
                            second.published.localeCompare(first.published) ||
                            first.identifier.localeCompare(second.identifier),
                    )
                    .slice(0, semanticCandidateLimit);

                for (const [position, match] of ordered.entries()) {
                    const hit = hits.get(match.identifier) || match;
                    hit.semantic = match.semantic;
                    hit.passages = match.passages.sort((first, second) => second.score - first.score);
                    hit.score += 1 / (60 + position + 1);
                    hits.set(match.identifier, hit);
                }
            } catch {
                notice = "Semantic index could not be read. Showing keyword matches.";
            }
        }

        if (invalidVectors) {
            notice += ` ${invalidVectors} invalid stored passage vectors were excluded.`;
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

        const results: Result[] = ordered.slice(offset, offset + limit).map((hit) => {
            const row = connection.prepare("SELECT data FROM videos WHERE identifier = ?").get(hit.identifier)!;
            const video = parseVideo(JSON.parse(String(row.data)));
            const matched = hit.passages.map((match) => match.passage);
            matched.push(...keywordPassages(video, tokens).map((match) => match.passage));

            passages[hit.identifier] = matched
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
                hit.keyword && hit.semantic !== null
                    ? "keyword and semantic relevance"
                    : hit.semantic !== null
                      ? "multilingual semantic relevance"
                      : "keyword relevance";

            return {
                video,
                explanation: `Ranked by ${constituent} in source metadata.`,
            };
        });

        connection.exec("COMMIT");

        return { results, total: ordered.length, passages, notice, coverage };
    } catch (error) {
        connection.exec("ROLLBACK");
        throw error;
    }
}
