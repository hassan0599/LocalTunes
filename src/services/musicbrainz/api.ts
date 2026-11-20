/**
 * Discover queries (spec 6.3): MusicBrainz client + mb_cache + mappers.
 * Every function returns `Cached<T>` so screens can show "saved results" when offline.
 */
import type { SQLiteDatabase } from 'expo-sqlite';

import { cachedFetch, TTL, type Cached } from './cache';
import { escapeLucene, mbClient } from './client';
import {
  mapArtist,
  mapArtistDetail,
  mapRecording,
  mapReleaseGroup,
  mapTracks,
  pickRelease,
  type RawArtist,
  type RawRecording,
  type RawRelease,
  type RawReleaseGroup,
} from './mappers';
import type { MbArtist, MbArtistDetail, MbPage, MbRecording, MbReleaseDetail, MbReleaseGroup } from './types';

export type SearchKind = 'artist' | 'release-group' | 'recording';

interface Ctx {
  db: SQLiteDatabase;
  online: boolean;
}

const PAGE = 25;

const cached = <T,>(ctx: Ctx, key: string, ttl: number, fetcher: () => Promise<T>) =>
  cachedFetch(ctx.db, key, ttl, fetcher, { online: ctx.online });

// ---------------------------------------------------------------- search

export function searchArtists(ctx: Ctx, query: string): Promise<Cached<MbPage<MbArtist>>> {
  const q = escapeLucene(query.trim());
  return cached(ctx, `search:artist:${q.toLowerCase()}`, TTL.search, async () => {
    const r = await mbClient.get<{ count: number; artists: RawArtist[] }>('artist', { query: q, limit: PAGE });
    return { count: r.count, items: r.artists.map(mapArtist) };
  });
}

export function searchReleaseGroups(ctx: Ctx, query: string): Promise<Cached<MbPage<MbReleaseGroup>>> {
  const q = escapeLucene(query.trim());
  return cached(ctx, `search:release-group:${q.toLowerCase()}`, TTL.search, async () => {
    const r = await mbClient.get<{ count: number; 'release-groups': RawReleaseGroup[] }>('release-group', {
      query: q,
      limit: PAGE,
    });
    return { count: r.count, items: r['release-groups'].map(mapReleaseGroup) };
  });
}

export function searchRecordings(ctx: Ctx, query: string): Promise<Cached<MbPage<MbRecording>>> {
  const q = escapeLucene(query.trim());
  return cached(ctx, `search:recording:${q.toLowerCase()}`, TTL.search, async () => {
    // Official releases only: avoids bootlegs and duplicate uploads dominating results.
    const r = await mbClient.get<{ count: number; recordings: RawRecording[] }>('recording', {
      query: `${q} AND status:official`,
      limit: PAGE,
    });
    return { count: r.count, items: r.recordings.map(mapRecording) };
  });
}

// ---------------------------------------------------------------- genres

/** Fixed list of popular tags for "Browse by genre" (spec 6.3 #1). */
export const GENRES = [
  'rock', 'pop', 'hip hop', 'electronic', 'jazz', 'classical', 'r&b', 'soul', 'funk', 'metal',
  'punk', 'indie', 'folk', 'country', 'blues', 'reggae', 'latin', 'ambient', 'house', 'k-pop',
];

export function releaseGroupsByTag(ctx: Ctx, tag: string): Promise<Cached<MbPage<MbReleaseGroup>>> {
  return cached(ctx, `tag:release-group:${tag}`, TTL.search, async () => {
    const r = await mbClient.get<{ count: number; 'release-groups': RawReleaseGroup[] }>('release-group', {
      query: `tag:"${escapeLucene(tag)}" AND primarytype:album AND status:official`,
      limit: PAGE,
    });
    return { count: r.count, items: r['release-groups'].map(mapReleaseGroup) };
  });
}

export function artistsByTag(ctx: Ctx, tag: string): Promise<Cached<MbPage<MbArtist>>> {
  return cached(ctx, `tag:artist:${tag}`, TTL.search, async () => {
    const r = await mbClient.get<{ count: number; artists: RawArtist[] }>('artist', {
      query: `tag:"${escapeLucene(tag)}"`,
      limit: PAGE,
    });
    return { count: r.count, items: r.artists.map(mapArtist) };
  });
}

// ---------------------------------------------------------------- artist page

export function getArtist(ctx: Ctx, mbid: string): Promise<Cached<MbArtistDetail>> {
  return cached(ctx, `artist:${mbid}`, TTL.entity, async () =>
    mapArtistDetail(await mbClient.get<RawArtist>(`artist/${mbid}`, { inc: 'tags+url-rels+artist-rels' })),
  );
}

/** Albums and EPs, oldest first (browse returns up to 100). */
export function getDiscography(ctx: Ctx, mbid: string): Promise<Cached<MbReleaseGroup[]>> {
  return cached(ctx, `discography:${mbid}`, TTL.entity, async () => {
    const r = await mbClient.get<{ 'release-groups': RawReleaseGroup[] }>('release-group', {
      artist: mbid,
      type: 'album|ep',
      limit: 100,
    });
    return r['release-groups']
      .map(mapReleaseGroup)
      .sort((a, b) => (a.firstReleaseDate || '9999').localeCompare(b.firstReleaseDate || '9999'));
  });
}

/**
 * Similar artists (spec 6.3 #3): artists sharing this artist's top tags, plus direct
 * relationships (bands, collaborations), minus the artist itself.
 */
export function getSimilarArtists(ctx: Ctx, artist: MbArtistDetail): Promise<Cached<MbArtist[]>> {
  const tags = artist.tags.slice(0, 2);
  return cached(ctx, `similar:${artist.id}`, TTL.entity, async () => {
    const byTag: MbArtist[] = [];
    if (tags.length) {
      const r = await mbClient.get<{ artists: RawArtist[] }>('artist', {
        query: tags.map((t) => `tag:"${escapeLucene(t)}"`).join(' AND '),
        limit: 20,
      });
      byTag.push(...r.artists.map(mapArtist));
    }
    const seen = new Set([artist.id]);
    const out: MbArtist[] = [];
    for (const a of [...artist.related.map((r) => ({ id: r.id, name: r.name, tags: [] })), ...byTag]) {
      if (!seen.has(a.id)) {
        seen.add(a.id);
        out.push(a);
      }
    }
    return out.slice(0, 20);
  });
}

// ---------------------------------------------------------------- release group page

export function getReleaseGroup(ctx: Ctx, mbid: string): Promise<Cached<MbReleaseDetail>> {
  return cached(ctx, `release-group:${mbid}`, TTL.entity, async () => {
    const rg = await mbClient.get<RawReleaseGroup>(`release-group/${mbid}`, { inc: 'artist-credits+releases' });
    const release = pickRelease(rg.releases);
    let tracks: MbReleaseDetail['tracks'] = [];
    if (release) {
      const full = await mbClient.get<RawRelease>(`release/${release.id}`, { inc: 'recordings+artist-credits' });
      tracks = mapTracks(full);
    }
    return { releaseGroup: mapReleaseGroup(rg), releaseId: release?.id, tracks };
  });
}
