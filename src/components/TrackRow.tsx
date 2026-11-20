import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Track } from '@/db/queries';
import { formatTime } from '@/services/playback/queue';

import { CoverImage } from './CoverImage';
import { useTheme } from './theme';

export const TRACK_ROW_HEIGHT = 64;

interface Props {
  track: Track;
  active?: boolean;
  onPress: (track: Track) => void;
  onLongPress?: (track: Track) => void;
}

export const TrackRow = memo(function TrackRow({ track, active, onPress, onLongPress }: Props) {
  const t = useTheme();
  const subtitle = [track.artist, track.album].filter(Boolean).join(' · ') || 'Unknown artist';
  const duration = track.duration_ms ? formatTime(track.duration_ms / 1000) : '';
  return (
    <Pressable
      onPress={() => onPress(track)}
      onLongPress={onLongPress ? () => onLongPress(track) : undefined}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: t.surface }]}
      accessibilityRole="button"
      accessibilityLabel={`${track.title}, ${subtitle}${duration ? `, ${duration}` : ''}`}
      accessibilityHint="Plays this song. Long press for more actions."
    >
      <CoverImage uri={track.artwork_uri} seed={track.album ?? track.title} size={44} />
      <View style={styles.text}>
        <Text numberOfLines={1} style={[styles.title, { color: active ? t.accent : t.text }]}>
          {track.title}
        </Text>
        <Text numberOfLines={1} style={[styles.subtitle, { color: t.textMuted }]}>
          {subtitle}
        </Text>
      </View>
      {duration ? <Text style={[styles.duration, { color: t.textMuted }]}>{duration}</Text> : null}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  row: { height: TRACK_ROW_HEIGHT, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, gap: 12 },
  text: { flex: 1, minWidth: 0 },
  title: { fontSize: 16, fontWeight: '500' },
  subtitle: { fontSize: 13, marginTop: 2 },
  duration: { fontSize: 13, fontVariant: ['tabular-nums'] },
});
