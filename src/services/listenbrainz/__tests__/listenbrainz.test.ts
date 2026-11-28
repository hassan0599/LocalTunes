/**
 * @jest-environment node
 */
/// <reference types="jest" />
/// <reference types="node" />

import { getSetting, setSetting } from '@/db/queries';
import { migrate } from '@/db/schema';
import { openTestDb } from '@/db/testing/nodeDb';

import {
  connect,
  disconnect,
  flushListens,
  isListen,
  pendingListenCount,
  queueListen,
  submitPayload,
  TOKEN_REJECTED_KEY,
  validateToken,
} from '../listenbrainz';

jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { version: '1.2.0' } } }));

const song = { title: 'So What', artist: 'Miles Davis', album: 'Kind of Blue', duration_ms: 545_000, mbid: 'rec-1' };

async function setup(token: string | null = 'tok') {
  const db = openTestDb();
  await migrate(db);
  if (token) await connect(db, token, 'listener');
  return db;
}

function fetcher(...statuses: number[]) {
  return jest.fn(async () => {
    const status = statuses.shift() ?? 200;
    return { ok: status >= 200 && status < 300, status, json: async () => ({}) } as Response;
  });
}

describe('isListen', () => {
  it('needs half the song or 4 minutes, and ignores very short songs', () => {
    expect(isListen(29_000, 60_000)).toBe(false);
    expect(isListen(30_000, 60_000)).toBe(true);
    expect(isListen(240_000, 900_000)).toBe(true);
    expect(isListen(239_000, 900_000)).toBe(false);
    expect(isListen(20_000, 20_000)).toBe(false);
    expect(isListen(99_000, null)).toBe(false);
  });
});

describe('submitPayload', () => {
  it('builds single and import payloads with optional fields only when known', () => {
    const one = submitPayload([{ id: 1, listened_at: 1700000000, artist: 'A', title: 'T', album: null, duration_ms: null, recording_mbid: null }], '1.2.0');
    expect(one).toEqual({
      listen_type: 'single',
      payload: [
        {
          listened_at: 1700000000,
          track_metadata: {
            artist_name: 'A',
            track_name: 'T',
            additional_info: { media_player: 'LocalTunes', submission_client: 'LocalTunes', submission_client_version: '1.2.0' },
          },
        },
      ],
    });
    const two = submitPayload(
      [
        { id: 1, listened_at: 1, artist: 'A', title: 'T', album: 'R', duration_ms: 1000, recording_mbid: 'm' },
        { id: 2, listened_at: 2, artist: 'B', title: 'U', album: null, duration_ms: null, recording_mbid: null },
      ],
      '1.2.0',
    );
    expect(two.listen_type).toBe('import');
    expect(two.payload[0].track_metadata).toMatchObject({ release_name: 'R', additional_info: { duration_ms: 1000, recording_mbid: 'm' } });
  });
});

describe('flushListens', () => {
  it('sends queued listens with the token and clears them', async () => {
    const db = await setup();
    await queueListen(db, song, 1_700_000_000_500);
    await queueListen(db, { ...song, title: 'Freddie Freeloader' }, 1_700_000_600_000);
    const f = fetcher(200);
    expect(await flushListens(db, f as unknown as typeof fetch)).toEqual({ status: 'sent', sent: 2 });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.listenbrainz.org/1/submit-listens');
    expect((init.headers as Record<string, string>).Authorization).toBe('Token tok');
    const body = JSON.parse(String(init.body));
    expect(body.listen_type).toBe('import');
    expect(body.payload.map((p: { listened_at: number }) => p.listened_at)).toEqual([1_700_000_000, 1_700_000_600]);
    expect(await pendingListenCount(db)).toBe(0);
  });

  it('keeps listens when offline or the server is busy, for a later try', async () => {
    const db = await setup();
    await queueListen(db, song, 1000);
    const offline = jest.fn(async () => {
      throw new Error('Network request failed');
    });
    expect((await flushListens(db, offline as unknown as typeof fetch)).status).toBe('retry-later');
    expect((await flushListens(db, fetcher(503) as unknown as typeof fetch)).status).toBe('retry-later');
    expect(await pendingListenCount(db)).toBe(1);
  });

  it('stops and flags the token when it is rejected', async () => {
    const db = await setup();
    await queueListen(db, song, 1000);
    expect(await flushListens(db, fetcher(401) as unknown as typeof fetch)).toEqual({ status: 'rejected' });
    expect(await getSetting(db, TOKEN_REJECTED_KEY)).toBe(true);
    const f = fetcher(200);
    expect(await flushListens(db, f as unknown as typeof fetch)).toEqual({ status: 'rejected' });
    expect(f).not.toHaveBeenCalled();
    await connect(db, 'new-token', 'listener'); // reconnecting clears the flag
    expect(await flushListens(db, f as unknown as typeof fetch)).toEqual({ status: 'sent', sent: 1 });
  });

  it('drops a batch the server says is invalid so the queue keeps moving', async () => {
    const db = await setup();
    await queueListen(db, song, 1000);
    expect(await flushListens(db, fetcher(400) as unknown as typeof fetch)).toEqual({ status: 'nothing' });
    expect(await pendingListenCount(db)).toBe(0);
  });

  it('does nothing without a token, and skips songs without an artist', async () => {
    const db = await setup(null);
    expect(await flushListens(db, fetcher() as unknown as typeof fetch)).toEqual({ status: 'no-token' });
    expect(await queueListen(db, { ...song, artist: null }, 1)).toBe(false);
  });

  it('sends large backlogs in batches of 100', async () => {
    const db = await setup();
    for (let i = 0; i < 230; i++) await queueListen(db, song, i * 1000);
    const f = fetcher(200, 200, 200);
    expect(await flushListens(db, f as unknown as typeof fetch)).toEqual({ status: 'sent', sent: 230 });
    expect(f).toHaveBeenCalledTimes(3);
  });

  it('disconnecting forgets the token and the queue', async () => {
    const db = await setup();
    await queueListen(db, song, 1000);
    await setSetting(db, 'player.rate', 1.5);
    await disconnect(db);
    expect(await pendingListenCount(db)).toBe(0);
    expect(await getSetting(db, 'listenbrainz.token')).toBeNull();
    expect(await getSetting(db, 'player.rate')).toBe(1.5);
  });
});

describe('validateToken', () => {
  it('returns the user name for a valid token and null otherwise', async () => {
    const ok = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ valid: true, user_name: 'listener' }) }) as Response);
    expect(await validateToken(' tok ', ok as unknown as typeof fetch)).toBe('listener');
    expect((ok.mock.calls[0] as unknown as [string, RequestInit])[1].headers).toEqual({ Authorization: 'Token tok' });
    const bad = jest.fn(async () => ({ ok: false, status: 401, json: async () => ({ valid: false }) }) as Response);
    expect(await validateToken('x', bad as unknown as typeof fetch)).toBeNull();
    const down = jest.fn(async () => ({ ok: false, status: 502, json: async () => ({}) }) as Response);
    await expect(validateToken('x', down as unknown as typeof fetch)).rejects.toThrow('502');
  });
});
