/**
 * Lyrics for a track, from (in order): a cached result, an .lrc file next to the audio
 * file, lyrics embedded in the file's tags, then LRCLIB (lrclib.net, a free, open lyrics
 * database with synced lyrics) when online and allowed. Results are cached in the `lyrics`
 * table so they work offline; "not found" online is cached for a week before retrying.
 */
import Constants from 'expo-constants';
import { File } from 'expo-file-system';
import type { SQLiteDatabase } from 'expo-sqlite';

import type { Track } from '@/db/queries';
import { openByteSource } from '@/services/media/fileSource';
import { readTags } from '@/services/media/tags';

import { parseLrc } from './lrc';

export type LyricsSource = 'file' | 'embedded' | 'lrclib';

export interface Lyrics {
  /** LRC text with timestamps, when available. */
  synced: string | null;
  plain: string | null;
  instrumental: boolean;
  source: LyricsSource;
}

export type LyricsResult = { status: 'found'; lyrics: Lyrics } | { status: 'none' } | { status: 'offline' };

/** Setting: look lyrics up on LRCLIB (on unless turned off). */
export const LYRICS_ONLINE_KEY = 'lyrics.online';

const RETRY_NONE_MS = 7 * 24 * 3600 * 1000;
const INSTRUMENTAL = '[instrumental]';
const LRCLIB = 'https://lrclib.net/api';

export interface LyricsDeps {
  fetch: typeof fetch;
  readSidecar: (fileUri: string) => Promise<string | null>;
  readEmbedded: (fileUri: string) => Promise<string | null>;
  now: () => number;
}

type LyricsTrack = Pick<Track, 'id' | 'title' | 'artist' | 'album' | 'duration_ms' | 'file_uri'>;

interface Row {
  synced: string | null;
  plain: string | null;
  source: string;
  fetched_at: number;
}

export async function getLyrics(
  db: SQLiteDatabase,
  track: LyricsTrack,
  opts: { online: boolean; allowOnline: boolean },
  deps: LyricsDeps = defaultDeps,
): Promise<LyricsResult> {
  const cached = await db.getFirstAsync<Row>('SELECT synced, plain, source, fetched_at FROM lyrics WHERE track_id = ?', track.id);
  if (cached && cached.source !== 'none') return { status: 'found', lyrics: fromRow(cached) };
  const canFetch = opts.online && opts.allowOnline;
  if (cached && (!canFetch || deps.now() - cached.fetched_at < RETRY_NONE_MS)) {
    // Local sources were already checked; only an online retry could change the answer.
    return { status: 'none' };
  }

  if (!cached) {
    for (const [source, read] of [
      ['file', deps.readSidecar],
      ['embedded', deps.readEmbedded],
    ] as const) {
      let text: string | null = null;
      try {
        text = await read(track.file_uri);
      } catch {
        text = null;
      }
      if (text?.trim()) {
        const lyrics = fromText(text, source);
        await save(db, track.id, lyrics, deps.now());
        return { status: 'found', lyrics };
      }
    }
  }

  if (!canFetch) {
    // Nothing on the phone. Don't cache the miss: checking local files again is cheap, and
    // turning online lookups on (or reconnecting) should be able to find something.
    return opts.allowOnline ? { status: 'offline' } : { status: 'none' };
  }

  let found: Lyrics | null;
  try {
    found = await fetchLrclib(track, deps.fetch);
  } catch {
    // Network or server trouble: try again next time, don't cache a miss.
    return cached ? { status: 'none' } : { status: 'offline' };
  }
  if (!found) {
    await saveNone(db, track.id, deps.now());
    return { status: 'none' };
  }
  await save(db, track.id, found, deps.now());
  return { status: 'found', lyrics: found };
}

/** Forget a track's cached lyrics (e.g. to look them up again). */
export async function clearLyrics(db: SQLiteDatabase, trackId?: number): Promise<void> {
  if (trackId === undefined) await db.runAsync('DELETE FROM lyrics');
  else await db.runAsync('DELETE FROM lyrics WHERE track_id = ?', trackId);
}

function fromText(text: string, source: LyricsSource): Lyrics {
  const synced = parseLrc(text).synced;
  return { synced: synced ? text : null, plain: synced ? null : text, instrumental: false, source };
}

function fromRow(r: Row): Lyrics {
  return {
    synced: r.synced,
    plain: r.plain === INSTRUMENTAL ? null : r.plain,
    instrumental: r.plain === INSTRUMENTAL,
    source: (r.source as LyricsSource) ?? 'lrclib',
  };
}

/** Caching is best-effort: the song may have been deleted while its lyrics were loading. */
async function save(db: SQLiteDatabase, trackId: number, l: Lyrics, now: number) {
  await db.runAsync(
    `INSERT INTO lyrics (track_id, synced, plain, source, fetched_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(track_id) DO UPDATE SET synced = excluded.synced, plain = excluded.plain, source = excluded.source, fetched_at = excluded.fetched_at`,
    trackId,
    l.synced,
    l.instrumental ? INSTRUMENTAL : l.plain,
    l.source,
    now,
  ).catch(() => {});
}

async function saveNone(db: SQLiteDatabase, trackId: number, now: number) {
  await db.runAsync(
    `INSERT INTO lyrics (track_id, synced, plain, source, fetched_at) VALUES (?, NULL, NULL, 'none', ?)
     ON CONFLICT(track_id) DO UPDATE SET synced = NULL, plain = NULL, source = 'none', fetched_at = excluded.fetched_at`,
    trackId,
    now,
  ).catch(() => {});
}

// ---------------------------------------------------------------- LRCLIB

interface LrclibRecord {
  trackName?: string;
  artistName?: string;
  duration?: number;
  instrumental?: boolean;
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
}

const userAgent = () => `LocalTunes/${Constants.expoConfig?.version ?? 'dev'}`;

/** Exact lookup when album and duration are known, otherwise a search picking the closest duration. */
export async function fetchLrclib(track: LyricsTrack, fetchFn: typeof fetch): Promise<Lyrics | null> {
  if (!track.artist) return null;
  const headers = { 'User-Agent': userAgent(), 'Lrclib-Client': userAgent() };
  const seconds = track.duration_ms ? Math.round(track.duration_ms / 1000) : null;

  if (track.album && seconds) {
    const q = new URLSearchParams({ track_name: track.title, artist_name: track.artist, album_name: track.album, duration: String(seconds) });
    const res = await fetchFn(`${LRCLIB}/get?${q}`, { headers });
    if (res.ok) {
      const rec = toLyrics((await res.json()) as LrclibRecord);
      if (rec) return rec;
    } else if (res.status !== 404) {
      throw new Error(`LRCLIB responded ${res.status}`);
    }
  }

  const q = new URLSearchParams({ track_name: track.title, artist_name: track.artist });
  const res = await fetchFn(`${LRCLIB}/search?${q}`, { headers });
  if (!res.ok) throw new Error(`LRCLIB responded ${res.status}`);
  const list = ((await res.json()) as LrclibRecord[]).filter((r) => r.instrumental || r.syncedLyrics || r.plainLyrics);
  if (!list.length) return null;
  // Within 3 s of the song if we know its length; synced lyrics preferred.
  const candidates = seconds ? list.filter((r) => r.duration == null || Math.abs(r.duration - seconds) <= 3) : list;
  const best = [...candidates].sort((a, b) => Number(!!b.syncedLyrics) - Number(!!a.syncedLyrics))[0];
  return best ? toLyrics(best) : null;
}

function toLyrics(r: LrclibRecord): Lyrics | null {
  if (r.instrumental) return { synced: null, plain: null, instrumental: true, source: 'lrclib' };
  if (r.syncedLyrics?.trim()) return { synced: r.syncedLyrics, plain: r.plainLyrics ?? null, instrumental: false, source: 'lrclib' };
  if (r.plainLyrics?.trim()) return { synced: null, plain: r.plainLyrics, instrumental: false, source: 'lrclib' };
  return null;
}

// ---------------------------------------------------------------- on-device sources

/** "file:///Music/Song.mp3" → contents of "file:///Music/Song.lrc" (or .LRC), if present. */
async function readSidecar(fileUri: string): Promise<string | null> {
  if (!fileUri.startsWith('file://')) return null;
  const base = fileUri.replace(/\.[^./]+$/, '');
  for (const ext of ['.lrc', '.LRC']) {
    const f = new File(base + ext);
    if (f.exists) return f.text();
  }
  return null;
}

async function readEmbedded(fileUri: string): Promise<string | null> {
  const file = new File(fileUri);
  if (!file.exists) return null;
  const src = openByteSource(file);
  try {
    return (await readTags(src)).lyrics ?? null;
  } finally {
    src.close();
  }
}

const defaultDeps: LyricsDeps = { fetch: (...a) => fetch(...a), readSidecar, readEmbedded, now: () => Date.now() };
