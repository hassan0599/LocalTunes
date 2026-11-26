import { StyleSheet, Text, View } from 'react-native';

import type { Track } from '@/db/queries';

import { CoverImage } from './CoverImage';
import { useTheme } from './theme';

/** Compact, non-interactive song row (cover, title, artist) for reorder and queue lists. */
export function TrackLine({ track, dim }: { track: Track; dim?: boolean }) {
  const t = useTheme();
  const subtitle = [track.artist, track.album].filter(Boolean).join(' · ') || 'Unknown artist';
  return (
    <View style={[styles.row, dim && { opacity: 0.6 }]}>
      <CoverImage uri={track.artwork_uri} seed={track.album ?? track.title} size={44} />
      <View style={styles.text}>
        <Text numberOfLines={1} style={[styles.title, { color: t.text }]}>
          {track.title}
        </Text>
        <Text numberOfLines={1} style={{ color: t.textMuted, fontSize: 13 }}>
          {subtitle}
        </Text>
      </View>
    </View>
  );
}

/** Stable keys for a list that may contain the same song twice: "id#occurrence". */
export function occurrenceKeys<T extends { id: number }>(items: T[]): string[] {
  const seen = new Map<number, number>();
  return items.map((it) => {
    const n = seen.get(it.id) ?? 0;
    seen.set(it.id, n + 1);
    return `${it.id}#${n}`;
  });
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingLeft: 16 },
  text: { flex: 1, minWidth: 0 },
  title: { fontSize: 15, fontWeight: '600' },
});
