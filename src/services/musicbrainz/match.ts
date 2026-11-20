/**
 * "In your library" matching (spec 6.3): MBID first, then normalized artist + title.
 * Pure and unit-tested; `useLibraryMatcher` builds one from the tracks table.
 */
import type { Track } from '@/db/queries';

import type { MbArtistRef, MbRecording, MbReleaseGroup } from './types';

const BRACKETS = /\s*[([{]([^)\]}]*)[)\]}]/g;
/** Bracketed text naming a different recording ("(Live)", "[DJ Remix]") is kept; the rest is noise. */
const VERSION_WORDS =
  /\b(remix|mix|live|acoustic|instrumental|demo|cover|karaoke|vip|rework|flip|bootleg|unplugged|reprise|dub|version|session|edit)\b/i;
const FEAT = /\s+(feat\.?|ft\.?|featuring|with)\s+.*$/i;
// ASCII + typographic punctuation (kept explicit so non-Latin letters survive).
const PUNCT = /[!"#$%'()*+,\-./:;<=>?@[\\\]^_`{|}~‘’“”–—…]/g;

/** "Blue in Green (Remastered 2009) [feat. X]" → "blue in green". */
export function normalize(s: string | null | undefined): string {
  if (!s) return '';
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(BRACKETS, (_, inner: string) => (VERSION_WORDS.test(inner) && !/remaster/.test(inner) ? ` ${inner} ` : ' '))
    .replace(FEAT, '')
    .replace(/&/g, ' and ')
    .replace(PUNCT, ' ')
    .replace(/^the\s+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** "The Kid LAROI, Justin Bieber" → ["kid laroi", "justin bieber"] (plus the whole string). */
export function artistKeys(artist: string | null | undefined): string[] {
  if (!artist) return [];
  const parts = artist.split(/\s*(?:,|;|\/|&| x | and | feat\.? | ft\.? | featuring )\s*/i);
  return [...new Set([normalize(artist), ...parts.map(normalize)].filter(Boolean))];
}

type MatchTrack = Pick<Track, 'id' | 'title' | 'artist' | 'album' | 'album_artist' | 'mbid'>;

export class LibraryMatcher<T extends MatchTrack = Track> {
  private byMbid = new Map<string, T>();
  private byArtistTitle = new Map<string, T>();
  private albums = new Set<string>();
  private artists = new Set<string>();

  constructor(tracks: T[]) {
    for (const t of tracks) {
      if (t.mbid) this.byMbid.set(t.mbid, t);
      const title = normalize(t.title);
      for (const a of artistKeys(t.artist)) {
        this.artists.add(a);
        if (title && !this.byArtistTitle.has(`${a}|${title}`)) this.byArtistTitle.set(`${a}|${title}`, t);
      }
      const album = normalize(t.album);
      if (album) for (const a of artistKeys(t.album_artist ?? t.artist)) this.albums.add(`${a}|${album}`);
    }
  }

  private names(credit: string, artists: MbArtistRef[]): string[] {
    return [...new Set([...artistKeys(credit), ...artists.flatMap((a) => artistKeys(a.name))])];
  }

  matchRecording(r: Pick<MbRecording, 'id' | 'title' | 'artistCredit' | 'artists'>): T | undefined {
    const byId = this.byMbid.get(r.id);
    if (byId) return byId;
    const title = normalize(r.title);
    for (const a of this.names(r.artistCredit, r.artists)) {
      const t = this.byArtistTitle.get(`${a}|${title}`);
      if (t) return t;
    }
    return undefined;
  }

  hasReleaseGroup(rg: Pick<MbReleaseGroup, 'title' | 'artistCredit' | 'artists'>): boolean {
    const album = normalize(rg.title);
    return this.names(rg.artistCredit, rg.artists).some((a) => this.albums.has(`${a}|${album}`));
  }

  hasArtist(name: string): boolean {
    return artistKeys(name).some((a) => this.artists.has(a));
  }
}
