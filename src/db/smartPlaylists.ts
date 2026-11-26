/**
 * Smart playlists: built from the play counts and timestamps the player already records
 * (tracks.play_count, last_played_at, added_at). Nothing is stored; each opens as a query.
 */
import type { SQLiteDatabase } from 'expo-sqlite';

import type { Track } from './queries';

export type SmartPlaylistId = 'most-played' | 'recently-played' | 'recently-added' | 'never-played';

export interface SmartPlaylist {
  id: SmartPlaylistId;
  name: string;
  description: string;
  icon: 'flame' | 'time' | 'sparkles' | 'leaf';
}

/** How many songs a smart playlist shows at most (the whole library for "Never played"). */
export const SMART_LIMIT = 100;

export const SMART_PLAYLISTS: SmartPlaylist[] = [
  { id: 'most-played', name: 'Most played', description: 'Your top songs by play count', icon: 'flame' },
  { id: 'recently-played', name: 'Recently played', description: 'What you listened to last', icon: 'time' },
  { id: 'recently-added', name: 'Recently added', description: 'Newest in your library', icon: 'sparkles' },
  { id: 'never-played', name: 'Never played', description: 'Songs waiting for a first listen', icon: 'leaf' },
];

const QUERIES: Record<SmartPlaylistId, string> = {
  'most-played': `SELECT * FROM tracks WHERE play_count > 0
                  ORDER BY play_count DESC, last_played_at DESC LIMIT ${SMART_LIMIT}`,
  'recently-played': `SELECT * FROM tracks WHERE last_played_at IS NOT NULL
                      ORDER BY last_played_at DESC LIMIT ${SMART_LIMIT}`,
  'recently-added': `SELECT * FROM tracks ORDER BY added_at DESC, id DESC LIMIT ${SMART_LIMIT}`,
  'never-played': `SELECT * FROM tracks WHERE play_count = 0
                   ORDER BY artist COLLATE NOCASE, album COLLATE NOCASE, track_no, title COLLATE NOCASE`,
};

export function isSmartPlaylistId(v: string): v is SmartPlaylistId {
  return v in QUERIES;
}

export function smartPlaylist(id: SmartPlaylistId): SmartPlaylist {
  return SMART_PLAYLISTS.find((p) => p.id === id)!;
}

export function listSmartPlaylistTracks(db: SQLiteDatabase, id: SmartPlaylistId): Promise<Track[]> {
  return db.getAllAsync<Track>(QUERIES[id]);
}

/** Song count per smart playlist, for the Playlists tab. */
export async function smartPlaylistCounts(db: SQLiteDatabase): Promise<Record<SmartPlaylistId, number>> {
  const row = await db.getFirstAsync<{ played: number; total: number }>(
    `SELECT SUM(play_count > 0) AS played, COUNT(*) AS total FROM tracks`,
  );
  const played = row?.played ?? 0;
  const total = row?.total ?? 0;
  return {
    'most-played': Math.min(played, SMART_LIMIT),
    'recently-played': Math.min(played, SMART_LIMIT),
    'recently-added': Math.min(total, SMART_LIMIT),
    'never-played': total - played,
  };
}
