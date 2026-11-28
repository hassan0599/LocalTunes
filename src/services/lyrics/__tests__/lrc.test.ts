/// <reference types="jest" />

import { activeLine, parseLrc } from '../lrc';

describe('parseLrc', () => {
  it('parses timestamps, repeated stamps, metadata and sorts by time', () => {
    const lrc = ['[ar:Someone]', '[ti:Song]', '[00:12.50]First line', '[00:05.00][01:00.0]Chorus', '[00:20]Third', ''].join('\n');
    expect(parseLrc(lrc)).toEqual({
      synced: true,
      lines: [
        { timeMs: 5000, text: 'Chorus' },
        { timeMs: 12500, text: 'First line' },
        { timeMs: 20000, text: 'Third' },
        { timeMs: 60000, text: 'Chorus' },
      ],
    });
  });

  it('handles millisecond precision, offsets and enhanced word stamps', () => {
    const lrc = '[offset:+500]\n[00:01.005]<00:01.00>One <00:01.50>word\n[00:02.5]Two';
    expect(parseLrc(lrc).lines).toEqual([
      { timeMs: 505, text: 'One word' },
      { timeMs: 2000, text: 'Two' },
    ]);
  });

  it('keeps empty timed lines (instrumental gaps)', () => {
    expect(parseLrc('[00:01.00]Sing\n[00:04.00]\n[00:09.00]Again').lines.map((l) => l.text)).toEqual(['Sing', '', 'Again']);
  });

  it('treats text without timestamps as plain lyrics, keeping stanza breaks', () => {
    expect(parseLrc('\n\nVerse one\nline two\n\nChorus\n\n')).toEqual({
      synced: false,
      lines: [
        { timeMs: null, text: 'Verse one' },
        { timeMs: null, text: 'line two' },
        { timeMs: null, text: '' },
        { timeMs: null, text: 'Chorus' },
      ],
    });
  });
});

describe('activeLine', () => {
  const lines = parseLrc('[00:01]a\n[00:05]b\n[00:09]c').lines;
  it('finds the line being sung', () => {
    expect(activeLine(lines, 0)).toBe(-1);
    expect(activeLine(lines, 1000)).toBe(0);
    expect(activeLine(lines, 8999)).toBe(1);
    expect(activeLine(lines, 60_000)).toBe(2);
    expect(activeLine([], 5)).toBe(-1);
  });
});
