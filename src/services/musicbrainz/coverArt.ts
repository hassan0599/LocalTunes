/**
 * Cover Art Archive images (spec 6.3): `release-group/{mbid}/front-250`, cached on disk
 * so they show offline. A 404 is normal (no art); misses are remembered for a day so
 * lists don't retry them on every render.
 */
import { Directory, File, Paths } from 'expo-file-system';
import type { SQLiteDatabase } from 'expo-sqlite';

import { getSetting, setSetting } from '@/db/queries';

const MAX_PARALLEL = 3;
const MISS_TTL_MS = 24 * 3600 * 1000;

const dir = () => new Directory(Paths.cache, 'caa');
const inflight = new Map<string, Promise<string | null>>();
let active = 0;
const waiting: (() => void)[] = [];

async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_PARALLEL) await new Promise<void>((r) => waiting.push(r));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiting.shift()?.();
  }
}

export function coverUrl(releaseGroupMbid: string): string {
  return `https://coverartarchive.org/release-group/${releaseGroupMbid}/front-250`;
}

/** Local file URI for a release group's front cover, or null if none (or offline and not cached). */
export function getCoverArt(db: SQLiteDatabase, mbid: string, online: boolean): Promise<string | null> {
  const file = new File(dir(), `${mbid}.jpg`);
  if (file.exists) return Promise.resolve(file.uri);
  if (!online) return Promise.resolve(null);
  let p = inflight.get(mbid);
  if (!p) {
    p = slot(async () => {
      const missKey = `caa-miss:${mbid}`;
      const missedAt = await getSetting<number>(db, missKey);
      if (missedAt && Date.now() - missedAt < MISS_TTL_MS) return null;
      try {
        dir().create({ intermediates: true, idempotent: true });
        const out = await File.downloadFileAsync(coverUrl(mbid), file, { idempotent: true });
        return out.uri;
      } catch {
        if (file.exists) file.delete();
        await setSetting(db, missKey, Date.now());
        return null;
      }
    }).finally(() => inflight.delete(mbid));
    inflight.set(mbid, p);
  }
  return p;
}

/** Bytes used by downloaded Discover cover art. */
export function coverCacheBytes(): number {
  try {
    const d = dir();
    return d.exists ? (d.size ?? 0) : 0;
  } catch {
    return 0;
  }
}

/** Delete downloaded Discover cover art (it downloads again when shown online). */
export function clearCoverCache(): void {
  try {
    const d = dir();
    if (d.exists) d.delete();
  } catch (e) {
    console.warn('cover cache clear failed', e);
  }
}
