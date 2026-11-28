/// <reference types="jest" />

import { gainToVolume, medianGain } from '../normalize';

describe('gainToVolume', () => {
  it('turns tagged songs down by their gain', () => {
    expect(gainToVolume(-6, null, true)).toBeCloseTo(0.501, 3);
    expect(gainToVolume(-20, null, true)).toBe(0.1);
  });
  it('never turns up past full volume, nor below the floor', () => {
    expect(gainToVolume(4, null, true)).toBe(1);
    expect(gainToVolume(-60, null, true)).toBe(0.05);
  });
  it('uses the library fallback for untagged songs', () => {
    expect(gainToVolume(null, -6, true)).toBeCloseTo(0.501, 3);
    expect(gainToVolume(null, null, true)).toBe(1);
  });
  it('is full volume when disabled', () => {
    expect(gainToVolume(-6, -6, false)).toBe(1);
  });
});

describe('medianGain', () => {
  it('handles odd, even and empty lists', () => {
    expect(medianGain([-3, -9, -6])).toBe(-6);
    expect(medianGain([-2, -4, -6, -8])).toBe(-5);
    expect(medianGain([])).toBeNull();
  });
});
