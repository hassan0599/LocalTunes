/// <reference types="jest" />
/// <reference types="node" />

import { formatTime, nextRepeatMode, previousIndex, shuffleKeepingCurrent, toLoopMode } from '../queue';

describe('shuffleKeepingCurrent', () => {
  const items = Array.from({ length: 20 }, (_, i) => i);

  it('keeps the current item first and is a permutation', () => {
    for (let trial = 0; trial < 50; trial++) {
      const current = trial % items.length;
      const out = shuffleKeepingCurrent(items, current);
      expect(out[0]).toBe(current);
      expect([...out].sort((a, b) => a - b)).toEqual(items);
    }
  });

  it('is deterministic for a given random source', () => {
    let seed = 1;
    const rng = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    const a = shuffleKeepingCurrent(items, 5, rng);
    seed = 1;
    const b = shuffleKeepingCurrent(items, 5, rng);
    expect(a).toEqual(b);
  });

  it('handles empty input', () => {
    expect(shuffleKeepingCurrent([], 0)).toEqual([]);
  });
});

describe('previousIndex', () => {
  it('restarts the current track after 3 seconds', () => {
    expect(previousIndex(4, 10, 10, 'off')).toBeNull();
  });
  it('goes back one track near the start', () => {
    expect(previousIndex(4, 1, 10, 'off')).toBe(3);
  });
  it('wraps to the end only with repeat all', () => {
    expect(previousIndex(0, 1, 10, 'all')).toBe(9);
    expect(previousIndex(0, 1, 10, 'off')).toBeNull();
  });
});

describe('repeat', () => {
  it('cycles off → all → one → off', () => {
    expect(nextRepeatMode.off).toBe('all');
    expect(nextRepeatMode.all).toBe('one');
    expect(nextRepeatMode.one).toBe('off');
  });
  it('maps to expo-audio loop modes', () => {
    expect(toLoopMode('off')).toBe('none');
    expect(toLoopMode('one')).toBe('single');
  });
});

describe('formatTime', () => {
  it.each([
    [0, '0:00'],
    [65.9, '1:05'],
    [3725, '1:02:05'],
    [NaN, '0:00'],
  ])('%p → %s', (s, out) => expect(formatTime(s)).toBe(out));
});
