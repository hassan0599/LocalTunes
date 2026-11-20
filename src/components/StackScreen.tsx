import { Stack } from 'expo-router';
import type { ReactNode } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MiniPlayer } from './MiniPlayer';
import { useTheme } from './theme';

/** Pushed (non-tab) screen with a header title and the mini player at the bottom. */
export function StackScreen({ title, children }: { title: string; children: ReactNode }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <Stack.Screen options={{ title }} />
      <View style={{ flex: 1 }}>{children}</View>
      <View style={{ paddingBottom: insets.bottom }}>
        <MiniPlayer />
      </View>
    </View>
  );
}
