import { useLocalSearchParams } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { SmartPlaylistArt } from '@/components/SmartPlaylistArt';
import { useTheme } from '@/components/theme';
import { TrackListScreen } from '@/components/TrackListScreen';
import { useLibraryQuery } from '@/components/useLibraryQuery';
import type { Track } from '@/db/queries';
import { isSmartPlaylistId, listSmartPlaylistTracks, smartPlaylist, type SmartPlaylistId } from '@/db/smartPlaylists';
import { usePlaysVersion } from '@/state/library';

const EMPTY: Record<SmartPlaylistId, string> = {
  'most-played': 'Play a few songs and your favourites will show up here.',
  'recently-played': 'Songs you play will show up here.',
  'recently-added': 'Import music or download some to see it here.',
  'never-played': 'You’ve played every song in your library. Nice.',
};

/** Most played / Recently played / Recently added / Never played. */
export default function SmartPlaylistScreen() {
  const t = useTheme();
  const raw = useLocalSearchParams<{ id: string }>().id ?? '';
  const id: SmartPlaylistId = isSmartPlaylistId(raw) ? raw : 'most-played';
  const playlist = smartPlaylist(id);
  const plays = usePlaysVersion((s) => s.version);
  const { data: tracks } = useLibraryQuery((d) => listSmartPlaylistTracks(d, id), [id, plays], [] as Track[]);

  return (
    <TrackListScreen
      title={playlist.name}
      subtitle={playlist.description}
      tracks={tracks}
      art={<SmartPlaylistArt playlist={playlist} size={200} />}
      empty={
        <View style={styles.empty}>
          <Text style={{ color: t.textMuted, textAlign: 'center' }}>{EMPTY[id]}</Text>
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  empty: { alignItems: 'center', padding: 32 },
});
