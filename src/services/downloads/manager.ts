/**
 * Download manager (spec 6.4).
 *
 * The `downloads` table is the queue, so it survives restarts. A worker loop ("kick")
 * starts up to MAX_CONCURRENT transfers when the network allows (online, and on Wi-Fi
 * if the user asked for that). Transfers are resumable: the DownloadTask's savable
 * state is stored with the progress, so a paused, interrupted or killed download
 * continues where it stopped. Failures retry with exponential backoff, up to 3 times.
 * On completion the file moves into app storage, its tags are read and it joins the
 * library with its source and license.
 */
import { Directory, DownloadTask, File, Paths, type DownloadPauseState } from 'expo-file-system';
import type { SQLiteDatabase } from 'expo-sqlite';

import { getSetting, insertTrack, setSetting, setTrackArtwork, type TrackSource } from '@/db/queries';
import { openByteSource } from '@/services/media/fileSource';
import { coversDir, deleteOwnedFiles, musicDir, saveCover } from '@/services/media/importer';
import { readTags, type AudioTags } from '@/services/media/tags';
import { removeFromQueue } from '@/services/playback/PlaybackService';
import { sourceById } from '@/services/sources';
import type { SourceId, SourceTrack } from '@/services/sources/types';
import { useDownloads } from '@/state/downloads';
import { useLibraryVersion } from '@/state/library';
import { useNetwork } from '@/state/network';

import {
  afterFailure,
  blockedReason,
  pickNext,
  PROGRESS_INTERVAL_MS,
  spaceError,
  type DownloadRow,
} from './schedule';

const WIFI_ONLY_KEY = 'downloads.wifiOnly';

let db: SQLiteDatabase | null = null;
const active = new Map<number, DownloadTask>();
/** Ids being paused by the user (so their task's end isn't treated as a failure). */
const userPaused = new Set<number>();
/** Ids being paused because the network went away; they resume automatically. */
const autoPaused = new Set<number>();
const cancelled = new Set<number>();
let kicking: Promise<void> | null = null;
let kickAgain = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

const partialDir = () => new Directory(Paths.document, 'downloads-partial');
const partialFile = (row: Pick<DownloadRow, 'id' | 'ext'>) => new File(partialDir(), `${row.id}.${row.ext}`);

function requireDb(): SQLiteDatabase {
  if (!db) throw new Error('startDownloads() has not run');
  return db;
}

// ---------------------------------------------------------------- lifecycle

export async function startDownloads(database: SQLiteDatabase): Promise<() => void> {
  db = database;
  // A download "in progress" when the app died resumes from its saved state.
  await db.runAsync("UPDATE downloads SET status = 'queued' WHERE status = 'downloading'");
  useDownloads.setState({ wifiOnly: (await getSetting<boolean>(db, WIFI_ONLY_KEY)) ?? false });
  const unsubscribe = useNetwork.subscribe(() => void kick());
  await kick();
  return () => {
    unsubscribe();
    if (retryTimer) clearTimeout(retryTimer);
  };
}

export async function setWifiOnly(value: boolean): Promise<void> {
  await setSetting(requireDb(), WIFI_ONLY_KEY, value);
  useDownloads.setState({ wifiOnly: value });
  await kick();
}

async function refreshRows(): Promise<DownloadRow[]> {
  const rows = await requireDb().getAllAsync<DownloadRow>('SELECT * FROM downloads ORDER BY created_at DESC');
  useDownloads.setState({ rows });
  return rows;
}

/** Re-evaluate the queue: start what can start, pause what must pause. Serialized. */
export function kick(): Promise<void> {
  if (!db) return Promise.resolve();
  if (kicking) {
    kickAgain = true;
    return kicking;
  }
  kicking = (async () => {
    do {
      kickAgain = false;
      await runQueue();
    } while (kickAgain);
  })().finally(() => {
    kicking = null;
  });
  return kicking;
}

async function runQueue() {
  const rows = await refreshRows();
  const { online, metered } = useNetwork.getState();
  const blocked = blockedReason({ online, metered }, useDownloads.getState().wifiOnly);
  useDownloads.setState({ blocked });

  if (blocked) {
    for (const [id, task] of active) await pauseTask(id, task, 'auto');
    return;
  }

  const now = Date.now();
  for (const row of pickNext(rows, new Set(active.keys()), now)) void startTransfer(row);

  // Wake up for the next scheduled retry.
  if (retryTimer) clearTimeout(retryTimer);
  const nextRetry = rows
    .filter((r) => r.status === 'queued' && (r.next_attempt_at ?? 0) > now)
    .reduce<number | null>((min, r) => (min === null || r.next_attempt_at! < min ? r.next_attempt_at! : min), null);
  if (nextRetry !== null) retryTimer = setTimeout(() => void kick(), nextRetry - now + 50);
}

// ---------------------------------------------------------------- transfers

async function update(id: number, fields: Partial<DownloadRow>) {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  await requireDb().runAsync(
    `UPDATE downloads SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`,
    ...keys.map((k) => (fields as Record<string, string | number | null>)[k]),
    id,
  );
}

async function startTransfer(row: DownloadRow) {
  const space = spaceError(row, Paths.availableDiskSpace);
  if (space) {
    await update(row.id, { status: 'failed', error: space });
    void kick();
    return;
  }

  partialDir().create({ intermediates: true, idempotent: true });
  const target = partialFile(row);
  let lastWrite = 0;
  let task: DownloadTask;
  const onProgress = ({ bytesWritten, totalBytes }: { bytesWritten: number; totalBytes: number }) => {
    const total = totalBytes > 0 ? totalBytes : null;
    useDownloads.setState((s) => ({ progress: { ...s.progress, [row.id]: { done: bytesWritten, total } } }));
    const now = Date.now();
    if (now - lastWrite >= PROGRESS_INTERVAL_MS) {
      lastWrite = now;
      let pause: string | null = null;
      try {
        pause = JSON.stringify(task.savable());
      } catch {
        // Not every platform can snapshot an active task; resume then restarts the file.
      }
      void update(row.id, { bytes_done: bytesWritten, bytes_total: total, pause_state: pause });
    }
  };

  let resumeState: DownloadPauseState | null = null;
  try {
    resumeState = row.pause_state ? (JSON.parse(row.pause_state) as DownloadPauseState) : null;
  } catch {
    resumeState = null;
  }
  task = resumeState && target.exists ? DownloadTask.fromSavable(resumeState, { onProgress }) : new DownloadTask(row.url, target, { onProgress });

  active.set(row.id, task);
  await update(row.id, { status: 'downloading', error: null });
  void refreshRows();

  try {
    const file = resumeState && target.exists ? await task.resumeAsync() : await task.downloadAsync();
    if (!file) return; // paused or cancelled; whoever did that already updated the row
    await finalize(row, file);
  } catch (e) {
    if (userPaused.has(row.id) || autoPaused.has(row.id) || cancelled.has(row.id)) return;
    const message = e instanceof Error ? e.message : String(e);
    // A broken resume state shouldn't fail every retry: start the file over next time.
    if (target.exists) target.delete();
    await update(row.id, { ...afterFailure(row, message, Date.now()), pause_state: null, bytes_done: 0 });
  } finally {
    active.delete(row.id);
    userPaused.delete(row.id);
    autoPaused.delete(row.id);
    cancelled.delete(row.id);
    useDownloads.setState((s) => {
      const progress = { ...s.progress };
      delete progress[row.id];
      return { progress };
    });
    void kick();
  }
}

async function pauseTask(id: number, task: DownloadTask, reason: 'user' | 'auto') {
  (reason === 'user' ? userPaused : autoPaused).add(id);
  try {
    await task.pauseAsync();
    await update(id, { status: reason === 'user' ? 'paused' : 'queued', pause_state: JSON.stringify(task.savable()) });
  } catch {
    await update(id, { status: reason === 'user' ? 'paused' : 'queued' });
  }
}

/** Move into the library: tags, track row with source + license, cover art. */
async function finalize(row: DownloadRow, file: File) {
  const database = requireDb();
  musicDir().create({ intermediates: true, idempotent: true });
  const dest = new File(musicDir(), `dl-${row.id}.${row.ext}`);
  if (dest.exists) dest.delete();
  await file.move(dest);

  let tags: AudioTags = {};
  try {
    const src = openByteSource(dest);
    try {
      tags = await readTags(src);
    } finally {
      src.close();
    }
  } catch {
    // Use the source's metadata.
  }

  // The source's metadata is curated; prefer it over embedded tags for the basics.
  const trackId = await insertTrack(database, {
    title: row.title || tags.title || 'Untitled',
    artist: row.artist ?? tags.artist ?? null,
    album: row.album ?? tags.album ?? null,
    album_artist: tags.albumArtist ?? null,
    track_no: row.track_no ?? tags.trackNo ?? null,
    genre: tags.genre ?? row.genre ?? null,
    duration_ms: tags.durationMs ?? row.duration_ms ?? null,
    file_uri: dest.uri,
    source: row.source as TrackSource,
    license: row.license,
    mbid: row.mbid,
  });

  if (tags.picture) await saveCover(database, trackId, tags.picture);
  else if (row.artwork_url) {
    try {
      coversDir().create({ intermediates: true, idempotent: true });
      const cover = new File(coversDir(), `${trackId}.jpg`);
      if (cover.exists) cover.delete();
      const out = await File.downloadFileAsync(row.artwork_url, cover, { idempotent: true });
      await setTrackArtwork(database, trackId, out.uri);
    } catch {
      // No cover: the placeholder is fine.
    }
  }

  await update(row.id, {
    status: 'done',
    track_id: trackId,
    finished_at: Date.now(),
    pause_state: null,
    error: null,
    bytes_done: row.bytes_total ?? dest.size ?? 0,
  });
  useLibraryVersion.getState().bump();
}

// ---------------------------------------------------------------- user actions

export type EnqueueResult = 'queued' | 'already-queued' | 'already-downloaded';

export async function enqueue(track: SourceTrack, extra: { mbid?: string } = {}): Promise<EnqueueResult> {
  const database = requireDb();
  const existing = await database.getFirstAsync<Pick<DownloadRow, 'id' | 'status'>>(
    'SELECT id, status FROM downloads WHERE source = ? AND source_id = ?',
    track.source,
    track.sourceId,
  );
  if (existing?.status === 'done') return 'already-downloaded';
  if (existing?.status === 'failed') {
    await retry(existing.id);
    return 'queued';
  }
  if (existing) return 'already-queued';

  const resolved = await sourceById(track.source).resolve(track);
  await database.runAsync(
    `INSERT INTO downloads (source, source_id, url, ext, title, artist, album, track_no, duration_ms, license, artwork_url, mbid, bytes_total, created_at, genre)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    track.source,
    track.sourceId,
    resolved.url,
    resolved.ext,
    track.title,
    track.artist ?? null,
    track.album ?? null,
    track.trackNo ?? null,
    track.durationMs ?? null,
    resolved.license,
    track.artworkUrl ?? null,
    track.mbid ?? extra.mbid ?? null,
    track.sizeBytes ?? null,
    Date.now(),
    track.genre ?? null,
  );
  await kick();
  return 'queued';
}

export async function pause(id: number) {
  const task = active.get(id);
  if (task) await pauseTask(id, task, 'user');
  else await update(id, { status: 'paused' });
  await kick();
}

export async function resume(id: number) {
  await update(id, { status: 'queued', next_attempt_at: null });
  await kick();
}

export async function retry(id: number) {
  await update(id, { status: 'queued', attempts: 0, next_attempt_at: null, error: null });
  await kick();
}

/** Cancel an unfinished download and remove its partial file. */
export async function cancel(id: number) {
  const row = await requireDb().getFirstAsync<DownloadRow>('SELECT * FROM downloads WHERE id = ?', id);
  const task = active.get(id);
  if (task) {
    cancelled.add(id);
    task.cancel();
  }
  if (row) {
    const partial = partialFile(row);
    if (partial.exists) partial.delete();
  }
  await requireDb().runAsync('DELETE FROM downloads WHERE id = ?', id);
  await kick();
}

/** Bulk delete (spec 8 "Storage"): every downloaded track from one source, files included. */
export async function deleteAllFromSource(source: SourceId | 'imported'): Promise<number> {
  const database = requireDb();
  const tracks = await database.getAllAsync<{ id: number; file_uri: string; artwork_uri: string | null }>(
    'SELECT id, file_uri, artwork_uri FROM tracks WHERE source = ?',
    source,
  );
  for (const t of tracks) {
    removeFromQueue(t.id);
    deleteOwnedFiles(t.file_uri, t.artwork_uri);
  }
  await database.withTransactionAsync(async () => {
    await database.runAsync('DELETE FROM tracks WHERE source = ?', source);
    await database.runAsync("DELETE FROM downloads WHERE source = ? AND status = 'done'", source);
  });
  useLibraryVersion.getState().bump();
  await kick();
  return tracks.length;
}

/** Bytes used in app storage, per track source (imports and downloads; device files aren't ours). */
export async function storageBySource(database: SQLiteDatabase): Promise<{ source: string; count: number; bytes: number }[]> {
  const tracks = await database.getAllAsync<{ source: string; file_uri: string }>(
    "SELECT source, file_uri FROM tracks WHERE source != 'device'",
  );
  const totals = new Map<string, { count: number; bytes: number }>();
  for (const t of tracks) {
    let size = 0;
    try {
      size = new File(t.file_uri).size ?? 0;
    } catch {
      size = 0;
    }
    const cur = totals.get(t.source) ?? { count: 0, bytes: 0 };
    totals.set(t.source, { count: cur.count + 1, bytes: cur.bytes + size });
  }
  return [...totals.entries()].map(([source, v]) => ({ source, ...v })).sort((a, b) => b.bytes - a.bytes);
}
