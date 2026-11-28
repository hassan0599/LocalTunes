/**
 * Volume normalization from ReplayGain tags (pure; unit-tested).
 *
 * The player can only turn volume down (0..1), so gains above 0 dB are capped at full
 * volume. Songs without a tag use the library's median gain, so an untagged song doesn't
 * blast out next to tagged ones that are being turned down.
 */

/** Never go quieter than this (about -26 dB), whatever a broken tag says. */
const MIN_VOLUME = 0.05;

export function gainToVolume(gainDb: number | null | undefined, fallbackDb: number | null, enabled: boolean): number {
  if (!enabled) return 1;
  const g = gainDb ?? fallbackDb;
  if (g == null || !Number.isFinite(g)) return 1;
  const v = Math.pow(10, g / 20);
  return Math.round(Math.min(1, Math.max(MIN_VOLUME, v)) * 1000) / 1000;
}

/** Median of the known gains, or null if none are known. */
export function medianGain(gains: number[]): number | null {
  const g = gains.filter(Number.isFinite).sort((a, b) => a - b);
  if (!g.length) return null;
  const mid = Math.floor(g.length / 2);
  return g.length % 2 ? g[mid] : (g[mid - 1] + g[mid]) / 2;
}
