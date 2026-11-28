/// <reference types="jest" />

jest.mock('expo-file-system', () => ({ File: class {}, Directory: class {}, Paths: {} }));

import type { Track } from '@/db/queries';

import { backfillUpdates } from '../tagBackfill';

const row = (over: Partial<Track> = {}) =>
  ({
    id: 1,
    file_uri: 'file:///m/Artist - Song.opus',
    source: 'device',
    title: 'Song',
    artist: 'Artist',
    album: null,
    album_artist: null,
    track_no: null,
    duration_ms: null,
    genre: null,
    replay_gain_db: null,
    artwork_uri: null,
    ...over,
  }) as Track;

describe('backfillUpdates', () => {
  it('fills metadata for a device Opus file that was added under its file name', () => {
    expect(
      backfillUpdates(row(), { title: 'Real Song', artist: 'Real Artist', album: 'LP', trackNo: 2, durationMs: 5000, genre: 'Jazz', replayGainDb: -4 }),
    ).toEqual({ title: 'Real Song', artist: 'Real Artist', album: 'LP', track_no: 2, duration_ms: 5000, genre: 'Jazz', replay_gain_db: -4 });
  });

  it('changes nothing when the tags match what is stored', () => {
    expect(backfillUpdates(row({ genre: 'Jazz', replay_gain_db: -4, duration_ms: 5000 }), { title: 'Song', artist: 'Artist', genre: 'Rock', replayGainDb: -1, durationMs: 9 })).toEqual({});
  });

  it('keeps the metadata a download source provided, but still fills gain and genre', () => {
    expect(
      backfillUpdates(row({ source: 'jamendo', title: 'From Jamendo' }), { title: 'Tag Title', artist: 'Tag Artist', genre: 'Folk', replayGainDb: -2.5 }),
    ).toEqual({ genre: 'Folk', replay_gain_db: -2.5 });
  });
});
