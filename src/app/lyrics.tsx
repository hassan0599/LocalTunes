import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import { ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconButton } from '@/components/IconButton';
import { useTheme } from '@/components/theme';
import { getSetting } from '@/db/queries';
import { activeLine, parseLrc, type LyricLine } from '@/services/lyrics/lrc';
import { getLyrics, LYRICS_ONLINE_KEY, type LyricsResult } from '@/services/lyrics/lyrics';
import { seekTo } from '@/services/playback/PlaybackService';
import { useNetwork } from '@/state/network';
import { selectCurrentTrack, usePlayer } from '@/state/player';

/** Lyrics for the current song: synced lines follow playback and can be tapped to seek. */
export default function LyricsScreen() {
  const t = useTheme();
  const db = useSQLiteContext();
  const insets = useSafeAreaInsets();
  const track = usePlayer(selectCurrentTrack);
  const online = useNetwork((s) => s.online);
  const [loaded, setLoaded] = useState<{ trackId: number; result: LyricsResult } | null>(null);
  const trackId = track?.id;

  useEffect(() => {
    if (!track) return;
    let alive = true;
    getSetting<boolean>(db, LYRICS_ONLINE_KEY)
      .then((allow) => getLyrics(db, track, { online, allowOnline: allow ?? true }))
      .then(
        (result) => alive && setLoaded({ trackId: track.id, result }),
        () => alive && setLoaded({ trackId: track.id, result: { status: 'offline' } }),
      );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload per song, not per track object
  }, [db, trackId, online]);

  const result = loaded && loaded.trackId === trackId ? loaded.result : null;

  return (
    <View style={[styles.screen, { backgroundColor: t.bg, paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={styles.top}>
        <IconButton icon="chevron-down" label="Close lyrics" onPress={() => router.back()} size={28} />
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text numberOfLines={1} style={[styles.title, { color: t.text }]}>
            {track?.title ?? 'Nothing playing'}
          </Text>
          {!!track?.artist && (
            <Text numberOfLines={1} style={{ color: t.textMuted, fontSize: 13 }}>
              {track.artist}
            </Text>
          )}
        </View>
        <View style={{ width: 44 }} />
      </View>

      {!track ? null : !result ? (
        <ActivityIndicator color={t.accent} style={{ marginTop: 48 }} accessibilityLabel="Looking for lyrics" />
      ) : result.status === 'found' && result.lyrics.synced ? (
        <SyncedLyrics lines={parseLrc(result.lyrics.synced).lines} />
      ) : result.status === 'found' && result.lyrics.plain ? (
        <ScrollView contentContainerStyle={styles.plain}>
          <Text style={[styles.plainText, { color: t.text }]}>{result.lyrics.plain.trim()}</Text>
        </ScrollView>
      ) : (
        <Empty
          icon={result.status === 'offline' ? 'cloud-offline-outline' : 'musical-notes-outline'}
          title={
            result.status === 'found' && result.lyrics.instrumental
              ? 'This song is instrumental'
              : result.status === 'offline'
                ? 'You’re offline'
                : 'No lyrics found'
          }
          body={
            result.status === 'offline'
              ? 'Connect to the internet to look up lyrics. Once found, they stay available offline.'
              : result.status === 'found'
                ? ''
                : 'Put an .lrc file with the same name next to the song, or embed lyrics in its tags.'
          }
        />
      )}

      {result?.status === 'found' && result.lyrics.source === 'lrclib' && (
        <Text style={[styles.credit, { color: t.textFaint }]}>Lyrics from LRCLIB</Text>
      )}
    </View>
  );
}

function SyncedLyrics({ lines }: { lines: LyricLine[] }) {
  const t = useTheme();
  const position = usePlayer((s) => s.position);
  const active = useMemo(() => activeLine(lines, position * 1000), [lines, position]);
  const list = useRef<ComponentRef<typeof FlatList<LyricLine>>>(null);
  // After the user scrolls by hand, stop following playback for a few seconds.
  const manualUntil = useRef(0);

  useEffect(() => {
    if (active < 0 || Date.now() < manualUntil.current) return;
    list.current?.scrollToIndex({ index: active, viewPosition: 0.4, animated: true });
  }, [active]);

  return (
    <FlatList
      ref={list}
      data={lines}
      keyExtractor={(_, i) => String(i)}
      contentContainerStyle={styles.synced}
      onScrollBeginDrag={() => (manualUntil.current = Date.now() + 4000)}
      onScrollToIndexFailed={(info) => list.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: true })}
      renderItem={({ item, index }) => {
        const isActive = index === active;
        const past = index < active;
        return (
          <Pressable
            onPress={() => item.timeMs != null && void seekTo(item.timeMs / 1000)}
            accessibilityRole="button"
            accessibilityLabel={item.text || 'Instrumental break'}
            accessibilityHint="Plays from this line"
            accessibilityState={{ selected: isActive }}
          >
            <Text
              style={[
                styles.line,
                { color: isActive ? t.text : past ? t.textFaint : t.textMuted, opacity: isActive ? 1 : 0.85 },
                isActive && styles.activeLine,
              ]}
            >
              {item.text || '♪'}
            </Text>
          </Pressable>
        );
      }}
    />
  );
}

function Empty({ icon, title, body }: { icon: 'cloud-offline-outline' | 'musical-notes-outline'; title: string; body: string }) {
  const t = useTheme();
  return (
    <View style={styles.empty}>
      <Ionicons name={icon} size={48} color={t.textMuted} />
      <Text style={{ color: t.text, fontSize: 18, fontWeight: '700', textAlign: 'center' }}>{title}</Text>
      {!!body && <Text style={{ color: t.textMuted, textAlign: 'center' }}>{body}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  top: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingBottom: 8 },
  title: { fontSize: 16, fontWeight: '700' },
  synced: { paddingHorizontal: 24, paddingTop: 24, paddingBottom: 240 },
  line: { fontSize: 22, fontWeight: '600', lineHeight: 30, paddingVertical: 8 },
  activeLine: { fontSize: 24, fontWeight: '700' },
  plain: { padding: 24, paddingBottom: 64 },
  plainText: { fontSize: 18, lineHeight: 28 },
  empty: { alignItems: 'center', gap: 10, paddingHorizontal: 32, paddingTop: 64 },
  credit: { textAlign: 'center', fontSize: 12, paddingVertical: 8 },
});
