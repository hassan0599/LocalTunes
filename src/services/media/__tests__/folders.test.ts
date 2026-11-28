/// <reference types="jest" />

import { allTrackIdsUnder, buildFolderTree, folderSegments, folderTitle, listFolder, type FolderTrack } from '../folders';

const T = (id: number, file_uri: string, source: FolderTrack['source'] = 'device'): FolderTrack => ({ id, file_uri, source });

const tracks = [
  T(1, 'file:///storage/emulated/0/Music/Jazz/Kind%20of%20Blue/02%20Freddie.mp3'),
  T(2, 'file:///storage/emulated/0/Music/Jazz/Kind%20of%20Blue/01%20So%20What.mp3'),
  T(3, 'file:///storage/emulated/0/Music/Jazz/loose.mp3'),
  T(4, 'file:///storage/emulated/0/Download/track10.mp3'),
  T(5, 'file:///storage/emulated/0/Download/track9.mp3'),
  T(6, 'file:///storage/1A2B-3C4D/Music/Rock/song.flac'),
  T(7, 'file:///data/user/0/app/files/music/abc.mp3', 'imported'),
  T(8, 'file:///data/user/0/app/files/music/def.mp3', 'jamendo'),
  T(9, 'content://media/external/audio/media/42'),
];

describe('folderSegments', () => {
  it('maps internal storage, SD cards, imports, downloads and other URIs', () => {
    expect(folderSegments(tracks[0])).toEqual({ segments: ['internal', 'Music', 'Jazz', 'Kind of Blue'], file: '02 Freddie.mp3' });
    expect(folderSegments(tracks[5]).segments).toEqual(['sd:1A2B-3C4D', 'Music', 'Rock']);
    expect(folderSegments(tracks[6]).segments).toEqual(['imported']);
    expect(folderSegments(tracks[7]).segments).toEqual(['downloaded']);
    expect(folderSegments(tracks[8]).segments).toEqual(['other']);
    expect(folderSegments(T(10, 'file:///sdcard/Podcasts/ep.mp3')).segments).toEqual(['internal', 'Podcasts']);
  });
});

describe('listFolder', () => {
  const root = buildFolderTree(tracks);

  it('lists top-level places in a fixed order with song counts', () => {
    expect(listFolder(root, '').folders.map((f) => [f.name, f.count])).toEqual([
      ['Internal storage', 5],
      ['SD card (1A2B-3C4D) / Music / Rock', 1],
      ['Imported', 1],
      ['Downloaded', 1],
      ['Other', 1],
    ]);
  });

  it('collapses single-subfolder chains and sorts songs by file name, numbers naturally', () => {
    const internal = listFolder(root, listFolder(root, '').folders[0].path);
    expect(internal.folders.map((f) => f.name)).toEqual(['Download', 'Music / Jazz']);
    expect(listFolder(root, internal.folders[0].path).trackIds).toEqual([5, 4]); // track9 before track10
    const jazz = listFolder(root, internal.folders[1].path);
    expect(jazz.folders.map((f) => [f.name, f.count])).toEqual([['Kind of Blue', 2]]);
    expect(jazz.trackIds).toEqual([3]);
    expect(listFolder(root, jazz.folders[0].path).trackIds).toEqual([2, 1]);
    expect(folderTitle(jazz.folders[0].path)).toBe('Kind of Blue');
    expect(folderTitle(internal.folders[1].path)).toBe('Jazz');
  });

  it('collects every song below a folder for Play all', () => {
    const internal = listFolder(root, '').folders[0].path;
    expect(allTrackIdsUnder(root, internal)).toEqual([5, 4, 3, 2, 1]);
  });

  it('copes with unknown paths and an empty library', () => {
    expect(listFolder(root, 'nope')).toEqual({ folders: [], trackIds: [] });
    expect(listFolder(buildFolderTree([]), '')).toEqual({ folders: [], trackIds: [] });
  });
});
