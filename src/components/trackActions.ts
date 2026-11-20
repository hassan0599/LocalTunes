import type { SQLiteDatabase } from 'expo-sqlite';
import { Alert } from 'react-native';

import { deleteTrack, type Track } from '@/db/queries';
import { ignoreDeviceAsset } from '@/services/media/deviceScan';
import { deleteOwnedFiles } from '@/services/media/importer';
import { addToQueue, playNext, removeFromQueue } from '@/services/playback/PlaybackService';
import { useLibraryVersion } from '@/state/library';

/** Long-press actions for a track (spec 5, Library). */
export function showTrackActions(db: SQLiteDatabase, track: Track) {
  Alert.alert(
    track.title,
    track.artist ?? undefined,
    [
      { text: 'Play next', onPress: () => playNext(track) },
      { text: 'Add to queue', onPress: () => addToQueue(track) },
      { text: 'Delete', style: 'destructive', onPress: () => confirmDelete(db, track) },
    ],
    { cancelable: true },
  );
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
          useLibraryVersion.getState().bump();
        },
      },
    ],
  );
}
