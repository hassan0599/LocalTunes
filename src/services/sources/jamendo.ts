/**
 * Jamendo source (spec 6.4): independent music under Creative Commons licenses.
 *
 * Needs a free client id from https://devportal.jamendo.com, provided at build time as
 * EXPO_PUBLIC_JAMENDO_CLIENT_ID (e.g. in .env.local, which is gitignored). Without it the
 * source is disabled.
 *
 * Field names follow the Jamendo API v3.0 docs (`tracks` endpoint). Not yet verified
 * against the live API: do that once a client id exists.
 */
import { JAMENDO_CLIENT_ID } from '@/config';

import { isOpenLicense } from './license';
import type { MusicSource, SourceTrack } from './types';

const API = 'https://api.jamendo.com/v3.0/tracks/';

export interface JamendoTrack {
  id: string;
  name: string;
  duration?: number;
  artist_name?: string;
  album_name?: string;
  album_id?: string;
  position?: number;
  license_ccurl?: string;
  image?: string;
  album_image?: string;
  audiodownload?: string;
  audiodownload_allowed?: boolean;
}

export function mapJamendoTrack(t: JamendoTrack): SourceTrack | null {
  // Only tracks the artist allows downloading, with a CC license on record.
  if (!t.audiodownload || t.audiodownload_allowed === false || !isOpenLicense(t.license_ccurl)) return null;
  return {
    source: 'jamendo',
    sourceId: String(t.id),
    title: t.name,
    artist: t.artist_name,
    album: t.album_name,
    trackNo: t.position || undefined,
    durationMs: t.duration ? t.duration * 1000 : undefined,
    license: t.license_ccurl!,
    artworkUrl: t.album_image || t.image,
    groupId: t.album_id ? `jamendo-album-${t.album_id}` : undefined,
    groupTitle: t.album_name,
  };
}

/** Kept per track so resolve() can return the direct download URL. */
const downloadUrls = new Map<string, string>();

export const jamendo: MusicSource = {
  id: 'jamendo',
  name: 'Jamendo',
  enabled: !!JAMENDO_CLIENT_ID,

  async search(q) {
    if (!JAMENDO_CLIENT_ID) return [];
    const params = new URLSearchParams({
      client_id: JAMENDO_CLIENT_ID,
      format: 'json',
      limit: '25',
      audiodlformat: 'mp32',
      include: 'licenses',
    });
    if (q.artist) params.set('artist_name', q.artist);
    if (q.album && q.title) params.set('album_name', q.title);
    else if (q.title) params.set('namesearch', q.title);
    if (q.text) params.set('search', q.text);
    const res = await fetch(`${API}?${params.toString()}`);
    if (!res.ok) throw new Error(`Jamendo responded ${res.status}`);
    const body = (await res.json()) as { results?: JamendoTrack[] };
    return (body.results ?? []).flatMap((t) => {
      const mapped = mapJamendoTrack(t);
      if (mapped) downloadUrls.set(mapped.sourceId, t.audiodownload!);
      return mapped ? [mapped] : [];
    });
  },

  async resolve(track) {
    const url = downloadUrls.get(track.sourceId);
    if (!url) throw new Error('Search again: Jamendo download link expired');
    return { url, license: track.license, ext: 'mp3' };
  },
};
