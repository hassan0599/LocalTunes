/**
 * @jest-environment node
 */
/// <reference types="jest" />
/// <reference types="node" />

jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { version: '1.2.0' } } }));
jest.mock('expo-file-system', () => ({ File: class {}, Directory: class {}, Paths: {} }));

import { insertTrack } from '@/db/queries';
import { migrate } from '@/db/schema';
import { openTestDb } from '@/db/testing/nodeDb';

import { getLyrics, type LyricsDeps } from '../lyrics';

const DAY = 24 * 3600 * 1000;

async function setup(over: { album?: string | null; duration_ms?: number | null } = {}) {
  const db = openTestDb();
  await migrate(db);
  const id = await insertTrack(db, {
    title: 'Song',
    artist: 'Band',
    album: over.album === undefined ? 'Album' : over.album,
    duration_ms: over.duration_ms === undefined ? 200_000 : over.duration_ms,
    file_uri: 'file:///m/Song.mp3',
    source: 'device',
  });
  const track = { id, title: 'Song', artist: 'Band', album: over.album === undefined ? 'Album' : over.album, duration_ms: over.duration_ms === undefined ? 200_000 : over.duration_ms, file_uri: 'file:///m/Song.mp3' };
  let now = 1_000_000;
  const responses: { status: number; body: unknown }[] = [];
  const fetchMock = jest.fn(async (url: string) => {
    void url;
    const r = responses.shift() ?? { status: 404, body: {} };
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body } as Response;
  });
  const deps: LyricsDeps & { advance: (ms: number) => void } = {
    fetch: fetchMock as unknown as typeof fetch,
    readSidecar: jest.fn(async () => null),
    readEmbedded: jest.fn(async () => null),
    now: () => now,
    advance: (ms) => (now += ms),
  };
  return { db, track, deps, fetchMock, responses };
}

const online = { online: true, allowOnline: true };

describe('getLyrics', () => {
  it('uses an .lrc file next to the song, then serves it from the cache', async () => {
    const { db, track, deps, fetchMock } = await setup();
    (deps.readSidecar as jest.Mock).mockResolvedValue('[00:01.00]Hello');
    const r = await getLyrics(db, track, online, deps);
    expect(r).toEqual({ status: 'found', lyrics: { synced: '[00:01.00]Hello', plain: null, instrumental: false, source: 'file' } });
    (deps.readSidecar as jest.Mock).mockResolvedValue(null);
    expect(await getLyrics(db, track, { online: false, allowOnline: true }, deps)).toEqual(r);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falls back to embedded plain lyrics', async () => {
    const { db, track, deps } = await setup();
    (deps.readEmbedded as jest.Mock).mockResolvedValue('Line one\nLine two');
    expect(await getLyrics(db, track, online, deps)).toMatchObject({ status: 'found', lyrics: { synced: null, plain: 'Line one\nLine two', source: 'embedded' } });
  });

  it('looks up LRCLIB exactly when album and duration are known', async () => {
    const { db, track, deps, fetchMock, responses } = await setup();
    responses.push({ status: 200, body: { syncedLyrics: '[00:02.00]Hi', plainLyrics: 'Hi' } });
    expect(await getLyrics(db, track, online, deps)).toMatchObject({ status: 'found', lyrics: { synced: '[00:02.00]Hi', source: 'lrclib' } });
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('lrclib.net/api/get?');
    expect(url).toContain('duration=200');
  });

  it('searches when the exact lookup misses, picking a synced result of the right length', async () => {
    const { db, track, deps, responses } = await setup();
    responses.push({ status: 404, body: {} });
    responses.push({
      status: 200,
      body: [
        { duration: 320, syncedLyrics: '[00:01]Wrong length' },
        { duration: 201, plainLyrics: 'Plain only' },
        { duration: 199, syncedLyrics: '[00:01]Right one' },
      ],
    });
    expect(await getLyrics(db, track, online, deps)).toMatchObject({ status: 'found', lyrics: { synced: '[00:01]Right one' } });
  });

  it('remembers instrumental songs', async () => {
    const { db, track, deps, responses } = await setup({ album: null });
    responses.push({ status: 200, body: [{ instrumental: true, duration: 200 }] });
    expect(await getLyrics(db, track, online, deps)).toEqual({ status: 'found', lyrics: { synced: null, plain: null, instrumental: true, source: 'lrclib' } });
    expect(await getLyrics(db, track, { online: false, allowOnline: true }, deps)).toMatchObject({ status: 'found', lyrics: { instrumental: true } });
  });

  it('caches a miss for a week, then asks again', async () => {
    const { db, track, deps, fetchMock, responses } = await setup({ album: null });
    responses.push({ status: 200, body: [] });
    expect(await getLyrics(db, track, online, deps)).toEqual({ status: 'none' });
    expect(await getLyrics(db, track, online, deps)).toEqual({ status: 'none' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    deps.advance(8 * DAY);
    responses.push({ status: 200, body: [{ duration: 200, plainLyrics: 'Finally' }] });
    expect(await getLyrics(db, track, online, deps)).toMatchObject({ status: 'found', lyrics: { plain: 'Finally' } });
  });

  it('says offline (and caches nothing) when it could only find lyrics online', async () => {
    const { db, track, deps, fetchMock } = await setup();
    expect(await getLyrics(db, track, { online: false, allowOnline: true }, deps)).toEqual({ status: 'offline' });
    expect(await db.getFirstAsync('SELECT * FROM lyrics')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('respects online lookups being off, and finds lyrics once they are turned on', async () => {
    const { db, track, deps, responses } = await setup({ album: null });
    expect(await getLyrics(db, track, { online: true, allowOnline: false }, deps)).toEqual({ status: 'none' });
    responses.push({ status: 200, body: [{ duration: 200, plainLyrics: 'Now online' }] });
    expect(await getLyrics(db, track, online, deps)).toMatchObject({ status: 'found', lyrics: { plain: 'Now online' } });
  });

  it('treats server errors as temporary', async () => {
    const { db, track, deps, responses } = await setup({ album: null });
    responses.push({ status: 503, body: {} });
    expect(await getLyrics(db, track, online, deps)).toEqual({ status: 'offline' });
    expect(await db.getFirstAsync('SELECT * FROM lyrics')).toBeNull();
  });

  it('skips the online lookup for songs without an artist', async () => {
    const { db, track, deps, fetchMock } = await setup();
    const r = await getLyrics(db, { ...track, artist: null }, online, deps);
    expect(r).toEqual({ status: 'none' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('copes with the song being deleted while lyrics load', async () => {
    const { db, track, deps, responses } = await setup();
    responses.push({ status: 200, body: { plainLyrics: 'Gone soon' } });
    await db.runAsync('DELETE FROM tracks WHERE id = ?', track.id);
    expect(await getLyrics(db, track, online, deps)).toMatchObject({ status: 'found', lyrics: { plain: 'Gone soon' } });
  });
});
