/// <reference types="jest" />

import {
  afterFailure,
  blockedReason,
  MAX_ATTEMPTS,
  pickNext,
  retryDelayMs,
  spaceError,
  type DownloadRow,
} from '../schedule';

const row = (id: number, extra: Partial<DownloadRow> = {}): DownloadRow => ({
  id,
  source: 'internet_archive',
  source_id: `s${id}`,
  url: `https://x/${id}.mp3`,
  ext: 'mp3',
  title: `T${id}`,
  artist: null,
  album: null,
  track_no: null,
  duration_ms: null,
  license: 'https://creativecommons.org/licenses/by/4.0/',
  artwork_url: null,
  mbid: null,
  status: 'queued',
  bytes_done: 0,
  bytes_total: null,
  attempts: 0,
  next_attempt_at: null,
  pause_state: null,
  track_id: null,
  error: null,
  created_at: id,
  finished_at: null,
  ...extra,
});

describe('pickNext', () => {
  it('fills up to 2 concurrent slots, oldest first', () => {
    const rows = [row(3), row(1), row(2)];
    expect(pickNext(rows, new Set(), 0).map((r) => r.id)).toEqual([1, 2]);
    expect(pickNext(rows, new Set([1]), 0).map((r) => r.id)).toEqual([2]);
    expect(pickNext(rows, new Set([1, 2]), 0)).toEqual([]);
  });

  it('skips paused, failed, done and not-yet-due retries', () => {
    const rows = [row(1, { status: 'paused' }), row(2, { status: 'failed' }), row(3, { status: 'done' }), row(4, { next_attempt_at: 5000 }), row(5)];
    expect(pickNext(rows, new Set(), 1000).map((r) => r.id)).toEqual([5]);
    expect(pickNext(rows, new Set(), 6000).map((r) => r.id)).toEqual([4, 5]);
  });
});

describe('retries', () => {
  it('backs off exponentially', () => {
    expect([1, 2, 3].map(retryDelayMs)).toEqual([10_000, 20_000, 40_000]);
  });

  it('requeues until the attempt limit, then fails', () => {
    expect(afterFailure({ attempts: 0 }, 'boom', 1000)).toEqual({ status: 'queued', attempts: 1, next_attempt_at: 11_000, error: 'boom' });
    expect(afterFailure({ attempts: MAX_ATTEMPTS - 1 }, 'boom', 1000)).toEqual({ status: 'failed', attempts: MAX_ATTEMPTS, next_attempt_at: null, error: 'boom' });
  });
});

describe('blockedReason', () => {
  it('pauses offline, and on metered networks when Wi-Fi only is on', () => {
    expect(blockedReason({ online: false, metered: false }, false)).toBe('offline');
    expect(blockedReason({ online: true, metered: true }, true)).toBe('wifi');
    expect(blockedReason({ online: true, metered: true }, false)).toBeNull();
    expect(blockedReason({ online: true, metered: false }, true)).toBeNull();
  });
});

describe('spaceError', () => {
  const MB = 1024 * 1024;
  it('allows downloads that leave the safety margin free', () => {
    expect(spaceError({ bytes_total: 10 * MB, bytes_done: 0 }, 500 * MB)).toBeNull();
  });
  it('explains when there is not enough space', () => {
    expect(spaceError({ bytes_total: 10 * MB, bytes_done: 0 }, 50 * MB)).toBe(
      'Not enough free space: needs 10 MB plus 100 MB spare, 50 MB available.',
    );
  });
  it('counts only the remaining bytes of a resumed download', () => {
    expect(spaceError({ bytes_total: 200 * MB, bytes_done: 150 * MB }, 160 * MB)).toBeNull();
  });
});
