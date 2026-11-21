/** Playlist queries (schema v1: playlists + playlist_tracks with a dense `position`). */
import type { SQLiteDatabase } from 'expo-sqlite';

import type { Track } from './queries';

export interface PlaylistSummary {
  id: number;
  name: string;
  created_at: number;
  track_count: number;
  /** Up to four distinct covers for the mosaic. */
  covers: string | null;
}

export function listPlaylists(db: SQLiteDatabase): Promise<PlaylistSummary[]> {
  return db.getAllAsync<PlaylistSummary>(
    `SELECT p.id, p.name, p.created_at, COUNT(pt.track_id) AS track_count,
            (SELECT json_group_array(artwork_uri) FROM (
               SELECT DISTINCT t.artwork_uri FROM playlist_tracks x JOIN tracks t ON t.id = x.track_id
               WHERE x.playlist_id = p.id AND t.artwork_uri IS NOT NULL ORDER BY x.position LIMIT 4)) AS covers
     FROM playlists p LEFT JOIN playlist_tracks pt ON pt.playlist_id = p.id
     GROUP BY p.id ORDER BY p.created_at DESC`,
  );
}

export function getPlaylist(db: SQLiteDatabase, id: number): Promise<PlaylistSummary | null> {
  return listPlaylists(db).then((all) => all.find((p) => p.id === id) ?? null);
}

/** Tracks in playlist order, each with its position (a track can appear twice). */
export function listPlaylistTracks(db: SQLiteDatabase, id: number): Promise<(Track & { position: number })[]> {
  return db.getAllAsync(
    `SELECT t.*, pt.position FROM playlist_tracks pt JOIN tracks t ON t.id = pt.track_id
     WHERE pt.playlist_id = ? ORDER BY pt.position`,
    id,
  );
}

export async function createPlaylist(db: SQLiteDatabase, name: string): Promise<number> {
  const r = await db.runAsync('INSERT INTO playlists (name) VALUES (?)', name.trim());
  return r.lastInsertRowId;
}

export async function renamePlaylist(db: SQLiteDatabase, id: number, name: string): Promise<void> {
  await db.runAsync('UPDATE playlists SET name = ? WHERE id = ?', name.trim(), id);
}

export async function deletePlaylist(db: SQLiteDatabase, id: number): Promise<void> {
  await db.runAsync('DELETE FROM playlist_tracks WHERE playlist_id = ?', id);
  await db.runAsync('DELETE FROM playlists WHERE id = ?', id);
}

/** Append tracks to the end. */
export async function addToPlaylist(db: SQLiteDatabase, id: number, trackIds: number[]): Promise<void> {
  await db.withTransactionAsync(async () => {
    const row = await db.getFirstAsync<{ next: number }>(
      'SELECT COALESCE(MAX(position) + 1, 0) AS next FROM playlist_tracks WHERE playlist_id = ?',
      id,
    );
    let pos = row?.next ?? 0;
    for (const trackId of trackIds) {
      await db.runAsync('INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)', id, trackId, pos++);
    }
  });
}

/** Remove the entry at `position`. Order is by position, so gaps are harmless. */
export async function removeFromPlaylist(db: SQLiteDatabase, id: number, position: number): Promise<void> {
  await db.runAsync('DELETE FROM playlist_tracks WHERE playlist_id = ? AND position = ?', id, position);
}

/**
 * Swap two entries (e.g. an entry and its displayed neighbour). Positions can have gaps
 * because deleting a track cascades out of playlists, so callers pass both positions.
 */
export async function swapInPlaylist(db: SQLiteDatabase, id: number, a: number, b: number): Promise<void> {
  await db.withTransactionAsync(async () => {
    await db.runAsync('UPDATE playlist_tracks SET position = -1 WHERE playlist_id = ? AND position = ?', id, a);
    await db.runAsync('UPDATE playlist_tracks SET position = ? WHERE playlist_id = ? AND position = ?', a, id, b);
    await db.runAsync('UPDATE playlist_tracks SET position = ? WHERE playlist_id = ? AND position = -1', b, id);
  });
}
