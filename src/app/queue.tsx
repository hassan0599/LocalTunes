import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { IconButton } from '@/components/IconButton';
import { ReorderList } from '@/components/ReorderList';
import { StackScreen } from '@/components/StackScreen';
import { useTheme } from '@/components/theme';
import { occurrenceKeys, TrackLine } from '@/components/TrackLine';
import type { Track } from '@/db/queries';
import { moveInQueue, removeQueueAt } from '@/services/playback/PlaybackService';
import { selectCurrentTrack, usePlayer } from '@/state/player';

const ROW = 64;

/** The upcoming songs: drag to reorder, × to remove. The current song stays put. */
export default function QueueScreen() {
  const t = useTheme();
  const queue = usePlayer((s) => s.queue);
  const index = usePlayer((s) => s.index);
  const current = usePlayer(selectCurrentTrack);
  const upNext = useMemo(() => queue.slice(index + 1), [queue, index]);
  const keys = useMemo(() => occurrenceKeys(upNext), [upNext]);
  const keyOf = useMemo(() => {
    const byTrack = new Map<Track, string>(upNext.map((tr, i) => [tr, keys[i]]));
    return (tr: Track, i: number) => byTrack.get(tr) ?? `${tr.id}@${i}`;
  }, [upNext, keys]);

  return (
    <StackScreen title="Queue">
      <ReorderList
        items={upNext}
        keyOf={keyOf}
        rowHeight={ROW}
        itemLabel={(tr) => tr.title}
        onMove={(from, to) => moveInQueue(index + 1 + from, index + 1 + to)}
        renderRow={(tr, i) => (
          <View style={styles.line}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <TrackLine track={tr} />
            </View>
            <IconButton icon="close" label={`Remove ${tr.title} from the queue`} color={t.textMuted} size={20} onPress={() => removeQueueAt(index + 1 + i)} />
          </View>
        )}
        header={
          <View>
            {current && (
              <>
                <Text style={[styles.heading, { color: t.textMuted }]}>Now playing</Text>
                <View style={{ height: ROW, justifyContent: 'center' }}>
                  <TrackLine track={current} />
                </View>
              </>
            )}
            <Text style={[styles.heading, { color: t.textMuted }]}>
              {upNext.length ? `Up next · ${upNext.length} ${upNext.length === 1 ? 'song' : 'songs'}` : 'Nothing queued after this song'}
            </Text>
          </View>
        }
      />
    </StackScreen>
  );
}

const styles = StyleSheet.create({
  heading: { fontSize: 13, fontWeight: '600', paddingHorizontal: 16, paddingTop: 16, paddingBottom: 6 },
  line: { flexDirection: 'row', alignItems: 'center' },
});
