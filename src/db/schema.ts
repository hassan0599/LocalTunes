import type { SQLiteDatabase } from 'expo-sqlite';

export const DB_NAME = 'localtunes.db';

/**
 * Ordered migrations. Index + 1 is the schema version stored in PRAGMA user_version.
 * Never edit a shipped migration; append a new one.
 */
const MIGRATIONS: string[] = [
  // v1 — spec section 4, plus `license` (spec 6.4), recency (6.1) and tag fields
  // (album_artist, track_no, artwork_uri) used for album grouping and cover art.
  `
  CREATE TABLE tracks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT NOT NULL,
    artist      TEXT,
    album       TEXT,
    album_artist TEXT,
    track_no    INTEGER,
    duration_ms INTEGER,
    file_uri    TEXT NOT NULL UNIQUE,
    artwork_uri TEXT,
    source      TEXT NOT NULL CHECK (source IN ('imported','device','internet_archive','jamendo')),
    license     TEXT,
    mbid        TEXT,
    added_at    INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    last_played_at INTEGER,
    play_count  INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX idx_tracks_mbid ON tracks(mbid);
  CREATE INDEX idx_tracks_artist_album ON tracks(artist, album);

  CREATE VIRTUAL TABLE tracks_fts USING fts5(
    title, artist, album,
    content='tracks', content_rowid='id',
    tokenize='unicode61 remove_diacritics 2'
  );
  CREATE TRIGGER tracks_ai AFTER INSERT ON tracks BEGIN
    INSERT INTO tracks_fts(rowid, title, artist, album) VALUES (new.id, new.title, new.artist, new.album);
  END;
  CREATE TRIGGER tracks_ad AFTER DELETE ON tracks BEGIN
    INSERT INTO tracks_fts(tracks_fts, rowid, title, artist, album) VALUES ('delete', old.id, old.title, old.artist, old.album);
  END;
  CREATE TRIGGER tracks_au AFTER UPDATE OF title, artist, album ON tracks BEGIN
    INSERT INTO tracks_fts(tracks_fts, rowid, title, artist, album) VALUES ('delete', old.id, old.title, old.artist, old.album);
    INSERT INTO tracks_fts(rowid, title, artist, album) VALUES (new.id, new.title, new.artist, new.album);
  END;

  CREATE TABLE playlists (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  );
  CREATE TABLE playlist_tracks (
    playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
    track_id    INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    position    INTEGER NOT NULL,
    PRIMARY KEY (playlist_id, position)
  );

  CREATE TABLE downloads (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    source      TEXT NOT NULL,
    source_id   TEXT NOT NULL,
    url         TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','downloading','paused','done','failed')),
    bytes_done  INTEGER NOT NULL DEFAULT 0,
    bytes_total INTEGER,
    attempts    INTEGER NOT NULL DEFAULT 0,
    track_id    INTEGER REFERENCES tracks(id) ON DELETE SET NULL,
    error       TEXT,
    UNIQUE (source, source_id)
  );

  CREATE TABLE mb_cache (
    key        TEXT PRIMARY KEY,
    json       TEXT NOT NULL,
    fetched_at INTEGER NOT NULL,
    ttl_s      INTEGER NOT NULL
  );

  CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT
  );
  `,
];

export async function migrate(db: SQLiteDatabase): Promise<void> {
  await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  let version = row?.user_version ?? 0;

  while (version < MIGRATIONS.length) {
    const next = version + 1;
    await db.withTransactionAsync(async () => {
      await db.execAsync(MIGRATIONS[version]);
      await db.execAsync(`PRAGMA user_version = ${next}`);
    });
    version = next;
  }
}
