/// <reference types="jest" />

import type { Track } from '@/db/queries';

// A fake mockNative playlist that, like expo-audio on Android, applies calls synchronously
// but delivers status events to JS later (we flush them by hand).
type Listener = (s: Record<string, unknown>) => void;
const mockNative = {
  items: [] as unknown[],
  index: 0,
  listener: null as Listener | null,
  pending: [] as Record<string, unknown>[],
  lockScreenThrows: false,
  paused: true,
  seeks: [] as number[],
  obj: null as null | ({ volume: number; playbackRate: number } & Record<string, unknown>),
};
function mockEmit(extra: Record<string, unknown> = {}) {
  mockNative.pending.push({
    currentIndex: mockNative.index,
    trackCount: mockNative.items.length,
    currentTime: 0,
    duration: 0,
    playing: true,
    isBuffering: false,
    isLoaded: true,
    ...extra,
  });
}
function flush() {
  const events = mockNative.pending.splice(0);
  for (const e of events) mockNative.listener?.(e);
}

jest.mock('expo-audio', () => ({
  setAudioModeAsync: jest.fn(async () => {}),
  createAudioPlaylist: jest.fn(() => (mockNative.obj = {
    addListener: (_: string, l: Listener) => (mockNative.listener = l),
    clear: () => {
      mockNative.items = [];
      mockNative.index = 0;
      mockEmit({ trackCount: 0, currentIndex: 0 });
    },
    add: (src: unknown) => {
      mockNative.items.push(src);
      mockEmit();
    },
    insert: (src: unknown, at: number) => {
      mockNative.items.splice(at, 0, src);
      mockEmit();
    },
    remove: (i: number) => {
      mockNative.items.splice(i, 1);
      mockEmit();
    },
    skipTo: (i: number) => {
      if (i >= 0 && i < mockNative.items.length) mockNative.index = i;
      mockEmit();
    },
    play: () => {
      mockNative.paused = false;
      mockEmit();
    },
    pause: () => {
      mockNative.paused = true;
      mockEmit({ playing: false });
    },
    seekTo: async (sec: number) => {
      mockNative.seeks.push(sec);
    },
    setActiveForLockScreen: () => {
      if (mockNative.lockScreenThrows) throw new Error('java.net.MalformedURLException: unknown protocol: content');
    },
    updateLockScreenMetadata: () => {
      if (mockNative.lockScreenThrows) throw new Error('java.net.MalformedURLException: unknown protocol: content');
    },
    clearLockScreenControls: () => {},
    playing: false,
    loop: 'none',
    volume: 1,
    playbackRate: 1,
  })),
}));
jest.mock('expo-file-system', () => ({ File: class { exists = true; } }));
jest.mock('@/services/listenbrainz/listenbrainz', () => ({
  ...jest.requireActual('@/services/listenbrainz/listenbrainz'),
  queueListen: jest.fn(async () => true),
  flushListens: jest.fn(async () => ({ status: 'sent', sent: 1 })),
}));
jest.mock('@/db/queries', () => ({
  getSetting: jest.fn(async () => null),
  setSetting: jest.fn(async () => {}),
  getTracksByIds: jest.fn(async () => []),
  markPlayed: jest.fn(async () => {}),
  setTrackDurationIfMissing: jest.fn(async () => {}),
}));

const track = (id: number): Track =>
  ({ id, title: `Song ${id}`, artist: null, album: null, file_uri: `file:///music/${id}.mp3`, artwork_uri: null, duration_ms: 1000 }) as Track;
const tracks = [1, 2, 3, 4, 5].map(track);

async function load() {
  jest.resetModules();
  mockNative.items = [];
  mockNative.index = 0;
  mockNative.pending = [];
  mockNative.listener = null;
  mockNative.lockScreenThrows = false;
  mockNative.paused = true;
  mockNative.seeks = [];
  let svc!: typeof import('../PlaybackService');
  let usePlayer!: typeof import('@/state/player').usePlayer;
  let queries!: { setSetting: jest.Mock };
  let listenbrainz!: { queueListen: jest.Mock; flushListens: jest.Mock };
  /* eslint-disable @typescript-eslint/no-require-imports -- isolateModules needs require() */
  jest.isolateModules(() => {
    svc = require('../PlaybackService');
    usePlayer = require('@/state/player').usePlayer;
    queries = require('@/db/queries');
    listenbrainz = require('@/services/listenbrainz/listenbrainz');
  });
  /* eslint-enable @typescript-eslint/no-require-imports */
  return { svc, usePlayer, queries, listenbrainz };
}

describe('PlaybackService tap path', () => {
  it('plays the tapped song and is not moved by stale events from the rebuild', async () => {
    const { svc, usePlayer } = await load();
    await svc.setupPlayback({} as never);
    svc.playTracks(tracks, 3);
    flush(); // events from clear() and each add() arrive after the queue is set
    expect(usePlayer.getState().index).toBe(3);
    expect(mockNative.index).toBe(3);
  });

  it('switching songs again keeps the newly tapped song current', async () => {
    const { svc, usePlayer } = await load();
    await svc.setupPlayback({} as never);
    svc.playTracks(tracks, 1);
    flush();
    svc.playTracks(tracks, 4);
    flush();
    expect(usePlayer.getState().index).toBe(4);
  });

  it('does not throw when lock-screen metadata is rejected natively', async () => {
    const { svc, usePlayer } = await load();
    await svc.setupPlayback({} as never);
    mockNative.lockScreenThrows = true;
    expect(() => svc.playTracks(tracks, 2)).not.toThrow();
    expect(() => svc.playTracks(tracks, 0)).not.toThrow();
    expect(() => flush()).not.toThrow();
    expect(usePlayer.getState().index).toBe(0);
  });

  it('falls back to the first song when the tapped index is invalid', async () => {
    const { svc, usePlayer } = await load();
    await svc.setupPlayback({} as never);
    expect(() => svc.playTracks(tracks, -1)).not.toThrow();
    flush();
    expect(usePlayer.getState().index).toBe(0);
    expect(usePlayer.getState().queue[0]?.id).toBe(1);
  });

  it('defers a tap that arrives before setup has finished instead of throwing', async () => {
    const { svc, usePlayer } = await load();
    expect(() => svc.playTracks(tracks, 2)).not.toThrow(); // setup not started: ignored safely
    const setup = svc.setupPlayback({} as never);
    svc.playTracks(tracks, 2); // tapped while setup is still running
    await setup;
    await Promise.resolve();
    flush();
    expect(usePlayer.getState().queue[usePlayer.getState().index]?.id).toBe(3);
  });
});

describe('playback speed', () => {
  it('clamps, applies natively and persists', async () => {
    const { svc, usePlayer, queries } = await load();
    await svc.setupPlayback({} as never);
    svc.setPlaybackRate(1.5);
    expect(mockNative.obj?.playbackRate).toBe(1.5);
    expect(usePlayer.getState().rate).toBe(1.5);
    svc.setPlaybackRate(9);
    expect(mockNative.obj?.playbackRate).toBe(2);
    expect(queries.setSetting).toHaveBeenLastCalledWith({}, 'player.rate', 2);
  });
});

describe('sleep timer', () => {
  const status = (extra: Record<string, unknown>) =>
    mockNative.listener?.({
      currentIndex: mockNative.index,
      trackCount: mockNative.items.length,
      currentTime: 0,
      duration: 100,
      playing: true,
      isBuffering: false,
      isLoaded: true,
      ...extra,
    });

  async function playing() {
    const ctx = await load();
    await ctx.svc.setupPlayback({} as never);
    ctx.svc.playTracks(tracks, 0);
    flush();
    expect(mockNative.paused).toBe(false);
    return ctx;
  }

  it('fades out over the last seconds, then pauses and restores volume', async () => {
    jest.useFakeTimers({ now: 1_000_000 });
    try {
      const { svc, usePlayer } = await playing();
      svc.startSleepTimer(1);
      svc.tickSleep(1_000_000 + 30_000);
      expect(mockNative.obj?.volume).toBe(1);
      svc.tickSleep(1_000_000 + 55_000);
      expect(mockNative.obj?.volume).toBe(0.5);
      expect(mockNative.paused).toBe(false);
      svc.tickSleep(1_000_000 + 60_000);
      expect(mockNative.paused).toBe(true);
      expect(mockNative.obj?.volume).toBe(1);
      expect(usePlayer.getState().sleep).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it('cancel restores the volume and clears the timer', async () => {
    jest.useFakeTimers({ now: 0 });
    try {
      const { svc, usePlayer } = await playing();
      svc.startSleepTimer(1);
      svc.tickSleep(58_000);
      expect(mockNative.obj?.volume).toBeLessThan(1);
      svc.cancelSleepTimer();
      expect(mockNative.obj?.volume).toBe(1);
      expect(usePlayer.getState().sleep).toBeNull();
      expect(mockNative.paused).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  it('end of song: stops just before the armed song ends', async () => {
    const { svc, usePlayer } = await playing();
    svc.sleepAtEndOfTrack();
    status({ currentTime: 95 });
    expect(mockNative.obj?.volume).toBe(0.5);
    status({ currentTime: 99.6 });
    expect(mockNative.paused).toBe(true);
    expect(usePlayer.getState().sleep).toBeNull();
    expect(mockNative.obj?.volume).toBe(1);
  });

  it('end of song: pauses and rewinds if the next song already started', async () => {
    const { svc } = await playing();
    svc.sleepAtEndOfTrack();
    mockNative.index = 1; // advanced on its own between status updates
    status({ currentTime: 0.3 });
    expect(mockNative.paused).toBe(true);
    expect(mockNative.seeks).toContain(0);
  });

  it('end of song: a manual skip moves the timer to the new song', async () => {
    const { svc, usePlayer } = await playing();
    svc.sleepAtEndOfTrack();
    svc.skipTo(2);
    flush();
    status({ currentTime: 10 });
    expect(mockNative.paused).toBe(false);
    expect(usePlayer.getState().sleep).toEqual({ kind: 'track' });
  });
});

describe('queue editing', () => {
  async function playing(start = 0) {
    const ctx = await load();
    await ctx.svc.setupPlayback({} as never);
    ctx.svc.playTracks(tracks, start);
    flush();
    return ctx;
  }
  const ids = (q: { id: number }[]) => q.map((t) => t.id);
  const nativeIds = () => (mockNative.items as { uri: string }[]).map((s) => Number(s.uri.match(/(\d+)\.mp3$/)![1]));

  it('moves an upcoming song in JS and native order alike, without touching the current one', async () => {
    const { svc, usePlayer } = await playing(1);
    svc.moveInQueue(4, 2);
    flush();
    expect(ids(usePlayer.getState().queue)).toEqual([1, 2, 5, 3, 4]);
    expect(nativeIds()).toEqual([1, 2, 5, 3, 4]);
    expect(usePlayer.getState().index).toBe(1);
    expect(mockNative.index).toBe(1);
    expect(ids(usePlayer.getState().originalQueue)).toEqual([1, 2, 5, 3, 4]);
  });

  it('refuses moves that involve the current or earlier songs', async () => {
    const { svc, usePlayer } = await playing(2);
    svc.moveInQueue(1, 4);
    svc.moveInQueue(4, 2);
    svc.moveInQueue(3, 9);
    expect(ids(usePlayer.getState().queue)).toEqual([1, 2, 3, 4, 5]);
  });

  it('removes one upcoming entry from JS and native', async () => {
    const { svc, usePlayer } = await playing(0);
    svc.removeQueueAt(2);
    flush();
    expect(ids(usePlayer.getState().queue)).toEqual([1, 2, 4, 5]);
    expect(nativeIds()).toEqual([1, 2, 4, 5]);
    expect(usePlayer.getState().index).toBe(0);
    svc.removeQueueAt(0); // the current song: not allowed here
    expect(usePlayer.getState().queue).toHaveLength(4);
  });
});


describe('volume normalization', () => {
  const loud = (id: number, gain: number | null) => ({ ...track(id), replay_gain_db: gain }) as Track;

  it('turns tagged songs down, follows track changes, and can be switched off', async () => {
    const { svc } = await load();
    await svc.setupPlayback({} as never);
    svc.playTracks([loud(1, -6), loud(2, -12), loud(3, 3)], 0);
    expect(mockNative.obj?.volume).toBeCloseTo(0.501, 3);
    mockNative.index = 1; // the next song starts on its own
    mockNative.listener?.({ currentIndex: 1, trackCount: 3, currentTime: 0, duration: 100, playing: true, isBuffering: false, isLoaded: true });
    expect(mockNative.obj?.volume).toBeCloseTo(0.251, 3);
    svc.setNormalize(false);
    expect(mockNative.obj?.volume).toBe(1);
    svc.setNormalize(true);
    svc.skipTo(2);
    flush();
    expect(mockNative.obj?.volume).toBe(1); // +3 dB can't go above full volume
  });

  it('multiplies with the sleep timer fade', async () => {
    jest.useFakeTimers({ now: 0 });
    try {
      const { svc } = await load();
      await svc.setupPlayback({} as never);
      svc.playTracks([loud(1, -6)], 0);
      svc.startSleepTimer(1);
      svc.tickSleep(55_000); // halfway through the fade
      expect(mockNative.obj?.volume).toBeCloseTo(0.251, 2);
      svc.cancelSleepTimer();
      expect(mockNative.obj?.volume).toBeCloseTo(0.501, 3);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('ListenBrainz listens', () => {
  const status = (currentIndex: number, currentTime: number, playing = true) =>
    mockNative.listener?.({ currentIndex, trackCount: 2, currentTime, duration: 60, playing, isBuffering: false, isLoaded: true });
  const song = (id: number) => ({ ...track(id), duration_ms: 60_000 }) as Track;

  it('queues one listen after half the song has actually played', async () => {
    const { svc, listenbrainz } = await load();
    await svc.setupPlayback({} as never);
    svc.setScrobbling(true);
    svc.playTracks([song(1), song(2)], 0);
    flush();
    for (let t = 0; t <= 29; t += 0.5) status(0, t);
    expect(listenbrainz.queueListen).not.toHaveBeenCalled();
    for (let t = 29.5; t <= 40; t += 0.5) status(0, t);
    expect(listenbrainz.queueListen).toHaveBeenCalledTimes(1);
    expect(listenbrainz.queueListen.mock.calls[0][1]).toMatchObject({ id: 1, duration_ms: 60_000 });
  });

  it('does not count seeking ahead or paused time', async () => {
    const { svc, listenbrainz } = await load();
    await svc.setupPlayback({} as never);
    svc.setScrobbling(true);
    svc.playTracks([song(1), song(2)], 0);
    flush();
    status(0, 0);
    status(0, 0.5);
    status(0, 55); // seek near the end
    for (let t = 55; t < 59; t += 0.5) status(0, t);
    status(0, 59, false);
    expect(listenbrainz.queueListen).not.toHaveBeenCalled();
  });

  it('counts each loop of repeat-one, and nothing while disconnected', async () => {
    const { svc, listenbrainz } = await load();
    await svc.setupPlayback({} as never);
    svc.playTracks([song(1), song(2)], 0);
    flush();
    for (let t = 0; t <= 35; t += 0.5) status(0, t);
    expect(listenbrainz.queueListen).not.toHaveBeenCalled(); // not connected
    svc.setScrobbling(true);
    for (let loop = 0; loop < 2; loop++) for (let t = 0; t <= 35; t += 0.5) status(0, t);
    expect(listenbrainz.queueListen).toHaveBeenCalledTimes(2);
  });
});

