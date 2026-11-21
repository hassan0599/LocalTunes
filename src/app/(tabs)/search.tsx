import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, SectionList, StyleSheet, Text, TextInput, View } from 'react-native';

import { CoverImage } from '@/components/CoverImage';
import { IconButton } from '@/components/IconButton';
import { ScreenHeader } from '@/components/ScreenHeader';
import { TOUCH, useTheme } from '@/components/theme';
import { showTrackActions } from '@/components/trackActions';
import { TrackRow } from '@/components/TrackRow';
import { EMPTY_RESULTS, searchLibrary, type SearchResults } from '@/db/fts';
import type { AlbumSummary, ArtistSummary, Track } from '@/db/queries';
import { playTracks } from '@/services/playback/PlaybackService';
import { useLibraryVersion } from '@/state/library';
import { selectCurrentTrack, usePlayer } from '@/state/player';

/** Spec 6.1: debounce typing by 150 ms. */
const DEBOUNCE_MS = 150;
/** Rows shown per album/artist group before "Show all". */
const GROUP_PREVIEW = 4;

type Row =
  | { kind: 'song'; track: Track }
  | { kind: 'album'; album: AlbumSummary }
  | { kind: 'artist'; artist: ArtistSummary }
  | { kind: 'more'; group: 'albums' | 'artists'; count: number };

interface Section {
  title: string;
  data: Row[];
}

export default function SearchScreen() {
  const t = useTheme();
  const db = useSQLiteContext();
  const version = useLibraryVersion((s) => s.version);
  const currentId = usePlayer((s) => selectCurrentTrack(s)?.id);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResults>(EMPTY_RESULTS);
  const [searched, setSearched] = useState('');
  const [expanded, setExpanded] = useState<{ albums: boolean; artists: boolean }>({ albums: false, artists: false });
  const requestId = useRef(0);

  useEffect(() => {
    const id = ++requestId.current;
    const q = query.trim();
    if (!q) {
      setResults(EMPTY_RESULTS);
      setSearched('');
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const r = await searchLibrary(db, q);
        // Ignore stale responses that finish after a newer query.
        if (id === requestId.current) {
          setResults(r);
          setSearched(q);
          setExpanded({ albums: false, artists: false });
        }
      } catch (e) {
        console.warn('search failed', e);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [db, query, version]);

  const onSongPress = useCallback(
    (track: Track) => playTracks(results.songs, results.songs.indexOf(track)),
    [results.songs],
  );
  const onSongLongPress = useCallback((track: Track) => showTrackActions(db, track), [db]);

  const sections: Section[] = [];
  if (results.songs.length) {
    sections.push({ title: 'Songs', data: results.songs.map((track) => ({ kind: 'song', track })) });
  }
  const group = <T,>(key: 'albums' | 'artists', title: string, items: T[], toRow: (x: T) => Row) => {
    if (!items.length) return;
    const shown = expanded[key] ? items : items.slice(0, GROUP_PREVIEW);
    const rows = shown.map(toRow);
    if (shown.length < items.length) rows.push({ kind: 'more', group: key, count: items.length });
    sections.push({ title, data: rows });
  };
  group('albums', 'Albums', results.albums, (album) => ({ kind: 'album', album }));
  group('artists', 'Artists', results.artists, (artist) => ({ kind: 'artist', artist }));

  const hasQuery = query.trim().length > 0;
  const noResults = hasQuery && searched === query.trim() && sections.length === 0;

  return (
    <View style={[styles.screen, { backgroundColor: t.bg }]}>
      <ScreenHeader title="Search" />
      <View style={[styles.inputWrap, { backgroundColor: "#FFFFFF" }]}>
        <Ionicons name="search" size={22} color="#121212" />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Songs, albums, artists"
          placeholderTextColor="#535353"
          style={[styles.input, { color: "#121212", fontWeight: "600" }]}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          clearButtonMode="never"
          accessibilityLabel="Search your library"
        />
        {hasQuery && <IconButton icon="close-circle" label="Clear search" color="#535353" size={20} onPress={() => setQuery('')} />}
      </View>

      {!hasQuery ? (
        <View style={styles.hint}>
          <Ionicons name="musical-notes-outline" size={48} color={t.textMuted} />
          <Text style={[styles.hintText, { color: t.textMuted }]}>
            Search everything in your library, including music already on this phone. Works offline.
          </Text>
        </View>
      ) : noResults ? (
        <View style={styles.hint}>
          <Text style={[styles.hintText, { color: t.textMuted }]}>No results for “{query.trim()}”</Text>
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          stickySectionHeadersEnabled={false}
          keyExtractor={(row, i) =>
            row.kind === 'song'
              ? `s${row.track.id}`
              : row.kind === 'album'
                ? `al${row.album.album}\u0000${row.album.artist ?? ''}`
                : row.kind === 'artist'
                  ? `ar${row.artist.artist}`
                  : `more${row.group}${i}`
          }
          renderSectionHeader={({ section }) => (
            <Text style={[styles.sectionTitle, { color: t.text }]} accessibilityRole="header">
              {section.title}
            </Text>
          )}
          renderItem={({ item }) => {
            switch (item.kind) {
              case 'song':
                return (
                  <TrackRow
                    track={item.track}
                    active={item.track.id === currentId}
                    onPress={onSongPress}
                    onLongPress={onSongLongPress}
                  />
                );
              case 'album':
                return <AlbumRow album={item.album} />;
              case 'artist':
                return <ArtistRow artist={item.artist} />;
              case 'more':
                return (
                  <Pressable
                    style={styles.more}
                    onPress={() => setExpanded((e) => ({ ...e, [item.group]: true }))}
                    accessibilityRole="button"
                  >
                    <Text style={{ color: t.accent, fontWeight: '600' }}>Show all {item.count}</Text>
                  </Pressable>
                );
            }
          }}
        />
      )}
    </View>
  );
}

function AlbumRow({ album }: { album: AlbumSummary }) {
  const t = useTheme();
  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: t.surface }]}
      onPress={() => router.push({ pathname: '/album', params: { name: album.album, artist: album.artist ?? '' } })}
      accessibilityRole="button"
      accessibilityLabel={`Album ${album.album}${album.artist ? ` by ${album.artist}` : ''}`}
    >
      <CoverImage uri={album.artwork_uri} seed={album.album} size={44} />
      <View style={styles.rowText}>
        <Text numberOfLines={1} style={[styles.rowTitle, { color: t.text }]}>
          {album.album}
        </Text>
        <Text numberOfLines={1} style={{ color: t.textMuted, fontSize: 13 }}>
          Album · {album.artist ?? 'Unknown artist'}
        </Text>
      </View>
    </Pressable>
  );
}

function ArtistRow({ artist }: { artist: ArtistSummary }) {
  const t = useTheme();
  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: t.surface }]}
      onPress={() => router.push({ pathname: '/artist', params: { name: artist.artist } })}
      accessibilityRole="button"
      accessibilityLabel={`Artist ${artist.artist}, ${artist.track_count} songs`}
    >
      <CoverImage uri={null} seed={artist.artist} size={48} round />
      <View style={styles.rowText}>
        <Text numberOfLines={1} style={[styles.rowTitle, { color: t.text }]}>
          {artist.artist}
        </Text>
        <Text numberOfLines={1} style={{ color: t.textMuted, fontSize: 13 }}>
          Artist · {artist.track_count} {artist.track_count === 1 ? 'song' : 'songs'}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 8,
    paddingLeft: 12,
    borderRadius: 12,
    minHeight: TOUCH,
  },
  input: { flex: 1, fontSize: 16, paddingVertical: 10 },
  hint: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  hintText: { textAlign: 'center', fontSize: 15 },
  sectionTitle: { fontSize: 17, fontWeight: '700', paddingHorizontal: 16, paddingTop: 16, paddingBottom: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, minHeight: 64 },
  rowText: { flex: 1, minWidth: 0 },
  rowTitle: { fontSize: 16, fontWeight: '500' },
  more: { paddingHorizontal: 16, minHeight: TOUCH, justifyContent: 'center' },
});
