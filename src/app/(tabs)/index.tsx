import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { CoverImage } from '@/components/CoverImage';
import { DeviceMusicBanner } from '@/components/DeviceMusicBanner';
import { parseCovers, PlaylistCover } from '@/components/PlaylistCover';
import { showPrompt } from '@/components/Sheet';
import { createPlaylist, listPlaylists, type PlaylistSummary } from '@/db/playlists';
import { IconButton } from '@/components/IconButton';
import { ScreenHeader } from '@/components/ScreenHeader';
import { SegmentedControl } from '@/components/SegmentedControl';
import { SmartPlaylistArt } from '@/components/SmartPlaylistArt';
import { SMART_PLAYLISTS, smartPlaylistCounts } from '@/db/smartPlaylists';
import { TOUCH, useTheme } from '@/components/theme';
import { showTrackActions } from '@/components/trackActions';
import { TRACK_ROW_HEIGHT, TrackRow } from '@/components/TrackRow';
import { useLibraryQuery } from '@/components/useLibraryQuery';
import {
  listAlbums,
  listArtists,
  listTracks,
  type AlbumSummary,
  type ArtistSummary,
  type SongSort,
  type Track,
} from '@/db/queries';
import { scanDevice } from '@/services/media/deviceScan';
import { pickAndImport } from '@/services/media/importer';
import { playTracks } from '@/services/playback/PlaybackService';
import { useLibraryVersion } from '@/state/library';
import { selectCurrentTrack, usePlayer } from '@/state/player';
import { useScan } from '@/state/scan';

type Section = 'songs' | 'playlists' | 'albums' | 'artists';

const SECTIONS: { value: Section; label: string }[] = [
  { value: 'songs', label: 'Songs' },
  { value: 'playlists', label: 'Playlists' },
  { value: 'albums', label: 'Albums' },
  { value: 'artists', label: 'Artists' },
];

const LIST_HEADER_HEIGHT = 48;

const SORT_NEXT: Record<SongSort, SongSort> = { title: 'artist', artist: 'added', added: 'title' };
const SORT_LABEL: Record<SongSort, string> = { title: 'Title', artist: 'Artist', added: 'Recently added' };

export default function LibraryScreen() {
  const t = useTheme();
  const db = useSQLiteContext();
  const [section, setSection] = useState<Section>('songs');
  const [sort, setSort] = useState<SongSort>('title');
  const [importing, setImporting] = useState(false);

  const onImport = useCallback(async () => {
    setImporting(true);
    try {
      const res = await pickAndImport(db);
      if (!res) return;
      useLibraryVersion.getState().bump();
      if (res.failed.length) {
        Alert.alert(
          `Imported ${res.imported}, ${res.failed.length} failed`,
          res.failed.map((f) => `${f.name}: ${f.error}`).join('\n'),
        );
      }
    } catch (e) {
      Alert.alert('Import failed', e instanceof Error ? e.message : String(e));
    } finally {
      setImporting(false);
    }
  }, [db]);

  return (
    <View style={[styles.screen, { backgroundColor: t.bg }]}>
      <ScreenHeader
        title="Library"
        right={
          importing ? (
            <ActivityIndicator color={t.accent} style={{ width: TOUCH }} accessibilityLabel="Importing" />
          ) : (
            <>
              <IconButton icon="add-circle-outline" label="Import audio files" onPress={onImport} size={28} />
              <IconButton icon="settings-outline" label="Settings" onPress={() => router.push('/settings')} size={26} />
            </>
          )
        }
      />
      <View style={styles.segments}>
        <SegmentedControl options={SECTIONS} value={section} onChange={setSection} />
      </View>
      <DeviceMusicBanner />

      {section === 'songs' && <Songs sort={sort} onSort={() => setSort(SORT_NEXT[sort])} onImport={onImport} />}
      {section === 'albums' && <Albums />}
      {section === 'artists' && <Artists />}
      {section === 'playlists' && <Playlists />}
    </View>
  );
}

function Songs({ sort, onSort, onImport }: { sort: SongSort; onSort: () => void; onImport: () => void }) {
  const t = useTheme();
  const db = useSQLiteContext();
  const { data: tracks, loading } = useLibraryQuery((d) => listTracks(d, sort), [sort], [] as Track[]);
  const currentId = usePlayer((s) => selectCurrentTrack(s)?.id);

  const onPress = useCallback(
    (track: Track) => playTracks(tracks, tracks.indexOf(track)),
    [tracks],
  );
  const onLongPress = useCallback((track: Track) => showTrackActions(db, track), [db]);
  const scanning = useScan((s) => s.scanning);
  const [pulled, setPulled] = useState(false);
  const onRefresh = useCallback(async () => {
    setPulled(true);
    try {
      await scanDevice(db, 'manual');
    } finally {
      setPulled(false);
    }
  }, [db]);
  const refreshControl =
    Platform.OS === 'android' ? (
      <RefreshControl refreshing={pulled && scanning} onRefresh={onRefresh} colors={[t.accent]} />
    ) : undefined;

  if (!loading && tracks.length === 0) {
    return (
      <ScrollView contentContainerStyle={styles.empty} refreshControl={refreshControl}>
        <Ionicons name="musical-notes-outline" size={56} color={t.textMuted} />
        <Text style={[styles.emptyTitle, { color: t.text }]}>Your library is empty</Text>
        <Text style={[styles.emptyBody, { color: t.textMuted }]}>
          Import audio files you own. They are copied into localtunes and play offline.
          {Platform.OS === 'android' ? ' Pull down to look for music already on this phone.' : ''}
        </Text>
        <Pressable
          onPress={onImport}
          style={[styles.cta, { backgroundColor: t.accent }]}
          accessibilityRole="button"
        >
          <Text style={{ color: t.onAccent, fontWeight: '600', fontSize: 16 }}>Import music</Text>
        </Pressable>
      </ScrollView>
    );
  }

  return (
    <FlatList
      data={tracks}
      keyExtractor={(item) => String(item.id)}
      refreshControl={refreshControl}
      getItemLayout={(_, index) => ({
        length: TRACK_ROW_HEIGHT,
        offset: LIST_HEADER_HEIGHT + TRACK_ROW_HEIGHT * index,
        index,
      })}
      ListHeaderComponent={
        <View style={styles.listHeader}>
          <Text style={{ color: t.textMuted }}>
            {tracks.length} {tracks.length === 1 ? 'song' : 'songs'}
          </Text>
          <Pressable onPress={onSort} style={styles.sortBtn} accessibilityRole="button" accessibilityLabel={`Sort by ${SORT_LABEL[sort]}. Tap to change.`}>
            <Ionicons name="swap-vertical" size={16} color={t.accent} />
            <Text style={{ color: t.accent, fontWeight: '600' }}>{SORT_LABEL[sort]}</Text>
          </Pressable>
        </View>
      }
      renderItem={({ item }) => (
        <TrackRow track={item} active={item.id === currentId} onPress={onPress} onLongPress={onLongPress} />
      )}
      initialNumToRender={20}
      windowSize={11}
    />
  );
}

function Albums() {
  const t = useTheme();
  const { data } = useLibraryQuery(listAlbums, [], [] as AlbumSummary[]);
  return (
    <FlatList
      data={data}
      numColumns={2}
      keyExtractor={(a) => `${a.album}\u0000${a.artist ?? ''}`}
      columnWrapperStyle={{ gap: 16, paddingHorizontal: 16 }}
      contentContainerStyle={{ gap: 16, paddingVertical: 8 }}
      ListEmptyComponent={<Text style={[styles.none, { color: t.textMuted }]}>No albums yet</Text>}
      renderItem={({ item }) => (
        <Pressable
          style={styles.albumCell}
          onPress={() => router.push({ pathname: '/album', params: { name: item.album, artist: item.artist ?? '' } })}
          accessibilityRole="button"
          accessibilityLabel={`Album ${item.album}${item.artist ? ` by ${item.artist}` : ''}, ${item.track_count} songs`}
        >
          <View style={{ aspectRatio: 1 }}>
            <AlbumCover uri={item.artwork_uri} seed={item.album} />
          </View>
          <Text numberOfLines={1} style={[styles.albumTitle, { color: t.text }]}>
            {item.album}
          </Text>
          <Text numberOfLines={1} style={{ color: t.textMuted, fontSize: 13 }}>
            {item.artist ?? 'Unknown artist'}
          </Text>
        </Pressable>
      )}
    />
  );
}

function AlbumCover({ uri, seed }: { uri: string | null; seed: string }) {
  const [width, setWidth] = useState(0);
  return (
    <View style={{ flex: 1 }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {width > 0 && <CoverImage uri={uri} seed={seed} size={width} />}
    </View>
  );
}

function Playlists() {
  const t = useTheme();
  const db = useSQLiteContext();
  const { data } = useLibraryQuery(listPlaylists, [], [] as PlaylistSummary[]);
  const { data: smartCounts } = useLibraryQuery(smartPlaylistCounts, [], null as Awaited<ReturnType<typeof smartPlaylistCounts>> | null);
  const create = () =>
    showPrompt({
      title: "Give your playlist a name",
      placeholder: "My playlist",
      confirmLabel: "Create",
      onSubmit: async (name) => {
        const id = await createPlaylist(db, name);
        useLibraryVersion.getState().bump();
        router.push({ pathname: "/playlist", params: { id: String(id) } });
      },
    });
  return (
    <FlatList
      data={data}
      keyExtractor={(p) => String(p.id)}
      ListHeaderComponent={
        <>
        <Pressable
          style={({ pressed }) => [styles.artistRow, pressed && { backgroundColor: t.surface }]}
          onPress={create}
          accessibilityRole="button"
        >
          <View style={[styles.newPlaylist, { backgroundColor: t.elevated }]}>
            <Ionicons name="add" size={30} color={t.text} />
          </View>
          <Text style={{ color: t.text, fontSize: 16, fontWeight: "600" }}>New playlist</Text>
        </Pressable>
        {SMART_PLAYLISTS.map((sp) => {
          const n = smartCounts?.[sp.id];
          return (
            <Pressable
              key={sp.id}
              style={({ pressed }) => [styles.artistRow, pressed && { backgroundColor: t.surface }]}
              onPress={() => router.push({ pathname: "/smart-playlist", params: { id: sp.id } })}
              accessibilityRole="button"
              accessibilityLabel={`${sp.name}, smart playlist${n != null ? `, ${n} songs` : ""}`}
            >
              <SmartPlaylistArt playlist={sp} size={56} />
              <View style={{ flex: 1 }}>
                <Text numberOfLines={1} style={{ color: t.text, fontSize: 16, fontWeight: "600" }}>
                  {sp.name}
                </Text>
                <Text numberOfLines={1} style={{ color: t.textMuted, fontSize: 13 }}>
                  Smart playlist{n != null ? ` · ${n} ${n === 1 ? "song" : "songs"}` : ""}
                </Text>
              </View>
            </Pressable>
          );
        })}
        </>
      }
      renderItem={({ item }) => (
        <Pressable
          style={({ pressed }) => [styles.artistRow, pressed && { backgroundColor: t.surface }]}
          onPress={() => router.push({ pathname: "/playlist", params: { id: String(item.id) } })}
          accessibilityRole="button"
          accessibilityLabel={`Playlist ${item.name}, ${item.track_count} songs`}
        >
          <PlaylistCover covers={parseCovers(item.covers)} size={56} />
          <View style={{ flex: 1 }}>
            <Text numberOfLines={1} style={{ color: t.text, fontSize: 16, fontWeight: "600" }}>
              {item.name}
            </Text>
            <Text style={{ color: t.textMuted, fontSize: 13 }}>
              Playlist · {item.track_count} {item.track_count === 1 ? "song" : "songs"}
            </Text>
          </View>
        </Pressable>
      )}
    />
  );
}

function Artists() {
  const t = useTheme();
  const { data } = useLibraryQuery(listArtists, [], [] as ArtistSummary[]);
  return (
    <FlatList
      data={data}
      keyExtractor={(a) => a.artist}
      ListEmptyComponent={<Text style={[styles.none, { color: t.textMuted }]}>No artists yet</Text>}
      renderItem={({ item }) => (
        <Pressable
          style={({ pressed }) => [styles.artistRow, pressed && { backgroundColor: t.surface }]}
          onPress={() => router.push({ pathname: '/artist', params: { name: item.artist } })}
          accessibilityRole="button"
          accessibilityLabel={`${item.artist}, ${item.track_count} songs`}
        >
          <CoverImage uri={null} seed={item.artist} size={48} round />
          <View style={{ flex: 1 }}>
            <Text numberOfLines={1} style={{ color: t.text, fontSize: 16, fontWeight: '500' }}>
              {item.artist}
            </Text>
            <Text style={{ color: t.textMuted, fontSize: 13 }}>
              {item.album_count} {item.album_count === 1 ? 'album' : 'albums'} · {item.track_count}{' '}
              {item.track_count === 1 ? 'song' : 'songs'}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={t.textMuted} />
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  newPlaylist: { width: 56, height: 56, borderRadius: 4, alignItems: "center", justifyContent: "center" },
  screen: { flex: 1 },
  segments: { paddingBottom: 8 },
  listHeader: { height: LIST_HEADER_HEIGHT, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16 },
  sortBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: TOUCH, paddingLeft: 8 },
  empty: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  emptyTitle: { fontSize: 20, fontWeight: '700' },
  emptyBody: { textAlign: 'center', fontSize: 15 },
  cta: { marginTop: 8, paddingHorizontal: 24, minHeight: TOUCH + 4, borderRadius: 24, justifyContent: 'center' },
  none: { textAlign: 'center', marginTop: 48 },
  albumCell: { flex: 1, gap: 4 },
  albumTitle: { fontSize: 15, fontWeight: '600', marginTop: 4 },
  artistRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, minHeight: 64 },
});
