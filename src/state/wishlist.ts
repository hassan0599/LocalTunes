import type { SQLiteDatabase } from 'expo-sqlite';
import { create } from 'zustand';

export type WishKind = 'recording' | 'release-group';

export interface WishItem {
  mbid: string;
  kind: WishKind;
  title: string;
  artist: string | null;
  added_at: number;
}

/** Wishlisted MBIDs, mirrored from the `wishlist` table for instant toggle state. */
export const useWishlist = create<{ items: WishItem[]; ids: Set<string> }>(() => ({ items: [], ids: new Set() }));

export async function loadWishlist(db: SQLiteDatabase): Promise<void> {
  const items = await db.getAllAsync<WishItem>('SELECT * FROM wishlist ORDER BY added_at DESC');
  useWishlist.setState({ items, ids: new Set(items.map((i) => i.mbid)) });
}

export async function toggleWishlist(
  db: SQLiteDatabase,
  item: Omit<WishItem, 'added_at'>,
): Promise<boolean> {
  const exists = useWishlist.getState().ids.has(item.mbid);
  if (exists) await db.runAsync('DELETE FROM wishlist WHERE mbid = ?', item.mbid);
  else {
    await db.runAsync(
      'INSERT OR IGNORE INTO wishlist (mbid, kind, title, artist) VALUES (?, ?, ?, ?)',
      item.mbid,
      item.kind,
      item.title,
      item.artist,
    );
  }
  await loadWishlist(db);
  return !exists;
}
