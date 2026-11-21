import { useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';

import { CoverImage } from '@/components/CoverImage';
import { pickPlaylist } from '@/components/trackActions';
import { HeaderIconButton, TrackListScreen } from '@/components/TrackListScreen';
import { useLibraryQuery } from '@/components/useLibraryQuery';
import { listAlbumTracks, type Track } from '@/db/queries';

export default function AlbumScreen() {
  const db = useSQLiteContext();
  const { name = '', artist = '' } = useLocalSearchParams<{ name: string; artist?: string }>();
  const { data: tracks } = useLibraryQuery((d) => listAlbumTracks(d, name, artist || null), [name, artist], [] as Track[]);
  const artwork = tracks.find((tr) => tr.artwork_uri)?.artwork_uri ?? null;

  return (
    <TrackListScreen
      title={name}
      subtitle={artist || 'Unknown artist'}
      tracks={tracks}
      numbered
      art={<CoverImage uri={artwork} seed={name} size={220} />}
      actions={
        <HeaderIconButton
          icon="add-circle-outline"
          label={`Add ${name} to a playlist`}
          onPress={() => void pickPlaylist(db, tracks.map((t) => t.id), name)}
        />
      }
    />
  );
}
