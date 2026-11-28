/**
 * One-time re-read of every track's tags, for things older versions didn't store:
 * - genre (before migration v5) and ReplayGain (before v6) for any track;
 * - full metadata and cover art for Ogg Vorbis / Opus files, which were added under their
 *   file names before the tag reader understood Ogg.
 * Downloads keep the metadata their source provided. Runs in the background after the
 * launch scan, once (remembered in settings).
 */
import { File } from 'expo-file-system';
import type { SQLiteDatabase } from 'expo-sqlite';

import { getSetting, setSetting, type Track } from '@/db/queries';
import { useLibraryVersion } from '@/state/library';

import { openByteSource } from './fileSource';
import { saveCover } from './importer';
import { readTags, type AudioTags } from './tags';

const DONE_KEY = 'backfill.tags.v2';

type Row = Pick<Track, 'id' | 'file_uri' | 'source' | 'title' | 'artist' | 'album' | 'album_artist' | 'track_no' | 'duration_ms' | 'genre' | 'replay_gain_db' | 'artwork_uri'>;

/** Column updates for one track given its freshly read tags (pure; unit-tested). */
export function backfillUpdates(row: Row, tags: AudioTags): Partial<Row> {
  const up: Partial<Row> = {};
  if (row.genre == null && tags.genre) up.genre = tags.genre;
  if (row.replay_gain_db == null && tags.replayGainDb != null) up.replay_gain_db = tags.replayGainDb;
  // Imported and device files got their metadata from these same tags (or the file name
  // when the tags couldn't be read), so taking the tags again only fills what was missing.
  if (row.source === 'imported' || row.source === 'device') {
    if (tags.title && tags.title !== row.title) up.title = tags.title;
    if (tags.artist && tags.artist !== row.artist) up.artist = tags.artist;
    if (tags.album && tags.album !== row.album) up.album = tags.album;
    if (tags.albumArtist && tags.albumArtist !== row.album_artist) up.album_artist = tags.albumArtist;
    if (tags.trackNo && tags.trackNo !== row.track_no) up.track_no = tags.trackNo;
  }
  if (row.duration_ms == null && tags.durationMs) up.duration_ms = tags.durationMs;
  return up;
}

export async function backfillTags(db: SQLiteDatabase): Promise<number> {
  if (await getSetting<boolean>(db, DONE_KEY)) return 0;
  const rows = await db.getAllAsync<Row>(
    `SELECT id, file_uri, source, title, artist, album, album_artist, track_no, duration_ms, genre, replay_gain_db, artwork_uri
     FROM tracks`,
  );
  let changed = 0;
  for (const row of rows) {
    try {
      const file = new File(row.file_uri);
      if (!file.exists) continue;
      const src = openByteSource(file);
      let tags: AudioTags;
      try {
        tags = await readTags(src);
      } finally {
        src.close();
      }
      const up = backfillUpdates(row, tags);
      const cols = Object.keys(up) as (keyof Row)[];
      if (cols.length) {
        await db.runAsync(
          `UPDATE tracks SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`,
          ...cols.map((c) => up[c] as string | number),
          row.id,
        );
        changed++;
      }
      if (!row.artwork_uri && tags.picture) {
        await saveCover(db, row.id, tags.picture);
        changed++;
      }
    } catch {
      // Unreadable file: leave it as it is.
    }
  }
  await setSetting(db, DONE_KEY, true);
  if (changed) useLibraryVersion.getState().bump();
  return changed;
}
