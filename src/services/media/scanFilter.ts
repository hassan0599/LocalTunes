/** Pure rules for which device audio files count as music (unit-tested). */

/** Bump when the rules below change, so the next scan re-checks every device track. */
export const FILTER_VERSION = 2;

/** Shorter files are usually notification sounds, voice notes or clips. */
export const MIN_MUSIC_SECONDS = 30;

/**
 * File names of voice recordings and messaging-app audio, wherever they end up
 * (e.g. shared into Downloads): "Voice 012.m4a", "AUD-20230813-WA0002.m4a", "PTT-…-WA….opus".
 */
const NON_MUSIC_NAMES = [/^voice[\s_-]*\d+\./i, /^(aud|ptt)-\d{8}-wa\d+\./i, /^recording[\s_-]*\d+\./i];

export function isNonMusicName(fileName: string): boolean {
  return NON_MUSIC_NAMES.some((re) => re.test(fileName));
}

/** Everything a scan needs to decide whether a device audio file is music. */
export function isMusic(uri: string, durationMs: number | null | undefined): boolean {
  // MediaStore reports no duration for files that aren't playable audio (e.g. app backups named .wav).
  if (!durationMs || durationMs < MIN_MUSIC_SECONDS * 1000) return false;
  const name = decodeURIComponent(uri.split('/').pop() ?? '');
  return !isNonMusicPath(uri) && !isNonMusicName(name);
}

const NON_MUSIC_DIRS = [
  '/notifications/',
  '/ringtones/',
  '/alarms/',
  '/recordings/',
  '/call/',
  '/voice recorder/',
  '/sounds/',
  'whatsapp voice notes',
  '/whatsapp audio/',
  '/telegram audio/',
  '/android/data/',
  '/android/media/',
  '/backups/',
  '/backup/',
];

/** True for files under folders that hold ringtones, recordings and app audio. */
export function isNonMusicPath(uri: string): boolean {
  const path = decodeURIComponent(uri).toLowerCase();
  return NON_MUSIC_DIRS.some((d) => path.includes(d));
}

/**
 * Quick change detector so foreground scans can skip when nothing changed.
 * Order-independent: count, newest modification time and a sum of per-id hashes.
 */
export function librarySignature(assets: { id: string; modificationTime: number | null }[]): string {
  let maxMtime = 0;
  let idSum = 0;
  for (const a of assets) {
    if ((a.modificationTime ?? 0) > maxMtime) maxMtime = a.modificationTime ?? 0;
    let h = 0;
    for (let i = 0; i < a.id.length; i++) h = (h * 31 + a.id.charCodeAt(i)) | 0;
    idSum = (idSum + h) | 0;
  }
  return `v${FILTER_VERSION}:${assets.length}:${maxMtime}:${idSum}`;
}
