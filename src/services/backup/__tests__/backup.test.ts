/**
 * @jest-environment node
 */
/// <reference types="jest" />
/// <reference types="node" />

import { addToPlaylist, createPlaylist, listPlaylists, listPlaylistTracks } from '@/db/playlists';
import { insertTrack } from '@/db/queries';
import { migrate } from '@/db/schema';
import { openTestDb } from '@/db/testing/nodeDb';

import { BackupError, buildBackup, parseBackup, parseM3u, restoreBackup, restoreM3u, toM3u, TrackResolver } from '../backup';

type Db = ReturnType<typeof openTestDb>;

async function phone(songs: { title: string; artist: string; album?: string; uri: string; ms?: number; mbid?: string }[]) {
  const db = openTestDb();
  await migrate(db);
  const ids: number[] = [];
  for (const s of songs) {
    ids.push(
      await insertTrack(db, { title: s.title, artist: s.artist, album: s.album ?? null, file_uri: s.uri, duration_ms: s.ms ?? null, mbid: s.mbid ?? null, source: 'device' }),
    );
  }
  return { db, ids };
}

const stats = (db: Db, title: string) => db.getFirstAsync<{ play_count: number; last_played_at: number | null }>('SELECT play_count, last_played_at FROM tracks WHERE title = ?', title);

describe('backup and restore', () => {
  it('round-trips playlists, play counts, wishlist and settings onto a phone with different paths', async () => {
    const old = await phone([
      { title: 'So What', artist: 'Miles Davis', album: 'Kind of Blue', uri: 'file:///old/a.mp3', ms: 545_000 },
      { title: 'Blue in Green (Remastered)', artist: 'Miles Davis', uri: 'file:///old/b.mp3', mbid: 'mbid-b' },
      { title: 'Gone Song', artist: 'Nobody', uri: 'file:///old/c.mp3' },
    ]);
    await old.db.runAsync('UPDATE tracks SET play_count = 7, last_played_at = 500 WHERE id = ?', old.ids[0]);
    const pl = await createPlaylist(old.db, 'Late night');
    await addToPlaylist(old.db, pl, [old.ids[1], old.ids[2], old.ids[0]]);
    await old.db.runAsync("INSERT INTO wishlist (mbid, kind, title, artist) VALUES ('w1', 'recording', 'Wanted', 'Someone')");
    await old.db.runAsync("INSERT INTO settings (key, value) VALUES ('player.rate', '1.25'), ('listenbrainz.token', '\"secret\"')");

    const backup = await buildBackup(old.db, new Date('2026-11-28T10:00:00Z'), '1.2.0');
    expect(backup.settings).toEqual({ 'player.rate': 1.25 }); // credentials are never exported
    const text = JSON.stringify(backup);

    const neu = await phone([
      { title: 'So What', artist: 'Miles Davis', album: 'Kind of Blue', uri: 'content://media/9', ms: 546_000 },
      { title: 'Blue in Green', artist: 'Miles Davis', uri: 'file:///new/x.flac', mbid: 'mbid-b' },
    ]);
    await neu.db.runAsync('UPDATE tracks SET play_count = 9 WHERE id = ?', neu.ids[0]);
    await createPlaylist(neu.db, 'Late night');

    const report = await restoreBackup(neu.db, parseBackup(text));
    expect(report).toMatchObject({ songs: 3, matched: 2, playlists: 1, playlistSongsMissing: 1, wishlist: 1, settings: { 'player.rate': 1.25 } });

    // Higher count wins; the restored playlist gets a new name and skips the missing song.
    expect(await stats(neu.db, 'So What')).toEqual({ play_count: 9, last_played_at: 500 });
    const restored = (await listPlaylists(neu.db)).find((p) => p.name === 'Late night (restored)')!;
    expect((await listPlaylistTracks(neu.db, restored.id)).map((t) => t.title)).toEqual(['Blue in Green', 'So What']);

    // Restoring again is harmless.
    const again = await restoreBackup(neu.db, parseBackup(text));
    expect(again.wishlist).toBe(0);
    expect(await stats(neu.db, 'So What')).toEqual({ play_count: 9, last_played_at: 500 });
    expect((await listPlaylists(neu.db)).map((p) => p.name).sort()).toEqual(['Late night', 'Late night (restored 2)', 'Late night (restored)']);
  });

  it('rejects files that are not backups, with a readable message', () => {
    expect(() => parseBackup('not json')).toThrow(BackupError);
    expect(() => parseBackup('{"app":"Other"}')).toThrow('isn’t a LocalTunes backup');
    expect(() => parseBackup(JSON.stringify({ app: 'LocalTunes', format: 99, tracks: [], playlists: [] }))).toThrow('newer version');
  });
});

describe('TrackResolver', () => {
  const lib = [
    { id: 1, title: 'Intro', artist: 'Band', album: 'First', duration_ms: 60_000, mbid: null, file_uri: 'file:///m/First/01%20Intro.mp3' },
    { id: 2, title: 'Intro', artist: 'Band', album: 'Second', duration_ms: 90_000, mbid: null, file_uri: 'file:///m/Second/01 Intro.mp3' },
  ];
  const r = new TrackResolver(lib);

  it('prefers the same album, then the closest duration', () => {
    expect(r.resolve({ title: 'Intro', artist: 'Band', album: 'Second' })?.id).toBe(2);
    expect(r.resolve({ title: 'Intro', artist: 'Band', duration_ms: 61_000 })?.id).toBe(1);
  });

  it('matches by path, decoding file URIs', () => {
    expect(r.resolve({ title: '?', path: '/m/First/01 Intro.mp3' })?.id).toBe(1);
    expect(r.resolve({ title: '?', path: 'C:\\Music\\Second\\01 Intro.mp3' })?.id).toBe(2);
  });

  it('returns nothing for unknown songs', () => {
    expect(r.resolve({ title: 'Outro', artist: 'Band' })).toBeUndefined();
  });
});

describe('M3U', () => {
  it('writes and reads #EXTINF entries', () => {
    const text = toM3u([
      { title: 'So What', artist: 'Miles Davis', duration_ms: 545_400, file_uri: 'file:///storage/Music/So%20What.mp3' },
      { title: 'Untitled', artist: null, duration_ms: null, file_uri: 'content://media/5' },
    ]);
    expect(text).toBe('#EXTM3U\n#EXTINF:545,Miles Davis - So What\n/storage/Music/So What.mp3\n#EXTINF:-1,Untitled\ncontent://media/5\n');
    expect(parseM3u(text)).toEqual([
      { path: '/storage/Music/So What.mp3', title: 'So What', artist: 'Miles Davis', duration_ms: 545_000 },
      { path: 'content://media/5', title: 'Untitled', artist: null, duration_ms: null },
    ]);
  });

  it('falls back to the file name when there is no #EXTINF, and ignores comments and BOM', () => {
    expect(parseM3u('\uFEFF#EXTM3U\r\n# a comment\r\nMusic\\Artist - Song.flac\r\n')).toEqual([
      { path: 'Music\\Artist - Song.flac', title: 'Artist - Song', artist: null, duration_ms: null },
    ]);
  });

  it('restores a playlist from another player, matching by path, file name or artist + title', async () => {
    const { db } = await phone([
      { title: 'One', artist: 'A', uri: 'file:///sdcard/Music/one.mp3' },
      { title: 'Two', artist: 'B', uri: 'content://media/2' },
      { title: 'Three', artist: 'C', uri: 'file:///sdcard/Other/3.ogg' },
    ]);
    const m3u = '#EXTM3U\n/sdcard/Music/one.mp3\n#EXTINF:100,B - Two\n/some/other/phone/two.mp3\n../Other/3.ogg\nmissing.mp3\n';
    const report = await restoreM3u(db, 'Imported', m3u);
    expect(report).toEqual({ name: 'Imported', entries: 4, matched: 3 });
    const pl = (await listPlaylists(db)).find((p) => p.name === 'Imported')!;
    expect((await listPlaylistTracks(db, pl.id)).map((t) => t.title)).toEqual(['One', 'Two', 'Three']);
  });
});
