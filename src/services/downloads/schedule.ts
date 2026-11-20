/** Pure download-queue rules (spec 6.4 "Download manager"), unit-tested. */

export type DownloadStatus = 'queued' | 'downloading' | 'paused' | 'done' | 'failed';

export interface DownloadRow {
  id: number;
  source: string;
  source_id: string;
  url: string;
  ext: string;
  title: string;
  artist: string | null;
  album: string | null;
  track_no: number | null;
  duration_ms: number | null;
  license: string;
  artwork_url: string | null;
  mbid: string | null;
  status: DownloadStatus;
  bytes_done: number;
  bytes_total: number | null;
  attempts: number;
  next_attempt_at: number | null;
  pause_state: string | null;
  track_id: number | null;
  error: string | null;
  created_at: number;
  finished_at: number | null;
}

export const MAX_CONCURRENT = 2;
export const MAX_ATTEMPTS = 3;
/** Write progress to the database at most this often. */
export const PROGRESS_INTERVAL_MS = 500;
/** Keep this much free space after a download completes. */
export const SPACE_MARGIN_BYTES = 100 * 1024 * 1024;
/** Assumed size when the source doesn't say (a long MP3). */
export const UNKNOWN_SIZE_BYTES = 30 * 1024 * 1024;

/** Exponential backoff before retry n (1-based): 10 s, 20 s, 40 s… */
export function retryDelayMs(attempt: number): number {
  return 10_000 * 2 ** Math.max(0, attempt - 1);
}

export interface NetState {
  online: boolean;
  /** On a metered/cellular connection. */
  metered: boolean;
}

/** Why the queue isn't running right now, or null when it may run. */
export function blockedReason(net: NetState, wifiOnly: boolean): 'offline' | 'wifi' | null {
  if (!net.online) return 'offline';
  if (wifiOnly && net.metered) return 'wifi';
  return null;
}

/** Queued rows ready to start now, oldest first, filling the free slots. */
export function pickNext(rows: DownloadRow[], activeIds: Set<number>, now: number): DownloadRow[] {
  const free = MAX_CONCURRENT - activeIds.size;
  if (free <= 0) return [];
  return rows
    .filter((r) => r.status === 'queued' && !activeIds.has(r.id) && (r.next_attempt_at ?? 0) <= now)
    .sort((a, b) => a.created_at - b.created_at)
    .slice(0, free);
}

/** State after a failed attempt: retry later, or give up after MAX_ATTEMPTS. */
export function afterFailure(
  row: Pick<DownloadRow, 'attempts'>,
  error: string,
  now: number,
): Pick<DownloadRow, 'status' | 'attempts' | 'next_attempt_at' | 'error'> {
  const attempts = row.attempts + 1;
  return attempts >= MAX_ATTEMPTS
    ? { status: 'failed', attempts, next_attempt_at: null, error }
    : { status: 'queued', attempts, next_attempt_at: now + retryDelayMs(attempts), error };
}

/** Free-space check before starting (spec 6.4). Returns an error message, or null when OK. */
export function spaceError(row: Pick<DownloadRow, 'bytes_total' | 'bytes_done'>, availableBytes: number): string | null {
  const remaining = (row.bytes_total ?? UNKNOWN_SIZE_BYTES) - row.bytes_done;
  if (availableBytes - remaining >= SPACE_MARGIN_BYTES) return null;
  const mb = (n: number) => `${Math.max(0, Math.round(n / 1024 / 1024))} MB`;
  return `Not enough free space: needs ${mb(remaining)} plus ${mb(SPACE_MARGIN_BYTES)} spare, ${mb(availableBytes)} available.`;
}
