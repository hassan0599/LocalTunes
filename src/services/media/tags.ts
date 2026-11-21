/**
 * Minimal audio tag reader (spec 6.1 "Metadata").
 *
 * Supports MP3 (ID3v2.2/2.3/2.4 + ID3v1, duration from Xing/Info/VBRI or CBR estimate),
 * FLAC (Vorbis comments, PICTURE, STREAMINFO duration) and MP4/M4A (ilst atoms, mvhd duration).
 * Anything else returns `{}` and the importer falls back to the file name.
 *
 * Pure TypeScript with no platform APIs: callers provide a `ByteSource`, so it runs on
 * device (expo-file-system FileHandle) and in Jest (Buffer) alike.
 */

export interface ByteSource {
  size: number;
  read(offset: number, length: number): Promise<Uint8Array>;
}

export interface Picture {
  mime: string;
  data: Uint8Array;
}

export interface AudioTags {
  title?: string;
  artist?: string;
  album?: string;
  albumArtist?: string;
  trackNo?: number;
  /** Comma-separated, title-cased: "Jazz, Swing". */
  genre?: string;
  durationMs?: number;
  picture?: Picture;
}

const MAX_TAG_BYTES = 32 * 1024 * 1024;

export async function readTags(src: ByteSource): Promise<AudioTags> {
  if (src.size < 12) return {};
  const head = await src.read(0, 12);

  if (ascii(head, 0, 3) === 'ID3') {
    const { tags, end } = await readId3v2(src);
    const next = await src.read(end, 4);
    if (ascii(next, 0, 4) === 'fLaC') return merge(tags, await readFlac(src, end));
    const mp3 = await readMp3Duration(src, end);
    return merge(tags, mp3, await readId3v1(src));
  }
  if (ascii(head, 0, 4) === 'fLaC') return readFlac(src, 0);
  if (ascii(head, 4, 8) === 'ftyp') return readMp4(src);
  if (head[0] === 0xff && (head[1] & 0xe0) === 0xe0) {
    return merge(await readId3v1(src), await readMp3Duration(src, 0));
  }
  return readId3v1(src);
}

/** First defined value wins, field by field. */
function merge(...parts: AudioTags[]): AudioTags {
  const out: AudioTags = {};
  for (const p of parts) {
    for (const [k, v] of Object.entries(p) as [keyof AudioTags, never][]) {
      if (out[k] === undefined && v !== undefined && v !== '') out[k] = v;
    }
  }
  return out;
}

// ---------------------------------------------------------------- byte helpers

function ascii(b: Uint8Array, start: number, end: number): string {
  let s = '';
  for (let i = start; i < end && i < b.length; i++) s += String.fromCharCode(b[i]);
  return s;
}

function u32be(b: Uint8Array, o: number): number {
  return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
}
function u24be(b: Uint8Array, o: number): number {
  return (b[o] << 16) | (b[o + 1] << 8) | b[o + 2];
}
function u16be(b: Uint8Array, o: number): number {
  return (b[o] << 8) | b[o + 1];
}
function u32le(b: Uint8Array, o: number): number {
  return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
}
function synchsafe(b: Uint8Array, o: number): number {
  return ((b[o] & 0x7f) << 21) | ((b[o + 1] & 0x7f) << 14) | ((b[o + 2] & 0x7f) << 7) | (b[o + 3] & 0x7f);
}

function latin1(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return s;
}

function utf8(b: Uint8Array): string {
  let s = '';
  let i = 0;
  while (i < b.length) {
    const c = b[i++];
    let cp: number;
    if (c < 0x80) cp = c;
    else if (c >= 0xc0 && c < 0xe0) cp = ((c & 0x1f) << 6) | (b[i++] & 0x3f);
    else if (c >= 0xe0 && c < 0xf0) cp = ((c & 0x0f) << 12) | ((b[i++] & 0x3f) << 6) | (b[i++] & 0x3f);
    else if (c >= 0xf0) {
      cp = ((c & 0x07) << 18) | ((b[i++] & 0x3f) << 12) | ((b[i++] & 0x3f) << 6) | (b[i++] & 0x3f);
    } else cp = 0xfffd;
    s += String.fromCodePoint(cp);
  }
  return s;
}

function utf16(b: Uint8Array, littleEndianDefault: boolean): string {
  let le = littleEndianDefault;
  let i = 0;
  if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe) (le = true), (i = 2);
  else if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) (le = false), (i = 2);
  const units: number[] = [];
  for (; i + 1 < b.length; i += 2) units.push(le ? b[i] | (b[i + 1] << 8) : (b[i] << 8) | b[i + 1]);
  let s = '';
  for (let j = 0; j < units.length; j += 4096) s += String.fromCharCode(...units.slice(j, j + 4096));
  return s;
}

function clean(s: string | undefined): string | undefined {
  if (s === undefined) return undefined;
  const parts = s.split('\u0000').map((p) => p.trim()).filter(Boolean);
  return parts.length ? parts.join(', ') : undefined;
}

function parseTrackNo(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const n = parseInt(s, 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

// ---------------------------------------------------------------- ID3v2

async function readId3v2(src: ByteSource): Promise<{ tags: AudioTags; end: number }> {
  const h = await src.read(0, 10);
  const major = h[3];
  const flags = h[5];
  const size = synchsafe(h, 6);
  const end = 10 + size + (major === 4 && flags & 0x10 ? 10 : 0);
  if (size > MAX_TAG_BYTES || major < 2 || major > 4) return { tags: {}, end };

  let body = await src.read(10, size);
  if (major < 4 && flags & 0x80) body = deunsync(body);

  let pos = 0;
  if (flags & 0x40 && major >= 3) {
    pos = major === 4 ? synchsafe(body, 0) : u32be(body, 0) + 4;
  }

  const text: Record<string, string> = {};
  const pictures: (Picture & { type: number })[] = [];
  const idLen = major === 2 ? 3 : 4;
  const hdrLen = major === 2 ? 6 : 10;

  while (pos + hdrLen <= body.length) {
    const id = ascii(body, pos, pos + idLen);
    if (!/^[A-Z0-9]+$/.test(id)) break; // padding
    const fsize =
      major === 2 ? u24be(body, pos + 3) : major === 4 ? synchsafe(body, pos + 4) : u32be(body, pos + 4);
    const fflags = major === 2 ? 0 : u16be(body, pos + 8);
    let data = body.subarray(pos + hdrLen, pos + hdrLen + fsize);
    pos += hdrLen + fsize;
    if (fsize <= 0) continue;

    if (major === 3) {
      if (fflags & 0x00c0) continue; // compressed or encrypted
      if (fflags & 0x0020) data = data.subarray(1); // grouping id
    } else if (major === 4) {
      if (fflags & 0x000c) continue; // compressed or encrypted
      if (fflags & 0x0040) data = data.subarray(1); // grouping id
      if (fflags & 0x0001) data = data.subarray(4); // data length indicator
      if (fflags & 0x0002) data = deunsync(data);
    }

    if (id[0] === 'T' && id !== 'TXXX' && id !== 'TXX') {
      text[id] = decodeText(data[0], data.subarray(1));
    } else if (id === 'APIC' || id === 'PIC') {
      const pic = parsePicture(id, data);
      if (pic) pictures.push(pic);
    }
  }

  const pick = (v23: string, v22: string) => clean(text[v23] ?? text[v22]);
  const front = pictures.find((p) => p.type === 3) ?? pictures[0];
  const tlen = parseInt(text.TLEN ?? text.TLE ?? '', 10);

  return {
    end,
    tags: {
      title: pick('TIT2', 'TT2'),
      artist: pick('TPE1', 'TP1'),
      album: pick('TALB', 'TAL'),
      genre: parseGenre(text.TCON ?? text.TCO),
      albumArtist: pick('TPE2', 'TP2'),
      trackNo: parseTrackNo(text.TRCK ?? text.TRK),
      durationMs: Number.isFinite(tlen) && tlen > 0 ? tlen : undefined,
      picture: front ? { mime: front.mime, data: front.data } : undefined,
    },
  };
}

function deunsync(b: Uint8Array): Uint8Array {
  const out = new Uint8Array(b.length);
  let j = 0;
  for (let i = 0; i < b.length; i++) {
    out[j++] = b[i];
    if (b[i] === 0xff && b[i + 1] === 0x00) i++;
  }
  return out.subarray(0, j);
}

function decodeText(enc: number, b: Uint8Array): string {
  switch (enc) {
    case 1:
      return utf16(b, true);
    case 2:
      return utf16(b, false);
    case 3:
      return utf8(b);
    default:
      return latin1(b);
  }
}

/** Index just past a NUL terminator for the given ID3 text encoding. */
function skipTerminated(b: Uint8Array, start: number, enc: number): number {
  if (enc === 1 || enc === 2) {
    for (let i = start; i + 1 < b.length; i += 2) if (b[i] === 0 && b[i + 1] === 0) return i + 2;
  } else {
    for (let i = start; i < b.length; i++) if (b[i] === 0) return i + 1;
  }
  return b.length;
}

function parsePicture(id: string, d: Uint8Array): (Picture & { type: number }) | undefined {
  const enc = d[0];
  let mime: string;
  let p: number;
  if (id === 'PIC') {
    const fmt = ascii(d, 1, 4).toUpperCase();
    mime = fmt === 'PNG' ? 'image/png' : 'image/jpeg';
    p = 4;
  } else {
    const mimeEnd = skipTerminated(d, 1, 0);
    mime = latin1(d.subarray(1, mimeEnd - 1)).toLowerCase() || 'image/jpeg';
    if (!mime.includes('/')) mime = `image/${mime === 'jpg' ? 'jpeg' : mime}`;
    p = mimeEnd;
  }
  const type = d[p];
  p = skipTerminated(d, p + 1, enc);
  const data = d.subarray(p);
  return data.length ? { mime, data, type } : undefined;
}

// ---------------------------------------------------------------- ID3v1

async function readId3v1(src: ByteSource): Promise<AudioTags> {
  if (src.size < 128) return {};
  const b = await src.read(src.size - 128, 128);
  if (ascii(b, 0, 3) !== 'TAG') return {};
  const field = (s: number, n: number) => clean(latin1(b.subarray(s, s + n)));
  return {
    title: field(3, 30),
    artist: field(33, 30),
    album: field(63, 30),
    trackNo: b[125] === 0 && b[126] > 0 ? b[126] : undefined,
    genre: ID3V1_GENRES[b[127]],
  };
}

// ---------------------------------------------------------------- MP3 duration

const BITRATES: Record<string, number[]> = {
  '1-1': [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  '1-2': [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  '1-3': [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  '2-1': [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
  '2-2': [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
  '2-3': [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const SAMPLE_RATES: Record<number, number[]> = {
  3: [44100, 48000, 32000], // MPEG 1
  2: [22050, 24000, 16000], // MPEG 2
  0: [11025, 12000, 8000], // MPEG 2.5
};

async function readMp3Duration(src: ByteSource, audioStart: number): Promise<AudioTags> {
  const buf = await src.read(audioStart, 64 * 1024);
  for (let i = 0; i + 4 <= buf.length; i++) {
    if (buf[i] !== 0xff || (buf[i + 1] & 0xe0) !== 0xe0) continue;
    const verBits = (buf[i + 1] >> 3) & 3;
    const layerBits = (buf[i + 1] >> 1) & 3;
    const brIdx = buf[i + 2] >> 4;
    const srIdx = (buf[i + 2] >> 2) & 3;
    if (verBits === 1 || layerBits === 0 || brIdx === 0 || brIdx === 15 || srIdx === 3) continue;

    const layer = 4 - layerBits;
    const v1 = verBits === 3;
    const sampleRate = SAMPLE_RATES[verBits][srIdx];
    const bitrate = BITRATES[`${v1 ? 1 : 2}-${layer}`][brIdx] * 1000;
    const samplesPerFrame = layer === 1 ? 384 : layer === 2 || v1 ? 1152 : 576;
    const mono = buf[i + 3] >> 6 === 3;

    const sideInfo = v1 ? (mono ? 17 : 32) : mono ? 9 : 17;
    const x = i + 4 + sideInfo;
    const tag = ascii(buf, x, x + 4);
    if ((tag === 'Xing' || tag === 'Info') && u32be(buf, x + 4) & 1) {
      const frames = u32be(buf, x + 8);
      if (frames > 0) return { durationMs: Math.round((frames * samplesPerFrame * 1000) / sampleRate) };
    }
    if (ascii(buf, i + 36, i + 40) === 'VBRI') {
      const frames = u32be(buf, i + 36 + 14);
      if (frames > 0) return { durationMs: Math.round((frames * samplesPerFrame * 1000) / sampleRate) };
    }
    const audioBytes = src.size - (audioStart + i);
    return audioBytes > 0 ? { durationMs: Math.round((audioBytes * 8 * 1000) / bitrate) } : {};
  }
  return {};
}

// ---------------------------------------------------------------- FLAC

async function readFlac(src: ByteSource, start: number): Promise<AudioTags> {
  const out: AudioTags = {};
  const comments: Record<string, string> = {};
  let pos = start + 4;
  for (let guard = 0; guard < 128 && pos + 4 <= src.size; guard++) {
    const h = await src.read(pos, 4);
    const last = (h[0] & 0x80) !== 0;
    const type = h[0] & 0x7f;
    const len = u24be(h, 1);
    const bodyAt = pos + 4;
    pos = bodyAt + len;

    if (type === 0) {
      const b = await src.read(bodyAt, len);
      const sampleRate = (b[10] << 12) | (b[11] << 4) | (b[12] >> 4);
      const total = (b[13] & 0x0f) * 2 ** 32 + u32be(b, 14);
      if (sampleRate > 0 && total > 0) out.durationMs = Math.round((total * 1000) / sampleRate);
    } else if (type === 4) {
      const b = await src.read(bodyAt, len);
      let p = 4 + u32le(b, 0);
      const count = u32le(b, p);
      p += 4;
      for (let k = 0; k < count && p + 4 <= b.length; k++) {
        const l = u32le(b, p);
        const entry = utf8(b.subarray(p + 4, p + 4 + l));
        p += 4 + l;
        const eq = entry.indexOf('=');
        if (eq > 0) {
          const key = entry.slice(0, eq).toUpperCase();
          if (!(key in comments)) comments[key] = entry.slice(eq + 1);
        }
      }
    } else if (type === 6 && !out.picture && len <= MAX_TAG_BYTES) {
      const b = await src.read(bodyAt, len);
      const picType = u32be(b, 0);
      const mimeLen = u32be(b, 4);
      const mime = latin1(b.subarray(8, 8 + mimeLen)) || 'image/jpeg';
      let p = 8 + mimeLen;
      p += 4 + u32be(b, p); // description
      p += 16; // width, height, depth, colors
      const dataLen = u32be(b, p);
      const data = b.subarray(p + 4, p + 4 + dataLen);
      if (data.length && (picType === 3 || !out.picture)) out.picture = { mime, data };
    }
    if (last) break;
  }
  out.title = clean(comments.TITLE);
  out.artist = clean(comments.ARTIST);
  out.album = clean(comments.ALBUM);
  out.albumArtist = clean(comments.ALBUMARTIST ?? comments['ALBUM ARTIST']);
  out.trackNo = parseTrackNo(comments.TRACKNUMBER);
  out.genre = parseGenre(comments.GENRE);
  return out;
}

// ---------------------------------------------------------------- MP4 / M4A

interface Atom {
  type: string;
  start: number; // offset of the atom's payload
  end: number;
}

function* atoms(b: Uint8Array, from: number, to: number): Generator<Atom> {
  let p = from;
  while (p + 8 <= to) {
    let size = u32be(b, p);
    const type = latin1(b.subarray(p + 4, p + 8));
    let header = 8;
    if (size === 1) {
      size = u32be(b, p + 8) * 2 ** 32 + u32be(b, p + 12);
      header = 16;
    } else if (size === 0) size = to - p;
    if (size < header) return;
    yield { type, start: p + header, end: Math.min(p + size, to) };
    p += size;
  }
}

function child(b: Uint8Array, parent: Atom, type: string, skip = 0): Atom | undefined {
  for (const a of atoms(b, parent.start + skip, parent.end)) if (a.type === type) return a;
  return undefined;
}

async function readMp4(src: ByteSource): Promise<AudioTags> {
  // Walk top-level atoms by reading headers only, then load `moov` whole.
  let pos = 0;
  let moov: Uint8Array | undefined;
  while (pos + 8 <= src.size) {
    const h = await src.read(pos, 16);
    let size = u32be(h, 0);
    const type = ascii(h, 4, 8);
    if (size === 1) size = u32be(h, 8) * 2 ** 32 + u32be(h, 12);
    else if (size === 0) size = src.size - pos;
    if (size < 8) break;
    if (type === 'moov') {
      if (size > MAX_TAG_BYTES) return {};
      moov = await src.read(pos, size);
      break;
    }
    pos += size;
  }
  if (!moov) return {};

  const root: Atom = { type: 'moov', start: 8, end: moov.length };
  const out: AudioTags = {};

  const mvhd = child(moov, root, 'mvhd');
  if (mvhd) {
    const v = moov[mvhd.start];
    const ts = v === 1 ? u32be(moov, mvhd.start + 20) : u32be(moov, mvhd.start + 12);
    const dur =
      v === 1
        ? u32be(moov, mvhd.start + 24) * 2 ** 32 + u32be(moov, mvhd.start + 28)
        : u32be(moov, mvhd.start + 16);
    if (ts > 0 && dur > 0) out.durationMs = Math.round((dur * 1000) / ts);
  }

  const udta = child(moov, root, 'udta');
  if (!udta) return out;
  const meta = child(moov, udta, 'meta');
  if (!meta) return out;
  // `meta` is a full box (4 bytes version/flags) in ISO files, but not in some QuickTime files.
  const metaSkip = latin1(moov.subarray(meta.start + 4, meta.start + 8)) === 'hdlr' ? 0 : 4;
  const ilst = child(moov, meta, 'ilst', metaSkip);
  if (!ilst) return out;

  for (const item of atoms(moov, ilst.start, ilst.end)) {
    const data = child(moov, item, 'data');
    if (!data) continue;
    const kind = u32be(moov, data.start) & 0xffffff;
    const value = moov.subarray(data.start + 8, data.end);
    switch (item.type) {
      case '©nam':
        out.title = clean(utf8(value));
        break;
      case '©ART':
        out.artist = clean(utf8(value));
        break;
      case '©alb':
        out.album = clean(utf8(value));
        break;
      case 'aART':
        out.albumArtist = clean(utf8(value));
        break;
      case '©gen':
        out.genre = parseGenre(utf8(value));
        break;
      case 'gnre':
        // Legacy MP4 genre: ID3v1 index + 1.
        if (!out.genre && value.length >= 2) out.genre = ID3V1_GENRES[u16be(value, 0) - 1];
        break;
      case 'trkn':
        if (value.length >= 4 && u16be(value, 2) > 0) out.trackNo = u16be(value, 2);
        break;
      case 'covr':
        if (!out.picture && value.length) {
          out.picture = { mime: kind === 14 ? 'image/png' : 'image/jpeg', data: value };
        }
        break;
    }
  }
  return out;
}

// ---------------------------------------------------------------- genres

/** ID3v1 genre codes 0–125 (the original 80 plus the Winamp extensions). */
export const ID3V1_GENRES: string[] = [
  'Blues', 'Classic Rock', 'Country', 'Dance', 'Disco', 'Funk', 'Grunge', 'Hip-Hop', 'Jazz', 'Metal',
  'New Age', 'Oldies', 'Other', 'Pop', 'R&B', 'Rap', 'Reggae', 'Rock', 'Techno', 'Industrial',
  'Alternative', 'Ska', 'Death Metal', 'Pranks', 'Soundtrack', 'Euro-Techno', 'Ambient', 'Trip-Hop', 'Vocal', 'Jazz+Funk',
  'Fusion', 'Trance', 'Classical', 'Instrumental', 'Acid', 'House', 'Game', 'Sound Clip', 'Gospel', 'Noise',
  'Alternative Rock', 'Bass', 'Soul', 'Punk', 'Space', 'Meditative', 'Instrumental Pop', 'Instrumental Rock', 'Ethnic', 'Gothic',
  'Darkwave', 'Techno-Industrial', 'Electronic', 'Pop-Folk', 'Eurodance', 'Dream', 'Southern Rock', 'Comedy', 'Cult', 'Gangsta',
  'Top 40', 'Christian Rap', 'Pop/Funk', 'Jungle', 'Native American', 'Cabaret', 'New Wave', 'Psychedelic', 'Rave', 'Showtunes',
  'Trailer', 'Lo-Fi', 'Tribal', 'Acid Punk', 'Acid Jazz', 'Polka', 'Retro', 'Musical', 'Rock & Roll', 'Hard Rock',
  'Folk', 'Folk-Rock', 'National Folk', 'Swing', 'Fast Fusion', 'Bebop', 'Latin', 'Revival', 'Celtic', 'Bluegrass',
  'Avantgarde', 'Gothic Rock', 'Progressive Rock', 'Psychedelic Rock', 'Symphonic Rock', 'Slow Rock', 'Big Band', 'Chorus', 'Easy Listening', 'Acoustic',
  'Humour', 'Speech', 'Chanson', 'Opera', 'Chamber Music', 'Sonata', 'Symphony', 'Booty Bass', 'Primus', 'Porn Groove',
  'Satire', 'Slow Jam', 'Club', 'Tango', 'Samba', 'Folklore', 'Ballad', 'Power Ballad', 'Rhythmic Soul', 'Freestyle',
  'Duet', 'Punk Rock', 'Drum Solo', 'A Cappella', 'Euro-House', 'Dance Hall',
];

// ASCII-only on purpose: avoids relying on Unicode property escapes in the JS engine.
const titleCase = (s: string) => s.replace(/(^|[\s\-&/])([a-z])/g, (_, sep: string, c: string) => sep + c.toUpperCase());

/**
 * Normalise a raw genre tag: "(17)", "(8)Jazz", "17", "rock; pop", NUL-separated lists
 * → "Rock", "Jazz", "Rock", "Rock, Pop". Returns undefined when nothing is left.
 */
export function parseGenre(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  const out: string[] = [];
  for (let part of raw.split(/[;\u0000]|\s*,\s*/)) {
    part = part.trim();
    // "(13)(17)" → two references; "(8)Jazz" → text wins.
    const refs = [...part.matchAll(/\((\d+|RX|CR)\)/g)].map((m) => m[1]);
    const rest = part.replace(/\((\d+|RX|CR)\)/g, '').trim();
    const names = rest
      ? [rest]
      : refs.map((r) => (r === 'RX' ? 'Remix' : r === 'CR' ? 'Cover' : ID3V1_GENRES[Number(r)]));
    if (!rest && !refs.length && /^\d+$/.test(part)) names.push(ID3V1_GENRES[Number(part)]);
    for (const n of names) {
      if (!n || /^\d+$/.test(n)) continue;
      const name = n === n.toLowerCase() ? titleCase(n) : n;
      if (!out.some((o) => o.toLowerCase() === name.toLowerCase())) out.push(name);
    }
  }
  return out.length ? out.join(', ') : undefined;
}

// ---------------------------------------------------------------- file name fallback

/** Bracketed clutter common in file names: "(Official Video)", "[Audio]", "(Lyrics)"… */
const NOISE =
  /\s*[([](?:official\s+)?(?:music\s+|lyric\s+)?(?:video|audio|visualizer|lyrics?)(?:\s+video)?[)\]]/gi;

/** "01 - Artist - Title.mp3" → { artist, title }. Used when tags are missing. */
export function tagsFromFileName(fileName: string): Pick<AudioTags, 'title' | 'artist' | 'trackNo'> {
  let base = fileName
    .replace(/\.[^./\\]+$/, '')
    .replace(/_/g, ' ')
    .replace(NOISE, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  let trackNo: number | undefined;
  const num = /^(\d{1,3})\s*[-.)]?\s+(.*)$/.exec(base);
  if (num) {
    trackNo = parseInt(num[1], 10) || undefined;
    base = num[2];
  }
  const parts = base.split(/\s+-\s+/);
  if (parts.length >= 2) {
    return { artist: parts[0].trim(), title: parts.slice(1).join(' - ').trim(), trackNo };
  }
  return { title: base || fileName, trackNo };
}
