import type { Video } from "../shared/metadata.ts";
import type { Passage } from "./passages.ts";

import { database } from "./database.ts";

import {
    embeddingDimensions,
    embeddingIdentity,
    embeddingModel,
    loadExtraction,
    localModelAvailable,
} from "./model.ts";

import { fingerprint, preparationRevision, sourceFingerprint } from "./passages.ts";

export function prepareVideo(video: Video, passages: Passage[]): void {
    const connection = database();

    const existing = connection
        .prepare("SELECT fingerprint, revision FROM preparations WHERE video = ?")
        .get(video.identifier);

    const signature = sourceFingerprint(video);

    if (existing?.fingerprint === signature && existing.revision === preparationRevision) {
        return;
    }

    connection.prepare("DELETE FROM preparations WHERE video = ?").run(video.identifier);

    if (video.availability !== "available") {
        return;
    }

    connection
        .prepare("INSERT INTO preparations(video, fingerprint, revision) VALUES (?, ?, ?)")
        .run(video.identifier, signature, preparationRevision);

    const insert = connection.prepare(
        "INSERT INTO passages(video, position, field, start, finish, excerpt, fingerprint) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );

    for (const [position, passage] of passages.entries()) {
        insert.run(
            video.identifier,
            position,
            passage.field,
            passage.start,
            passage.finish,
            passage.excerpt,
            passage.fingerprint,
        );
    }
}

export function semanticCoverage() {
    const connection = database();

    const counts = connection
        .prepare(`
        SELECT COUNT(*) AS total,
            COALESCE(SUM(prepared), 0) AS prepared,
            COALESCE(SUM(passages > 0 AND passages = embedded), 0) AS indexed,
            COALESCE(SUM(passages), 0) AS passages,
            COALESCE(SUM(embedded), 0) AS embedded
        FROM (
            SELECT videos.identifier, preparations.video IS NOT NULL AS prepared,
                COUNT(passages.fingerprint) AS passages,
                COUNT(CASE WHEN passages.fingerprint IN (
                    SELECT fingerprint FROM vectors WHERE identity = ?
                ) THEN 1 END) AS embedded
            FROM videos
            LEFT JOIN preparations ON preparations.video = videos.identifier AND preparations.revision = ?
            LEFT JOIN passages ON passages.video = preparations.video
            WHERE videos.availability = 'available'
            GROUP BY videos.identifier
        )
    `)
        .get(embeddingIdentity, preparationRevision)!;

    return {
        model: embeddingModel,
        identity: embeddingIdentity,
        configured: localModelAvailable(),
        total: Number(counts.total),
        prepared: Number(counts.prepared),
        indexed: Number(counts.indexed),
        passages: Number(counts.passages),
        embedded: Number(counts.embedded),
    };
}

export function decodeVector(value: unknown): Float32Array {
    if (!(value instanceof Uint8Array) || value.byteLength !== embeddingDimensions * 4) {
        throw new Error("Stored embedding has an invalid dimension.");
    }

    const buffer = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
    const result = new Float32Array(embeddingDimensions);
    let squared = 0;

    for (let position = 0; position < result.length; position++) {
        const component = buffer.readFloatLE(position * 4);

        if (!Number.isFinite(component)) {
            throw new Error("Stored embedding contains an invalid value.");
        }

        result[position] = component;
        squared += component * component;
    }

    if (Math.abs(squared - 1) > 0.01) {
        throw new Error("Stored embedding is not normalized.");
    }

    return result;
}

export async function embed(
    content: string,
    signal?: AbortSignal,
): Promise<{ vector: Float32Array; computed: boolean }> {
    signal?.throwIfAborted();
    const connection = database();
    const signature = fingerprint(content);

    const saved = connection
        .prepare("SELECT vector FROM vectors WHERE identity = ? AND fingerprint = ?")
        .get(embeddingIdentity, signature);

    if (saved) {
        return { vector: decodeVector(saved.vector), computed: false };
    }

    let extraction;

    try {
        extraction = await loadExtraction();
    } catch {
        throw new Error(
            "Local embedding model could not be loaded. Run the explicit model download command if it is missing; saved embeddings were retained.",
        );
    }

    signal?.throwIfAborted();

    if (extraction.tokenizer.encode(content).length > 512) {
        throw new Error(
            "Research input exceeds the local model's 512-token limit; refine the query. Keyword search remains available.",
        );
    }

    const output = await extraction(content, { pooling: "mean", normalize: true });
    signal?.throwIfAborted();

    if (
        !(output.data instanceof Float32Array) ||
        output.dims.length !== 2 ||
        output.dims[0] !== 1 ||
        output.dims[1] !== embeddingDimensions ||
        output.data.some((value) => !Number.isFinite(value))
    ) {
        throw new Error("Local model returned an invalid embedding; saved embeddings were retained.");
    }

    const norm = Math.hypot(...output.data);

    if (!Number.isFinite(norm) || norm <= 0) {
        throw new Error("Local model returned an empty vector.");
    }

    const vector = new Float32Array(output.data.map((value) => value / norm));
    const buffer = Buffer.alloc(embeddingDimensions * 4);

    for (const [position, component] of vector.entries()) {
        buffer.writeFloatLE(component, position * 4);
    }

    connection
        .prepare("INSERT INTO vectors(identity, fingerprint, vector) VALUES (?, ?, ?) ON CONFLICT DO NOTHING")
        .run(embeddingIdentity, signature, buffer);

    return { vector, computed: true };
}
