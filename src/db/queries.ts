import type { SQLiteDatabase } from 'expo-sqlite';

export type TrackSource = 'imported' | 'device' | 'internet_archive' | 'jamendo';

export interface Track {
  id: number;
  title: string;
  artist: string | null;
  album: string | null;
  album_artist: string | null;
  track_no: number | null;
  duration_ms: number | null;
  file_uri: string;
  artwork_uri: string | null;
  source: TrackSource;
  license: string | null;
  mbid: string | null;
  device_id: string | null;
  /** Comma-separated: "Jazz, Swing". */
  genre: string | null;
  added_at: number;
  last_played_at: number | null;
  play_count: number;
  /** ReplayGain track gain in dB, from the file's tags (null when untagged). */
  replay_gain_db: number | null;
}

export type NewTrack = Pick<Track, 'title' | 'file_uri' | 'source'> &
  Partial<
    Pick<
      Track,
      'artist' | 'album' | 'album_artist' | 'track_no' | 'duration_ms' | 'artwork_uri' | 'license' | 'mbid' | 'device_id' | 'genre' | 'replay_gain_db'
    >
  >;

export interface AlbumSummary {
  album: string;
  artist: string | null;
  track_count: number;
  artwork_uri: string | null;
}

export interface ArtistSummary {
  artist: string;
  track_count: number;
  album_count: number;
}

export type SongSort = 'title' | 'artist' | 'added';

const SONG_ORDER: Record<SongSort, string> = {
  title: 'title COLLATE NOCASE',
  artist: 'artist COLLATE NOCASE, album COLLATE NOCASE, track_no, title COLLATE NOCASE',
  added: 'added_at DESC',
};

/** Album grouping key: album artist when tagged, otherwise track artist. */
const ALBUM_ARTIST = 'COALESCE(album_artist, artist)';

// ---------------------------------------------------------------- tracks

export function listTracks(db: SQLiteDatabase, sort: SongSort = 'title'): Promise<Track[]> {
  return db.getAllAsync<Track>(`SELECT * FROM tracks ORDER BY ${SONG_ORDER[sort]}`);
}

export function getTrack(db: SQLiteDatabase, id: number): Promise<Track | null> {
  return db.getFirstAsync<Track>('SELECT * FROM tracks WHERE id = ?', id);
}

/** Returns tracks in the same order as `ids`; missing ids are dropped. */
export async function getTracksByIds(db: SQLiteDatabase, ids: number[]): Promise<Track[]> {
  if (!ids.length) return [];
  // json_each avoids SQLite's bound-parameter limit for very long queues.
  const rows = await db.getAllAsync<Track>(
    'SELECT * FROM tracks WHERE id IN (SELECT value FROM json_each(?))',
    JSON.stringify(ids),
  );
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.map((id) => byId.get(id)).filter((t): t is Track => !!t);
}

export async function insertTrack(db: SQLiteDatabase, t: NewTrack): Promise<number> {
  const res = await db.runAsync(
    `INSERT INTO tracks (title, artist, album, album_artist, track_no, duration_ms, file_uri, artwork_uri, source, license, mbid, device_id, genre, replay_gain_db)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    t.title,
    t.artist ?? null,
    t.album ?? null,
    t.album_artist ?? null,
    t.track_no ?? null,
    t.duration_ms ?? null,
    t.file_uri,
    t.artwork_uri ?? null,
    t.source,
    t.license ?? null,
    t.mbid ?? null,
    t.device_id ?? null,
    t.genre ?? null,
    t.replay_gain_db ?? null,
  );
  return res.lastInsertRowId;
}

export interface DeviceTrackRow {
  id: number;
  device_id: string;
  file_uri: string;
  artwork_uri: string | null;
}

/** Every track that came from the device scan. */
export function listDeviceTracks(db: SQLiteDatabase): Promise<DeviceTrackRow[]> {
  return db.getAllAsync('SELECT id, device_id, file_uri, artwork_uri FROM tracks WHERE device_id IS NOT NULL');
}

export async function setTrackArtwork(db: SQLiteDatabase, id: number, uri: string): Promise<void> {
  await db.runAsync('UPDATE tracks SET artwork_uri = ? WHERE id = ?', uri, id);
}

/** Fill in duration once the player knows it (tags may lack it). */
export async function setTrackDurationIfMissing(db: SQLiteDatabase, id: number, ms: number): Promise<void> {
  await db.runAsync('UPDATE tracks SET duration_ms = ? WHERE id = ? AND duration_ms IS NULL', Math.round(ms), id);
}

export async function markPlayed(db: SQLiteDatabase, id: number): Promise<void> {
  await db.runAsync(
    'UPDATE tracks SET play_count = play_count + 1, last_played_at = ? WHERE id = ?',
    Date.now(),
    id,
  );
}

export async function deleteTrack(db: SQLiteDatabase, id: number): Promise<void> {
  await db.runAsync('DELETE FROM tracks WHERE id = ?', id);
}

// ---------------------------------------------------------------- albums & artists

export function listAlbums(db: SQLiteDatabase): Promise<AlbumSummary[]> {
  return db.getAllAsync<AlbumSummary>(
    `SELECT album, ${ALBUM_ARTIST} AS artist, COUNT(*) AS track_count, MAX(artwork_uri) AS artwork_uri
     FROM tracks WHERE album IS NOT NULL
     GROUP BY album COLLATE NOCASE, ${ALBUM_ARTIST} COLLATE NOCASE
     ORDER BY album COLLATE NOCASE`,
  );
}

export function listAlbumTracks(db: SQLiteDatabase, album: string, artist: string | null): Promise<Track[]> {
  return db.getAllAsync<Track>(
    `SELECT * FROM tracks
     WHERE album = ? COLLATE NOCASE AND (${ALBUM_ARTIST} = ? COLLATE NOCASE OR (? IS NULL AND ${ALBUM_ARTIST} IS NULL))
     ORDER BY track_no, title COLLATE NOCASE`,
    album,
    artist,
    artist,
  );
}

export function listArtists(db: SQLiteDatabase): Promise<ArtistSummary[]> {
  return db.getAllAsync<ArtistSummary>(
    `SELECT artist, COUNT(*) AS track_count, COUNT(DISTINCT album) AS album_count
     FROM tracks WHERE artist IS NOT NULL
     GROUP BY artist COLLATE NOCASE
     ORDER BY artist COLLATE NOCASE`,
  );
}

/** Tracks whose genre list contains `genre` (stored as "A, B"); case-insensitive. */
export function listGenreTracks(db: SQLiteDatabase, genre: string): Promise<Track[]> {
  const escaped = genre.replace(/[\\%_]/g, (c) => `\\${c}`);
  return db.getAllAsync<Track>(
    `SELECT * FROM tracks WHERE (', ' || genre || ', ') LIKE ? ESCAPE '\\'
     ORDER BY artist COLLATE NOCASE, album COLLATE NOCASE, track_no, title COLLATE NOCASE`,
    `%, ${escaped}, %`,
  );
}

export async function setTrackGenre(db: SQLiteDatabase, id: number, genre: string | null): Promise<void> {
  await db.runAsync('UPDATE tracks SET genre = ? WHERE id = ?', genre, id);
}

export function listArtistTracks(db: SQLiteDatabase, artist: string): Promise<Track[]> {
  return db.getAllAsync<Track>(
    `SELECT * FROM tracks WHERE artist = ? COLLATE NOCASE
     ORDER BY album COLLATE NOCASE, track_no, title COLLATE NOCASE`,
    artist,
  );
}

// ---------------------------------------------------------------- settings

export async function getSetting<T>(db: SQLiteDatabase, key: string): Promise<T | null> {
  const row = await db.getFirstAsync<{ value: string | null }>('SELECT value FROM settings WHERE key = ?', key);
  if (!row?.value) return null;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return null;
  }
}

export async function setSetting(db: SQLiteDatabase, key: string, value: unknown): Promise<void> {
  await db.runAsync(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    key,
    JSON.stringify(value),
  );
}
