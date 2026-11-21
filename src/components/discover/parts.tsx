/** Building blocks for Discover screens: banners, rows, badges. */
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import type { Track } from '@/db/queries';
import { yearOf } from '@/services/musicbrainz/mappers';
import type { MbArtist, MbRecording, MbReleaseGroup } from '@/services/musicbrainz/types';
import { playTracks } from '@/services/playback/PlaybackService';
import { formatTime } from '@/services/playback/queue';
import { useNetwork } from '@/state/network';
import { toggleWishlist, useWishlist, type WishKind } from '@/state/wishlist';

import { CoverImage } from '../CoverImage';
import { IconButton } from '../IconButton';
import { TOUCH, tileColor, useTheme } from '../theme';
import { useCoverArt, type MbState } from './hooks';

// ---------------------------------------------------------------- status

/** Spec 6.3: "Offline, showing saved results". */
export function OfflineBanner({ stale }: { stale?: boolean }) {
  const t = useTheme();
  const online = useNetwork((s) => s.online);
  if (online && !stale) return null;
  return (
    <View style={[styles.banner, { backgroundColor: t.surface }]} accessibilityLiveRegion="polite">
      <Ionicons name="cloud-offline-outline" size={16} color={t.textMuted} />
      <Text style={{ color: t.textMuted, flex: 1 }}>
        {online ? 'Couldn’t refresh, showing saved results' : 'Offline, showing saved results'}
      </Text>
    </View>
  );
}

/** Loading / error / empty states for a MusicBrainz query; renders children when data is ready. */
export function MbStatus<T>({ state, empty, children }: { state: MbState<T>; empty?: boolean; children: ReactNode }) {
  const t = useTheme();
  const online = useNetwork((s) => s.online);
  if (state.data === undefined) {
    if (state.loading) return <ActivityIndicator style={{ marginTop: 32 }} color={t.accent} />;
    if (state.error) {
      const offline = !online || state.error.name === 'OfflineError';
      return (
        <View style={styles.center}>
          <Ionicons name={offline ? 'cloud-offline-outline' : 'alert-circle-outline'} size={40} color={t.textMuted} />
          <Text style={[styles.centerText, { color: t.textMuted }]}>
            {offline ? 'You’re offline and this hasn’t been saved yet.' : 'MusicBrainz didn’t respond. Try again in a moment.'}
          </Text>
          {!offline && (
            <Pressable onPress={state.retry} style={styles.retry} accessibilityRole="button">
              <Text style={{ color: t.accent, fontWeight: '700' }}>Retry</Text>
            </Pressable>
          )}
        </View>
      );
    }
    return null;
  }
  if (empty) {
    return (
      <View style={styles.center}>
        <Text style={[styles.centerText, { color: t.textMuted }]}>Nothing found</Text>
      </View>
    );
  }
  return <>{children}</>;
}

// ---------------------------------------------------------------- badges & buttons

export function InLibraryBadge() {
  const t = useTheme();
  return (
    <View style={[styles.badge, { backgroundColor: t.accent }]} accessibilityLabel="In your library">
      <Ionicons name="checkmark" size={11} color={t.onAccent} />
      <Text style={[styles.badgeText, { color: t.onAccent }]}>In library</Text>
    </View>
  );
}

export function WishlistButton({ mbid, kind, title, artist }: { mbid: string; kind: WishKind; title: string; artist: string | null }) {
  const t = useTheme();
  const db = useSQLiteContext();
  const saved = useWishlist((s) => s.ids.has(mbid));
  return (
    <IconButton
      icon={saved ? 'bookmark' : 'bookmark-outline'}
      label={saved ? `Remove ${title} from wishlist` : `Save ${title} to wishlist`}
      selected={saved}
      color={saved ? t.accent : t.textMuted}
      size={22}
      onPress={() => void toggleWishlist(db, { mbid, kind, title, artist })}
    />
  );
}

// ---------------------------------------------------------------- rows

export function RemoteCover({ releaseGroupId, seed, size }: { releaseGroupId?: string; seed: string; size: number }) {
  const uri = useCoverArt(releaseGroupId);
  return <CoverImage uri={uri} seed={seed} size={size} />;
}

export function ReleaseGroupRow({ rg, inLibrary }: { rg: MbReleaseGroup; inLibrary: boolean }) {
  const t = useTheme();
  const year = yearOf(rg.firstReleaseDate);
  const sub = [rg.primaryType, rg.artistCredit, year].filter(Boolean).join(' · ');
  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: t.surface }]}
      onPress={() => router.push({ pathname: '/mb-album', params: { id: rg.id, title: rg.title } })}
      accessibilityRole="button"
      accessibilityLabel={`${rg.title}, ${sub}${inLibrary ? ', in your library' : ''}`}
    >
      <RemoteCover releaseGroupId={rg.id} seed={rg.title} size={52} />
      <View style={styles.rowText}>
        <Text numberOfLines={1} style={[styles.title, { color: t.text }]}>
          {rg.title}
        </Text>
        <Text numberOfLines={1} style={[styles.sub, { color: t.textMuted }]}>
          {sub}
        </Text>
        {inLibrary && <InLibraryBadge />}
      </View>
      <WishlistButton mbid={rg.id} kind="release-group" title={rg.title} artist={rg.artistCredit || null} />
    </Pressable>
  );
}

export function ArtistRow({ artist, inLibrary }: { artist: Pick<MbArtist, 'id' | 'name' | 'disambiguation' | 'type' | 'country' | 'tags'>; inLibrary: boolean }) {
  const t = useTheme();
  const sub = [artist.type, artist.country, artist.disambiguation].filter(Boolean).join(' · ') || artist.tags.slice(0, 3).join(', ');
  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: t.surface }]}
      onPress={() => router.push({ pathname: '/mb-artist', params: { id: artist.id, name: artist.name } })}
      accessibilityRole="button"
      accessibilityLabel={`Artist ${artist.name}${sub ? `, ${sub}` : ''}`}
    >
      <CoverImage uri={null} seed={artist.name} size={52} round />
      <View style={styles.rowText}>
        <Text numberOfLines={1} style={[styles.title, { color: t.text }]}>
          {artist.name}
        </Text>
        {!!sub && (
          <Text numberOfLines={1} style={[styles.sub, { color: t.textMuted }]}>
            {sub}
          </Text>
        )}
        {inLibrary && <InLibraryBadge />}
      </View>
      <Ionicons name="chevron-forward" size={18} color={t.textMuted} />
    </Pressable>
  );
}

/** A discovered song: plays directly when it's in the library, otherwise opens its album. */
export function RecordingRow({ rec, match }: { rec: MbRecording; match?: Track }) {
  const t = useTheme();
  const sub = [rec.artistCredit, rec.releaseGroup?.title].filter(Boolean).join(' · ');
  const onPress = () => {
    if (match) playTracks([match], 0);
    else if (rec.releaseGroup) router.push({ pathname: '/mb-album', params: { id: rec.releaseGroup.id, title: rec.releaseGroup.title } });
  };
  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: t.surface }]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${rec.title}, ${sub}${match ? ', in your library. Plays now.' : ''}`}
    >
      <RemoteCover releaseGroupId={rec.releaseGroup?.id} seed={rec.releaseGroup?.title ?? rec.title} size={52} />
      <View style={styles.rowText}>
        <Text numberOfLines={1} style={[styles.title, { color: match ? t.accent : t.text }]}>
          {rec.title}
        </Text>
        <Text numberOfLines={1} style={[styles.sub, { color: t.textMuted }]}>
          {sub}
          {rec.lengthMs ? ` · ${formatTime(rec.lengthMs / 1000)}` : ''}
        </Text>
        {match && <InLibraryBadge />}
      </View>
      {match ? (
        <Ionicons name="play-circle" size={28} color={t.accent} style={{ marginRight: 8 }} />
      ) : (
        <>
          <IconButton
            icon="download-outline"
            label={`Find a free, legal download of ${rec.title}`}
            color={t.accent}
            size={22}
            onPress={() =>
              router.push({ pathname: '/get', params: { artist: rec.artists[0]?.name ?? rec.artistCredit, title: rec.title, mbid: rec.id } })
            }
          />
          <WishlistButton mbid={rec.id} kind="recording" title={rec.title} artist={rec.artistCredit || null} />
        </>
      )}
    </Pressable>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  const t = useTheme();
  return (
    <Text style={[styles.section, { color: t.text }]} accessibilityRole="header">
      {children}
    </Text>
  );
}

/** Colourful "browse" tile for a genre. */
export function GenreTile({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.tile, { backgroundColor: tileColor(label), opacity: pressed ? 0.8 : 1 }]}
      accessibilityRole="button"
      accessibilityLabel={`Browse ${label}`}
    >
      <Text style={styles.tileText} numberOfLines={2}>
        {label.replace(/(^|\s)\S/g, (c) => c.toUpperCase())}
      </Text>
      <View style={styles.tileShape} />
    </Pressable>
  );
}

export function Chip({ label, onPress }: { label: string; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} style={[styles.chip, { backgroundColor: t.surface }]} accessibilityRole="button">
      <Text style={{ color: t.text, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  center: { alignItems: 'center', padding: 32, gap: 12 },
  centerText: { textAlign: 'center', fontSize: 15 },
  retry: { minHeight: TOUCH, justifyContent: 'center', paddingHorizontal: 16 },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 3,
    marginTop: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  badgeText: { fontSize: 11, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingLeft: 16, paddingRight: 4, paddingVertical: 8, minHeight: 68 },
  rowText: { flex: 1, minWidth: 0 },
  title: { fontSize: 16, fontWeight: '500' },
  sub: { fontSize: 13, marginTop: 2 },
  section: { fontSize: 18, fontWeight: '700', paddingHorizontal: 16, paddingTop: 20, paddingBottom: 6 },
  chip: { paddingHorizontal: 14, minHeight: 40, borderRadius: 20, justifyContent: 'center' },
  tile: { flexBasis: '47%', flexGrow: 1, height: 96, borderRadius: 8, padding: 12, overflow: 'hidden' },
  tileText: { color: '#fff', fontSize: 17, fontWeight: '800', maxWidth: '75%' },
  tileShape: {
    position: 'absolute',
    right: -18,
    bottom: -18,
    width: 72,
    height: 72,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.22)',
    transform: [{ rotate: '25deg' }],
  },
});
