/**
 * @jest-environment node
 */
/// <reference types="jest" />
/// <reference types="node" />

import { openTestDb } from '@/db/testing/nodeDb';
import { migrate } from '@/db/schema';

import { cachedFetch, OfflineError, pruneCache } from '../cache';

async function db() {
  const d = openTestDb();
  await migrate(d);
  return d;
}

describe('cachedFetch', () => {
  it('fetches once, then serves fresh entries from the cache', async () => {
    const d = await db();
    const fetcher = jest.fn(async () => ({ n: 1 }));
    await cachedFetch(d, 'k', 60, fetcher, { online: true, now: 0 });
    const r = await cachedFetch(d, 'k', 60, fetcher, { online: true, now: 59_000 });
    expect(r).toEqual({ data: { n: 1 }, stale: false, fetchedAt: 0 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('refreshes expired entries when online', async () => {
    const d = await db();
    await cachedFetch(d, 'k', 60, async () => 'old', { online: true, now: 0 });
    const r = await cachedFetch(d, 'k', 60, async () => 'new', { online: true, now: 61_000 });
    expect(r).toEqual({ data: 'new', stale: false, fetchedAt: 61_000 });
  });

  it('serves stale entries offline or when the refresh fails', async () => {
    const d = await db();
    await cachedFetch(d, 'k', 60, async () => 'old', { online: true, now: 0 });
    const fetcher = jest.fn(async () => 'new');
    expect(await cachedFetch(d, 'k', 60, fetcher, { online: false, now: 999_000 })).toMatchObject({ data: 'old', stale: true });
    expect(fetcher).not.toHaveBeenCalled();
    const failing = async () => {
      throw new Error('503');
    };
    expect(await cachedFetch(d, 'k', 60, failing, { online: true, now: 999_000 })).toMatchObject({ data: 'old', stale: true });
  });

  it('throws OfflineError when offline with nothing cached', async () => {
    const d = await db();
    await expect(cachedFetch(d, 'missing', 60, async () => 1, { online: false })).rejects.toBeInstanceOf(OfflineError);
  });

  it('prunes long-expired entries only', async () => {
    const d = await db();
    const day = 86_400_000;
    await cachedFetch(d, 'old', 60, async () => 1, { online: true, now: 0 });
    await cachedFetch(d, 'recent', 60, async () => 1, { online: true, now: 20 * day });
    expect(await pruneCache(d, 30, 40 * day)).toBe(1);
  });
});
