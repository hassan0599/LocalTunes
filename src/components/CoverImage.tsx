import Ionicons from '@expo/vector-icons/Ionicons';
import { Image, StyleSheet, View } from 'react-native';

/**
 * Cover art (spec 6.2): embedded/cached art if present, otherwise a generated
 * placeholder whose colour is derived from the album or title.
 */
export function CoverImage({ uri, seed, size }: { uri: string | null | undefined; seed: string; size: number }) {
  const radius = Math.max(4, size * 0.08);
  if (uri) {
    return (
      <Image
        source={{ uri }}
        style={{ width: size, height: size, borderRadius: radius }}
        accessibilityIgnoresInvertColors
      />
    );
  }
  const hue = hash(seed) % 360;
  return (
    <View
      style={[styles.placeholder, { width: size, height: size, borderRadius: radius, backgroundColor: `hsl(${hue}, 45%, 42%)` }]}
    >
      <Ionicons name="musical-notes" size={size * 0.45} color="rgba(255,255,255,0.85)" />
    </View>
  );
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

const styles = StyleSheet.create({
  placeholder: { alignItems: 'center', justifyContent: 'center' },
});
