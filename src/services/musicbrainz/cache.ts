/**
 * `mb_cache` (spec 6.3 "Caching and offline behavior"): every MusicBrainz response is
 * stored with a TTL. Fresh entries are served without a request; stale ones are
 * refreshed when online and still served when offline or when the refresh fails.
 */
import type { SQLiteDatabase } from 'expo-sqlite';

export const TTL = {
  /** Artists, release groups, releases. */
  entity: 7 * 24 * 3600,
  /** Search and tag-browse results. */
  search: 24 * 3600,
} as const;

export class OfflineError extends Error {
  constructor() {
    super('Offline and nothing saved yet');
    this.name = 'OfflineError';
  }
}

export interface Cached<T> {
  data: T;
  /** Served from the cache past its TTL (offline or refresh failed). */
  stale: boolean;
  fetchedAt: number;
}

interface Row {
  json: string;
  fetched_at: number;
  ttl_s: number;
}

export function isFresh(row: Pick<Row, 'fetched_at' | 'ttl_s'>, now: number): boolean {
  return now - row.fetched_at < row.ttl_s * 1000;
}

export async function cachedFetch<T>(
  db: SQLiteDatabase,
  key: string,
  ttlS: number,
  fetcher: () => Promise<T>,
  opts: { online: boolean; now?: number },
): Promise<Cached<T>> {
  const now = opts.now ?? Date.now();
  const row = await db.getFirstAsync<Row>('SELECT json, fetched_at, ttl_s FROM mb_cache WHERE key = ?', key);
  const cached = row ? (JSON.parse(row.json) as T) : undefined;

  if (row && isFresh(row, now)) return { data: cached as T, stale: false, fetchedAt: row.fetched_at };
  if (!opts.online) {
    if (row) return { data: cached as T, stale: true, fetchedAt: row.fetched_at };
    throw new OfflineError();
  }
  try {
    const data = await fetcher();
    await db.runAsync(
      `INSERT INTO mb_cache (key, json, fetched_at, ttl_s) VALUES (?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET json = excluded.json, fetched_at = excluded.fetched_at, ttl_s = excluded.ttl_s`,
      key,
      JSON.stringify(data),
      now,
      ttlS,
    );
    return { data, stale: false, fetchedAt: now };
  } catch (e) {
    if (row) return { data: cached as T, stale: true, fetchedAt: row.fetched_at };
    throw e;
  }
}

/** Drop expired entries older than `graceDays` past their TTL, to keep storage small. */
export async function pruneCache(db: SQLiteDatabase, graceDays = 30, now = Date.now()): Promise<number> {
  const res = await db.runAsync(
    'DELETE FROM mb_cache WHERE fetched_at + (ttl_s * 1000) + ? < ?',
    graceDays * 86_400_000,
    now,
  );
  return res.changes;
}

/** Saved Discover pages: how many and roughly how much space (text bytes). */
export async function cacheStats(db: SQLiteDatabase): Promise<{ entries: number; bytes: number }> {
  const row = await db.getFirstAsync<{ entries: number; bytes: number | null }>(
    'SELECT COUNT(*) AS entries, SUM(length(json)) AS bytes FROM mb_cache',
  );
  return { entries: row?.entries ?? 0, bytes: row?.bytes ?? 0 };
}

/** Forget every saved Discover page; they are fetched again when next opened online. */
export async function clearCache(db: SQLiteDatabase): Promise<number> {
  return (await db.runAsync('DELETE FROM mb_cache')).changes;
}
