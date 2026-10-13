import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { searchRevision, searchableDescription } from "./passages.ts";
import { catalogPath } from "./settings.ts";
import { durationSeconds, titleKey } from "./sort.ts";

let connection: DatabaseSync | null = null;

export function database(): DatabaseSync {
    if (connection) {
        return connection;
    }

    if (catalogPath.endsWith(".json")) {
        throw new Error("CATALOG_PATH must name a SQLite database. Import JSON with bun run migrate <file>.");
    }

    mkdirSync(dirname(catalogPath), { recursive: true });
    const opened = new DatabaseSync(catalogPath);

    try {
        opened.exec("PRAGMA busy_timeout = 5000");
        opened.exec("PRAGMA foreign_keys = ON");
        opened.exec("BEGIN IMMEDIATE");
        const version = Number(opened.prepare("PRAGMA user_version").get()!.user_version);

        if (![0, 1, 2, 3, 4, 5, 6].includes(version)) {
            throw new Error("Unsupported catalog database version.");
        }

        if (
            version > 0 &&
            version < 6 &&
            (existsSync(`${catalogPath}.lock`) || existsSync(`${catalogPath}.embedding.lock`))
        ) {
            throw new Error("Finish active ingestion or indexing before upgrading the searchable catalog.");
        }

        if (version === 0) {
            if (opened.prepare("SELECT 1 FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").get()) {
                throw new Error("The selected database is not an ArchiveMate catalog.");
            }

            opened.exec(`
                CREATE TABLE IF NOT EXISTS state (
                    name TEXT PRIMARY KEY,
                    data TEXT NOT NULL CHECK(json_valid(data))
                ) STRICT;
                CREATE TABLE IF NOT EXISTS sources (
                    identifier TEXT PRIMARY KEY,
                    data TEXT NOT NULL CHECK(json_valid(data))
                ) STRICT;
                CREATE TABLE IF NOT EXISTS videos (
                    identifier TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    description TEXT NOT NULL,
                    categories TEXT NOT NULL,
                    published TEXT,
                    availability TEXT NOT NULL CHECK(availability IN ('available', 'unavailable', 'unknown')),
                    details TEXT NOT NULL CHECK(details IN ('pending', 'complete')),
                    data TEXT NOT NULL CHECK(json_valid(data))
                ) STRICT;
                CREATE TABLE IF NOT EXISTS memberships (
                    video TEXT NOT NULL REFERENCES videos(identifier) ON DELETE CASCADE,
                    playlist TEXT NOT NULL REFERENCES sources(identifier),
                    category TEXT NOT NULL,
                    added TEXT,
                    PRIMARY KEY(video, playlist)
                ) STRICT;
                CREATE INDEX IF NOT EXISTS dates ON videos(availability, substr(published, 1, 10));
                CREATE INDEX IF NOT EXISTS publication ON videos(availability, published DESC, identifier);
                CREATE INDEX IF NOT EXISTS categories ON memberships(category, video);
                CREATE VIRTUAL TABLE IF NOT EXISTS footage USING fts5(
                    title, description, categories,
                    content='videos', content_rowid='rowid', tokenize='unicode61 remove_diacritics 2'
                );
                CREATE TRIGGER IF NOT EXISTS videos_insert AFTER INSERT ON videos BEGIN
                    INSERT INTO footage(rowid, title, description, categories)
                    VALUES (new.rowid, new.title, new.description, new.categories);
                END;
                CREATE TRIGGER IF NOT EXISTS videos_delete AFTER DELETE ON videos BEGIN
                    INSERT INTO footage(footage, rowid, title, description, categories)
                    VALUES ('delete', old.rowid, old.title, old.description, old.categories);
                END;
                CREATE TRIGGER IF NOT EXISTS videos_update AFTER UPDATE OF title, description, categories ON videos
                WHEN old.title != new.title OR old.description != new.description OR old.categories != new.categories BEGIN
                    INSERT INTO footage(footage, rowid, title, description, categories)
                    VALUES ('delete', old.rowid, old.title, old.description, old.categories);
                    INSERT INTO footage(rowid, title, description, categories)
                    VALUES (new.rowid, new.title, new.description, new.categories);
                END;
                PRAGMA user_version = 1;
            `);
        }

        if (version < 2) {
            opened.exec(`
                CREATE TABLE preparations (
                    video TEXT PRIMARY KEY REFERENCES videos(identifier) ON DELETE CASCADE,
                    fingerprint TEXT NOT NULL,
                    revision INTEGER NOT NULL
                ) STRICT;
                CREATE TABLE passages (
                    video TEXT NOT NULL REFERENCES preparations(video) ON DELETE CASCADE,
                    position INTEGER NOT NULL,
                    field TEXT NOT NULL CHECK(field IN ('title', 'description')),
                    start INTEGER NOT NULL CHECK(start >= 0),
                    finish INTEGER NOT NULL CHECK(finish > start),
                    excerpt TEXT NOT NULL,
                    fingerprint TEXT NOT NULL,
                    PRIMARY KEY(video, position)
                ) STRICT;
                CREATE INDEX passage_fingerprints ON passages(fingerprint);
                CREATE TABLE vectors (
                    identity TEXT NOT NULL,
                    fingerprint TEXT NOT NULL,
                    vector BLOB NOT NULL CHECK(length(vector) = 1536),
                    PRIMARY KEY(identity, fingerprint)
                ) STRICT;
            `);
        }

        if (version === 2) {
            if (opened.prepare("SELECT 1 FROM vectors LIMIT 1").get()) {
                throw new Error("The draft vector schema is not empty; automatic replacement was refused.");
            }

            opened.exec(`
                DROP TABLE vectors;
                CREATE TABLE vectors (
                    identity TEXT NOT NULL,
                    fingerprint TEXT NOT NULL,
                    vector BLOB NOT NULL CHECK(length(vector) = 1536),
                    PRIMARY KEY(identity, fingerprint)
                ) STRICT;
            `);
        }

        if (version < 3) {
            opened.exec(`
                DROP TRIGGER IF EXISTS preparation_update;
                CREATE TRIGGER preparation_update AFTER UPDATE OF data, categories ON videos
                WHEN json_extract(old.data, '$.title') != json_extract(new.data, '$.title')
                    OR json_extract(old.data, '$.description') != json_extract(new.data, '$.description')
                    OR old.categories != new.categories
                BEGIN
                    DELETE FROM preparations WHERE video = new.identifier;
                END;
                PRAGMA user_version = 3;
            `);
        }

        if (version < 4) {
            opened.exec(`
                ALTER TABLE videos ADD COLUMN duration REAL;
                ALTER TABLE videos ADD COLUMN title_sort BLOB NOT NULL DEFAULT X'';
            `);
            const update = opened.prepare("UPDATE videos SET duration = ?, title_sort = ? WHERE identifier = ?");

            for (const row of opened
                .prepare(
                    "SELECT identifier, json_extract(data, '$.duration') AS duration, json_extract(data, '$.title') AS title FROM videos",
                )
                .iterate()) {
                update.run(
                    durationSeconds(typeof row.duration === "string" ? row.duration : null),
                    titleKey(String(row.title ?? "")),
                    String(row.identifier),
                );
            }

            opened.exec(`
                CREATE INDEX publication_latest ON videos(availability, published IS NULL OR published = '', published DESC, identifier);
                CREATE INDEX publication_oldest ON videos(availability, published IS NULL OR published = '', published ASC, identifier);
                CREATE INDEX duration_shortest ON videos(availability, duration IS NULL, duration ASC, identifier);
                CREATE INDEX duration_longest ON videos(availability, duration IS NULL, duration DESC, identifier);
                CREATE INDEX title_ascending ON videos(availability, title_sort ASC, identifier);
                CREATE INDEX title_descending ON videos(availability, title_sort DESC, identifier);
                CREATE INDEX available_videos ON videos(availability, identifier);
                CREATE INDEX preparation_revisions ON preparations(revision, video);
                CREATE INDEX passage_videos ON passages(video, fingerprint);
                PRAGMA user_version = 4;
            `);
        }

        if (version < 5) {
            opened.exec("ALTER TABLE videos ADD COLUMN search_revision INTEGER NOT NULL DEFAULT 0");

            const update = opened.prepare(
                "UPDATE videos SET title = ?, description = ?, search_revision = ? WHERE identifier = ?",
            );

            for (const row of opened
                .prepare(`
                    SELECT identifier, json_extract(data, '$.title') AS title,
                        json_extract(data, '$.description') AS description FROM videos
                `)
                .iterate()) {
                update.run(
                    String(row.title ?? "").normalize("NFKD"),
                    searchableDescription(String(row.description ?? "")),
                    searchRevision,
                    String(row.identifier),
                );
            }
        }

        if (version < 6) {
            opened.exec(`
                DROP TRIGGER IF EXISTS neighbors_insert;
                DROP TRIGGER IF EXISTS neighbors_update;
                DROP TRIGGER IF EXISTS neighbors_delete;
                DROP TRIGGER IF EXISTS passages_insert;
                DROP TRIGGER IF EXISTS passages_delete;
                DROP TRIGGER IF EXISTS neighbors_availability;
                DROP TABLE IF EXISTS identifiers;
                DROP TABLE IF EXISTS neighbors;
                DROP INDEX IF EXISTS vector_fingerprints;
                DELETE FROM state WHERE name = 'neighbors';
                CREATE TABLE identifiers (
                    identifier INTEGER PRIMARY KEY AUTOINCREMENT,
                    identity TEXT NOT NULL,
                    fingerprint TEXT NOT NULL,
                    UNIQUE(identity, fingerprint),
                    FOREIGN KEY(identity, fingerprint) REFERENCES vectors(identity, fingerprint)
                        ON DELETE CASCADE ON UPDATE CASCADE
                ) STRICT;
                CREATE INDEX identifier_fingerprints ON identifiers(fingerprint);
                CREATE INDEX vector_fingerprints ON vectors(fingerprint);
                INSERT INTO identifiers(identity, fingerprint)
                    SELECT identity, fingerprint FROM vectors
                    WHERE EXISTS (SELECT 1 FROM passages WHERE passages.fingerprint = vectors.fingerprint)
                    ORDER BY identity, fingerprint;
                CREATE TABLE neighbors (
                    position INTEGER PRIMARY KEY AUTOINCREMENT,
                    identifier INTEGER NOT NULL
                ) STRICT;
                CREATE TRIGGER identifiers_insert AFTER INSERT ON identifiers BEGIN
                    INSERT INTO neighbors(identifier) VALUES (new.identifier);
                END;
                CREATE TRIGGER identifiers_delete AFTER DELETE ON identifiers BEGIN
                    INSERT INTO neighbors(identifier) VALUES (old.identifier);
                END;
                CREATE TRIGGER neighbors_insert AFTER INSERT ON vectors
                WHEN EXISTS (SELECT 1 FROM passages WHERE fingerprint = new.fingerprint) BEGIN
                    INSERT INTO identifiers(identity, fingerprint) VALUES (new.identity, new.fingerprint)
                        ON CONFLICT DO NOTHING;
                END;
                CREATE TRIGGER neighbors_update AFTER UPDATE ON vectors
                WHEN old.identity != new.identity OR old.fingerprint != new.fingerprint OR old.vector != new.vector BEGIN
                    INSERT INTO identifiers(identity, fingerprint)
                        SELECT new.identity, new.fingerprint
                        WHERE EXISTS (SELECT 1 FROM passages WHERE fingerprint = new.fingerprint)
                        ON CONFLICT DO NOTHING;
                    INSERT INTO neighbors(identifier)
                        SELECT identifier FROM identifiers WHERE identity = new.identity AND fingerprint = new.fingerprint;
                END;
                CREATE TRIGGER passages_insert AFTER INSERT ON passages BEGIN
                    INSERT INTO identifiers(identity, fingerprint)
                        SELECT identity, fingerprint FROM vectors WHERE fingerprint = new.fingerprint
                        ON CONFLICT DO NOTHING;
                    INSERT INTO neighbors(identifier)
                        SELECT identifier FROM identifiers WHERE fingerprint = new.fingerprint;
                END;
                CREATE TRIGGER passages_delete AFTER DELETE ON passages BEGIN
                    INSERT INTO neighbors(identifier)
                        SELECT identifier FROM identifiers WHERE fingerprint = old.fingerprint;
                END;
                CREATE TRIGGER neighbors_availability AFTER UPDATE OF availability ON videos
                WHEN old.availability != new.availability BEGIN
                    INSERT INTO neighbors(identifier)
                    SELECT DISTINCT identifiers.identifier FROM identifiers JOIN passages
                        ON passages.fingerprint = identifiers.fingerprint WHERE passages.video = new.identifier;
                END;
                PRAGMA user_version = 6;
            `);
        }

        opened.exec("COMMIT");
        opened.exec("PRAGMA journal_mode = WAL");
        connection = opened;

        return opened;
    } catch (error) {
        opened.close();
        throw error;
    }
}
