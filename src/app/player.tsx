import Slider from '@react-native-community/slider';
import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CoverImage } from '@/components/CoverImage';
import { HeroGradient } from '@/components/ScreenHeader';
import { LicenseChip } from '@/components/downloads/parts';
import { IconButton } from '@/components/IconButton';
import { radius, useTheme } from '@/components/theme';
import { TRACK_ROW_HEIGHT, TrackRow } from '@/components/TrackRow';
import {
  cycleRepeat,
  seekTo,
  skipTo,
  skipToNext,
  skipToPrevious,
  togglePlay,
  toggleShuffle,
} from '@/services/playback/PlaybackService';
import { formatTime } from '@/services/playback/queue';
import { selectCurrentTrack, usePlayer } from '@/state/player';

export default function PlayerScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const track = usePlayer(selectCurrentTrack);
  const { isPlaying, position, duration, repeat, shuffle, queue, index } = usePlayer();
  const [scrubbing, setScrubbing] = useState<number | null>(null);

  const shown = scrubbing ?? position;
  const total = duration || (track?.duration_ms ?? 0) / 1000;
  const coverSize = Math.min(width - 64, 340);
  const upNext = queue.slice(index + 1);
  const hasNext = index < queue.length - 1 || repeat === 'all';

  if (!track) {
    return (
      <View style={[styles.screen, styles.center, { backgroundColor: t.bg }]}>
        <Text style={{ color: t.textMuted }}>Nothing playing</Text>
        <IconButton icon="chevron-down" label="Close player" onPress={() => router.back()} />
      </View>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: t.bg, paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <HeroGradient height={700} color={t.heroTop} />
      <View style={styles.topBar}>
        <IconButton icon="chevron-down" label="Close player" onPress={() => router.back()} size={28} />
        <Text style={[styles.topLabel, { color: t.textMuted }]}>Now playing</Text>
        <View style={{ width: 44 }} />
      </View>

      <FlatList
        data={upNext}
        keyExtractor={(item, i) => `${item.id}-${i}`}
        ListHeaderComponent={
          <View style={styles.main}>
            <CoverImage uri={track.artwork_uri} seed={track.album ?? track.title} size={coverSize} />
            <View style={styles.meta}>
              <Text numberOfLines={2} style={[styles.title, { color: t.text }]} accessibilityRole="header">
                {track.title}
              </Text>
              <Text numberOfLines={1} style={[styles.artist, { color: t.textMuted }]}>
                {[track.artist ?? 'Unknown artist', track.album].filter(Boolean).join(' · ')}
              </Text>
              <LicenseChip url={track.license} />
            </View>

            <Slider
              style={styles.slider}
              minimumValue={0}
              maximumValue={Math.max(total, 0.1)}
              value={Math.min(shown, total || 0)}
              minimumTrackTintColor={t.accent}
              maximumTrackTintColor={"rgba(255,255,255,0.25)"}
              thumbTintColor={t.text}
              onSlidingStart={(v) => setScrubbing(v)}
              onValueChange={(v) => scrubbing !== null && setScrubbing(v)}
              onSlidingComplete={async (v) => {
                await seekTo(v);
                setScrubbing(null);
              }}
              accessibilityLabel="Seek"
              accessibilityValue={{ text: `${formatTime(shown)} of ${formatTime(total)}` }}
            />
            <View style={styles.times}>
              <Text style={[styles.time, { color: t.textMuted }]}>{formatTime(shown)}</Text>
              <Text style={[styles.time, { color: t.textMuted }]}>-{formatTime(Math.max(0, total - shown))}</Text>
            </View>

            <View style={styles.controls}>
              <IconButton
                icon="shuffle"
                label={shuffle ? 'Shuffle on' : 'Shuffle off'}
                selected={shuffle}
                color={shuffle ? t.accent : t.textMuted}
                onPress={toggleShuffle}
              />
              <IconButton icon="play-skip-back" label="Previous song" size={32} onPress={skipToPrevious} />
              <IconButton
                icon={isPlaying ? 'pause' : 'play'}
                label={isPlaying ? 'Pause' : 'Play'}
                size={36}
                color={t.onAccent}
                onPress={togglePlay}
                style={[styles.playBtn, { backgroundColor: t.accent }]}
              />
              <IconButton icon="play-skip-forward" label="Next song" size={32} onPress={skipToNext} disabled={!hasNext} />
              <IconButton
                icon={repeat === 'one' ? 'repeat-outline' : 'repeat'}
                label={repeat === 'off' ? 'Repeat off' : repeat === 'all' ? 'Repeat all' : 'Repeat one'}
                selected={repeat !== 'off'}
                color={repeat === 'off' ? t.textMuted : t.accent}
                onPress={cycleRepeat}
              />
            </View>
            {repeat === 'one' && <Text style={[styles.repeatOne, { color: t.accent }]}>Repeating this song</Text>}

            {upNext.length > 0 && (
              <Text style={[styles.upNext, { color: t.text }]} accessibilityRole="header">
                Up next
              </Text>
            )}
          </View>
        }
        renderItem={({ item, index: i }) => (
          <TrackRow track={item} onPress={() => skipTo(index + 1 + i)} />
        )}
        initialNumToRender={Math.ceil(600 / TRACK_ROW_HEIGHT)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8 },
  topLabel: { fontSize: 14, fontWeight: '600' },
  main: { alignItems: 'center', paddingHorizontal: 24, paddingTop: 16 },
  meta: { alignSelf: 'stretch', marginTop: 24, gap: 4 },
  title: { fontSize: 22, fontWeight: '700' },
  artist: { fontSize: 16 },
  slider: { alignSelf: 'stretch', height: 40, marginTop: 16 },
  times: { alignSelf: 'stretch', flexDirection: 'row', justifyContent: 'space-between' },
  time: { fontSize: 12, fontVariant: ['tabular-nums'] },
  controls: { alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 },
  playBtn: { width: 72, height: 72, borderRadius: radius.lg + 6, alignItems: 'center', justifyContent: 'center' },
  repeatOne: { fontSize: 12, marginTop: 4 },
  upNext: { alignSelf: 'stretch', fontSize: 17, fontWeight: '700', marginTop: 32, marginBottom: 4 },
});
