import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { Pressable, StyleSheet, Text } from 'react-native';

import { artRadius, shade, tileColor, useTheme } from '@/components/theme';
import { pickPlaylist } from '@/components/trackActions';
import { HeaderIconButton, TrackListScreen } from '@/components/TrackListScreen';
import { useLibraryQuery } from '@/components/useLibraryQuery';
import { listGenreTracks, type Track } from '@/db/queries';

/** Every song in the library tagged with a genre (opened from Search). */
export default function LibraryGenreScreen() {
  const t = useTheme();
  const db = useSQLiteContext();
  const { name = '' } = useLocalSearchParams<{ name: string }>();
  const { data: tracks } = useLibraryQuery((d) => listGenreTracks(d, name), [name], [] as Track[]);
  const color = tileColor(name.toLowerCase());

  return (
    <TrackListScreen
      title={name}
      subtitle="Genre"
      tracks={tracks}
      art={
        <LinearGradient colors={[color, shade(color, 0.6)]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.art}>
          <Text style={styles.artText} numberOfLines={2}>
            {name}
          </Text>
        </LinearGradient>
      }
      actions={
        <>
          <HeaderIconButton
            icon="add-circle-outline"
            label={`Add all ${name} songs to a playlist`}
            onPress={() => void pickPlaylist(db, tracks.map((tr) => tr.id), name)}
          />
          <Pressable
            onPress={() => router.push({ pathname: '/genre', params: { tag: name.toLowerCase() } })}
            hitSlop={8}
            style={styles.discover}
            accessibilityRole="button"
            accessibilityLabel={`Discover more ${name} on MusicBrainz`}
          >
            <Ionicons name="compass-outline" size={24} color={t.textMuted} />
          </Pressable>
        </>
      }
    />
  );
}

const styles = StyleSheet.create({
  art: { width: 200, height: 200, borderRadius: artRadius(200), justifyContent: 'flex-end', padding: 14 },
  artText: { color: '#fff', fontSize: 28, fontWeight: '700' },
  discover: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
