import { create } from 'zustand';

import type { Track } from '@/db/queries';
import type { RepeatMode } from '@/services/playback/queue';
import type { SleepTimer } from '@/services/playback/sleep';

/**
 * Observable player state. Written only by PlaybackService; UI reads it and
 * calls PlaybackService for actions.
 */
export interface PlayerState {
  queue: Track[]; // playback order
  originalQueue: Track[]; // order before shuffle
  index: number;
  isPlaying: boolean;
  isBuffering: boolean;
  position: number; // seconds
  duration: number; // seconds
  repeat: RepeatMode;
  shuffle: boolean;
  /** Playback speed, 0.5..2 (1 = normal). */
  rate: number;
  /** Active sleep timer, if any. */
  sleep: SleepTimer | null;
  /** Volume normalization from ReplayGain tags. */
  normalize: boolean;
}

export const usePlayer = create<PlayerState>(() => ({
  queue: [],
  originalQueue: [],
  index: 0,
  isPlaying: false,
  isBuffering: false,
  position: 0,
  duration: 0,
  repeat: 'off',
  shuffle: false,
  rate: 1,
  sleep: null,
  normalize: true,
}));

export const selectCurrentTrack = (s: PlayerState): Track | undefined => s.queue[s.index];
