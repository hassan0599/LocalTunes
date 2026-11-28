/**
 * PlaybackService (spec 6.2) on top of expo-audio's native AudioPlaylist.
 *
 * The native playlist owns playback (it keeps going with the screen off and handles
 * lock-screen / notification next, previous and seek). This module mirrors its state
 * into the `usePlayer` store, keeps lock-screen metadata current, counts plays, and
 * persists the queue and position to `settings` so the app resumes where it stopped.
 *
 * UI code must call these functions rather than touching expo-audio directly.
 */
import {
  createAudioPlaylist,
  setAudioModeAsync,
  type AudioMetadata,
  type AudioPlaylist,
  type AudioPlaylistStatus,
} from 'expo-audio';
import { File } from 'expo-file-system';
import type { SQLiteDatabase } from 'expo-sqlite';

import {
  getSetting,
  getTracksByIds,
  markPlayed,
  setSetting,
  setTrackDurationIfMissing,
  type Track,
} from '@/db/queries';
import { flushListens, isListen, queueListen, TOKEN_KEY } from '@/services/listenbrainz/listenbrainz';
import { usePlaysVersion } from '@/state/library';
import { useNetwork } from '@/state/network';
import { usePlayer } from '@/state/player';

import {
  nextRepeatMode,
  previousIndex,
  shuffleKeepingCurrent,
  toLoopMode,
  type PersistedQueue,
} from './queue';
import { gainToVolume, medianGain } from './normalize';
import { clampRate, fadeVolume } from './sleep';

const QUEUE_KEY = 'player.queue';
const RATE_KEY = 'player.rate';
const NORMALIZE_KEY = 'player.normalize';
const POSITION_SAVE_INTERVAL_MS = 5000;

let db: SQLiteDatabase | null = null;
let playlist: AudioPlaylist | null = null;
let lockScreenActive = false;
let rebuilding = false;
let lastIndex = -1;
let lastMarkedKey = '';
let lastPositionSave = 0;
let pendingSeek: { index: number; seconds: number } | null = null;
let setupPromise: Promise<void> | null = null;
/** Set once the user starts something, so a slow queue restore never overrides their choice. */
let userStartedPlayback = false;
/** Sleep timer: the 1 s ticker, the song an end-of-song timer waits for, the applied fade. */
let sleepTicker: ReturnType<typeof setInterval> | null = null;
let sleepTrackId: number | null = null;
let sleepVolume = 1;
/** Volume normalization: this song's level, the library median for untagged songs, and the volume last sent. */
let normVolume = 1;
let libraryGain: number | null = null;
let appliedVolume = 1;
/** ListenBrainz: on while connected; progress of the current play through its song. */
let scrobbling = false;
let listen = { key: '', playedMs: 0, lastTime: 0, startedAt: 0, done: false };

const get = usePlayer.getState;
const set = usePlayer.setState;

// ---------------------------------------------------------------- setup

export function setupPlayback(database: SQLiteDatabase): Promise<void> {
  db = database;
  setupPromise ??= (async () => {
    await setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      // Exclusive focus: other apps pause, and calls pause us. Required for lock-screen controls.
      interruptionMode: 'doNotMix',
    });
    playlist = createAudioPlaylist({ updateInterval: 500, loop: 'none' });
    playlist.addListener('playlistStatusUpdate', onStatus);
    await restoreRate();
    await restoreNormalize();
    await refreshScrobbling();
    await restoreQueue();
  })();
  return setupPromise;
}

function requirePlaylist(): AudioPlaylist {
  if (!playlist) throw new Error('setupPlayback() has not run');
  return playlist;
}

/**
 * Run a non-essential native call (lock screen / notification). Their argument conversion
 * can throw (e.g. artwork that isn't a valid URL), and an uncaught throw from a tap handler
 * or status listener closes the app. Losing lock-screen metadata must never stop playback.
 */
function safely(label: string, fn: () => void) {
  try {
    fn();
  } catch (e) {
    console.warn(`playback: ${label} failed`, e);
  }
}

// ---------------------------------------------------------------- native status → store

function onStatus(s: AudioPlaylistStatus) {
  // An exception escaping a native event listener is fatal in release builds.
  try {
    handleStatus(s);
  } catch (e) {
    console.warn('playback: status update failed', e);
  }
}

function handleStatus(s: AudioPlaylistStatus) {
  if (rebuilding) return;
  const state = get();
  // Native calls are synchronous but their status events reach JS later, so events from the
  // middle of a rebuild (after clear(), between add()s) arrive once the new queue is set.
  // Their indexes refer to a half-built playlist: don't let them move the current track.
  const inSync = s.trackCount === state.queue.length;

  if (inSync && s.currentIndex !== lastIndex && s.currentIndex >= 0 && s.currentIndex < state.queue.length) {
    // The armed song ended on its own and the next one started: stop here.
    if (state.sleep?.kind === 'track' && sleepTrackId !== null && state.queue[s.currentIndex]?.id !== sleepTrackId) {
      fireSleepTimer(true);
    }
    lastIndex = s.currentIndex;
    set({ index: s.currentIndex, position: 0 });
    updateNormalization(state.queue[s.currentIndex]);
    updateLockScreen();
    void persistQueue();
  }

  if (pendingSeek && s.isLoaded && s.currentIndex === pendingSeek.index) {
    const { seconds } = pendingSeek;
    pendingSeek = null;
    void playlist?.seekTo(seconds);
  }

  set({
    isPlaying: s.playing,
    isBuffering: s.isBuffering,
    position: s.currentTime,
    duration: s.duration > 0 ? s.duration : get().duration,
  });

  if (inSync) checkTrackSleep(s);
  if (inSync) trackListen(s);

  const track = get().queue[s.currentIndex];
  if (!track || !db) return;

  if (s.playing) {
    const key = `${s.currentIndex}:${track.id}`;
    if (key !== lastMarkedKey) {
      lastMarkedKey = key;
      void markPlayed(db, track.id).then(() => usePlaysVersion.getState().bump(), () => {});
    }
  }
  if (s.isLoaded && s.duration > 0 && track.duration_ms == null) {
    void setTrackDurationIfMissing(db, track.id, s.duration * 1000);
  }
  const now = Date.now();
  if (now - lastPositionSave > POSITION_SAVE_INTERVAL_MS) {
    lastPositionSave = now;
    void persistQueue();
  }
}

// ---------------------------------------------------------------- lock screen

function metadataFor(t: Track | undefined): AudioMetadata {
  return {
    title: t?.title,
    artist: t?.artist ?? undefined,
    albumTitle: t?.album ?? undefined,
    artworkUrl: t?.artwork_uri ?? undefined,
  };
}

function updateLockScreen() {
  const p = playlist;
  if (!p) return;
  const { queue, index } = get();
  const meta = metadataFor(queue[index]);
  if (!lockScreenActive) {
    safely('setActiveForLockScreen', () => {
      p.setActiveForLockScreen(true, meta, {
        showNextTrack: true,
        showPreviousTrack: true,
        showSeekForward: false,
        showSeekBackward: false,
      });
      lockScreenActive = true;
    });
  } else {
    safely('updateLockScreenMetadata', () => p.updateLockScreenMetadata(meta));
  }
}

// ---------------------------------------------------------------- queue building

function sourceFor(t: Track) {
  return { uri: t.file_uri, name: t.title };
}

/** Replace the native playlist contents with `queue` and select `index`. */
function rebuild(queue: Track[], index: number) {
  const p = requirePlaylist();
  rebuilding = true;
  try {
    p.clear();
    for (const t of queue) p.add(sourceFor(t));
    if (queue.length) p.skipTo(index);
  } finally {
    rebuilding = false;
  }
  lastIndex = index;
  lastMarkedKey = '';
  updateNormalization(queue[index]);
}

/** Play `tracks` starting at `startIndex` (album, playlist, search results…). */
export function playTracks(tracks: Track[], startIndex = 0) {
  if (!tracks.length) return;
  // A tap can land before setup has created the native playlist: play once it exists.
  if (!playlist) {
    void setupPromise?.then(() => playTracks(tracks, startIndex));
    return;
  }
  // Callers look the tapped track up with indexOf; a list refreshed in between gives -1.
  if (!Number.isInteger(startIndex) || startIndex < 0 || startIndex >= tracks.length) startIndex = 0;
  userStartedPlayback = true;
  const p = playlist;
  const { shuffle } = get();
  const queue = shuffle ? shuffleKeepingCurrent(tracks, startIndex) : tracks;
  const index = shuffle ? 0 : startIndex;
  pendingSeek = null;
  set({ queue, originalQueue: tracks, index, position: 0, duration: 0 });
  rearmTrackSleep(queue[index]);
  rebuild(queue, index);
  void refreshLibraryGain();
  updateLockScreen();
  p.play();
  void persistQueue();
}

/** "Shuffle play": turn shuffle on and start from a random track. */
export function playTracksShuffled(tracks: Track[]) {
  if (!tracks.length) return;
  set({ shuffle: true });
  playTracks(tracks, Math.floor(Math.random() * tracks.length));
}

export function playNext(track: Track) {
  const p = requirePlaylist();
  const { queue, originalQueue, index } = get();
  if (!queue.length) return playTracks([track]);
  const at = index + 1;
  rebuilding = true;
  try {
    p.insert(sourceFor(track), at);
  } finally {
    rebuilding = false;
  }
  set({
    queue: [...queue.slice(0, at), track, ...queue.slice(at)],
    originalQueue: [...originalQueue, track],
  });
  void persistQueue();
}

export function addToQueue(track: Track) {
  const p = requirePlaylist();
  const { queue, originalQueue } = get();
  if (!queue.length) return playTracks([track]);
  p.add(sourceFor(track));
  set({ queue: [...queue, track], originalQueue: [...originalQueue, track] });
  void persistQueue();
}

/** Drop a track from the queue (e.g. after it is deleted from the library). */
export function removeFromQueue(trackId: number) {
  const p = playlist;
  if (!p) return;
  const { queue, originalQueue, index } = get();
  if (!queue.some((t) => t.id === trackId)) return;

  const newQueue = queue.filter((t) => t.id !== trackId);
  const removedBefore = queue.slice(0, index).filter((t) => t.id === trackId).length;
  const currentRemoved = queue[index]?.id === trackId;
  let newIndex = Math.max(0, index - removedBefore);
  if (newIndex >= newQueue.length) newIndex = Math.max(0, newQueue.length - 1);

  set({ queue: newQueue, originalQueue: originalQueue.filter((t) => t.id !== trackId), index: newIndex });
  if (currentRemoved) rearmTrackSleep(newQueue[newIndex]);
  if (currentRemoved || !newQueue.length) {
    const wasPlaying = get().isPlaying;
    rebuild(newQueue, newIndex);
    if (!newQueue.length) {
      safely('clearLockScreenControls', () => p.clearLockScreenControls());
      lockScreenActive = false;
    } else {
      updateLockScreen();
      if (wasPlaying) p.play();
    }
  } else {
    rebuilding = true;
    try {
      for (let i = queue.length - 1; i >= 0; i--) if (queue[i].id === trackId) p.remove(i);
    } finally {
      rebuilding = false;
    }
    lastIndex = newIndex;
  }
  void persistQueue();
}

/**
 * Move an upcoming song from queue index `from` to `to` (both after the current song, so
 * playback is never interrupted). The native playlist has no move, so it's remove + insert.
 */
export function moveInQueue(from: number, to: number) {
  const p = playlist;
  const { queue, originalQueue, index, shuffle } = get();
  if (!p || from === to || from <= index || to <= index || from >= queue.length || to >= queue.length) return;
  const newQueue = [...queue];
  const [track] = newQueue.splice(from, 1);
  newQueue.splice(to, 0, track);
  rebuilding = true;
  try {
    p.remove(from);
    p.insert(sourceFor(track), to);
  } finally {
    rebuilding = false;
  }
  // Without shuffle the play order *is* the original order, so keep them in step.
  set({ queue: newQueue, originalQueue: shuffle ? originalQueue : newQueue });
  void persistQueue();
}

/** Remove the upcoming song at queue index `at` (one entry, even if the song is queued twice). */
export function removeQueueAt(at: number) {
  const p = playlist;
  const { queue, originalQueue, index, shuffle } = get();
  if (!p || at <= index || at >= queue.length) return;
  const removed = queue[at];
  const newQueue = queue.filter((_, i) => i !== at);
  rebuilding = true;
  try {
    p.remove(at);
  } finally {
    rebuilding = false;
  }
  let newOriginal = newQueue;
  if (shuffle) {
    const k = originalQueue.indexOf(removed);
    newOriginal = k >= 0 ? originalQueue.filter((_, i) => i !== k) : originalQueue;
  }
  set({ queue: newQueue, originalQueue: newOriginal });
  void persistQueue();
}

// ---------------------------------------------------------------- transport

export function togglePlay() {
  const p = requirePlaylist();
  if (!get().queue.length) return;
  if (p.playing) p.pause();
  else {
    updateLockScreen();
    p.play();
  }
}

export function pause() {
  playlist?.pause();
}

export function skipToNext() {
  const p = requirePlaylist();
  const { index, queue, repeat } = get();
  if (index < queue.length - 1 || repeat === 'all') {
    rearmTrackSleep(queue[index < queue.length - 1 ? index + 1 : 0]);
    p.next();
  }
}

export function skipToPrevious() {
  const p = requirePlaylist();
  const { index, position, queue, repeat } = get();
  const target = previousIndex(index, position, queue.length, repeat);
  if (target === null) void p.seekTo(0);
  else {
    rearmTrackSleep(queue[target]);
    p.skipTo(target);
  }
}

export function skipTo(index: number) {
  const p = requirePlaylist();
  if (index < 0 || index >= get().queue.length) return;
  rearmTrackSleep(get().queue[index]);
  p.skipTo(index);
  if (!p.playing) p.play();
}

export async function seekTo(seconds: number) {
  set({ position: seconds });
  await requirePlaylist().seekTo(seconds);
}

export function cycleRepeat() {
  const repeat = nextRepeatMode[get().repeat];
  requirePlaylist().loop = toLoopMode(repeat);
  set({ repeat });
  void persistQueue();
}

export function toggleShuffle() {
  const { shuffle, queue, originalQueue, index, position, isPlaying } = get();
  const current = queue[index];
  if (!current) {
    set({ shuffle: !shuffle });
    return;
  }
  const newQueue = shuffle ? originalQueue : shuffleKeepingCurrent(queue, index);
  const newIndex = Math.max(0, newQueue.findIndex((t) => t.id === current.id));
  set({ shuffle: !shuffle, queue: newQueue, index: newIndex });
  rebuild(newQueue, newIndex);
  pendingSeek = position > 0 ? { index: newIndex, seconds: position } : null;
  if (isPlaying) requirePlaylist().play();
  void persistQueue();
}

// ---------------------------------------------------------------- playback speed

/** Set the playback speed (0.5–2×). It applies to every song until changed, and persists. */
export function setPlaybackRate(rate: number) {
  const r = clampRate(rate);
  set({ rate: r });
  const p = playlist;
  if (p) safely('playbackRate', () => (p.playbackRate = r));
  if (db) void setSetting(db, RATE_KEY, r);
}

async function restoreRate() {
  if (!db) return;
  const saved = await getSetting<number>(db, RATE_KEY);
  if (saved != null && saved !== 1) setPlaybackRate(saved);
}

// ---------------------------------------------------------------- sleep timer

/** Stop playback after `minutes`, fading out over the last few seconds. */
export function startSleepTimer(minutes: number) {
  clearSleep();
  set({ sleep: { kind: 'time', endsAt: Date.now() + minutes * 60_000 } });
  sleepTicker = setInterval(tickSleep, 1000);
}

/** Stop playback when the current song ends. */
export function sleepAtEndOfTrack() {
  clearSleep();
  const { queue, index } = get();
  sleepTrackId = queue[index]?.id ?? null;
  set({ sleep: { kind: 'track' } });
}

export function cancelSleepTimer() {
  clearSleep();
}

function clearSleep() {
  if (sleepTicker) clearInterval(sleepTicker);
  sleepTicker = null;
  sleepTrackId = null;
  applySleepVolume(1);
  if (get().sleep) set({ sleep: null });
}

/** The user moved to another song: an end-of-song timer now waits for that one. */
function rearmTrackSleep(next: Track | undefined) {
  if (get().sleep?.kind === 'track') {
    sleepTrackId = next?.id ?? null;
    applySleepVolume(1);
  }
}

function applySleepVolume(v: number) {
  sleepVolume = v;
  applyVolume();
}

/** Send normalization × sleep fade to the player (only when it changes). */
function applyVolume() {
  const v = Math.round(normVolume * sleepVolume * 1000) / 1000;
  if (v === appliedVolume) return;
  appliedVolume = v;
  const p = playlist;
  if (p) safely('volume', () => (p.volume = v));
}

// ---------------------------------------------------------------- volume normalization

function updateNormalization(track: Track | undefined) {
  normVolume = gainToVolume(track?.replay_gain_db, libraryGain, get().normalize);
  applyVolume();
}

/** Turn ReplayGain volume normalization on or off (persisted). */
export function setNormalize(enabled: boolean) {
  set({ normalize: enabled });
  const { queue, index } = get();
  updateNormalization(queue[index]);
  if (db) void setSetting(db, NORMALIZE_KEY, enabled);
}

async function restoreNormalize() {
  if (!db) return;
  const saved = await getSetting<boolean>(db, NORMALIZE_KEY);
  if (saved === false) set({ normalize: false });
  await refreshLibraryGain();
}

/** Median ReplayGain of the library, used for songs without a tag. */
async function refreshLibraryGain() {
  if (!db) return;
  try {
    const rows = await db.getAllAsync<{ g: number }>('SELECT replay_gain_db AS g FROM tracks WHERE replay_gain_db IS NOT NULL');
    libraryGain = medianGain(rows.map((r) => r.g));
  } catch {
    libraryGain = null;
  }
}

/** Timed mode: runs every second (JS timers keep running while audio plays in the background). */
export function tickSleep(now = Date.now()) {
  const sleep = get().sleep;
  if (sleep?.kind !== 'time') return;
  const remaining = sleep.endsAt - now;
  if (remaining <= 0) fireSleepTimer(false);
  else applySleepVolume(fadeVolume(remaining));
}

/** End-of-song mode: fade over the song's last seconds, stop just before it ends. */
function checkTrackSleep(s: AudioPlaylistStatus) {
  const { sleep, queue } = get();
  if (sleep?.kind !== 'track' || !s.isLoaded || s.duration <= 0) return;
  if (queue[s.currentIndex]?.id !== sleepTrackId) return;
  const remainingMs = ((s.duration - s.currentTime) * 1000) / (get().rate || 1);
  // Status arrives every 500 ms, so stop inside the last 600 ms rather than miss the end.
  if (remainingMs <= 600) fireSleepTimer(false);
  else applySleepVolume(fadeVolume(remainingMs));
}

/** Pause, restore the volume and clear the timer. `rewind`: the next song already started. */
function fireSleepTimer(rewind: boolean) {
  const p = playlist;
  if (p) {
    safely('pause', () => p.pause());
    if (rewind) void p.seekTo(0).catch(() => {});
  }
  clearSleep();
}

// ---------------------------------------------------------------- ListenBrainz

/** Re-read whether ListenBrainz is connected (after connecting or disconnecting). */
export async function refreshScrobbling() {
  if (!db) return;
  try {
    scrobbling = !!(await getSetting<string>(db, TOKEN_KEY));
  } catch {
    scrobbling = false;
  }
}

/** Test hook and settings shortcut. */
export function setScrobbling(enabled: boolean) {
  scrobbling = enabled;
}

/**
 * Count real progress through the current song (position deltas while playing, so seeking
 * ahead doesn't count and speed changes do). A new occurrence starts on a track change or
 * when repeat-one jumps back to the start.
 */
function trackListen(s: AudioPlaylistStatus) {
  const track = get().queue[s.currentIndex];
  if (!track) return;
  const key = `${s.currentIndex}:${track.id}`;
  const restarted = key === listen.key && s.currentTime + 5 < listen.lastTime;
  if (key !== listen.key || restarted) {
    listen = { key, playedMs: 0, lastTime: s.currentTime, startedAt: Date.now(), done: false };
    return;
  }
  const delta = s.currentTime - listen.lastTime;
  listen.lastTime = s.currentTime;
  if (s.playing && delta > 0 && delta < 3) listen.playedMs += delta * 1000;
  const durationMs = track.duration_ms ?? (s.duration > 0 ? s.duration * 1000 : null);
  if (!listen.done && scrobbling && db && isListen(listen.playedMs, durationMs)) {
    listen.done = true;
    const database = db;
    void queueListen(database, { ...track, duration_ms: durationMs }, listen.startedAt)
      .then((queued) => {
        if (queued && useNetwork.getState().online) return flushListens(database);
      })
      .catch((e) => console.warn('listenbrainz: queue failed', e));
  }
}

// ---------------------------------------------------------------- persistence

async function persistQueue() {
  if (!db) return;
  const { queue, originalQueue, index, position, repeat, shuffle } = get();
  const data: PersistedQueue = {
    trackIds: queue.map((t) => t.id),
    originalIds: originalQueue.map((t) => t.id),
    index,
    positionS: position,
    repeat,
    shuffle,
  };
  await setSetting(db, QUEUE_KEY, data);
}

async function restoreQueue() {
  if (!db) return;
  const saved = await getSetting<PersistedQueue>(db, QUEUE_KEY);
  if (!saved) return;
  const p = requirePlaylist();
  // Files can vanish between launches (deleted outside the app, SD card removed): skip them.
  const playable = (t: Track) => {
    try {
      return new File(t.file_uri).exists;
    } catch {
      return false;
    }
  };
  const queue = (await getTracksByIds(db, saved.trackIds)).filter(playable);
  const originalQueue = (await getTracksByIds(db, saved.originalIds)).filter(playable);
  // The user tapped a song while we were loading: keep what they chose.
  if (userStartedPlayback) return;
  p.loop = toLoopMode(saved.repeat);
  set({ repeat: saved.repeat, shuffle: saved.shuffle });
  if (!queue.length) return;

  // Tracks may have been deleted since; re-find the saved current track.
  const savedCurrentId = saved.trackIds[saved.index];
  const found = queue.findIndex((t) => t.id === savedCurrentId);
  const index = found >= 0 ? found : Math.min(saved.index, queue.length - 1);

  set({
    queue,
    originalQueue: originalQueue.length ? originalQueue : queue,
    index,
    position: found >= 0 ? saved.positionS : 0,
    duration: (queue[index].duration_ms ?? 0) / 1000,
  });
  rebuild(queue, index);
  if (found >= 0 && saved.positionS > 0) pendingSeek = { index, seconds: saved.positionS };
}
