/**
 * Internet Archive source (spec 6.4): openly licensed music only.
 *
 * Search: advancedsearch restricted to audio in music collections whose `licenseurl`
 * is Creative Commons or public domain, most-downloaded first. Each matching item is
 * expanded via the metadata API into one entry per track, choosing a single file per
 * track (VBR MP3 preferred). Verified against the live API (fixtures in __tests__).
 */
import { MUSICBRAINZ_USER_AGENT } from '@/config';

import { isOpenLicense } from './license';
import type { MusicSource, SourceQuery, SourceTrack } from './types';

const SEARCH = 'https://archive.org/advancedsearch.php';
const METADATA = 'https://archive.org/metadata/';
const MUSIC_COLLECTIONS = '(netlabels OR etree OR audio_music OR opensource_audio)';
const ITEMS_TO_EXPAND = 3;

/** Preferred download formats, best first: small enough for phones, good quality. */
const FORMAT_PREFERENCE = ['VBR MP3', '256Kbps MP3', '320Kbps MP3', '192Kbps MP3', '128Kbps MP3', 'MP3', 'Ogg Vorbis', '64Kbps MP3', 'Flac'];

export interface IaDoc {
  identifier: string;
  title?: string;
  creator?: string | string[];
  licenseurl?: string;
  downloads?: number;
}

export interface IaFile {
  name: string;
  source?: string;
  format?: string;
  title?: string;
  creator?: string;
  artist?: string;
  album?: string;
  track?: string;
  length?: string;
  size?: string;
  original?: string;
  'external-identifier'?: string | string[];
}

export interface IaMetadata {
  metadata: { identifier: string; title?: string; creator?: string | string[]; licenseurl?: string; date?: string };
  files: IaFile[];
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Lucene-style escaping for archive.org queries. */
function esc(s: string): string {
  return s.replace(/([+\-&|!(){}[\]^"~*?:\\/])/g, '\\$1').trim();
}

export function buildIaQuery(q: SourceQuery): string {
  const parts = [`mediatype:audio`, `licenseurl:(*creativecommons.org*)`, `collection:${MUSIC_COLLECTIONS}`];
  if (q.title) parts.push(`title:(${esc(q.title)})`);
  if (q.artist) parts.push(`creator:(${esc(q.artist)})`);
  if (q.text) parts.push(`(${esc(q.text)})`);
  return parts.join(' AND ');
}

/** "02:48" or "168.78" → ms. */
export function parseLength(len: string | undefined): number | undefined {
  if (!len) return undefined;
  if (len.includes(':')) {
    const p = len.split(':').map(Number);
    if (p.some((n) => !Number.isFinite(n))) return undefined;
    return Math.round(p.reduce((acc, n) => acc * 60 + n, 0) * 1000);
  }
  const s = Number(len);
  return Number.isFinite(s) && s > 0 ? Math.round(s * 1000) : undefined;
}

function mbidOf(f: IaFile): string | undefined {
  const ids = Array.isArray(f['external-identifier']) ? f['external-identifier'] : f['external-identifier'] ? [f['external-identifier']] : [];
  return ids.map((x) => /^urn:mb_recording_id:(.+)$/.exec(x)?.[1]).find(Boolean);
}

function cleanTitle(title: string, track: number | undefined): string {
  // IA often prefixes the track number: "1 Ghosts I" → "Ghosts I".
  return track !== undefined ? title.replace(new RegExp(`^0*${track}[\\s.\\-_]+`), '') : title;
}

const AUDIO_FORMATS = new Set(FORMAT_PREFERENCE);

/** Expand item metadata into one track per song, picking the preferred file for each. */
export function tracksFromMetadata(meta: IaMetadata): SourceTrack[] {
  const license = meta.metadata.licenseurl;
  if (!isOpenLicense(license)) return [];
  const id = meta.metadata.identifier;
  const byName = new Map(meta.files.map((f) => [f.name, f]));
  const root = (f: IaFile): string => {
    let cur = f;
    for (let i = 0; i < 5 && cur.original && byName.has(cur.original); i++) cur = byName.get(cur.original)!;
    return cur.name;
  };

  // Group every audio file belonging to the same song. Titled files key by track + title
  // (an item can hold two "originals" of one song, e.g. FLAC and 320 kbps MP3); untitled
  // derivatives (often the OGG) join the group of the file they were made from.
  const audio = meta.files.filter((f) => f.format && AUDIO_FORMATS.has(f.format));
  const titledKey = (f: IaFile) => `${f.track ? parseInt(f.track, 10) : ''}|${f.title!.toLowerCase()}`;
  const keyByRoot = new Map<string, string>();
  for (const f of audio) if (f.title && !keyByRoot.has(root(f))) keyByRoot.set(root(f), titledKey(f));
  const groups = new Map<string, IaFile[]>();
  for (const f of audio) {
    const key = f.title ? titledKey(f) : (keyByRoot.get(root(f)) ?? `root:${root(f)}`);
    groups.set(key, [...(groups.get(key) ?? []), f]);
  }

  const artwork = meta.files.find((f) => f.format === 'JPEG' && /cover|front|folder/i.test(f.name))?.name;
  const out: SourceTrack[] = [];
  for (const files of groups.values()) {
    const best = [...files].sort((a, b) => FORMAT_PREFERENCE.indexOf(a.format!) - FORMAT_PREFERENCE.indexOf(b.format!))[0];
    const withMeta = files.find((f) => f.title) ?? best;
    const trackNo = withMeta.track ? parseInt(withMeta.track, 10) || undefined : undefined;
    const rawTitle = withMeta.title ?? best.name.replace(/\.[^.]+$/, '').replace(/_/g, ' ');
    out.push({
      source: 'internet_archive',
      sourceId: `${id}/${best.name}`,
      title: cleanTitle(rawTitle, trackNo),
      artist: withMeta.artist ?? withMeta.creator ?? first(meta.metadata.creator),
      album: withMeta.album ?? meta.metadata.title,
      trackNo,
      durationMs: parseLength(files.map((f) => f.length).find(Boolean)),
      sizeBytes: best.size ? Number(best.size) : undefined,
      license: license!,
      artworkUrl: artwork ? fileUrl(id, artwork) : `https://archive.org/services/img/${id}`,
      mbid: files.map(mbidOf).find(Boolean),
      groupId: id,
      groupTitle: meta.metadata.title,
    });
  }
  return out.sort((a, b) => (a.trackNo ?? 999) - (b.trackNo ?? 999) || a.title.localeCompare(b.title));
}

export function fileUrl(identifier: string, name: string): string {
  return `https://archive.org/download/${encodeURIComponent(identifier)}/${name.split('/').map(encodeURIComponent).join('/')}`;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { 'User-Agent': MUSICBRAINZ_USER_AGENT, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Internet Archive responded ${res.status}`);
  return (await res.json()) as T;
}

/** Loose title match used to narrow an album's tracks to the requested song. */
function sameSong(a: string, b: string): boolean {
  const n = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return n(a) === n(b) || n(a).includes(n(b)) || n(b).includes(n(a));
}

export const internetArchive: MusicSource = {
  id: 'internet_archive',
  name: 'Internet Archive',
  enabled: true,

  async search(q) {
    // A song title rarely matches an item (album) title, so for songs search by artist and filter tracks.
    const itemQuery: SourceQuery = q.title && !q.album ? { artist: q.artist, text: q.artist ? undefined : q.title } : q;
    const params = new URLSearchParams({ q: buildIaQuery(itemQuery), rows: '10', output: 'json' });
    for (const fl of ['identifier', 'title', 'creator', 'licenseurl', 'downloads']) params.append('fl[]', fl);
    params.append('sort[]', 'downloads desc');
    const res = await getJson<{ response: { docs: IaDoc[] } }>(`${SEARCH}?${params.toString()}`);
    const docs = res.response.docs.filter((d) => isOpenLicense(d.licenseurl)).slice(0, ITEMS_TO_EXPAND);
    const metas = await Promise.all(
      docs.map((d) => getJson<IaMetadata>(`${METADATA}${encodeURIComponent(d.identifier)}`).catch(() => null)),
    );
    const tracks = metas.flatMap((m) => (m ? tracksFromMetadata(m) : []));
    return q.title && !q.album ? tracks.filter((t) => sameSong(t.title, q.title!)) : tracks;
  },

  async resolve(track) {
    const [identifier, ...rest] = track.sourceId.split('/');
    const name = rest.join('/');
    return { url: fileUrl(identifier, name), license: track.license, ext: name.split('.').pop()?.toLowerCase() ?? 'mp3' };
  },
};
