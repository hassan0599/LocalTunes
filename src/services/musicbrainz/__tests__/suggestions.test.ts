/**
 * @jest-environment node
 */
/// <reference types="jest" />
/// <reference types="node" />

import { insertTrack } from '@/db/queries';
import { migrate } from '@/db/schema';
import { openTestDb } from '@/db/testing/nodeDb';

import { becauseYouListened, topArtists } from '../suggestions';
import type { MbArtist, MbArtistDetail } from '../types';

const A = (id: string, name: string): MbArtist => ({ id, name, tags: [] });
const fresh = <T,>(data: T, stale = false) => ({ data, stale, fetchedAt: 100 });

function fakeApi(results: MbArtist[], similar: MbArtist[], staleSimilar = false) {
  return {
    searchArtists: jest.fn(async () => fresh({ items: results, total: results.length, offset: 0 })),
    getArtist: jest.fn(async (_ctx: unknown, id: string) => fresh({ id, name: 'x', tags: [], related: [], links: [] } as unknown as MbArtistDetail)),
    getSimilarArtists: jest.fn(async () => fresh(similar, staleSimilar)),
  };
}

const ctx = { db: {} as never, online: true };

describe('becauseYouListened', () => {
  it('suggests similar artists that are not in the library', async () => {
    const api = fakeApi([A('x', 'The Other Radiohead'), A('rh', 'Radiohead')], [A('rh', 'Radiohead'), A('a', 'Portishead'), A('b', 'Thom Yorke'), A('c', 'Massive Attack')], true);
    const r = await becauseYouListened(ctx, 'radiohead', (n) => n === 'Thom Yorke', 8, api as never);
    expect(api.getArtist).toHaveBeenCalledWith(ctx, 'rh');
    expect(r.data).toEqual({ seed: { id: 'rh', name: 'Radiohead' }, artists: [A('a', 'Portishead'), A('c', 'Massive Attack')] });
    expect(r.stale).toBe(true);
  });

  it('gives nothing when the artist is not found exactly, or nothing new is similar', async () => {
    expect((await becauseYouListened(ctx, 'Nobody', () => false, 8, fakeApi([A('x', 'Somebody')], []) as never)).data).toBeNull();
    expect((await becauseYouListened(ctx, 'Radiohead', () => true, 8, fakeApi([A('rh', 'Radiohead')], [A('a', 'Portishead')]) as never)).data).toBeNull();
  });
});

describe('topArtists', () => {
  it('ranks artists by total plays, ignoring unplayed and unknown artists', async () => {
    const db = openTestDb();
    await migrate(db);
    const add = async (title: string, artist: string | null, plays: number) => {
      const id = await insertTrack(db, { title, artist, file_uri: `file:///${title}`, source: 'imported' });
      await db.runAsync('UPDATE tracks SET play_count = ?, last_played_at = ? WHERE id = ?', plays, plays ? 1 : null, id);
    };
    await add('a1', 'Alpha', 3);
    await add('a2', 'alpha', 4);
    await add('b1', 'Beta', 5);
    await add('c1', 'Gamma', 0);
    await add('u1', null, 50);
    expect(await topArtists(db)).toEqual(['Alpha', 'Beta']);
  });
});
