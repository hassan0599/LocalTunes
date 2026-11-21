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
  createAudioPlaylist: jest.fn(() => ({
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
    play: () => mockEmit(),
    pause: () => mockEmit({ playing: false }),
    seekTo: async () => {},
    setActiveForLockScreen: () => {
      if (mockNative.lockScreenThrows) throw new Error('java.net.MalformedURLException: unknown protocol: content');
    },
    updateLockScreenMetadata: () => {
      if (mockNative.lockScreenThrows) throw new Error('java.net.MalformedURLException: unknown protocol: content');
    },
    clearLockScreenControls: () => {},
    playing: false,
    loop: 'none',
  })),
}));
jest.mock('expo-file-system', () => ({ File: class { exists = true; } }));
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
  let svc!: typeof import('../PlaybackService');
  let usePlayer!: typeof import('@/state/player').usePlayer;
  /* eslint-disable @typescript-eslint/no-require-imports -- isolateModules needs require() */
  jest.isolateModules(() => {
    svc = require('../PlaybackService');
    usePlayer = require('@/state/player').usePlayer;
  });
  /* eslint-enable @typescript-eslint/no-require-imports */
  return { svc, usePlayer };
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
