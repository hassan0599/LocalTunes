/**
 * @jest-environment node
 */
/// <reference types="jest" />
/// <reference types="node" />

import {
  addToPlaylist,
  createPlaylist,
  deletePlaylist,
  listPlaylists,
  listPlaylistTracks,
  removeFromPlaylist,
  swapInPlaylist,
} from '../playlists';
import { deleteTrack, insertTrack } from '../queries';
import { migrate } from '../schema';
import { openTestDb } from '../testing/nodeDb';

async function setup() {
  const db = openTestDb();
  await migrate(db);
  const ids: number[] = [];
  for (const title of ['A', 'B', 'C', 'D']) {
    ids.push(await insertTrack(db, { title, file_uri: `file:///${title}.mp3`, source: 'imported', artwork_uri: `file:///${title}.jpg` }));
  }
  const pl = await createPlaylist(db, '  Road trip ');
  return { db, ids, pl };
}

const titles = async (db: Awaited<ReturnType<typeof setup>>['db'], pl: number) => (await listPlaylistTracks(db, pl)).map((t) => t.title);

describe('playlists', () => {
  it('appends in order and allows duplicates', async () => {
    const { db, ids, pl } = await setup();
    await addToPlaylist(db, pl, [ids[0], ids[1]]);
    await addToPlaylist(db, pl, [ids[0]]);
    expect(await titles(db, pl)).toEqual(['A', 'B', 'A']);
    const [summary] = await listPlaylists(db);
    expect(summary).toMatchObject({ name: 'Road trip', track_count: 3 });
    expect(JSON.parse(summary.covers!)).toEqual(['file:///A.jpg', 'file:///B.jpg']);
  });

  it('swaps neighbours, even across gaps left by removals', async () => {
    const { db, ids, pl } = await setup();
    await addToPlaylist(db, pl, ids);
    await removeFromPlaylist(db, pl, 1); // B
    const entries = await listPlaylistTracks(db, pl);
    await swapInPlaylist(db, pl, entries[0].position, entries[1].position); // A <-> C
    expect(await titles(db, pl)).toEqual(['C', 'A', 'D']);
  });

  it('drops entries when a track is deleted from the library', async () => {
    const { db, ids, pl } = await setup();
    await addToPlaylist(db, pl, ids);
    await deleteTrack(db, ids[2]);
    expect(await titles(db, pl)).toEqual(['A', 'B', 'D']);
  });

  it('deletes the playlist but not the songs', async () => {
    const { db, ids, pl } = await setup();
    await addToPlaylist(db, pl, ids);
    await deletePlaylist(db, pl);
    expect(await listPlaylists(db)).toEqual([]);
    expect((await db.getAllAsync('SELECT id FROM tracks')).length).toBe(4);
  });
});
