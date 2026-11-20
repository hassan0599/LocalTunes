import { Stack } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, type ReactNode } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { Track } from '@/db/queries';
import { playTracks } from '@/services/playback/PlaybackService';
import { selectCurrentTrack, usePlayer } from '@/state/player';

import { MiniPlayer } from './MiniPlayer';
import { useTheme } from './theme';
import { showTrackActions } from './trackActions';
import { TRACK_ROW_HEIGHT, TrackRow } from './TrackRow';

/** Shared body for album and artist pages: header, track list, mini player. */
export function TrackListScreen({ title, tracks, header }: { title: string; tracks: Track[]; header: ReactNode }) {
  const t = useTheme();
  const db = useSQLiteContext();
  const insets = useSafeAreaInsets();
  const currentId = usePlayer((s) => selectCurrentTrack(s)?.id);
  const onPress = useCallback((track: Track) => playTracks(tracks, tracks.indexOf(track)), [tracks]);
  const onLongPress = useCallback((track: Track) => showTrackActions(db, track), [db]);

  return (
    <View style={[styles.screen, { backgroundColor: t.bg }]}>
      <Stack.Screen options={{ title }} />
      <FlatList
        data={tracks}
        keyExtractor={(item) => String(item.id)}
        ListHeaderComponent={<>{header}</>}
        renderItem={({ item }) => (
          <TrackRow track={item} active={item.id === currentId} onPress={onPress} onLongPress={onLongPress} />
        )}
        style={{ flex: 1 }}
        initialNumToRender={Math.ceil(800 / TRACK_ROW_HEIGHT)}
      />
      <View style={{ paddingBottom: insets.bottom }}>
        <MiniPlayer />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
});
