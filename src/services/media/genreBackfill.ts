/**
 * One-time backfill: tracks added before genres were stored (migration v5) get their
 * genre read from the file's tags. Runs in the background after launch; files without
 * a genre tag simply stay NULL. Remembered in settings so it runs once.
 */
import { File } from 'expo-file-system';
import type { SQLiteDatabase } from 'expo-sqlite';

import { getSetting, setSetting, setTrackGenre } from '@/db/queries';
import { useLibraryVersion } from '@/state/library';

import { openByteSource } from './fileSource';
import { readTags } from './tags';

const DONE_KEY = 'backfill.genre.v1';

export async function backfillGenres(db: SQLiteDatabase): Promise<number> {
  if (await getSetting<boolean>(db, DONE_KEY)) return 0;
  const rows = await db.getAllAsync<{ id: number; file_uri: string }>('SELECT id, file_uri FROM tracks WHERE genre IS NULL');
  let found = 0;
  for (const row of rows) {
    try {
      const file = new File(row.file_uri);
      if (!file.exists) continue;
      const src = openByteSource(file);
      try {
        const { genre } = await readTags(src);
        if (genre) {
          await setTrackGenre(db, row.id, genre);
          found++;
        }
      } finally {
        src.close();
      }
    } catch {
      // Unreadable file: leave it.
    }
  }
  await setSetting(db, DONE_KEY, true);
  if (found) useLibraryVersion.getState().bump();
  return found;
}
