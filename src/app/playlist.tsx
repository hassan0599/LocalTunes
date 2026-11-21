import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { parseCovers, PlaylistCover } from '@/components/PlaylistCover';
import { showPrompt, showSheet } from '@/components/Sheet';
import { useTheme } from '@/components/theme';
import { HeaderIconButton, TrackListScreen } from '@/components/TrackListScreen';
import { useLibraryQuery } from '@/components/useLibraryQuery';
import {
  deletePlaylist,
  getPlaylist,
  listPlaylistTracks,
  removeFromPlaylist,
  renamePlaylist,
  swapInPlaylist,
  type PlaylistSummary,
} from '@/db/playlists';
import type { Track } from '@/db/queries';
import { useLibraryVersion } from '@/state/library';

type Entry = Track & { position: number };

export default function PlaylistScreen() {
  const t = useTheme();
  const db = useSQLiteContext();
  const id = Number(useLocalSearchParams<{ id: string }>().id);
  const { data: playlist } = useLibraryQuery((d) => getPlaylist(d, id), [id], null as PlaylistSummary | null);
  const { data: entries } = useLibraryQuery((d) => listPlaylistTracks(d, id), [id], [] as Entry[]);
  const bump = () => useLibraryVersion.getState().bump();
  const name = playlist?.name ?? 'Playlist';

  const menu = () =>
    showSheet({
      title: name,
      subtitle: 'Playlist',
      options: [
        {
          label: 'Rename',
          icon: 'pencil-outline',
          onPress: () =>
            showPrompt({
              title: 'Rename playlist',
              initial: name,
              confirmLabel: 'Save',
              onSubmit: async (v) => {
                await renamePlaylist(db, id, v);
                bump();
              },
            }),
        },
        {
          label: 'Delete playlist',
          icon: 'trash-outline',
          destructive: true,
          onPress: () =>
            Alert.alert('Delete playlist?', `"${name}" will be deleted. The songs stay in your library.`, [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Delete',
                style: 'destructive',
                onPress: async () => {
                  await deletePlaylist(db, id);
                  bump();
                  router.back();
                },
              },
            ]),
        },
      ],
    });

  return (
    <TrackListScreen
      title={name}
      subtitle="Playlist"
      tracks={entries}
      art={<PlaylistCover covers={parseCovers(playlist?.covers ?? null)} size={220} />}
      actions={<HeaderIconButton icon="ellipsis-horizontal" label={`Playlist options for ${name}`} onPress={menu} />}
      extraActions={(_, i) => {
        const entry = entries[i];
        const opts = [];
        if (i > 0) {
          opts.push({
            label: 'Move up',
            icon: 'arrow-up' as const,
            onPress: async () => {
              await swapInPlaylist(db, id, entry.position, entries[i - 1].position);
              bump();
            },
          });
        }
        if (i < entries.length - 1) {
          opts.push({
            label: 'Move down',
            icon: 'arrow-down' as const,
            onPress: async () => {
              await swapInPlaylist(db, id, entry.position, entries[i + 1].position);
              bump();
            },
          });
        }
        opts.push({
          label: 'Remove from this playlist',
          icon: 'remove-circle-outline' as const,
          onPress: async () => {
            await removeFromPlaylist(db, id, entry.position);
            bump();
          },
        });
        return opts;
      }}
      empty={
        <View style={styles.empty}>
          <Text style={{ color: t.text, fontSize: 18, fontWeight: '700' }}>Let’s add some songs</Text>
          <Text style={{ color: t.textMuted, textAlign: 'center' }}>
            Open any song’s menu (⋮ or long-press) and choose “Add to playlist”.
          </Text>
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  empty: { alignItems: 'center', padding: 32, gap: 8 },
});
