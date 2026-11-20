/// <reference types="jest" />
/// <reference types="node" />

import { readTags, tagsFromFileName, type ByteSource } from '../tags';

// ---------------------------------------------------------------- fixture builders

const bytes = (...parts: (number[] | Uint8Array | string)[]): Uint8Array => {
  const arrs = parts.map((p) =>
    typeof p === 'string' ? Uint8Array.from([...p].map((c) => c.charCodeAt(0))) : Uint8Array.from(p),
  );
  const out = new Uint8Array(arrs.reduce((n, a) => n + a.length, 0));
  let o = 0;
  for (const a of arrs) out.set(a, (o += a.length) - a.length);
  return out;
};
const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const le32 = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
const be24 = (n: number) => [(n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const synchsafe = (n: number) => [(n >> 21) & 127, (n >> 14) & 127, (n >> 7) & 127, n & 127];
const utf8 = (s: string) => Uint8Array.from(Buffer.from(s, 'utf8'));
const utf16le = (s: string) => bytes([0xff, 0xfe], Uint8Array.from(Buffer.from(s, 'utf16le')));

const source = (data: Uint8Array): ByteSource => ({
  size: data.length,
  read: async (offset, length) => data.slice(offset, offset + length),
});

function id3Frame(id: string, data: Uint8Array) {
  return bytes(id, be32(data.length), [0, 0], data);
}
function id3v23(...frames: Uint8Array[]) {
  const body = bytes(...frames, new Array(16).fill(0)); // padding
  return bytes('ID3', [3, 0, 0], synchsafe(body.length), body);
}
/** MPEG-1 Layer III, 128 kbps, 44.1 kHz, stereo frame carrying a Xing header with `frames`. */
function xingFrame(frames: number) {
  const frame = new Uint8Array(417);
  frame.set([0xff, 0xfb, 0x90, 0x00]);
  frame.set(bytes('Xing', be32(1), be32(frames)), 4 + 32);
  return frame;
}

// ---------------------------------------------------------------- tests

describe('readTags: MP3', () => {
  it('reads ID3v2.3 text frames, cover art and Xing duration', async () => {
    const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    const file = bytes(
      id3v23(
        id3Frame('TIT2', bytes([0], 'So What')),
        id3Frame('TPE1', bytes([1], utf16le('Miles Davis'))),
        id3Frame('TALB', bytes([3], utf8('Kind of Blué'))),
        id3Frame('TRCK', bytes([0], '1/5')),
        id3Frame('APIC', bytes([0], 'image/jpeg', [0], [3], 'cover', [0], jpeg)),
      ),
      xingFrame(1000),
    );
    const tags = await readTags(source(file));
    expect(tags.title).toBe('So What');
    expect(tags.artist).toBe('Miles Davis');
    expect(tags.album).toBe('Kind of Blué');
    expect(tags.trackNo).toBe(1);
    expect(tags.durationMs).toBe(Math.round((1000 * 1152 * 1000) / 44100));
    expect(tags.picture?.mime).toBe('image/jpeg');
    expect(Array.from(tags.picture!.data)).toEqual(Array.from(jpeg));
  });

  it('falls back to ID3v1 and estimates CBR duration without a Xing header', async () => {
    const audio = new Uint8Array(160_000);
    audio.set([0xff, 0xfb, 0x90, 0x00]);
    const v1 = new Uint8Array(128);
    v1.set(bytes('TAG', 'Old Title'), 0);
    v1.set(bytes('Old Artist'), 33);
    v1[126] = 7;
    const file = bytes(audio, v1);
    const tags = await readTags(source(file));
    expect(tags.title).toBe('Old Title');
    expect(tags.artist).toBe('Old Artist');
    expect(tags.trackNo).toBe(7);
    // (160000 + 128) bytes * 8 / 128 kbps ≈ 10 s
    expect(tags.durationMs).toBeGreaterThan(9900);
    expect(tags.durationMs).toBeLessThan(10100);
  });
});

describe('readTags: FLAC', () => {
  it('reads STREAMINFO duration and Vorbis comments', async () => {
    const sr = 44100;
    const total = 441000; // 10 s
    const si = new Uint8Array(34);
    si[10] = (sr >> 12) & 255;
    si[11] = (sr >> 4) & 255;
    si[12] = ((sr & 15) << 4) | (1 << 1); // 2 channels, bps high bit 0
    si[13] = (15 << 4) | 0; // 16 bps, total samples high bits
    si.set(be32(total), 14);

    const comments = ['TITLE=Blue in Green', 'ARTIST=Miles Davis', 'ALBUMARTIST=Miles Davis Sextet', 'TRACKNUMBER=3'];
    const vc = bytes(
      le32(4),
      'test',
      le32(comments.length),
      ...comments.flatMap((c) => [Uint8Array.from(le32(utf8(c).length)), utf8(c)]),
    );
    const file = bytes('fLaC', [0], be24(34), si, [0x84], be24(vc.length), vc, new Uint8Array(64));
    const tags = await readTags(source(file));
    expect(tags).toMatchObject({
      title: 'Blue in Green',
      artist: 'Miles Davis',
      albumArtist: 'Miles Davis Sextet',
      trackNo: 3,
      durationMs: 10000,
    });
  });
});

describe('readTags: MP4', () => {
  const atom = (type: string, ...children: Uint8Array[]) => {
    const body = bytes(...children);
    return bytes(be32(body.length + 8), type, body);
  };
  const data = (kind: number, value: Uint8Array) => atom('data', Uint8Array.from(be32(kind)), new Uint8Array(4), value);

  it('reads ilst metadata and mvhd duration', async () => {
    const mvhd = atom('mvhd', new Uint8Array([0, 0, 0, 0, ...be32(0), ...be32(0), ...be32(1000), ...be32(5000)]));
    const ilst = atom(
      'ilst',
      atom('©nam', data(1, utf8('Freddie Freeloader'))),
      atom('©ART', data(1, utf8('Miles Davis'))),
      atom('trkn', data(0, Uint8Array.from([0, 0, 0, 2, 0, 5, 0, 0]))),
    );
    const meta = atom('meta', new Uint8Array(4), atom('hdlr', new Uint8Array(25)), ilst);
    const moov = atom('moov', mvhd, atom('udta', meta));
    const file = bytes(atom('ftyp', bytes('M4A '), new Uint8Array(4)), atom('mdat', new Uint8Array(100)), moov);
    const tags = await readTags(source(file));
    expect(tags).toMatchObject({ title: 'Freddie Freeloader', artist: 'Miles Davis', trackNo: 2, durationMs: 5000 });
  });
});

describe('readTags: unknown formats', () => {
  it('returns no tags for non-audio data', async () => {
    expect(await readTags(source(bytes('RIFF....WAVEfmt ', new Uint8Array(200))))).toEqual({});
  });
});

describe('tagsFromFileName', () => {
  it.each([
    ['Miles Davis - So What.mp3', { artist: 'Miles Davis', title: 'So What' }],
    ['03 - Blue in Green.flac', { title: 'Blue in Green', trackNo: 3 }],
    ['01 Artist - Song - Live.m4a', { artist: 'Artist', title: 'Song - Live', trackNo: 1 }],
    ['my_recording.wav', { title: 'my recording' }],
    ['The Weeknd - Take My Breath (Official Music Video).mp3', { artist: 'The Weeknd', title: 'Take My Breath' }],
    ['RINI - Good Intentions (Audio).mp3', { artist: 'RINI', title: 'Good Intentions' }],
    ['Artist - Song (Live).mp3', { artist: 'Artist', title: 'Song (Live)' }],
  ])('%s', (name, expected) => {
    expect(tagsFromFileName(name)).toMatchObject(expected);
  });
});
