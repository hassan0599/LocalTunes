/** Pure helpers for the sleep timer and playback speed (no native code; unit-tested). */

/** Speeds offered in the player. 1 is normal. Pitch is preserved by the native player. */
export const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;

export function clampRate(rate: number): number {
  if (!Number.isFinite(rate)) return 1;
  return Math.min(2, Math.max(0.5, Math.round(rate * 100) / 100));
}

export function formatRate(rate: number): string {
  return `${Number(rate.toFixed(2))}×`;
}

/** Sleep timer presets, in minutes. */
export const SLEEP_PRESETS = [5, 15, 30, 45, 60, 90] as const;

/** The timer: a wall-clock deadline, or "stop when the current song ends". */
export type SleepTimer = { kind: 'time'; endsAt: number } | { kind: 'track' };

/** Volume fades out linearly over this long before the timer stops playback. */
export const FADE_MS = 10_000;

/** Volume (0..1) for a fade-out with `remainingMs` left; full volume until the fade starts. */
export function fadeVolume(remainingMs: number): number {
  if (remainingMs >= FADE_MS) return 1;
  if (remainingMs <= 0) return 0;
  return Math.round((remainingMs / FADE_MS) * 100) / 100;
}

/** "1:05:09", "12:04", "0:42" (remaining time on the timer). */
export function formatRemaining(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
