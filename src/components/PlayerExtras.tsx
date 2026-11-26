import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  cancelSleepTimer,
  setPlaybackRate,
  sleepAtEndOfTrack,
  startSleepTimer,
} from '@/services/playback/PlaybackService';
import { formatRate, formatRemaining, SLEEP_PRESETS, SPEEDS, type SleepTimer } from '@/services/playback/sleep';
import { usePlayer } from '@/state/player';

import { showSheet, type SheetOption } from './Sheet';
import { radius, TOUCH, useTheme } from './theme';

/** Speed and sleep-timer buttons under the player controls. */
export function PlayerExtras() {
  const rate = usePlayer((s) => s.rate);
  const sleep = usePlayer((s) => s.sleep);
  const remaining = useRemaining(sleep);

  const chooseSpeed = () =>
    showSheet({
      title: 'Playback speed',
      subtitle: 'Applies to every song until you change it',
      options: SPEEDS.map<SheetOption>((s) => ({
        label: `${formatRate(s)}${s === 1 ? '  (normal)' : ''}${s === rate ? '  ✓' : ''}`,
        icon: s === rate ? 'checkmark-circle' : 'speedometer-outline',
        onPress: () => setPlaybackRate(s),
      })),
    });

  const chooseSleep = () =>
    showSheet({
      title: 'Sleep timer',
      subtitle: sleep ? `Stops ${sleep.kind === 'track' ? 'at the end of this song' : `in ${remaining}`}` : 'Stop playing after…',
      options: [
        ...SLEEP_PRESETS.map<SheetOption>((m) => ({
          label: m < 60 ? `${m} minutes` : m === 60 ? '1 hour' : `${m / 60} hours`,
          icon: 'moon-outline',
          onPress: () => startSleepTimer(m),
        })),
        { label: 'End of this song', icon: 'musical-note-outline', onPress: sleepAtEndOfTrack },
        ...(sleep ? [{ label: 'Turn off timer', icon: 'close-circle-outline' as const, onPress: cancelSleepTimer, destructive: true }] : []),
      ],
    });

  return (
    <View style={styles.row}>
      <Chip
        icon="speedometer-outline"
        label={formatRate(rate)}
        active={rate !== 1}
        onPress={chooseSpeed}
        a11y={`Playback speed ${formatRate(rate)}. Tap to change.`}
      />
      <Chip
        icon={sleep ? 'moon' : 'moon-outline'}
        label={sleep ? (sleep.kind === 'track' ? 'End of song' : remaining) : 'Sleep'}
        active={!!sleep}
        onPress={chooseSleep}
        a11y={sleep ? `Sleep timer on, ${sleep.kind === 'track' ? 'stops at the end of this song' : `${remaining} left`}. Tap to change.` : 'Sleep timer off. Tap to set.'}
      />
    </View>
  );
}

/** Remaining time on a timed sleep timer, re-rendered every second. */
function useRemaining(sleep: SleepTimer | null): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (sleep?.kind !== 'time') return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [sleep]);
  return sleep?.kind === 'time' ? formatRemaining(sleep.endsAt - now) : '';
}

function Chip({
  icon,
  label,
  active,
  onPress,
  a11y,
}: {
  icon: 'speedometer-outline' | 'moon' | 'moon-outline';
  label: string;
  active: boolean;
  onPress: () => void;
  a11y: string;
}) {
  const t = useTheme();
  const color = active ? t.accent : t.textMuted;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.chip, { backgroundColor: pressed ? t.elevated : t.surface }]}
      accessibilityRole="button"
      accessibilityLabel={a11y}
    >
      <Ionicons name={icon} size={16} color={color} />
      <Text style={[styles.label, { color: active ? t.text : t.textMuted }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { alignSelf: 'stretch', flexDirection: 'row', justifyContent: 'center', gap: 10, marginTop: 16 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: TOUCH - 4, paddingHorizontal: 14, borderRadius: radius.md },
  label: { fontSize: 14, fontWeight: '600', fontVariant: ['tabular-nums'] },
});
