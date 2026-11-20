import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { useLibraryMatcher } from '@/components/discover/hooks';
import { InLibraryBadge, RemoteCover, WishlistButton } from '@/components/discover/parts';
import { StackScreen } from '@/components/StackScreen';
import { useTheme } from '@/components/theme';
import { playTracks } from '@/services/playback/PlaybackService';
import { useWishlist, type WishItem } from '@/state/wishlist';

/** Songs and albums saved from Discover (spec 10: keep interest when there's no audio yet). */
export default function WishlistScreen() {
  const t = useTheme();
  const items = useWishlist((s) => s.items);
  return (
    <StackScreen title="Wishlist">
      <FlatList
        data={items}
        keyExtractor={(i) => i.mbid}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="bookmark-outline" size={48} color={t.textMuted} />
            <Text style={{ color: t.textMuted, textAlign: 'center' }}>
              Tap the bookmark on songs and albums in Discover to save them here.
            </Text>
          </View>
        }
        renderItem={({ item }) => <WishRow item={item} />}
      />
    </StackScreen>
  );
}

function WishRow({ item }: { item: WishItem }) {
  const t = useTheme();
  const matcher = useLibraryMatcher();
  const isAlbum = item.kind === 'release-group';
  const artists = item.artist ? [{ id: '', name: item.artist }] : [];
  const match = !isAlbum ? matcher?.matchRecording({ id: item.mbid, title: item.title, artistCredit: item.artist ?? '', artists }) : undefined;
  const ownedAlbum = isAlbum && !!matcher?.hasReleaseGroup({ title: item.title, artistCredit: item.artist ?? '', artists });
  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: t.surface }]}
      onPress={() => {
        if (isAlbum) router.push({ pathname: '/mb-album', params: { id: item.mbid, title: item.title } });
        else if (match) playTracks([match], 0);
      }}
      accessibilityRole="button"
    >
      {isAlbum ? (
        <RemoteCover releaseGroupId={item.mbid} seed={item.title} size={52} />
      ) : (
        <View style={[styles.icon, { backgroundColor: t.surface }]}>
          <Ionicons name="musical-note" size={22} color={t.textMuted} />
        </View>
      )}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ color: t.text, fontSize: 16, fontWeight: '500' }}>
          {item.title}
        </Text>
        <Text numberOfLines={1} style={{ color: t.textMuted, fontSize: 13 }}>
          {[isAlbum ? 'Album' : 'Song', item.artist].filter(Boolean).join(' · ')}
        </Text>
        {(match || ownedAlbum) && <InLibraryBadge />}
      </View>
      <WishlistButton mbid={item.mbid} kind={item.kind} title={item.title} artist={item.artist} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  empty: { alignItems: 'center', padding: 32, gap: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingLeft: 16, paddingRight: 4, minHeight: 68, paddingVertical: 8 },
  icon: { width: 52, height: 52, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
});
