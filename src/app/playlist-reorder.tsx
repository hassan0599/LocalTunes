import { useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useMemo } from 'react';
import { StyleSheet, Text } from 'react-native';

import { ReorderList } from '@/components/ReorderList';
import { StackScreen } from '@/components/StackScreen';
import { useTheme } from '@/components/theme';
import { occurrenceKeys, TrackLine } from '@/components/TrackLine';
import { useLibraryQuery } from '@/components/useLibraryQuery';
import { getPlaylist, listPlaylistTracks, moveInPlaylist, type PlaylistSummary } from '@/db/playlists';
import type { Track } from '@/db/queries';
import { useLibraryVersion } from '@/state/library';

type Entry = Track & { position: number };

const ROW = 64;

/** Drag songs into a new order; each drop is saved straight away. */
export default function PlaylistReorderScreen() {
  const t = useTheme();
  const db = useSQLiteContext();
  const id = Number(useLocalSearchParams<{ id: string }>().id);
  const { data: playlist } = useLibraryQuery((d) => getPlaylist(d, id), [id], null as PlaylistSummary | null);
  const { data: entries } = useLibraryQuery((d) => listPlaylistTracks(d, id), [id], [] as Entry[]);
  const keys = useMemo(() => occurrenceKeys(entries), [entries]);
  const keyOf = useMemo(() => {
    const byEntry = new Map(entries.map((e, i) => [e, keys[i]]));
    return (e: Entry) => byEntry.get(e) ?? `${e.id}@${e.position}`;
  }, [entries, keys]);

  const onMove = async (from: number, to: number) => {
    await moveInPlaylist(db, id, from, to);
    useLibraryVersion.getState().bump();
  };

  return (
    <StackScreen title={playlist ? `Reorder ${playlist.name}` : 'Reorder'}>
      <ReorderList
        items={entries}
        keyOf={keyOf}
        rowHeight={ROW}
        renderRow={(e) => <TrackLine track={e} />}
        itemLabel={(e) => e.title}
        onMove={(from, to) => void onMove(from, to)}
        header={
          <Text style={[styles.hint, { color: t.textMuted }]}>
            Drag the handle to move a song. Changes are saved as you go.
          </Text>
        }
      />
    </StackScreen>
  );
}

const styles = StyleSheet.create({
  hint: { paddingHorizontal: 16, paddingVertical: 12, fontSize: 13 },
});
