import { useLocalSearchParams } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { CoverImage } from '@/components/CoverImage';
import { TOUCH, useTheme } from '@/components/theme';
import { TrackListScreen } from '@/components/TrackListScreen';
import { useLibraryQuery } from '@/components/useLibraryQuery';
import { listAlbumTracks, type Track } from '@/db/queries';
import { playTracks } from '@/services/playback/PlaybackService';

export default function AlbumScreen() {
  const t = useTheme();
  const { name = '', artist = '' } = useLocalSearchParams<{ name: string; artist?: string }>();
  const { data: tracks } = useLibraryQuery((db) => listAlbumTracks(db, name, artist || null), [name, artist], [] as Track[]);
  const artwork = tracks.find((tr) => tr.artwork_uri)?.artwork_uri ?? null;

  return (
    <TrackListScreen
      title={name}
      tracks={tracks}
      header={
        <View style={styles.header}>
          <CoverImage uri={artwork} seed={name} size={200} />
          <Text style={[styles.title, { color: t.text }]} accessibilityRole="header">
            {name}
          </Text>
          <Text style={{ color: t.textMuted }}>{artist || 'Unknown artist'}</Text>
          <Pressable
            onPress={() => playTracks(tracks, 0)}
            disabled={!tracks.length}
            style={[styles.play, { backgroundColor: t.accent }]}
            accessibilityRole="button"
            accessibilityLabel={`Play album ${name}`}
          >
            <Text style={{ color: t.onAccent, fontWeight: '600' }}>Play</Text>
          </Pressable>
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  header: { alignItems: 'center', padding: 16, gap: 6 },
  title: { fontSize: 22, fontWeight: '700', textAlign: 'center', marginTop: 8 },
  play: { marginTop: 8, minHeight: TOUCH, paddingHorizontal: 32, borderRadius: 22, justifyContent: 'center' },
});
