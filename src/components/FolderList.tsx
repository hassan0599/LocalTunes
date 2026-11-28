import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useSQLiteContext, type SQLiteDatabase } from 'expo-sqlite';
import { useCallback, useMemo } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import type { Track } from '@/db/queries';
import { allTrackIdsUnder, buildFolderTree, listFolder, type FolderEntry } from '@/services/media/folders';
import { playTracks } from '@/services/playback/PlaybackService';
import { selectCurrentTrack, usePlayer } from '@/state/player';

import { radius, TOUCH, useTheme } from './theme';
import { showTrackActions } from './trackActions';
import { TrackRow } from './TrackRow';
import { useLibraryQuery } from './useLibraryQuery';

type Row = { kind: 'folder'; folder: FolderEntry } | { kind: 'track'; track: Track };

const allTracks = (db: SQLiteDatabase) => db.getAllAsync<Track>('SELECT * FROM tracks');

/** One folder level: subfolders first, then the songs directly inside. */
export function FolderList({ path }: { path: string }) {
  const t = useTheme();
  const db = useSQLiteContext();
  const { data: tracks, loading } = useLibraryQuery(allTracks, [], [] as Track[]);
  const currentId = usePlayer((s) => selectCurrentTrack(s)?.id);

  const { rows, here, under } = useMemo(() => {
    const byId = new Map(tracks.map((tr) => [tr.id, tr]));
    const tree = buildFolderTree(tracks);
    const listing = listFolder(tree, path);
    const songs = listing.trackIds.map((id) => byId.get(id)).filter((tr): tr is Track => !!tr);
    const all = allTrackIdsUnder(tree, path).map((id) => byId.get(id)).filter((tr): tr is Track => !!tr);
    return {
      rows: [...listing.folders.map<Row>((folder) => ({ kind: 'folder', folder })), ...songs.map<Row>((track) => ({ kind: 'track', track }))],
      here: songs,
      under: all,
    };
  }, [tracks, path]);

  const onSong = useCallback((track: Track) => playTracks(here, here.indexOf(track)), [here]);
  const onLongPress = useCallback((track: Track) => showTrackActions(db, track), [db]);

  if (!loading && !rows.length) {
    return <Text style={[styles.none, { color: t.textMuted }]}>{path ? 'This folder is empty' : 'No music yet'}</Text>;
  }

  return (
    <FlatList
      data={rows}
      keyExtractor={(r) => (r.kind === 'folder' ? `f:${r.folder.path}` : `t:${r.track.id}`)}
      ListHeaderComponent={
        under.length > 0 ? (
          <View style={styles.header}>
            <Text style={{ color: t.textMuted, flex: 1 }}>
              {under.length} {under.length === 1 ? 'song' : 'songs'}
            </Text>
            <Pressable
              onPress={() => playTracks(under, 0)}
              style={({ pressed }) => [styles.playAll, { backgroundColor: pressed ? t.accentPressed : t.accent }]}
              accessibilityRole="button"
              accessibilityLabel={`Play all ${under.length} songs in this folder and its subfolders`}
            >
              <Ionicons name="play" size={16} color={t.onAccent} />
              <Text style={{ color: t.onAccent, fontWeight: '700' }}>Play all</Text>
            </Pressable>
          </View>
        ) : undefined
      }
      renderItem={({ item }) =>
        item.kind === 'folder' ? (
          <Pressable
            onPress={() => router.push({ pathname: '/folder', params: { path: item.folder.path } })}
            style={({ pressed }) => [styles.folder, pressed && { backgroundColor: t.surface }]}
            accessibilityRole="button"
            accessibilityLabel={`Folder ${item.folder.name}, ${item.folder.count} songs`}
          >
            <View style={[styles.folderIcon, { backgroundColor: t.surface }]}>
              <Ionicons name="folder" size={24} color={t.textMuted} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ color: t.text, fontSize: 16, fontWeight: '500' }}>
                {item.folder.name}
              </Text>
              <Text style={{ color: t.textMuted, fontSize: 13 }}>
                {item.folder.count} {item.folder.count === 1 ? 'song' : 'songs'}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={t.textMuted} />
          </Pressable>
        ) : (
          <TrackRow track={item.track} active={item.track.id === currentId} onPress={onSong} onLongPress={onLongPress} />
        )
      }
    />
  );
}

const styles = StyleSheet.create({
  none: { textAlign: 'center', marginTop: 48 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8, gap: 12 },
  playAll: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: TOUCH - 4, paddingHorizontal: 14, borderRadius: radius.md },
  folder: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingLeft: 16, paddingRight: 12, minHeight: 64 },
  folderIcon: { width: 48, height: 48, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
});
