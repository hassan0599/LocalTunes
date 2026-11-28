/// <reference types="jest" />
/// <reference types="node" />

import { base64ToBytes, parseGainDb, parseGenre, readTags, tagsFromFileName, type ByteSource } from '../tags';

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

describe('genres', () => {
  it('reads ID3v2 TCON, including numeric references', async () => {
    const file = bytes(id3v23(id3Frame('TIT2', bytes([0], 'T')), id3Frame('TCON', bytes([0], '(8)Jazz'))), xingFrame(10));
    expect((await readTags(source(file))).genre).toBe('Jazz');
    const numeric = bytes(id3v23(id3Frame('TCON', bytes([0], '(17)'))), xingFrame(10));
    expect((await readTags(source(numeric))).genre).toBe('Rock');
  });

  it('reads the ID3v1 genre byte', async () => {
    const audio = new Uint8Array(2000);
    audio.set([0xff, 0xfb, 0x90, 0x00]);
    const v1 = new Uint8Array(128);
    v1.set(bytes('TAG', 'Title'), 0);
    v1[127] = 32; // Classical
    expect((await readTags(source(bytes(audio, v1)))).genre).toBe('Classical');
  });

  it('normalises lists and case', () => {
    expect(parseGenre('rock; pop')).toBe('Rock, Pop');
    expect(parseGenre('Hip-Hop/Rap')).toBe('Hip-Hop/Rap');
    expect(parseGenre('(13)(17)')).toBe('Pop, Rock');
    expect(parseGenre('Electronic, electronic')).toBe('Electronic');
    expect(parseGenre('  ')).toBeUndefined();
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

// ---------------------------------------------------------------- Ogg fixtures

const le16 = (n: number) => [n & 255, (n >>> 8) & 255];
const le64 = (n: number) => [...le32(n % 2 ** 32), ...le32(Math.floor(n / 2 ** 32))];

/** Split packets into Ogg pages of at most `maxSegs` lacing values (so packets can span pages). */
function oggStream(packets: Uint8Array[], opts: { serial?: number; finalGranule: number; maxSegs?: number }) {
  const serial = opts.serial ?? 0x1234;
  const maxSegs = opts.maxSegs ?? 255;
  const segs: { data: Uint8Array; len: number }[] = [];
  for (const pk of packets) {
    let o = 0;
    while (pk.length - o >= 255) {
      segs.push({ data: pk.subarray(o, o + 255), len: 255 });
      o += 255;
    }
    segs.push({ data: pk.subarray(o), len: pk.length - o });
  }
  const pages: Uint8Array[] = [];
  for (let i = 0, seq = 0; i < segs.length; i += maxSegs, seq++) {
    const chunk = segs.slice(i, i + maxSegs);
    const last = i + maxSegs >= segs.length;
    pages.push(
      bytes('OggS', [0, seq === 0 ? 2 : 0], le64(last ? opts.finalGranule : 0), le32(serial), le32(seq), le32(0), [chunk.length], chunk.map((c) => c.len), ...chunk.map((c) => c.data)),
    );
  }
  // A final audio page carrying the real end position.
  pages.push(bytes('OggS', [0, 4], le64(opts.finalGranule), le32(serial), le32(999), le32(0), [1], [3], [9, 9, 9]));
  return bytes(...pages);
}

function vorbisComment(entries: string[]) {
  return bytes(le32(6), 'vendor', le32(entries.length), ...entries.flatMap((c) => [Uint8Array.from(le32(utf8(c).length)), utf8(c)]));
}

function flacPictureBlock(mime: string, data: Uint8Array) {
  return bytes(be32(3), be32(mime.length), mime, be32(0), be32(0), be32(0), be32(0), be32(0), be32(data.length), data);
}

describe('readTags: Ogg Vorbis', () => {
  it('reads Vorbis comments and the duration from the last page', async () => {
    const idHeader = bytes([1], 'vorbis', le32(0), [2], le32(44100), new Array(16).fill(0));
    const comment = bytes([3], 'vorbis', vorbisComment(['TITLE=Hjartað hlær', 'ARTIST=Sigur Rós', 'ALBUM=Takk...', 'TRACKNUMBER=4/11', 'GENRE=post-rock', 'REPLAYGAIN_TRACK_GAIN=-7.32 dB']), [1]);
    const file = oggStream([idHeader, comment], { finalGranule: 44100 * 245 });
    expect(await readTags(source(file))).toMatchObject({
      title: 'Hjartað hlær',
      artist: 'Sigur Rós',
      album: 'Takk...',
      trackNo: 4,
      genre: 'Post-Rock',
      durationMs: 245_000,
      replayGainDb: -7.32,
    });
  });

  it('reassembles a comment header that spans several pages', async () => {
    const idHeader = bytes([1], 'vorbis', le32(0), [2], le32(48000), new Array(16).fill(0));
    const long = 'x'.repeat(3000);
    const comment = bytes([3], 'vorbis', vorbisComment([`DESCRIPTION=${long}`, 'TITLE=Long Notes']), [1]);
    const file = oggStream([idHeader, comment], { finalGranule: 48000 * 10, maxSegs: 4 });
    const tags = await readTags(source(file));
    expect(tags.title).toBe('Long Notes');
    expect(tags.durationMs).toBe(10_000);
  });
});

describe('readTags: Opus', () => {
  it('reads OpusTags, an embedded picture, R128 gain and pre-skip-corrected duration', async () => {
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    const picture = Buffer.from(flacPictureBlock('image/png', png)).toString('base64');
    const head = bytes('OpusHead', [1, 2], le16(312), le32(48000), le16(0), [0]);
    const tags = bytes('OpusTags', vorbisComment(['TITLE=Opus Song', 'ARTIST=Encoder Fan', `METADATA_BLOCK_PICTURE=${picture}`, 'R128_TRACK_GAIN=-1280']));
    const file = oggStream([head, tags], { finalGranule: 312 + 48000 * 3 });
    const out = await readTags(source(file));
    expect(out).toMatchObject({ title: 'Opus Song', artist: 'Encoder Fan', durationMs: 3000, replayGainDb: 0 });
    expect(out.picture?.mime).toBe('image/png');
    expect(Array.from(out.picture!.data)).toEqual(Array.from(png));
  });

  it('prefers REPLAYGAIN_TRACK_GAIN over R128 when both exist', async () => {
    const head = bytes('OpusHead', [1, 2], le16(0), le32(48000), le16(0), [0]);
    const tags = bytes('OpusTags', vorbisComment(['REPLAYGAIN_TRACK_GAIN=-3.5 dB', 'R128_TRACK_GAIN=-1280']));
    expect((await readTags(source(oggStream([head, tags], { finalGranule: 48000 })))).replayGainDb).toBe(-3.5);
  });

  it('returns nothing for an Ogg stream of another codec', async () => {
    const file = oggStream([bytes('\x80theora', new Array(20).fill(0)), bytes('x')], { finalGranule: 1 });
    expect(await readTags(source(file))).toEqual({});
  });
});

describe('ReplayGain', () => {
  it('reads TXXX from ID3v2', async () => {
    const txxx = id3Frame('TXXX', bytes([0], 'REPLAYGAIN_TRACK_GAIN', [0], '-9.10 dB'));
    const other = id3Frame('TXXX', bytes([0], 'replaygain_album_gain', [0], '-8 dB'));
    const tags = await readTags(source(bytes(id3v23(id3Frame('TIT2', bytes([0], 'Loud')), other, txxx), xingFrame(10))));
    expect(tags.title).toBe('Loud');
    expect(tags.replayGainDb).toBe(-9.1);
  });

  it('reads Vorbis comments in FLAC', async () => {
    const si = new Uint8Array(34);
    const vc = vorbisComment(['REPLAYGAIN_TRACK_GAIN=+2.10 dB']);
    const file = bytes('fLaC', [0], be24(34), si, [0x84], be24(vc.length), vc, new Uint8Array(16));
    expect((await readTags(source(file))).replayGainDb).toBe(2.1);
  });

  it('parses gain strings defensively', () => {
    expect(parseGainDb('-6.54 dB')).toBe(-6.54);
    expect(parseGainDb('+1,5 dB')).toBe(1.5);
    expect(parseGainDb('3')).toBe(3);
    expect(parseGainDb('loud')).toBeUndefined();
    expect(parseGainDb('-99 dB')).toBeUndefined();
    expect(parseGainDb(undefined)).toBeUndefined();
  });
});

describe('base64ToBytes', () => {
  it('matches Node for all padding cases', () => {
    for (const s of ['', 'a', 'ab', 'abc', 'abcd', 'hello world', '\u00ff\u0000\u0080']) {
      const enc = Buffer.from(s, 'latin1').toString('base64');
      expect(Array.from(base64ToBytes(enc))).toEqual(Array.from(Buffer.from(s, 'latin1')));
      expect(Array.from(base64ToBytes(enc.replace(/=+$/, '')))).toEqual(Array.from(Buffer.from(s, 'latin1')));
    }
  });
});

