import { useLocalSearchParams } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { TOUCH, useTheme } from '@/components/theme';
import { TrackListScreen } from '@/components/TrackListScreen';
import { useLibraryQuery } from '@/components/useLibraryQuery';
import { listArtistTracks, type Track } from '@/db/queries';
import { playTracks } from '@/services/playback/PlaybackService';

export default function ArtistScreen() {
  const t = useTheme();
  const { name = '' } = useLocalSearchParams<{ name: string }>();
  const { data: tracks } = useLibraryQuery((db) => listArtistTracks(db, name), [name], [] as Track[]);

  return (
    <TrackListScreen
      title={name}
      tracks={tracks}
      header={
        <View style={styles.header}>
          <Text style={[styles.title, { color: t.text }]} accessibilityRole="header">
            {name}
          </Text>
          <Text style={{ color: t.textMuted }}>
            {tracks.length} {tracks.length === 1 ? 'song' : 'songs'}
          </Text>
          <Pressable
            onPress={() => playTracks(tracks, 0)}
            disabled={!tracks.length}
            style={[styles.play, { backgroundColor: t.accent }]}
            accessibilityRole="button"
            accessibilityLabel={`Play all songs by ${name}`}
          >
            <Text style={{ color: t.onAccent, fontWeight: '600' }}>Play all</Text>
          </Pressable>
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  header: { padding: 16, gap: 6 },
  title: { fontSize: 26, fontWeight: '700' },
  play: { alignSelf: 'flex-start', marginTop: 8, minHeight: TOUCH, paddingHorizontal: 32, borderRadius: 22, justifyContent: 'center' },
});
