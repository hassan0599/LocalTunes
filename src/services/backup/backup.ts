/**
 * Library backup and restore (pure logic over SQLite; file picking lives in ./io).
 *
 * A backup is JSON: every song's identity and play stats, playlists as references into
 * that song list, the wishlist and a few settings. Music files themselves aren't included
 * (they're on the phone or re-downloadable), so restoring matches songs against whatever
 * library the phone has now: MusicBrainz ID first, then artist + title (preferring the
 * closest duration). Restoring twice is harmless: play counts take the higher value and
 * the wishlist ignores duplicates.
 *
 * M3U playlists (from LocalTunes or other players) restore the same way.
 */
import type { SQLiteDatabase } from 'expo-sqlite';

import type { Track } from '@/db/queries';
import { artistKeys, normalize } from '@/services/musicbrainz/match';

export const BACKUP_FORMAT = 1;

export interface BackupTrack {
  title: string;
  artist: string | null;
  album: string | null;
  duration_ms: number | null;
  mbid: string | null;
  play_count: number;
  last_played_at: number | null;
}

export interface BackupPlaylist {
  name: string;
  created_at: number;
  /** Indexes into `tracks`, in playlist order. */
  items: number[];
}

export interface BackupWish {
  mbid: string;
  kind: 'recording' | 'release-group';
  title: string;
  artist: string | null;
  added_at: number;
}

export interface Backup {
  app: 'LocalTunes';
  format: number;
  exportedAt: string;
  appVersion?: string;
  tracks: BackupTrack[];
  playlists: BackupPlaylist[];
  wishlist: BackupWish[];
  settings: Record<string, unknown>;
}

/** Settings worth carrying to a new phone (never credentials). */
export const BACKED_UP_SETTINGS = ['player.rate', 'player.normalize', 'downloads.wifiOnly'] as const;

export async function buildBackup(db: SQLiteDatabase, now: Date, appVersion?: string): Promise<Backup> {
  const rows = await db.getAllAsync<Track>('SELECT * FROM tracks ORDER BY id');
  const indexOf = new Map(rows.map((t, i) => [t.id, i]));
  const tracks: BackupTrack[] = rows.map((t) => ({
    title: t.title,
    artist: t.artist,
    album: t.album,
    duration_ms: t.duration_ms,
    mbid: t.mbid,
    play_count: t.play_count,
    last_played_at: t.last_played_at,
  }));

  const playlistRows = await db.getAllAsync<{ id: number; name: string; created_at: number }>(
    'SELECT id, name, created_at FROM playlists ORDER BY created_at',
  );
  const playlists: BackupPlaylist[] = [];
  for (const p of playlistRows) {
    const items = await db.getAllAsync<{ track_id: number }>(
      'SELECT track_id FROM playlist_tracks WHERE playlist_id = ? ORDER BY position',
      p.id,
    );
    playlists.push({
      name: p.name,
      created_at: p.created_at,
      items: items.map((i) => indexOf.get(i.track_id)).filter((i): i is number => i !== undefined),
    });
  }

  const wishlist = await db.getAllAsync<BackupWish>('SELECT mbid, kind, title, artist, added_at FROM wishlist ORDER BY added_at');

  const settings: Record<string, unknown> = {};
  for (const key of BACKED_UP_SETTINGS) {
    const row = await db.getFirstAsync<{ value: string | null }>('SELECT value FROM settings WHERE key = ?', key);
    if (row?.value != null) {
      try {
        settings[key] = JSON.parse(row.value);
      } catch {
        // Unreadable setting: leave it out.
      }
    }
  }

  return { app: 'LocalTunes', format: BACKUP_FORMAT, exportedAt: now.toISOString(), appVersion, tracks, playlists, wishlist, settings };
}

export class BackupError extends Error {}

/** Parse and sanity-check a backup file. Throws BackupError with a user-facing message. */
export function parseBackup(text: string): Backup {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new BackupError('This file isn’t a LocalTunes backup (it isn’t valid JSON).');
  }
  const b = data as Partial<Backup>;
  if (!b || b.app !== 'LocalTunes' || !Array.isArray(b.tracks) || !Array.isArray(b.playlists)) {
    throw new BackupError('This file isn’t a LocalTunes backup.');
  }
  if (typeof b.format !== 'number' || b.format > BACKUP_FORMAT) {
    throw new BackupError('This backup was made by a newer version of LocalTunes. Update the app, then try again.');
  }
  return {
    app: 'LocalTunes',
    format: b.format,
    exportedAt: String(b.exportedAt ?? ''),
    appVersion: b.appVersion,
    tracks: b.tracks.filter((t): t is BackupTrack => !!t && typeof t.title === 'string'),
    playlists: b.playlists.filter((p) => !!p && typeof p.name === 'string' && Array.isArray(p.items)),
    wishlist: Array.isArray(b.wishlist) ? b.wishlist.filter((w) => !!w && typeof w.mbid === 'string' && typeof w.title === 'string') : [],
    settings: b.settings && typeof b.settings === 'object' ? b.settings : {},
  };
}

// ---------------------------------------------------------------- matching

export interface TrackRef {
  title: string;
  artist?: string | null;
  album?: string | null;
  duration_ms?: number | null;
  mbid?: string | null;
  /** File path or URI (M3U entries). */
  path?: string | null;
}

type LibTrack = Pick<Track, 'id' | 'title' | 'artist' | 'album' | 'duration_ms' | 'mbid' | 'file_uri'>;

/** Finds the library song a reference most likely means. */
export class TrackResolver {
  private byMbid = new Map<string, LibTrack>();
  private byKey = new Map<string, LibTrack[]>();
  private byPath = new Map<string, LibTrack>();
  private byFileName = new Map<string, LibTrack>();

  constructor(tracks: LibTrack[]) {
    for (const t of tracks) {
      if (t.mbid) this.byMbid.set(t.mbid, t);
      const title = normalize(t.title);
      for (const a of artistKeys(t.artist)) {
        const k = `${a}|${title}`;
        this.byKey.set(k, [...(this.byKey.get(k) ?? []), t]);
      }
      const path = pathOf(t.file_uri);
      this.byPath.set(path, t);
      this.byFileName.set(baseName(path), t);
    }
  }

  resolve(ref: TrackRef): LibTrack | undefined {
    if (ref.mbid) {
      const t = this.byMbid.get(ref.mbid);
      if (t) return t;
    }
    if (ref.path) {
      const path = pathOf(ref.path);
      const t = this.byPath.get(path) ?? this.byFileName.get(baseName(path));
      if (t) return t;
    }
    const title = normalize(ref.title);
    if (!title) return undefined;
    const candidates = new Set<LibTrack>();
    for (const a of artistKeys(ref.artist)) for (const t of this.byKey.get(`${a}|${title}`) ?? []) candidates.add(t);
    if (!candidates.size) return undefined;
    const album = normalize(ref.album);
    // Prefer the same album, then the closest duration.
    return [...candidates].sort((x, y) => score(y, album, ref) - score(x, album, ref))[0];
  }
}

function score(t: LibTrack, album: string, ref: TrackRef): number {
  let s = 0;
  if (album && normalize(t.album) === album) s += 10;
  if (ref.duration_ms && t.duration_ms) s -= Math.min(10, Math.abs(ref.duration_ms - t.duration_ms) / 2000);
  return s;
}

/** "file:///storage/Music/A%20B.mp3" and "/storage/Music/A B.mp3" compare equal. */
function pathOf(uri: string): string {
  let p = uri.replace(/^file:\/\//i, '');
  try {
    p = decodeURIComponent(p);
  } catch {
    // Not percent-encoded.
  }
  return p.replace(/\\/g, '/').toLowerCase();
}

function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

export async function libraryResolver(db: SQLiteDatabase): Promise<TrackResolver> {
  return new TrackResolver(await db.getAllAsync<LibTrack>('SELECT id, title, artist, album, duration_ms, mbid, file_uri FROM tracks'));
}

// ---------------------------------------------------------------- restore

export interface RestoreReport {
  songs: number;
  matched: number;
  playlists: number;
  playlistSongsMissing: number;
  wishlist: number;
  settings: Record<string, unknown>;
}

async function uniquePlaylistName(db: SQLiteDatabase, name: string): Promise<string> {
  const taken = new Set((await db.getAllAsync<{ name: string }>('SELECT name FROM playlists')).map((r) => r.name.toLowerCase()));
  if (!taken.has(name.toLowerCase())) return name;
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? `${name} (restored)` : `${name} (restored ${n})`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

/** Create a playlist from resolved song ids (missing ones are skipped). */
async function insertPlaylist(db: SQLiteDatabase, name: string, ids: number[], createdAt?: number): Promise<void> {
  const unique = await uniquePlaylistName(db, name.trim() || 'Restored playlist');
  const r = createdAt
    ? await db.runAsync('INSERT INTO playlists (name, created_at) VALUES (?, ?)', unique, createdAt)
    : await db.runAsync('INSERT INTO playlists (name) VALUES (?)', unique);
  for (let i = 0; i < ids.length; i++) {
    await db.runAsync('INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)', r.lastInsertRowId, ids[i], i);
  }
}

export async function restoreBackup(db: SQLiteDatabase, backup: Backup): Promise<RestoreReport> {
  const resolver = await libraryResolver(db);
  const resolved = backup.tracks.map((t) => resolver.resolve(t));
  const report: RestoreReport = { songs: backup.tracks.length, matched: 0, playlists: 0, playlistSongsMissing: 0, wishlist: 0, settings: {} };

  await db.withTransactionAsync(async () => {
    for (let i = 0; i < backup.tracks.length; i++) {
      const lib = resolved[i];
      if (!lib) continue;
      report.matched++;
      const t = backup.tracks[i];
      if (t.play_count > 0 || t.last_played_at) {
        await db.runAsync(
          `UPDATE tracks SET play_count = MAX(play_count, ?), last_played_at = MAX(COALESCE(last_played_at, 0), ?) WHERE id = ?`,
          Math.max(0, Math.floor(t.play_count || 0)),
          t.last_played_at ?? 0,
          lib.id,
        );
        await db.runAsync('UPDATE tracks SET last_played_at = NULL WHERE id = ? AND last_played_at = 0', lib.id);
      }
    }

    for (const p of backup.playlists) {
      const ids: number[] = [];
      for (const i of p.items) {
        const lib = resolved[i];
        if (lib) ids.push(lib.id);
        else report.playlistSongsMissing++;
      }
      await insertPlaylist(db, p.name, ids, p.created_at);
      report.playlists++;
    }

    for (const w of backup.wishlist) {
      const r = await db.runAsync(
        'INSERT OR IGNORE INTO wishlist (mbid, kind, title, artist, added_at) VALUES (?, ?, ?, ?, ?)',
        w.mbid,
        w.kind === 'release-group' ? 'release-group' : 'recording',
        w.title,
        w.artist ?? null,
        w.added_at || Date.now(),
      );
      report.wishlist += r.changes;
    }

    for (const key of BACKED_UP_SETTINGS) {
      if (key in backup.settings) {
        await db.runAsync(
          'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
          key,
          JSON.stringify(backup.settings[key]),
        );
        report.settings[key] = backup.settings[key];
      }
    }
  });
  return report;
}

// ---------------------------------------------------------------- M3U

export function toM3u(tracks: Pick<Track, 'title' | 'artist' | 'duration_ms' | 'file_uri'>[]): string {
  const lines = ['#EXTM3U'];
  for (const t of tracks) {
    const secs = t.duration_ms ? Math.round(t.duration_ms / 1000) : -1;
    lines.push(`#EXTINF:${secs},${t.artist ? `${t.artist} - ` : ''}${t.title}`);
    // Plain paths for local files (what other players expect); other URIs as they are.
    lines.push(t.file_uri.startsWith('file://') ? decodeFileUri(t.file_uri) : t.file_uri);
  }
  return lines.join('\n') + '\n';
}

function decodeFileUri(uri: string): string {
  const p = uri.replace(/^file:\/\//i, '');
  try {
    return decodeURIComponent(p);
  } catch {
    return p;
  }
}

/** Entries of an M3U/M3U8 playlist: the path plus "Artist - Title" and duration from #EXTINF. */
export function parseM3u(text: string): TrackRef[] {
  const out: TrackRef[] = [];
  let pending: { title: string; artist: string | null; duration_ms: number | null } | null = null;
  for (const raw of text.replace(/^﻿/, '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#EXTINF:')) {
      const m = /^#EXTINF:(-?\d+(?:\.\d+)?)[^,]*,(.*)$/.exec(line);
      if (m) {
        const secs = parseFloat(m[1]);
        const info = m[2].trim();
        const dash = info.indexOf(' - ');
        pending = {
          artist: dash > 0 ? info.slice(0, dash).trim() : null,
          title: dash > 0 ? info.slice(dash + 3).trim() : info,
          duration_ms: secs > 0 ? Math.round(secs * 1000) : null,
        };
      }
      continue;
    }
    if (line.startsWith('#')) continue;
    const name = baseName(line.replace(/\\/g, '/')).replace(/\.[^.]+$/, '');
    out.push({ path: line, title: pending?.title ?? name, artist: pending?.artist ?? null, duration_ms: pending?.duration_ms ?? null });
    pending = null;
  }
  return out;
}

export interface M3uReport {
  name: string;
  entries: number;
  matched: number;
}

export async function restoreM3u(db: SQLiteDatabase, name: string, text: string): Promise<M3uReport> {
  const entries = parseM3u(text);
  const resolver = await libraryResolver(db);
  const ids = entries.map((e) => resolver.resolve(e)?.id).filter((id): id is number => id !== undefined);
  await db.withTransactionAsync(() => insertPlaylist(db, name, ids));
  return { name, entries: entries.length, matched: ids.length };
}
