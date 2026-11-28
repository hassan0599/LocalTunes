/**
 * Folder view (pure; unit-tested): songs grouped by where their files live.
 *
 * Device songs use their real folders, shown relative to "Internal storage" or an SD
 * card. Imported files and downloads live in the app's private storage, so they get
 * their own top-level folders. Folders with a single subfolder and no songs are
 * collapsed into one row ("Music / Albums / Jazz").
 */
import type { Track } from '@/db/queries';

export type FolderTrack = Pick<Track, 'id' | 'file_uri' | 'source'>;

export interface FolderEntry {
  /** Stable path key used for navigation, e.g. "internal/Music/Jazz". */
  path: string;
  /** What the row shows; collapsed chains read "Music / Jazz". */
  name: string;
  /** Songs in this folder and everything below it. */
  count: number;
}

export interface FolderListing {
  folders: FolderEntry[];
  /** Ids of songs directly in this folder, in file-name order. */
  trackIds: number[];
}

interface Node {
  name: string;
  children: Map<string, Node>;
  tracks: { id: number; file: string }[];
  count: number;
}

const ROOT_NAMES: Record<string, string> = {
  internal: 'Internal storage',
  imported: 'Imported',
  downloaded: 'Downloaded',
  other: 'Other',
};

/** ["internal", "Music", "Jazz"] + file name, for one track. */
export function folderSegments(t: FolderTrack): { segments: string[]; file: string } {
  if (t.source === 'imported') return { segments: ['imported'], file: fileName(t.file_uri) };
  if (t.source === 'internet_archive' || t.source === 'jamendo') return { segments: ['downloaded'], file: fileName(t.file_uri) };
  if (!t.file_uri.startsWith('file://') && !t.file_uri.startsWith('/')) return { segments: ['other'], file: t.file_uri };

  const path = decode(t.file_uri.replace(/^file:\/\//, ''));
  const parts = path.split('/').filter(Boolean);
  const file = parts.pop() ?? path;
  // /storage/emulated/<user>/… is internal storage; /storage/<VOLUME-ID>/… is an SD card or USB drive.
  if (parts[0] === 'storage' && parts[1] === 'emulated' && parts.length >= 3) return { segments: ['internal', ...parts.slice(3)], file };
  if (parts[0] === 'sdcard') return { segments: ['internal', ...parts.slice(1)], file };
  if (parts[0] === 'storage' && parts[1]) return { segments: [`sd:${parts[1]}`, ...parts.slice(2)], file };
  return { segments: ['other', ...parts], file };
}

export function buildFolderTree(tracks: FolderTrack[]): Node {
  const root: Node = { name: '', children: new Map(), tracks: [], count: 0 };
  for (const t of tracks) {
    const { segments, file } = folderSegments(t);
    let node = root;
    node.count++;
    for (const seg of segments) {
      let next = node.children.get(seg);
      if (!next) {
        next = { name: seg, children: new Map(), tracks: [], count: 0 };
        node.children.set(seg, next);
      }
      next.count++;
      node = next;
    }
    node.tracks.push({ id: t.id, file });
  }
  return root;
}

/** Subfolders and songs at `path` ("" for the top level). */
export function listFolder(root: Node, path: string): FolderListing {
  let node: Node | undefined = root;
  for (const seg of splitPath(path)) node = node?.children.get(seg);
  if (!node) return { folders: [], trackIds: [] };

  const folders: FolderEntry[] = [];
  for (const [seg, child] of node.children) {
    // Collapse chains of folders that hold nothing but one subfolder.
    const names = [displayName(seg, path === '')];
    const segs = [seg];
    let c = child;
    while (c.tracks.length === 0 && c.children.size === 1) {
      const [nextSeg, next] = [...c.children][0];
      names.push(nextSeg);
      segs.push(nextSeg);
      c = next;
    }
    folders.push({ path: joinPath(path, ...segs), name: names.join(' / '), count: child.count });
  }
  folders.sort((a, b) => rootOrder(a.path) - rootOrder(b.path) || a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }));
  const trackIds = [...node.tracks].sort((a, b) => a.file.localeCompare(b.file, undefined, { numeric: true, sensitivity: 'base' })).map((t) => t.id);
  return { folders, trackIds };
}

/** Every song at or below `path`, folder by folder (for "Play all"). */
export function allTrackIdsUnder(root: Node, path: string): number[] {
  const { folders, trackIds } = listFolder(root, path);
  return [...trackIds, ...folders.flatMap((f) => allTrackIdsUnder(root, f.path))];
}

/** Title for a folder screen: its own name (collapsed paths show the last part). */
export function folderTitle(path: string): string {
  const segs = splitPath(path);
  if (!segs.length) return 'Folders';
  return segs.length === 1 ? displayName(segs[0], true) : segs[segs.length - 1];
}

function displayName(seg: string, topLevel: boolean): string {
  if (!topLevel) return seg;
  if (seg.startsWith('sd:')) return `SD card (${seg.slice(3)})`;
  return ROOT_NAMES[seg] ?? seg;
}

function rootOrder(path: string): number {
  const top = splitPath(path)[0] ?? '';
  return top === 'internal' ? 0 : top.startsWith('sd:') ? 1 : top === 'imported' ? 2 : top === 'downloaded' ? 3 : 4;
}

// Paths are joined with "\u001f" so folder names may contain "/".
const SEP = '\u001f';
const splitPath = (p: string) => (p ? p.split(SEP) : []);
const joinPath = (base: string, ...segs: string[]) => [...splitPath(base), ...segs].join(SEP);

function fileName(uri: string): string {
  return decode(uri.slice(uri.lastIndexOf('/') + 1));
}

function decode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
