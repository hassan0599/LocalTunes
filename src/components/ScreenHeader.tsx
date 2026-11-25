import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from './theme';

/** Tab screen header: a flat bar with a large title (no colour wash). */
export function ScreenHeader({ title, right }: { title: string; right?: ReactNode }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ paddingTop: insets.top }}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: t.text }]} accessibilityRole="header">
          {title}
        </Text>
        <View style={styles.right}>{right}</View>
      </View>
    </View>
  );
}

/** A faint ink lift behind album/player artwork, fading into the background. */
export function HeroGradient({ height = 320, color }: { height?: number; color?: string }) {
  const t = useTheme();
  return (
    <LinearGradient
      colors={[color ?? t.heroTop, t.bg]}
      style={[StyleSheet.absoluteFill, { height }]}
      pointerEvents="none"
    />
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12 },
  title: { flex: 1, fontSize: 30, fontWeight: '700' },
  right: { flexDirection: 'row', alignItems: 'center', gap: 4 },
});
