import type { DatabaseSync } from "node:sqlite";

import { createHash, randomUUID } from "node:crypto";
import { closeSync, existsSync, fsyncSync, openSync, readSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { Index, MetricKind, ScalarKind } from "usearch";

import { database } from "./database.ts";
import { decodeVector } from "./embeddings.ts";
import { embeddingDimensions, embeddingIdentity } from "./model.ts";
import { preparationRevision } from "./passages.ts";
import { catalogPath } from "./settings.ts";
import { integer, object, text } from "./validation.ts";

interface Snapshot {
    identity: string;
    revision: number;
    checkpoint: number;
    count: number;
    snapshot: string;
    checksum: string;
    rejected: boolean;
}

export interface NeighborIndex {
    index: Index;
    pending: number;
    rejected: boolean;
}

let cached: { index: Index; snapshot: Snapshot; checkpoint: number; rejected: boolean } | null = null;

function saved(connection: DatabaseSync): Snapshot | null {
    const row = connection.prepare("SELECT data FROM state WHERE name = 'neighbors'").get();

    if (!row) {
        return null;
    }

    const value = object(JSON.parse(String(row.data)));
    const snapshot = text(value.snapshot, 36);
    const checksum = text(value.checksum, 64);

    if (
        value.identity !== embeddingIdentity ||
        value.revision !== preparationRevision ||
        !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/iu.test(snapshot) ||
        !/^[\da-f]{64}$/u.test(checksum) ||
        typeof value.rejected !== "boolean"
    ) {
        throw new Error("Native neighbor snapshot is incompatible; rebuild it with bun run index --neighbors.");
    }

    return {
        identity: embeddingIdentity,
        revision: preparationRevision,
        checkpoint: integer(value.checkpoint),
        count: integer(value.count),
        snapshot,
        checksum,
        rejected: value.rejected,
    };
}

function checksum(path: string): string {
    const file = openSync(path, "r");
    const hash = createHash("sha256");
    const bytes = Buffer.alloc(1024 * 1024);

    try {
        let length: number;

        while ((length = readSync(file, bytes)) > 0) {
            hash.update(bytes.subarray(0, length));
        }

        return hash.digest("hex");
    } finally {
        closeSync(file);
    }
}

function restore(snapshot: Snapshot): Index {
    const path = `${catalogPath}.${snapshot.snapshot}.neighbors`;

    if (checksum(path) !== snapshot.checksum) {
        throw new Error("Native neighbor snapshot is corrupted; rebuild it with bun run index --neighbors.");
    }

    const index = new Index({
        dimensions: embeddingDimensions,
        metric: MetricKind.Cos,
        quantization: ScalarKind.F32,
        connectivity: 16,
        expansion_add: 128,
        expansion_search: 128,
        multi: false,
    });

    index.load(path);

    if (index.dimensions() !== embeddingDimensions || index.size() !== snapshot.count) {
        throw new Error("Native neighbor snapshot is incomplete; rebuild it with bun run index --neighbors.");
    }

    return index;
}

function replay(connection: DatabaseSync, index: Index, checkpoint: number, limit: number) {
    const changes = connection
        .prepare("SELECT position, identifier FROM neighbors WHERE position > ? ORDER BY position LIMIT ?")
        .all(checkpoint, limit);

    const vector = connection.prepare(`
        SELECT vectors.vector FROM identifiers JOIN vectors
            ON vectors.identity = identifiers.identity AND vectors.fingerprint = identifiers.fingerprint
        WHERE identifiers.identifier = ? AND vectors.identity = ? AND EXISTS (
            SELECT 1 FROM passages JOIN preparations ON preparations.video = passages.video
            JOIN videos ON videos.identifier = passages.video
            WHERE passages.fingerprint = vectors.fingerprint AND preparations.revision = ?
                AND videos.availability = 'available'
        )
    `);
    let rejected = false;

    for (const identifier of new Set(changes.map((change) => integer(change.identifier)))) {
        const key = BigInt(identifier);
        const row = vector.get(identifier, embeddingIdentity, preparationRevision);
        const present = index.contains(key);

        if (typeof present !== "boolean") {
            throw new Error("Native neighbor index returned an invalid membership result.");
        }

        if (present) {
            index.remove(key);
        }

        if (!row) {
            continue;
        }

        let decoded: Float32Array;

        try {
            decoded = decodeVector(row.vector);
        } catch {
            rejected = true;
            continue;
        }

        index.add(key, decoded, 1);
    }

    return {
        checkpoint: changes.length ? integer(changes.at(-1)!.position) : checkpoint,
        rejected,
    };
}

export function neighborIndex(): NeighborIndex {
    const connection = database();
    const snapshot = saved(connection);

    if (!snapshot) {
        throw new Error("Build the native neighbor index with bun run index --neighbors.");
    }

    if (!cached || cached.snapshot.snapshot !== snapshot.snapshot) {
        cached = { index: restore(snapshot), snapshot, checkpoint: snapshot.checkpoint, rejected: snapshot.rejected };
    }

    const updated = replay(connection, cached.index, cached.checkpoint, 1000);
    cached.checkpoint = updated.checkpoint;
    cached.rejected ||= updated.rejected;

    const remaining = Number(
        connection.prepare("SELECT COUNT(*) AS total FROM neighbors WHERE position > ?").get(cached.checkpoint)!.total,
    );

    return { index: cached.index, pending: remaining, rejected: cached.rejected };
}

export function saveNeighbors() {
    const connection = database();
    const lockPath = `${catalogPath}.neighbors.lock`;
    const lock = openSync(lockPath, "wx");
    const snapshot = randomUUID();
    const destination = `${catalogPath}.${snapshot}.neighbors`;
    const temporary = `${destination}.temporary`;
    let published = false;

    try {
        writeFileSync(lock, String(process.pid));
        let previous: Snapshot | null = null;
        let index: Index | null = null;

        try {
            previous = saved(connection);
            index = previous ? restore(previous) : null;
        } catch {
            previous = null;
        }

        let checkpoint = 0;
        let rejected = previous?.rejected ?? false;
        connection.exec("BEGIN");

        try {
            if (index && previous) {
                checkpoint = previous.checkpoint;

                const latest = Number(
                    connection.prepare("SELECT COALESCE(MAX(position), 0) AS position FROM neighbors").get()!.position,
                );

                while (checkpoint < latest) {
                    const updated = replay(connection, index, checkpoint, 1000);

                    if (updated.checkpoint === checkpoint) {
                        throw new Error("Native neighbor journal is incomplete; retained snapshot was not replaced.");
                    }

                    checkpoint = updated.checkpoint;
                    rejected ||= updated.rejected;
                }
            } else {
                index = new Index({
                    dimensions: embeddingDimensions,
                    metric: MetricKind.Cos,
                    quantization: ScalarKind.F32,
                    connectivity: 16,
                    expansion_add: 128,
                    expansion_search: 128,
                    multi: false,
                });

                checkpoint = Number(
                    connection.prepare("SELECT COALESCE(MAX(position), 0) AS position FROM neighbors").get()!.position,
                );

                const rows = connection
                    .prepare(`
                    SELECT identifiers.identifier, vectors.vector FROM identifiers JOIN vectors
                        ON vectors.identity = identifiers.identity AND vectors.fingerprint = identifiers.fingerprint
                    WHERE vectors.identity = ? AND EXISTS (
                        SELECT 1 FROM passages JOIN preparations ON preparations.video = passages.video
                        JOIN videos ON videos.identifier = passages.video
                        WHERE passages.fingerprint = vectors.fingerprint AND preparations.revision = ?
                            AND videos.availability = 'available'
                    ) ORDER BY identifiers.identifier
                `)
                    .iterate(embeddingIdentity, preparationRevision);

                for (const row of rows) {
                    let vector: Float32Array;

                    try {
                        vector = decodeVector(row.vector);
                    } catch {
                        rejected = true;
                        continue;
                    }

                    index.add(BigInt(integer(row.identifier)), vector, 1);
                }
            }

            index.save(temporary);
            const file = openSync(temporary, "r+");

            try {
                fsyncSync(file);
            } finally {
                closeSync(file);
            }

            renameSync(temporary, destination);
            connection.exec("COMMIT");
        } catch (error) {
            connection.exec("ROLLBACK");
            throw error;
        }

        const manifest: Snapshot = {
            identity: embeddingIdentity,
            revision: preparationRevision,
            checkpoint,
            count: index.size(),
            snapshot,
            checksum: checksum(destination),
            rejected,
        };

        connection.exec("BEGIN IMMEDIATE");

        try {
            connection
                .prepare(`
                INSERT INTO state(name, data) VALUES ('neighbors', ?)
                ON CONFLICT(name) DO UPDATE SET data = excluded.data
            `)
                .run(JSON.stringify(manifest));

            connection.prepare("DELETE FROM neighbors WHERE position <= ?").run(checkpoint);
            connection.exec("COMMIT");
            published = true;
        } catch (error) {
            connection.exec("ROLLBACK");
            throw error;
        }

        cached = { index, snapshot: manifest, checkpoint, rejected };

        if (previous) {
            const original = `${catalogPath}.${previous.snapshot}.neighbors`;

            if (existsSync(original)) {
                rmSync(original);
            }
        }

        return { indexed: manifest.count, rejected };
    } finally {
        closeSync(lock);
        rmSync(lockPath, { force: true });
        rmSync(temporary, { force: true });

        if (!published) {
            rmSync(destination, { force: true });
        }
    }
}
