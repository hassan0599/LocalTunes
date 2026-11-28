/**
 * Android device scan (spec 6.1): read audio from MediaStore via expo-media-library and
 * upsert it into `tracks` with `source = 'device'`.
 *
 * - Runs on first launch (asks for permission once), when the app returns to the
 *   foreground, and on pull-to-refresh.
 * - Skips the work when MediaStore's signature (count, newest mtime, ids) is unchanged.
 * - New assets: resolve the file URI, filter out ringtones/recordings, read tags with the
 *   same reader as imports, save embedded cover art.
 * - Assets that disappeared are removed; tracks the user deleted are remembered and skipped.
 */
import { File } from 'expo-file-system';
import {
  Asset,
  AssetField,
  getPermissionsAsync,
  MediaType,
  Query,
  requestPermissionsAsync,
  type AssetMetadata,
  type PermissionResponse,
} from 'expo-media-library';
import type { SQLiteDatabase } from 'expo-sqlite';
import { Platform } from 'react-native';

import { deleteTrack, getSetting, insertTrack, listDeviceTracks, setSetting } from '@/db/queries';
import { removeFromQueue } from '@/services/playback/PlaybackService';
import { useLibraryVersion } from '@/state/library';
import { useScan, type ScanPermission } from '@/state/scan';

import { openByteSource } from './fileSource';
import { deleteOwnedFiles, saveCover } from './importer';
import { isMusic, librarySignature, MIN_MUSIC_SECONDS } from './scanFilter';
import { readTags, tagsFromFileName, type AudioTags } from './tags';

const SIGNATURE_KEY = 'scan.signature';
const ASKED_KEY = 'scan.permissionAsked';
const IGNORED_KEY = 'scan.ignored';
/** Bump the library (re-render lists) after this many inserts. */
const BATCH = 20;

export type ScanTrigger = 'launch' | 'foreground' | 'manual';

export interface ScanResult {
  skipped?: 'platform' | 'permission' | 'unchanged';
  added: number;
  removed: number;
  ignored: number;
  failed: number;
}

const NOTHING: Omit<ScanResult, 'skipped'> = { added: 0, removed: 0, ignored: 0, failed: 0 };

let running: Promise<ScanResult> | null = null;

/** Start a scan, or join the one already running. */
export function scanDevice(db: SQLiteDatabase, trigger: ScanTrigger): Promise<ScanResult> {
  if (Platform.OS !== 'android') return Promise.resolve({ ...NOTHING, skipped: 'platform' });
  running ??= runScan(db, trigger).finally(() => {
    running = null;
    useScan.setState({ scanning: false });
  });
  return running;
}

/** Remember a device track the user deleted so rescans don't bring it back. */
export async function ignoreDeviceAsset(db: SQLiteDatabase, deviceId: string): Promise<void> {
  const ignored = (await getSetting<string[]>(db, IGNORED_KEY)) ?? [];
  if (!ignored.includes(deviceId)) await setSetting(db, IGNORED_KEY, [...ignored, deviceId]);
}

/** How many device songs were deleted from the library (and are kept out of rescans). */
export async function hiddenDeviceSongCount(db: SQLiteDatabase): Promise<number> {
  return ((await getSetting<string[]>(db, IGNORED_KEY)) ?? []).length;
}

/** Bring back device songs deleted from the library: forget them, then rescan. */
export async function restoreHiddenDeviceSongs(db: SQLiteDatabase): Promise<ScanResult> {
  await setSetting(db, IGNORED_KEY, []);
  return scanDevice(db, 'manual');
}

function permissionState(p: PermissionResponse): ScanPermission {
  if (p.granted) return 'granted';
  return p.canAskAgain ? 'undetermined' : 'denied';
}

async function ensurePermission(db: SQLiteDatabase, trigger: ScanTrigger): Promise<boolean> {
  let perm = await getPermissionsAsync(false, ['audio']);
  if (!perm.granted && perm.canAskAgain) {
    // Ask automatically only once (first launch); afterwards only when the user taps.
    const asked = await getSetting<boolean>(db, ASKED_KEY);
    if (trigger === 'manual' || (trigger === 'launch' && !asked)) {
      await setSetting(db, ASKED_KEY, true);
      perm = await requestPermissionsAsync(false, ['audio']);
    }
  }
  useScan.setState({ permission: permissionState(perm) });
  return perm.granted;
}

async function runScan(db: SQLiteDatabase, trigger: ScanTrigger): Promise<ScanResult> {
  if (!(await ensurePermission(db, trigger))) return { ...NOTHING, skipped: 'permission' };

  const assets = await new Query().eq(AssetField.MEDIA_TYPE, MediaType.AUDIO).exeForMetadata();
  const signature = librarySignature(assets);
  if (trigger !== 'manual' && signature === (await getSetting<string>(db, SIGNATURE_KEY))) {
    return { ...NOTHING, skipped: 'unchanged' };
  }

  const result: ScanResult = { ...NOTHING };
  const existing = new Map((await listDeviceTracks(db)).map((t) => [t.device_id, t]));
  const ignored = new Set((await getSetting<string[]>(db, IGNORED_KEY)) ?? []);
  const durations = new Map(assets.map((a) => [a.id, a.duration]));

  // Removed from the device since the last scan, or no longer passing the music filter
  // (FILTER_VERSION in the signature forces this re-check when the rules change).
  for (const [deviceId, track] of existing) {
    if (durations.has(deviceId) && isMusic(track.file_uri, durations.get(deviceId))) continue;
    removeFromQueue(track.id);
    await deleteTrack(db, track.id);
    deleteOwnedFiles(null, track.artwork_uri); // only the cover art lives in app storage
    existing.delete(deviceId);
    result.removed++;
  }

  // MediaStore durations are in milliseconds (verified on device). Files without a
  // duration aren't playable audio; the path/name rules run once the URI is known.
  const fresh = assets.filter((a) => !existing.has(a.id));
  const candidates = fresh.filter((a) => !ignored.has(a.id) && (a.duration ?? 0) >= MIN_MUSIC_SECONDS * 1000);
  result.ignored = fresh.length - candidates.length;

  useScan.setState({ scanning: true, done: 0, total: candidates.length });
  for (let i = 0; i < candidates.length; i++) {
    try {
      const added = await addAsset(db, candidates[i]);
      if (added) result.added++;
      else result.ignored++;
    } catch (e) {
      console.warn('device scan: failed to add', candidates[i].filename, e);
      result.failed++;
    }
    useScan.setState({ done: i + 1 });
    if ((i + 1) % BATCH === 0) useLibraryVersion.getState().bump();
  }

  await setSetting(db, SIGNATURE_KEY, signature);
  if (result.added || result.removed) useLibraryVersion.getState().bump();
  return result;
}

/** Returns false when the asset is not music (ringtone folder, recordings…). */
async function addAsset(db: SQLiteDatabase, meta: AssetMetadata): Promise<boolean> {
  const uri = await new Asset(meta.id).getUri();
  if (!isMusic(uri, meta.duration)) return false;

  let tags: AudioTags = {};
  try {
    const src = openByteSource(new File(uri));
    try {
      tags = await readTags(src);
    } finally {
      src.close();
    }
  } catch {
    // Unreadable: fall back to the file name.
  }

  const name = meta.filename ?? decodeURIComponent(uri.split('/').pop() ?? 'Unknown');
  const fromName = tagsFromFileName(name);
  const id = await insertTrack(db, {
    title: tags.title ?? fromName.title ?? name,
    artist: tags.artist ?? fromName.artist ?? null,
    album: tags.album ?? null,
    album_artist: tags.albumArtist ?? null,
    track_no: tags.trackNo ?? fromName.trackNo ?? null,
    genre: tags.genre ?? null,
    replay_gain_db: tags.replayGainDb ?? null,
    duration_ms: tags.durationMs ?? meta.duration ?? null,
    file_uri: uri,
    source: 'device',
    device_id: meta.id,
  });
  if (tags.picture) await saveCover(db, id, tags.picture);
  return true;
}
