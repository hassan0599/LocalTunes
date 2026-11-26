/// <reference types="jest" />

import { clampRate, FADE_MS, fadeVolume, formatRate, formatRemaining } from '../sleep';

describe('sleep timer helpers', () => {
  it('keeps full volume until the fade, then fades linearly to 0', () => {
    expect(fadeVolume(60_000)).toBe(1);
    expect(fadeVolume(FADE_MS)).toBe(1);
    expect(fadeVolume(FADE_MS / 2)).toBe(0.5);
    expect(fadeVolume(0)).toBe(0);
    expect(fadeVolume(-5)).toBe(0);
  });

  it('formats the remaining time', () => {
    expect(formatRemaining(42_000)).toBe('0:42');
    expect(formatRemaining(41_001)).toBe('0:42');
    expect(formatRemaining(12 * 60_000 + 4_000)).toBe('12:04');
    expect(formatRemaining(3_909_000)).toBe('1:05:09');
    expect(formatRemaining(-1)).toBe('0:00');
  });
});

describe('playback speed helpers', () => {
  it('clamps to 0.5–2 and rejects junk', () => {
    expect(clampRate(0.1)).toBe(0.5);
    expect(clampRate(3)).toBe(2);
    expect(clampRate(1.254)).toBe(1.25);
    expect(clampRate(NaN)).toBe(1);
  });

  it('formats speeds compactly', () => {
    expect(formatRate(1)).toBe('1×');
    expect(formatRate(1.25)).toBe('1.25×');
    expect(formatRate(0.5)).toBe('0.5×');
  });
});
