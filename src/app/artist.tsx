import { useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';

import { CoverImage } from '@/components/CoverImage';
import { pickPlaylist } from '@/components/trackActions';
import { HeaderIconButton, TrackListScreen } from '@/components/TrackListScreen';
import { useLibraryQuery } from '@/components/useLibraryQuery';
import { listArtistTracks, type Track } from '@/db/queries';

export default function ArtistScreen() {
  const db = useSQLiteContext();
  const { name = '' } = useLocalSearchParams<{ name: string }>();
  const { data: tracks } = useLibraryQuery((d) => listArtistTracks(d, name), [name], [] as Track[]);

  return (
    <TrackListScreen
      title={name}
      subtitle="Artist"
      tracks={tracks}
      art={<CoverImage uri={null} seed={name} size={180} round />}
      actions={
        <HeaderIconButton
          icon="add-circle-outline"
          label={`Add all songs by ${name} to a playlist`}
          onPress={() => void pickPlaylist(db, tracks.map((t) => t.id), name)}
        />
      }
    />
  );
}
