/**
 * @jest-environment node
 */
/// <reference types="jest" />
/// <reference types="node" />

import { buildMatchQuery, searchLibrary } from '../fts';
import { deleteTrack, insertTrack, type NewTrack } from '../queries';
import { migrate } from '../schema';
import { openTestDb } from '../testing/nodeDb';

const T = (title: string, artist: string | null, album: string | null, extra: Partial<NewTrack> = {}): NewTrack => ({
  title,
  artist,
  album,
  file_uri: `file:///music/${title}-${Math.random()}.mp3`,
  source: 'imported',
  ...extra,
});

async function seeded() {
  const db = openTestDb();
  await migrate(db);
  for (const t of [
    T('So What', 'Miles Davis', 'Kind of Blue'),
    T('Blue in Green', 'Miles Davis', 'Kind of Blue'),
    T('Miles Away', 'Other Band', 'Roads'),
    T('Naïma', 'John Coltrane', 'Giant Steps'),
    T('Giant Steps', 'John Coltrane', 'Giant Steps'),
    T('Jazz Milestones', 'Various', 'Jazz Collection'),
  ]) {
    await insertTrack(db, t);
  }
  return db;
}

describe('buildMatchQuery', () => {
  it('prefix-matches every token', () => {
    expect(buildMatchQuery('jazz mil')).toBe('"jazz"* AND "mil"*');
  });
  it('drops punctuation and FTS syntax', () => {
    expect(buildMatchQuery('  AC/DC "back" (in) black*  ')).toBe('"ac"* AND "dc"* AND "back"* AND "in"* AND "black"*');
    expect(buildMatchQuery('NEAR OR AND')).toBe('"near"* AND "or"* AND "and"*');
  });
  it('returns null for empty input', () => {
    expect(buildMatchQuery('  ')).toBeNull();
    expect(buildMatchQuery('"*()')).toBeNull();
  });
});

describe('migrations', () => {
  it('reach the latest version and are idempotent', async () => {
    const db = openTestDb();
    await migrate(db);
    await migrate(db);
    const { user_version } = (await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version'))!;
    expect(user_version).toBe(4);
  });
});

describe('searchLibrary', () => {
  it('matches across columns with prefixes', async () => {
    const db = await seeded();
    const r = await searchLibrary(db, 'jazz mil');
    expect(r.songs.map((s) => s.title)).toEqual(['Jazz Milestones']);
  });

  it('ranks title matches above artist matches', async () => {
    const db = await seeded();
    const r = await searchLibrary(db, 'miles');
    expect(r.songs[0].title).toBe('Miles Away');
    expect(r.songs.map((s) => s.title)).toEqual(expect.arrayContaining(['So What', 'Blue in Green']));
  });

  it('groups albums and artists using only their columns', async () => {
    const db = await seeded();
    const r = await searchLibrary(db, 'miles');
    expect(r.artists.map((a) => a.artist)).toEqual(['Miles Davis']);
    expect(r.artists[0]).toMatchObject({ track_count: 2, album_count: 1 });
    expect(r.albums.map((a) => a.album)).toEqual(['Kind of Blue']);
  });

  it('ignores diacritics and case', async () => {
    const db = await seeded();
    expect((await searchLibrary(db, 'NAIMA')).songs.map((s) => s.title)).toEqual(['Naïma']);
  });

  it('boosts recently played tracks', async () => {
    const db = await seeded();
    const now = Date.now();
    const before = await searchLibrary(db, 'giant', { now });
    const last = before.songs[before.songs.length - 1];
    await db.runAsync('UPDATE tracks SET last_played_at = ? WHERE id = ?', now - 1000, last.id);
    const after = await searchLibrary(db, 'giant', { now });
    expect(after.songs[0].id).toBe(last.id);
  });

  it('keeps the index in sync on update and delete', async () => {
    const db = await seeded();
    const [song] = (await searchLibrary(db, 'so what')).songs;
    await db.runAsync('UPDATE tracks SET title = ? WHERE id = ?', 'Renamed', song.id);
    expect((await searchLibrary(db, 'so what')).songs).toHaveLength(0);
    expect((await searchLibrary(db, 'renamed')).songs).toHaveLength(1);
    await deleteTrack(db, song.id);
    expect((await searchLibrary(db, 'renamed')).songs).toHaveLength(0);
  });

  it('handles broad queries (more matches than the bm25 cutoff) newest first', async () => {
    const db = openTestDb();
    await migrate(db);
    db.raw.exec('BEGIN');
    const stmt = db.raw.prepare('INSERT INTO tracks (title, artist, album, file_uri, source) VALUES (?, ?, ?, ?, ?)');
    for (let i = 0; i < 2500; i++) {
      stmt.run(`Song ${i}`, `Artist ${i % 50}`, `Album ${i % 100}`, `file:///${i}.mp3`, 'device');
    }
    db.raw.exec('COMMIT');

    const r = await searchLibrary(db, 's', { songLimit: 10, groupLimit: 5 });
    expect(r.songs.map((s) => s.title)).toEqual(Array.from({ length: 10 }, (_, k) => `Song ${2499 - k}`));
    // Albums and artists only search their own columns ("Album N", "Artist N").
    expect(r.albums).toHaveLength(0);
    expect(r.artists).toHaveLength(0);
    const broad = await searchLibrary(db, 'a'); // matches every album and artist row
    expect(broad.albums).toHaveLength(20);
    expect(broad.artists).toHaveLength(20);
  });
});
