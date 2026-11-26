/**
 * @jest-environment node
 */
/// <reference types="jest" />
/// <reference types="node" />

import { insertTrack, markPlayed } from '../queries';
import { migrate } from '../schema';
import { listSmartPlaylistTracks, SMART_LIMIT, smartPlaylistCounts } from '../smartPlaylists';
import { openTestDb } from '../testing/nodeDb';

async function setup() {
  const db = openTestDb();
  await migrate(db);
  const id: Record<string, number> = {};
  let added = 1000;
  for (const title of ['A', 'B', 'C', 'D']) {
    id[title] = await insertTrack(db, { title, artist: 'X', file_uri: `file:///${title}.mp3`, source: 'imported' });
    await db.runAsync('UPDATE tracks SET added_at = ? WHERE id = ?', (added += 10), id[title]);
  }
  return { db, id };
}

const titles = (rows: { title: string }[]) => rows.map((r) => r.title);

describe('smart playlists', () => {
  it('ranks most played by count, then by most recent', async () => {
    const { db, id } = await setup();
    await markPlayed(db, id.B);
    await markPlayed(db, id.B);
    await markPlayed(db, id.C);
    await markPlayed(db, id.A);
    await db.runAsync('UPDATE tracks SET last_played_at = 5 WHERE id = ?', id.C);
    expect(titles(await listSmartPlaylistTracks(db, 'most-played'))).toEqual(['B', 'A', 'C']);
  });

  it('orders recently played by last play and excludes unplayed songs', async () => {
    const { db, id } = await setup();
    await db.runAsync('UPDATE tracks SET play_count = 1, last_played_at = 200 WHERE id = ?', id.A);
    await db.runAsync('UPDATE tracks SET play_count = 3, last_played_at = 300 WHERE id = ?', id.D);
    expect(titles(await listSmartPlaylistTracks(db, 'recently-played'))).toEqual(['D', 'A']);
  });

  it('lists recently added newest first and never played by artist/album/title', async () => {
    const { db, id } = await setup();
    await markPlayed(db, id.C);
    expect(titles(await listSmartPlaylistTracks(db, 'recently-added'))).toEqual(['D', 'C', 'B', 'A']);
    expect(titles(await listSmartPlaylistTracks(db, 'never-played'))).toEqual(['A', 'B', 'D']);
  });

  it('counts songs per smart playlist, capped like the lists', async () => {
    const { db, id } = await setup();
    await markPlayed(db, id.A);
    expect(await smartPlaylistCounts(db)).toEqual({
      'most-played': 1,
      'recently-played': 1,
      'recently-added': 4,
      'never-played': 3,
    });
    for (let i = 0; i < SMART_LIMIT + 5; i++) {
      await insertTrack(db, { title: `T${i}`, file_uri: `file:///t${i}.mp3`, source: 'imported' });
    }
    expect((await smartPlaylistCounts(db))['recently-added']).toBe(SMART_LIMIT);
    expect(await listSmartPlaylistTracks(db, 'recently-added')).toHaveLength(SMART_LIMIT);
  });

  it('is empty for an empty library', async () => {
    const db = openTestDb();
    await migrate(db);
    expect(await smartPlaylistCounts(db)).toEqual({ 'most-played': 0, 'recently-played': 0, 'recently-added': 0, 'never-played': 0 });
  });
});
