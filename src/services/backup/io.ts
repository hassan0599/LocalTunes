/**
 * Backup files: write to a folder the user picks (Android's folder picker, so it can be
 * Downloads, an SD card or a cloud drive) and read a file the user picks.
 */
import Constants from 'expo-constants';
import * as DocumentPicker from 'expo-document-picker';
import { Directory, File } from 'expo-file-system';
import type { SQLiteDatabase } from 'expo-sqlite';

import { listPlaylists, listPlaylistTracks } from '@/db/playlists';

import { buildBackup, parseBackup, restoreBackup, restoreM3u, toM3u, type M3uReport, type RestoreReport } from './backup';

export interface ExportResult {
  fileName: string;
  playlists: number;
}

/** Ask for a folder, then write the backup JSON and one .m3u8 per playlist. Null if cancelled. */
export async function exportBackup(db: SQLiteDatabase, now = new Date()): Promise<ExportResult | null> {
  let dir: Directory;
  try {
    dir = await Directory.pickDirectoryAsync();
  } catch {
    return null; // picker dismissed
  }
  if (!dir) return null;

  const backup = await buildBackup(db, now, Constants.expoConfig?.version);
  const date = now.toISOString().slice(0, 10);
  const fileName = `LocalTunes backup ${date}.json`;
  await dir.createFile(fileName, 'application/json').write(JSON.stringify(backup, null, 1));

  const playlists = await listPlaylists(db);
  for (const p of playlists) {
    const tracks = await listPlaylistTracks(db, p.id);
    await dir.createFile(`${safeFileName(p.name)}.m3u8`, 'audio/x-mpegurl').write(toM3u(tracks));
  }
  return { fileName, playlists: playlists.length };
}

export type RestoreResult = { kind: 'backup'; report: RestoreReport } | { kind: 'm3u'; report: M3uReport };

/** Pick a LocalTunes backup (.json) or an M3U playlist and restore it. Null if cancelled. */
export async function pickAndRestore(db: SQLiteDatabase): Promise<RestoreResult | null> {
  const res = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true, multiple: false });
  if (res.canceled || !res.assets.length) return null;
  const { uri, name } = res.assets[0];
  const text = await new File(uri).text();
  if (/\.m3u8?$/i.test(name) || text.trimStart().startsWith('#EXTM3U')) {
    return { kind: 'm3u', report: await restoreM3u(db, name.replace(/\.m3u8?$/i, ''), text) };
  }
  return { kind: 'backup', report: await restoreBackup(db, parseBackup(text)) };
}

/** Playlist names can contain characters file systems reject. */
export function safeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim().slice(0, 100) || 'Playlist';
}
