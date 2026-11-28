/**
 * ListenBrainz scrobbling (listenbrainz.org, the open listening-history service run by the
 * MetaBrainz Foundation, which also runs MusicBrainz).
 *
 * A song counts as a listen once it has played for half its length or 4 minutes, whichever
 * comes first (songs under 30 s never count). Listens go into the `listens` table first, so
 * nothing is lost offline, and are sent in batches when online. Only queued while
 * connected, so the table can't grow without bound.
 */
import Constants from 'expo-constants';
import type { SQLiteDatabase } from 'expo-sqlite';

import { getSetting, setSetting, type Track } from '@/db/queries';

export const TOKEN_KEY = 'listenbrainz.token';
export const USER_KEY = 'listenbrainz.user';
/** Set when the server rejected the token, so the UI can ask to reconnect. */
export const TOKEN_REJECTED_KEY = 'listenbrainz.rejected';

const API = 'https://api.listenbrainz.org/1';
const BATCH = 100;

export const MIN_TRACK_MS = 30_000;
export const MAX_REQUIRED_MS = 4 * 60_000;

/** Has `playedMs` of real listening made this song a listen? */
export function isListen(playedMs: number, durationMs: number | null | undefined): boolean {
  if (!durationMs || durationMs < MIN_TRACK_MS) return false;
  return playedMs >= Math.min(durationMs / 2, MAX_REQUIRED_MS);
}

export type ListenTrack = Pick<Track, 'title' | 'artist' | 'album' | 'duration_ms' | 'mbid'>;

export async function queueListen(db: SQLiteDatabase, track: ListenTrack, listenedAtMs: number): Promise<boolean> {
  if (!track.artist) return false; // ListenBrainz requires an artist name
  await db.runAsync(
    'INSERT INTO listens (listened_at, artist, title, album, duration_ms, recording_mbid) VALUES (?, ?, ?, ?, ?, ?)',
    Math.floor(listenedAtMs / 1000),
    track.artist,
    track.title,
    track.album ?? null,
    track.duration_ms ?? null,
    track.mbid ?? null,
  );
  return true;
}

export async function pendingListenCount(db: SQLiteDatabase): Promise<number> {
  return (await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM listens'))?.n ?? 0;
}

interface ListenRow {
  id: number;
  listened_at: number;
  artist: string;
  title: string;
  album: string | null;
  duration_ms: number | null;
  recording_mbid: string | null;
}

/** The JSON body ListenBrainz expects for submit-listens. */
export function submitPayload(rows: ListenRow[], clientVersion: string) {
  return {
    listen_type: rows.length === 1 ? 'single' : 'import',
    payload: rows.map((r) => ({
      listened_at: r.listened_at,
      track_metadata: {
        artist_name: r.artist,
        track_name: r.title,
        ...(r.album ? { release_name: r.album } : {}),
        additional_info: {
          media_player: 'LocalTunes',
          submission_client: 'LocalTunes',
          submission_client_version: clientVersion,
          ...(r.duration_ms ? { duration_ms: r.duration_ms } : {}),
          ...(r.recording_mbid ? { recording_mbid: r.recording_mbid } : {}),
        },
      },
    })),
  };
}

export type FlushResult =
  | { status: 'sent'; sent: number }
  | { status: 'nothing' }
  | { status: 'no-token' }
  | { status: 'rejected' }
  | { status: 'retry-later'; error: string };

const clientVersion = () => Constants.expoConfig?.version ?? 'dev';

let flushing: Promise<FlushResult> | null = null;

/** Send queued listens, oldest first, in batches. Safe to call often (joins a running flush). */
export function flushListens(db: SQLiteDatabase, fetchFn: typeof fetch = (...a) => fetch(...a)): Promise<FlushResult> {
  flushing ??= doFlush(db, fetchFn).finally(() => (flushing = null));
  return flushing;
}

async function doFlush(db: SQLiteDatabase, fetchFn: typeof fetch): Promise<FlushResult> {
  const token = await getSetting<string>(db, TOKEN_KEY);
  if (!token) return { status: 'no-token' };
  if (await getSetting<boolean>(db, TOKEN_REJECTED_KEY)) return { status: 'rejected' };
  let sent = 0;
  for (;;) {
    const rows = await db.getAllAsync<ListenRow>('SELECT * FROM listens ORDER BY listened_at, id LIMIT ?', BATCH);
    if (!rows.length) return sent ? { status: 'sent', sent } : { status: 'nothing' };
    let res: Response;
    try {
      res = await fetchFn(`${API}/submit-listens`, {
        method: 'POST',
        headers: { Authorization: `Token ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(submitPayload(rows, clientVersion())),
      });
    } catch (e) {
      return { status: 'retry-later', error: e instanceof Error ? e.message : String(e) };
    }
    if (res.status === 401) {
      await setSetting(db, TOKEN_REJECTED_KEY, true);
      return { status: 'rejected' };
    }
    if (res.status === 400) {
      // The server refused these listens as invalid; drop them so the rest can go through.
      await deleteRows(db, rows);
      continue;
    }
    if (!res.ok) return { status: 'retry-later', error: `ListenBrainz responded ${res.status}` };
    await deleteRows(db, rows);
    sent += rows.length;
  }
}

async function deleteRows(db: SQLiteDatabase, rows: ListenRow[]) {
  await db.runAsync(`DELETE FROM listens WHERE id IN (${rows.map(() => '?').join(',')})`, ...rows.map((r) => r.id));
}

/** Check a user token; returns the ListenBrainz user name, or null if the token is invalid. */
export async function validateToken(token: string, fetchFn: typeof fetch = (...a) => fetch(...a)): Promise<string | null> {
  const res = await fetchFn(`${API}/validate-token`, { headers: { Authorization: `Token ${token.trim()}` } });
  if (!res.ok && res.status !== 400 && res.status !== 401) throw new Error(`ListenBrainz responded ${res.status}`);
  const body = (await res.json().catch(() => ({}))) as { valid?: boolean; user_name?: string };
  return body.valid && body.user_name ? body.user_name : null;
}

export async function connect(db: SQLiteDatabase, token: string, userName: string): Promise<void> {
  await setSetting(db, TOKEN_KEY, token.trim());
  await setSetting(db, USER_KEY, userName);
  await setSetting(db, TOKEN_REJECTED_KEY, false);
}

/** Forget the token and drop unsent listens. */
export async function disconnect(db: SQLiteDatabase): Promise<void> {
  await db.runAsync('DELETE FROM settings WHERE key IN (?, ?, ?)', TOKEN_KEY, USER_KEY, TOKEN_REJECTED_KEY);
  await db.runAsync('DELETE FROM listens');
}
