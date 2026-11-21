import Ionicons from '@expo/vector-icons/Ionicons';
import { memo } from 'react';
import { PixelRatio, Pressable, StyleSheet, Text, View } from 'react-native';

import type { Track } from '@/db/queries';
import { formatTime } from '@/services/playback/queue';

import { CoverImage } from './CoverImage';
import { TOUCH, useTheme } from './theme';

/**
 * Row height grows with the system font size (spec 8: dynamic type) so large text is
 * never clipped; it stays fixed per launch so lists can use getItemLayout.
 */
export const TRACK_ROW_HEIGHT = Math.round(64 * Math.max(1, PixelRatio.getFontScale()));

interface Props {
  track: Track;
  active?: boolean;
  onPress: (track: Track) => void;
  /** Opens the actions menu; also reachable via the ⋯ button. */
  onLongPress?: (track: Track) => void;
  /** Hide the cover (album pages show track numbers instead). */
  index?: number;
}

export const TrackRow = memo(function TrackRow({ track, active, onPress, onLongPress, index }: Props) {
  const t = useTheme();
  const subtitle = [track.artist, track.album].filter(Boolean).join(' · ') || 'Unknown artist';
  const duration = track.duration_ms ? formatTime(track.duration_ms / 1000) : '';
  return (
    <Pressable
      onPress={() => onPress(track)}
      onLongPress={onLongPress ? () => onLongPress(track) : undefined}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: t.surface }]}
      accessibilityRole="button"
      accessibilityLabel={`${track.title}, ${subtitle}${duration ? `, ${duration}` : ''}${active ? ', now playing' : ''}`}
      accessibilityHint="Plays this song."
      accessibilityActions={onLongPress ? [{ name: 'longpress', label: 'More actions' }] : undefined}
      onAccessibilityAction={(e) => e.nativeEvent.actionName === 'longpress' && onLongPress?.(track)}
    >
      {index !== undefined ? (
        <Text style={[styles.index, { color: active ? t.accent : t.textMuted }]}>{index}</Text>
      ) : (
        <CoverImage uri={track.artwork_uri} seed={track.album ?? track.title} size={48} />
      )}
      <View style={styles.text}>
        <Text numberOfLines={1} style={[styles.title, { color: active ? t.accent : t.text }]}>
          {track.title}
        </Text>
        <Text numberOfLines={1} style={[styles.subtitle, { color: t.textMuted }]}>
          {track.source === 'internet_archive' || track.source === 'jamendo' ? '↓ ' : ''}
          {subtitle}
        </Text>
      </View>
      {!!duration && <Text style={[styles.duration, { color: t.textMuted }]}>{duration}</Text>}
      {onLongPress && (
        <Pressable
          onPress={() => onLongPress(track)}
          hitSlop={6}
          style={styles.more}
          accessibilityRole="button"
          accessibilityLabel={`More actions for ${track.title}`}
          importantForAccessibility="no-hide-descendants"
          accessibilityElementsHidden
        >
          <Ionicons name="ellipsis-vertical" size={18} color={t.textMuted} />
        </Pressable>
      )}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  row: { height: TRACK_ROW_HEIGHT, flexDirection: 'row', alignItems: 'center', paddingLeft: 16, paddingRight: 4, gap: 12 },
  index: { width: 28, textAlign: 'center', fontSize: 15, fontVariant: ['tabular-nums'] },
  text: { flex: 1, minWidth: 0 },
  title: { fontSize: 16, fontWeight: '600' },
  subtitle: { fontSize: 14, marginTop: 2 },
  duration: { fontSize: 13, fontVariant: ['tabular-nums'] },
  more: { width: TOUCH, height: TOUCH, alignItems: 'center', justifyContent: 'center' },
});
