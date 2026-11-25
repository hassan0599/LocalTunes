import Ionicons from '@expo/vector-icons/Ionicons';
import { Image, StyleSheet, View } from 'react-native';

import { artRadius, tileColor, useTheme } from './theme';

/**
 * Cover art (spec 6.2): embedded/cached art if present, otherwise a generated
 * placeholder whose colour is derived from the album or title. `round` for artists.
 */
export function CoverImage({ uri, seed, size, round }: { uri: string | null | undefined; seed: string; size: number; round?: boolean }) {
  const t = useTheme();
  const radius = round ? size / 2 : artRadius(size);
  if (uri) {
    return (
      <Image
        source={{ uri }}
        style={{ width: size, height: size, borderRadius: radius, backgroundColor: t.surface }}
        accessibilityIgnoresInvertColors
      />
    );
  }
  return (
    <View style={[styles.placeholder, { width: size, height: size, borderRadius: radius, backgroundColor: t.surface }]}>
      <View style={[StyleSheet.absoluteFill, { backgroundColor: tileColor(seed), opacity: 0.35, borderRadius: radius }]} />
      <Ionicons name={round ? 'person' : 'musical-notes'} size={size * 0.42} color="rgba(255,255,255,0.75)" />
    </View>
  );
}

const styles = StyleSheet.create({
  placeholder: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
});
