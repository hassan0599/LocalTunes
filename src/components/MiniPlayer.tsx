import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { skipToNext, togglePlay } from '@/services/playback/PlaybackService';
import { selectCurrentTrack, usePlayer } from '@/state/player';

import { CoverImage } from './CoverImage';
import { IconButton } from './IconButton';
import { radius, useTheme } from './theme';

/** Floating card above the tab bar on every screen (spec 5). Hidden when the queue is empty. */
export function MiniPlayer() {
  const t = useTheme();
  const track = usePlayer(selectCurrentTrack);
  const isPlaying = usePlayer((s) => s.isPlaying);
  const progress = usePlayer((s) => (s.duration > 0 ? Math.min(1, s.position / s.duration) : 0));
  const hasNext = usePlayer((s) => s.index < s.queue.length - 1 || s.repeat === 'all');

  if (!track) return null;
  return (
    <View style={styles.outer}>
      <View style={[styles.card, { backgroundColor: t.player }]}>
        <Pressable
          style={styles.main}
          onPress={() => router.push('/player')}
          accessibilityRole="button"
          accessibilityLabel={`Now playing: ${track.title}${track.artist ? ` by ${track.artist}` : ''}. Opens the player.`}
        >
          <CoverImage uri={track.artwork_uri} seed={track.album ?? track.title} size={40} />
          <View style={styles.text}>
            <Text numberOfLines={1} style={[styles.title, { color: t.text }]}>
              {track.title}
            </Text>
            <Text numberOfLines={1} style={[styles.artist, { color: t.textMuted }]}>
              {track.artist ?? 'Unknown artist'}
            </Text>
          </View>
        </Pressable>
        <IconButton icon={isPlaying ? 'pause' : 'play'} label={isPlaying ? 'Pause' : 'Play'} size={26} onPress={togglePlay} />
        <IconButton icon="play-skip-forward" label="Next song" size={22} onPress={skipToNext} disabled={!hasNext} />
        <View style={[styles.progressTrack, { backgroundColor: 'rgba(255,255,255,0.18)' }]}>
          <View style={[styles.progress, { width: `${progress * 100}%`, backgroundColor: t.text }]} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  outer: { paddingHorizontal: 8, paddingBottom: 6 },
  card: { flexDirection: 'row', alignItems: 'center', paddingRight: 4, borderRadius: radius.md, overflow: 'hidden' },
  main: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, paddingLeft: 8, minWidth: 0 },
  text: { flex: 1, minWidth: 0 },
  title: { fontSize: 14, fontWeight: '700' },
  artist: { fontSize: 13 },
  progressTrack: { position: 'absolute', left: 8, right: 8, bottom: 0, height: 2, borderRadius: 1 },
  progress: { height: 2, borderRadius: 1 },
});
