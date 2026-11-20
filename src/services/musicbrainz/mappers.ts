/** Raw MusicBrainz JSON → app types. Tolerant of missing fields. */
import type {
  MbArtist,
  MbArtistDetail,
  MbArtistRef,
  MbLink,
  MbRecording,
  MbReleaseGroup,
  MbTrack,
} from './types';

// ---------------------------------------------------------------- raw shapes (subset)

interface RawCredit {
  name?: string;
  joinphrase?: string;
  artist?: { id: string; name: string };
}
interface RawTag {
  name: string;
  count?: number;
}
export interface RawArtist {
  id: string;
  name: string;
  disambiguation?: string;
  type?: string | null;
  country?: string | null;
  tags?: RawTag[];
  'life-span'?: { begin?: string | null; end?: string | null; ended?: boolean | null };
  relations?: RawRelation[];
}
interface RawRelation {
  type: string;
  'target-type': string;
  direction?: string;
  artist?: { id: string; name: string };
  url?: { resource: string };
}
export interface RawReleaseGroup {
  id: string;
  title: string;
  'primary-type'?: string | null;
  'secondary-types'?: string[];
  'first-release-date'?: string;
  'artist-credit'?: RawCredit[];
  releases?: RawRelease[];
}
export interface RawRecording {
  id: string;
  title: string;
  length?: number | null;
  'artist-credit'?: RawCredit[];
  releases?: { id: string; title: string; status?: string; 'release-group'?: RawReleaseGroup }[];
}
export interface RawRelease {
  id: string;
  title: string;
  status?: string | null;
  date?: string;
  'release-group'?: RawReleaseGroup;
  media?: {
    position?: number;
    tracks?: {
      number?: string;
      position?: number;
      title: string;
      length?: number | null;
      recording?: { id: string; title: string; length?: number | null };
      'artist-credit'?: RawCredit[];
    }[];
  }[];
}

// ---------------------------------------------------------------- helpers

export function creditString(credits: RawCredit[] | undefined): string {
  if (!credits?.length) return '';
  return credits.map((c) => `${c.name ?? c.artist?.name ?? ''}${c.joinphrase ?? ''}`).join('').trim();
}

function creditArtists(credits: RawCredit[] | undefined): MbArtistRef[] {
  return (credits ?? []).filter((c) => c.artist).map((c) => ({ id: c.artist!.id, name: c.artist!.name }));
}

function sortedTags(tags: RawTag[] | undefined): string[] {
  return [...(tags ?? [])].sort((a, b) => (b.count ?? 0) - (a.count ?? 0)).map((t) => t.name);
}

const opt = <T,>(v: T | null | undefined): T | undefined => (v == null || v === '' ? undefined : v);

// ---------------------------------------------------------------- mappers

export function mapArtist(a: RawArtist): MbArtist {
  return {
    id: a.id,
    name: a.name,
    disambiguation: opt(a.disambiguation),
    type: opt(a.type),
    country: opt(a.country),
    tags: sortedTags(a.tags),
  };
}

/** Relationship types that make sense as "related artists". */
const RELATED_TYPES = new Set(['member of band', 'collaboration', 'is person', 'supporting musician', 'tribute', 'teacher', 'married', 'sibling', 'parent']);
/** Link types worth showing, in display order. */
const LINK_TYPES = ['official homepage', 'bandcamp', 'purchase for download', 'free streaming', 'streaming', 'wikidata', 'allmusic', 'discogs', 'last.fm'];

export function mapArtistDetail(a: RawArtist): MbArtistDetail {
  const related = new Map<string, MbArtistRef & { relation: string }>();
  const links: MbLink[] = [];
  for (const r of a.relations ?? []) {
    if (r['target-type'] === 'artist' && r.artist && RELATED_TYPES.has(r.type) && !related.has(r.artist.id)) {
      related.set(r.artist.id, { id: r.artist.id, name: r.artist.name, relation: r.type });
    } else if (r['target-type'] === 'url' && r.url && LINK_TYPES.includes(r.type)) {
      if (!links.some((l) => l.url === r.url!.resource)) links.push({ type: r.type, url: r.url.resource });
    }
  }
  links.sort((x, y) => LINK_TYPES.indexOf(x.type) - LINK_TYPES.indexOf(y.type));
  const ls = a['life-span'];
  return {
    ...mapArtist(a),
    lifeSpan: ls ? { begin: opt(ls.begin), end: opt(ls.end), ended: ls.ended ?? undefined } : undefined,
    related: [...related.values()],
    links,
  };
}

export function mapReleaseGroup(rg: RawReleaseGroup): MbReleaseGroup {
  return {
    id: rg.id,
    title: rg.title,
    primaryType: opt(rg['primary-type']),
    secondaryTypes: rg['secondary-types'] ?? [],
    firstReleaseDate: opt(rg['first-release-date']),
    artistCredit: creditString(rg['artist-credit']),
    artists: creditArtists(rg['artist-credit']),
  };
}

export function mapRecording(r: RawRecording): MbRecording {
  // Prefer an official release on a non-compilation album for the "from" line.
  const releases = r.releases ?? [];
  const best =
    releases.find((x) => x.status === 'Official' && !(x['release-group']?.['secondary-types'] ?? []).length) ??
    releases.find((x) => x.status === 'Official') ??
    releases[0];
  const rg = best?.['release-group'];
  return {
    id: r.id,
    title: r.title,
    lengthMs: opt(r.length),
    artistCredit: creditString(r['artist-credit']),
    artists: creditArtists(r['artist-credit']),
    releaseGroup: rg ? { id: rg.id, title: rg.title } : undefined,
  };
}

/** Pick the release whose tracklist represents a release group: earliest official one. */
export function pickRelease(releases: RawRelease[] | undefined): RawRelease | undefined {
  const list = [...(releases ?? [])];
  const byDate = (a: RawRelease, b: RawRelease) => (a.date || '9999').localeCompare(b.date || '9999');
  return list.filter((r) => r.status === 'Official').sort(byDate)[0] ?? list.sort(byDate)[0];
}

export function mapTracks(release: RawRelease): MbTrack[] {
  const media = release.media ?? [];
  const multiDisc = media.length > 1;
  return media.flatMap((m, mi) =>
    (m.tracks ?? [])
      .filter((t) => t.recording)
      .map((t) => ({
        position: `${multiDisc ? `${m.position ?? mi + 1}-` : ''}${t.number ?? t.position ?? ''}`,
        title: t.title,
        lengthMs: opt(t.length ?? t.recording!.length),
        recordingId: t.recording!.id,
        artistCredit: creditString(t['artist-credit']),
      })),
  );
}

/** Year from a partial date ("1959", "1959-08", "1959-08-17"). */
export function yearOf(date: string | undefined): string | undefined {
  return date && /^\d{4}/.test(date) ? date.slice(0, 4) : undefined;
}
