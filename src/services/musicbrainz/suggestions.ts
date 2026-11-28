/**
 * "Because you listened to…" (Discover): artists similar to one you play a lot, minus
 * artists already in your library. Built from the cached MusicBrainz calls Discover
 * already uses, so it works offline once seen.
 */
import type { SQLiteDatabase } from 'expo-sqlite';

import { getArtist, getSimilarArtists, searchArtists } from './api';
import type { Cached } from './cache';
import { normalize } from './match';
import type { MbArtist } from './types';

export interface Suggestion {
  seed: { id: string; name: string };
  artists: MbArtist[];
}

type Ctx = { db: SQLiteDatabase; online: boolean };
type Api = { searchArtists: typeof searchArtists; getArtist: typeof getArtist; getSimilarArtists: typeof getSimilarArtists };

const defaultApi: Api = { searchArtists, getArtist, getSimilarArtists };

/** Most-played artists in the library (by total plays), most first. */
export async function topArtists(db: SQLiteDatabase, limit = 2): Promise<string[]> {
  const rows = await db.getAllAsync<{ artist: string }>(
    `SELECT artist FROM tracks WHERE artist IS NOT NULL AND play_count > 0
     GROUP BY artist COLLATE NOCASE ORDER BY SUM(play_count) DESC, MAX(last_played_at) DESC LIMIT ?`,
    limit,
  );
  return rows.map((r) => r.artist);
}

export async function becauseYouListened(
  ctx: Ctx,
  artistName: string,
  inLibrary: (name: string) => boolean,
  max = 8,
  api: Api = defaultApi,
): Promise<Cached<Suggestion | null>> {
  const search = await api.searchArtists(ctx, artistName);
  const want = normalize(artistName);
  const seed = search.data.items.find((a) => normalize(a.name) === want);
  if (!seed) return { ...search, data: null };
  const detail = await api.getArtist(ctx, seed.id);
  const similar = await api.getSimilarArtists(ctx, detail.data);
  const artists = similar.data.filter((a) => a.id !== seed.id && !inLibrary(a.name)).slice(0, max);
  return {
    data: artists.length ? { seed: { id: seed.id, name: seed.name }, artists } : null,
    stale: search.stale || detail.stale || similar.stale,
    fetchedAt: Math.min(search.fetchedAt, detail.fetchedAt, similar.fetchedAt),
  };
}
