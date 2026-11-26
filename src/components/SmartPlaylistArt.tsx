import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet } from 'react-native';

import type { SmartPlaylist } from '@/db/smartPlaylists';

import { artRadius, shade, tileColor } from './theme';

/** Cover for a smart playlist: its icon on a two-tone tile from the shared palette. */
export function SmartPlaylistArt({ playlist, size }: { playlist: SmartPlaylist; size: number }) {
  const color = tileColor(playlist.id);
  return (
    <LinearGradient
      colors={[color, shade(color, 0.45)]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[styles.art, { width: size, height: size, borderRadius: artRadius(size) }]}
    >
      <Ionicons name={playlist.icon} size={size * 0.42} color="rgba(255,255,255,0.92)" />
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  art: { alignItems: 'center', justifyContent: 'center' },
});
