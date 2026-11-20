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
  added_at: number;
  last_played_at: number | null;
  play_count: number;
}

export type NewTrack = Pick<Track, 'title' | 'file_uri' | 'source'> &
  Partial<
    Pick<Track, 'artist' | 'album' | 'album_artist' | 'track_no' | 'duration_ms' | 'artwork_uri' | 'license' | 'mbid'>
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
  const rows = await db.getAllAsync<Track>(
    `SELECT * FROM tracks WHERE id IN (${ids.map(() => '?').join(',')})`,
    ...ids,
  );
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.map((id) => byId.get(id)).filter((t): t is Track => !!t);
}

export async function insertTrack(db: SQLiteDatabase, t: NewTrack): Promise<number> {
  const res = await db.runAsync(
    `INSERT INTO tracks (title, artist, album, album_artist, track_no, duration_ms, file_uri, artwork_uri, source, license, mbid)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
  );
  return res.lastInsertRowId;
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
