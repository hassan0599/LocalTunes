/** LRC lyrics parsing and lookup (pure; unit-tested). */

export interface LyricLine {
  /** Start time in ms, or null for plain (unsynced) lyrics. */
  timeMs: number | null;
  text: string;
}

export interface ParsedLyrics {
  synced: boolean;
  lines: LyricLine[];
}

const STAMP = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
const WORD_STAMP = /<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g;
const META = /^\[(ar|ti|al|au|by|re|ve|length|#):[^\]]*\]$/i;
const OFFSET = /^\[offset:\s*([+-]?\d+)\s*\]$/i;

function stampMs(m: RegExpExecArray): number {
  const frac = m[3] ?? '0';
  // ".5" = 500 ms, ".05" = 50 ms, ".005" = 5 ms
  const ms = Math.round(parseInt(frac, 10) * 10 ** (3 - frac.length));
  return (parseInt(m[1], 10) * 60 + parseInt(m[2], 10)) * 1000 + ms;
}

/**
 * Parses LRC (`[mm:ss.xx]line`, several stamps per line, `[offset:±ms]`, enhanced `<mm:ss>`
 * word stamps) or plain text. Synced output is sorted by time.
 */
export function parseLrc(text: string): ParsedLyrics {
  const timed: LyricLine[] = [];
  const plain: string[] = [];
  let offset = 0;
  for (const raw of text.replace(/^﻿/, '').split(/\r?\n/)) {
    const line = raw.trim();
    const off = OFFSET.exec(line);
    if (off) {
      offset = parseInt(off[1], 10);
      continue;
    }
    if (META.test(line)) continue;
    STAMP.lastIndex = 0;
    const stamps: number[] = [];
    let m: RegExpExecArray | null;
    let end = 0;
    while ((m = STAMP.exec(line)) && m.index === end) {
      stamps.push(stampMs(m));
      end = STAMP.lastIndex;
    }
    const body = line.slice(end).replace(WORD_STAMP, '').replace(/\s+/g, ' ').trim();
    if (stamps.length) for (const t of stamps) timed.push({ timeMs: t, text: body });
    else plain.push(raw.trimEnd());
  }
  if (timed.length) {
    // A positive offset means lyrics appear earlier.
    const lines = timed.map((l) => ({ timeMs: Math.max(0, (l.timeMs ?? 0) - offset), text: l.text })).sort((a, b) => a.timeMs - b.timeMs);
    return { synced: true, lines };
  }
  // Trim leading/trailing blank lines but keep stanza breaks.
  while (plain.length && !plain[0].trim()) plain.shift();
  while (plain.length && !plain[plain.length - 1].trim()) plain.pop();
  return { synced: false, lines: plain.map((t) => ({ timeMs: null, text: t.trim() })) };
}

/** Index of the line being sung at `positionMs` (-1 before the first line). */
export function activeLine(lines: LyricLine[], positionMs: number): number {
  let lo = 0;
  let hi = lines.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if ((lines[mid].timeMs ?? 0) <= positionMs) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}
