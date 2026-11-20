import Ionicons from '@expo/vector-icons/Ionicons';
import { TabList, TabSlot, TabTrigger, Tabs, type TabTriggerSlotProps } from 'expo-router/ui';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MiniPlayer } from '@/components/MiniPlayer';
import { TOUCH, useTheme } from '@/components/theme';

type IconName = ComponentProps<typeof Ionicons>['name'];

/** Headless tabs so the MiniPlayer can sit between the screen and the tab bar (spec 5). */
export default function TabsLayout() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    // TabList must be a direct child of Tabs: expo-router only discovers triggers there.
    <Tabs style={{ flex: 1, backgroundColor: t.bg }}>
      <TabSlot style={{ flex: 1 }} />
      <MiniPlayer />
      <TabList style={[styles.bar, { backgroundColor: t.bg, borderTopColor: t.border, paddingBottom: insets.bottom }]}>
          <TabTrigger name="index" href="/" asChild>
            <TabButton icon="library" label="Library" />
          </TabTrigger>
          <TabTrigger name="search" href="/search" asChild>
            <TabButton icon="search" label="Search" />
          </TabTrigger>
          <TabTrigger name="discover" href="/discover" asChild>
            <TabButton icon="compass" label="Discover" />
          </TabTrigger>
          <TabTrigger name="downloads" href="/downloads" asChild>
            <TabButton icon="download" label="Downloads" />
          </TabTrigger>
      </TabList>
    </Tabs>
  );
}

function TabButton({
  icon,
  label,
  isFocused,
  ref: _ref, // expo-router's ref type doesn't match Pressable's; not needed here
  ...props
}: TabTriggerSlotProps & { icon: IconName; label: string }) {
  const t = useTheme();
  const color = isFocused ? t.accent : t.textMuted;
  return (
    <Pressable
      {...props}
      style={styles.tab}
      accessibilityRole="tab"
      accessibilityLabel={label}
      accessibilityState={{ selected: isFocused }}
    >
      <Ionicons name={isFocused ? icon : (`${icon}-outline` as IconName)} size={22} color={color} />
      <Text style={[styles.label, { color }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth },
  tab: { flex: 1, minHeight: TOUCH + 8, alignItems: 'center', justifyContent: 'center', paddingVertical: 6 },
  label: { fontSize: 11, marginTop: 2 },
});
