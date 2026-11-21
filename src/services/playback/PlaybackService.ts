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
import { usePlayer } from '@/state/player';

import {
  nextRepeatMode,
  previousIndex,
  shuffleKeepingCurrent,
  toLoopMode,
  type PersistedQueue,
} from './queue';

const QUEUE_KEY = 'player.queue';
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
    await restoreQueue();
  })();
  return setupPromise;
}

function requirePlaylist(): AudioPlaylist {
  if (!playlist) throw new Error('setupPlayback() has not run');
  return playlist;
}

// ---------------------------------------------------------------- native status → store

function onStatus(s: AudioPlaylistStatus) {
  if (rebuilding) return;
  const state = get();

  if (s.currentIndex !== lastIndex && s.currentIndex >= 0 && s.currentIndex < state.queue.length) {
    lastIndex = s.currentIndex;
    set({ index: s.currentIndex, position: 0 });
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

  const track = get().queue[s.currentIndex];
  if (!track || !db) return;

  if (s.playing) {
    const key = `${s.currentIndex}:${track.id}`;
    if (key !== lastMarkedKey) {
      lastMarkedKey = key;
      void markPlayed(db, track.id);
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
    p.setActiveForLockScreen(true, meta, {
      showNextTrack: true,
      showPreviousTrack: true,
      showSeekForward: false,
      showSeekBackward: false,
    });
    lockScreenActive = true;
  } else {
    p.updateLockScreenMetadata(meta);
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
}

/** Play `tracks` starting at `startIndex` (album, playlist, search results…). */
export function playTracks(tracks: Track[], startIndex = 0) {
  if (!tracks.length) return;
  const p = requirePlaylist();
  const { shuffle } = get();
  const queue = shuffle ? shuffleKeepingCurrent(tracks, startIndex) : tracks;
  const index = shuffle ? 0 : startIndex;
  pendingSeek = null;
  set({ queue, originalQueue: tracks, index, position: 0, duration: 0 });
  rebuild(queue, index);
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
  if (currentRemoved || !newQueue.length) {
    const wasPlaying = get().isPlaying;
    rebuild(newQueue, newIndex);
    if (!newQueue.length) {
      p.clearLockScreenControls();
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
  if (index < queue.length - 1 || repeat === 'all') p.next();
}

export function skipToPrevious() {
  const p = requirePlaylist();
  const { index, position, queue, repeat } = get();
  const target = previousIndex(index, position, queue.length, repeat);
  if (target === null) void p.seekTo(0);
  else p.skipTo(target);
}

export function skipTo(index: number) {
  const p = requirePlaylist();
  if (index < 0 || index >= get().queue.length) return;
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
