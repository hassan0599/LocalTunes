import Ionicons from '@expo/vector-icons/Ionicons';
import { Stack } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, type ReactNode } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { Track } from '@/db/queries';
import { playTracks, playTracksShuffled } from '@/services/playback/PlaybackService';
import { formatTime } from '@/services/playback/queue';
import { selectCurrentTrack, usePlayer } from '@/state/player';

import { MiniPlayer } from './MiniPlayer';
import { HeroGradient } from './ScreenHeader';
import type { SheetOption } from './Sheet';
import { radius, TOUCH, useTheme } from './theme';
import { showTrackActions } from './trackActions';
import { TRACK_ROW_HEIGHT, TrackRow } from './TrackRow';

interface Props {
  title: string;
  tracks: Track[];
  /** Artwork node shown at the top of the hero. */
  art?: ReactNode;
  subtitle?: string;
  /** Extra buttons next to shuffle/play (e.g. a playlist's menu). */
  actions?: ReactNode;
  /** Extra per-track menu options (e.g. reordering in a playlist). */
  extraActions?: (track: Track, index: number) => SheetOption[];
  /** Show track numbers instead of covers (album pages). */
  numbered?: boolean;
  empty?: ReactNode;
}

/** Album, artist and playlist pages: artwork hero, Play/Shuffle buttons, track list, mini player. */
export function TrackListScreen({ title, tracks, art, subtitle, actions, extraActions, numbered, empty }: Props) {
  const t = useTheme();
  const db = useSQLiteContext();
  const insets = useSafeAreaInsets();
  const currentId = usePlayer((s) => selectCurrentTrack(s)?.id);
  const onPress = useCallback((track: Track) => playTracks(tracks, tracks.indexOf(track)), [tracks]);
  const totalMs = tracks.reduce((n, tr) => n + (tr.duration_ms ?? 0), 0);
  const meta = [subtitle, `${tracks.length} ${tracks.length === 1 ? 'song' : 'songs'}`, totalMs ? formatDuration(totalMs) : null]
    .filter(Boolean)
    .join(' · ');

  return (
    <View style={[styles.screen, { backgroundColor: t.bg }]}>
      <Stack.Screen options={{ title, headerTransparent: true, headerStyle: { backgroundColor: 'transparent' }, headerTitle: '' }} />
      <FlatList
        data={tracks}
        keyExtractor={(item, i) => `${item.id}-${i}`}
        ListHeaderComponent={
          <View style={{ paddingTop: insets.top + 56 }}>
            <HeroGradient height={insets.top + 420} />
            <View style={styles.hero}>
              {art}
              <Text style={[styles.title, { color: t.text }]} accessibilityRole="header" numberOfLines={2}>
                {title}
              </Text>
              <Text style={{ color: t.textMuted, alignSelf: 'stretch' }}>{meta}</Text>
            </View>
            <View style={styles.controls}>
              <View style={styles.leftActions}>{actions}</View>
              <Pressable
                onPress={() => playTracksShuffled(tracks)}
                disabled={!tracks.length}
                style={({ pressed }) => [styles.btn, { backgroundColor: pressed ? t.elevated : t.surface, opacity: tracks.length ? 1 : 0.4 }]}
                accessibilityRole="button"
                accessibilityLabel={`Shuffle play ${title}`}
              >
                <Ionicons name="shuffle" size={20} color={t.text} />
                <Text style={[styles.btnText, { color: t.text }]}>Shuffle</Text>
              </Pressable>
              <Pressable
                onPress={() => playTracks(tracks, 0)}
                disabled={!tracks.length}
                style={({ pressed }) => [styles.btn, { backgroundColor: pressed ? t.accentPressed : t.accent, opacity: tracks.length ? 1 : 0.4 }]}
                accessibilityRole="button"
                accessibilityLabel={`Play ${title}`}
              >
                <Ionicons name="play" size={20} color={t.onAccent} />
                <Text style={[styles.btnText, { color: t.onAccent }]}>Play</Text>
              </Pressable>
            </View>
          </View>
        }
        ListEmptyComponent={<>{empty}</>}
        renderItem={({ item, index }) => (
          <TrackRow
            track={item}
            index={numbered ? (item.track_no ?? index + 1) : undefined}
            active={item.id === currentId}
            onPress={onPress}
            onLongPress={(tr) => showTrackActions(db, tr, extraActions?.(tr, index))}
          />
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

function formatDuration(ms: number): string {
  const min = Math.round(ms / 60000);
  return min >= 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min} min`;
}

export function HeaderIconButton({ icon, label, onPress }: { icon: 'ellipsis-horizontal' | 'add-circle-outline'; label: string; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} hitSlop={8} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel={label}>
      <Ionicons name={icon} size={26} color={t.textMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  hero: { alignItems: 'center', paddingHorizontal: 16, gap: 8 },
  title: { alignSelf: 'stretch', fontSize: 26, fontWeight: '700', marginTop: 12 },
  controls: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 8 },
  leftActions: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4 },
  btn: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: TOUCH, paddingHorizontal: 16, borderRadius: radius.md },
  btnText: { fontSize: 15, fontWeight: '700' },
  iconBtn: { width: TOUCH, height: TOUCH, alignItems: 'center', justifyContent: 'center' },
});
