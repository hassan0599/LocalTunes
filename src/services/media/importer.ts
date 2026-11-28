import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
import type { SQLiteDatabase } from 'expo-sqlite';

import { insertTrack, setTrackArtwork } from '@/db/queries';

import { openByteSource } from './fileSource';
import { readTags, tagsFromFileName, type AudioTags, type Picture } from './tags';

export const musicDir = () => new Directory(Paths.document, 'music');
export const coversDir = () => new Directory(Paths.document, 'covers');

export interface ImportResult {
  imported: number;
  failed: { name: string; error: string }[];
}

/**
 * Spec 6.1 / 6.4 "Local import": pick audio files, copy them into app storage,
 * read tags (falling back to the file name) and insert them into the library.
 * Returns null if the user cancelled.
 */
export async function pickAndImport(db: SQLiteDatabase): Promise<ImportResult | null> {
  const res = await DocumentPicker.getDocumentAsync({
    type: 'audio/*',
    multiple: true,
    copyToCacheDirectory: true,
  });
  if (res.canceled) return null;

  ensureDirs();
  const result: ImportResult = { imported: 0, failed: [] };
  for (const asset of res.assets) {
    try {
      await importOne(db, new File(asset.uri), asset.name);
      result.imported++;
    } catch (e) {
      result.failed.push({ name: asset.name, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return result;
}

function ensureDirs() {
  musicDir().create({ intermediates: true, idempotent: true });
  coversDir().create({ intermediates: true, idempotent: true });
}

async function importOne(db: SQLiteDatabase, picked: File, originalName: string): Promise<void> {
  const ext = extensionOf(originalName) || extensionOf(picked.uri) || 'mp3';
  const dest = new File(musicDir(), `${uniqueId()}.${ext}`);
  await picked.move(dest);

  let tags: AudioTags = {};
  try {
    const src = openByteSource(dest);
    try {
      tags = await readTags(src);
    } finally {
      src.close();
    }
  } catch {
    // Unreadable or unsupported tags: fall back to the file name below.
  }

  const fromName = tagsFromFileName(originalName);
  try {
    const id = await insertTrack(db, {
      title: tags.title ?? fromName.title ?? originalName,
      artist: tags.artist ?? fromName.artist ?? null,
      album: tags.album ?? null,
      album_artist: tags.albumArtist ?? null,
      track_no: tags.trackNo ?? fromName.trackNo ?? null,
      genre: tags.genre ?? null,
      replay_gain_db: tags.replayGainDb ?? null,
      duration_ms: tags.durationMs ?? null,
      file_uri: dest.uri,
      source: 'imported',
    });
    if (tags.picture) await saveCover(db, id, tags.picture);
  } catch (e) {
    dest.delete();
    throw e;
  }
}

export async function saveCover(db: SQLiteDatabase, trackId: number, pic: Picture): Promise<void> {
  coversDir().create({ intermediates: true, idempotent: true });
  const file = new File(coversDir(), `${trackId}.${pic.mime.includes('png') ? 'png' : 'jpg'}`);
  if (file.exists) file.delete();
  file.create();
  await file.write(pic.data);
  await setTrackArtwork(db, trackId, file.uri);
}

/**
 * Remove a track's files from app storage. Only files under the app's document
 * directory are touched, so device-owned audio files are never deleted.
 */
export function deleteOwnedFiles(fileUri: string | null, artworkUri: string | null): void {
  for (const uri of [fileUri, artworkUri]) {
    if (!uri || !uri.startsWith(Paths.document.uri)) continue;
    const f = new File(uri);
    if (f.exists) f.delete();
  }
}

function extensionOf(name: string): string | undefined {
  const m = /\.([a-z0-9]{2,5})$/i.exec(name.split('?')[0]);
  return m?.[1].toLowerCase();
}

function uniqueId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
