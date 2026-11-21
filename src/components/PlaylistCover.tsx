import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { Image, StyleSheet, View } from 'react-native';

import { useTheme } from './theme';

/** 2×2 mosaic of the first covers, or a red gradient with a note when there are none. */
export function PlaylistCover({ covers, size }: { covers: string[]; size: number }) {
  const t = useTheme();
  const r = Math.max(4, size * 0.04);
  if (covers.length >= 4) {
    const half = size / 2;
    return (
      <View style={{ width: size, height: size, borderRadius: r, overflow: 'hidden', flexDirection: 'row', flexWrap: 'wrap' }}>
        {covers.slice(0, 4).map((uri) => (
          <Image key={uri} source={{ uri }} style={{ width: half, height: half }} accessibilityIgnoresInvertColors />
        ))}
      </View>
    );
  }
  if (covers.length > 0) {
    return <Image source={{ uri: covers[0] }} style={{ width: size, height: size, borderRadius: r }} accessibilityIgnoresInvertColors />;
  }
  return (
    <LinearGradient colors={[t.accent, '#5C1520']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.empty, { width: size, height: size, borderRadius: r }]}>
      <Ionicons name="musical-notes" size={size * 0.42} color="rgba(255,255,255,0.9)" />
    </LinearGradient>
  );
}

export function parseCovers(json: string | null): string[] {
  try {
    return (JSON.parse(json ?? '[]') as (string | null)[]).filter((x): x is string => !!x);
  } catch {
    return [];
  }
}

const styles = StyleSheet.create({
  empty: { alignItems: 'center', justifyContent: 'center' },
});
