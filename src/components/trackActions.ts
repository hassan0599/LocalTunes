import { router } from 'expo-router';
import type { SQLiteDatabase } from 'expo-sqlite';
import { Alert } from 'react-native';

import { addToPlaylist, createPlaylist, listPlaylists } from '@/db/playlists';
import { deleteTrack, type Track } from '@/db/queries';
import { ignoreDeviceAsset } from '@/services/media/deviceScan';
import { deleteOwnedFiles } from '@/services/media/importer';
import { addToQueue, playNext, removeFromQueue } from '@/services/playback/PlaybackService';
import { useLibraryVersion } from '@/state/library';

import { showPrompt, showSheet, type SheetOption } from './Sheet';

const bump = () => useLibraryVersion.getState().bump();

/** Track actions menu (spec 5, Library long-press). `extra` options go first (e.g. playlist reordering). */
export function showTrackActions(db: SQLiteDatabase, track: Track, extra: SheetOption[] = []) {
  const options: SheetOption[] = [
    ...extra,
    { label: 'Play next', icon: 'play-forward-outline', onPress: () => playNext(track) },
    { label: 'Add to queue', icon: 'list-outline', onPress: () => addToQueue(track) },
    { label: 'Add to playlist', icon: 'add-circle-outline', onPress: () => void pickPlaylist(db, [track.id], track.title) },
  ];
  if (track.album) {
    options.push({
      label: 'Go to album',
      icon: 'disc-outline',
      onPress: () => router.push({ pathname: '/album', params: { name: track.album!, artist: track.album_artist ?? track.artist ?? '' } }),
    });
  }
  if (track.artist) {
    options.push({ label: 'Go to artist', icon: 'person-outline', onPress: () => router.push({ pathname: '/artist', params: { name: track.artist! } }) });
  }
  options.push({ label: 'Delete from library', icon: 'trash-outline', destructive: true, onPress: () => confirmDelete(db, track) });

  showSheet({
    title: track.title,
    subtitle: [track.artist, track.album].filter(Boolean).join(' · ') || undefined,
    artwork: { uri: track.artwork_uri, seed: track.album ?? track.title },
    options,
  });
}

/** "Add to playlist": choose an existing playlist or create one. */
export async function pickPlaylist(db: SQLiteDatabase, trackIds: number[], what: string) {
  const playlists = await listPlaylists(db);
  const add = async (id: number) => {
    await addToPlaylist(db, id, trackIds);
    bump();
  };
  showSheet({
    title: 'Add to playlist',
    subtitle: what,
    options: [
      {
        label: 'New playlist',
        icon: 'add',
        onPress: () =>
          showPrompt({
            title: 'Give your playlist a name',
            placeholder: 'My playlist',
            confirmLabel: 'Create',
            onSubmit: async (name) => add(await createPlaylist(db, name)),
          }),
      },
      ...playlists.map<SheetOption>((p) => ({
        label: `${p.name}  ·  ${p.track_count}`,
        icon: 'musical-notes-outline',
        onPress: () => void add(p.id),
      })),
    ],
  });
}

function confirmDelete(db: SQLiteDatabase, track: Track) {
  const ownsFile = track.source !== 'device';
  Alert.alert(
    'Delete song?',
    ownsFile
      ? `"${track.title}" will be removed from localtunes and its file deleted from app storage.`
      : `"${track.title}" will be removed from the localtunes library. The file stays on your device.`,
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          removeFromQueue(track.id);
          await deleteTrack(db, track.id);
          // Only deletes files in app storage: imported audio and cover art, never device files.
          deleteOwnedFiles(track.file_uri, track.artwork_uri);
          if (track.device_id) await ignoreDeviceAsset(db, track.device_id);
          bump();
        },
      },
    ],
  );
}
