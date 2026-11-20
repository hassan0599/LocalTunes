/** Pure queue helpers (no native code), unit-tested in queue.test.ts. */

export type RepeatMode = 'off' | 'all' | 'one';

export const nextRepeatMode: Record<RepeatMode, RepeatMode> = { off: 'all', all: 'one', one: 'off' };

export function toLoopMode(r: RepeatMode): 'none' | 'all' | 'single' {
  return r === 'off' ? 'none' : r === 'all' ? 'all' : 'single';
}

/**
 * Fisher–Yates shuffle that keeps the current item first, so playback continues
 * uninterrupted and every other item plays exactly once afterwards.
 */
export function shuffleKeepingCurrent<T>(items: T[], currentIndex: number, random: () => number = Math.random): T[] {
  if (items.length === 0) return [];
  const current = items[currentIndex];
  const rest = items.filter((_, i) => i !== currentIndex);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  return current === undefined ? rest : [current, ...rest];
}

/** "Previous" restarts the track if more than this many seconds in. */
export const RESTART_THRESHOLD_S = 3;

/** Index to jump to for "previous", or null to just restart the current track. */
export function previousIndex(index: number, positionS: number, length: number, repeat: RepeatMode): number | null {
  if (positionS > RESTART_THRESHOLD_S) return null;
  if (index > 0) return index - 1;
  if (repeat === 'all' && length > 0) return length - 1;
  return null;
}

/** Saved between launches so the app resumes where it stopped (spec 6.2). */
export interface PersistedQueue {
  trackIds: number[]; // playback order
  originalIds: number[]; // order before shuffle
  index: number;
  positionS: number;
  repeat: RepeatMode;
  shuffle: boolean;
}

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
