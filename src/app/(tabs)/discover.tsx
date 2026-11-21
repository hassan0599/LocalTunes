import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { useDebounced, useLibraryMatcher, useMb } from '@/components/discover/hooks';
import {
  ArtistRow,
  GenreTile,
  MbStatus,
  OfflineBanner,
  RecordingRow,
  ReleaseGroupRow,
  SectionTitle,
} from '@/components/discover/parts';
import { IconButton } from '@/components/IconButton';
import { ScreenHeader } from '@/components/ScreenHeader';
import { TOUCH, useTheme } from '@/components/theme';
import {
  GENRES,
  searchArtists,
  searchRecordings,
  searchReleaseGroups,
  type SearchKind,
} from '@/services/musicbrainz/api';
import type { MbArtist, MbPage, MbRecording, MbReleaseGroup } from '@/services/musicbrainz/types';
import { useWishlist } from '@/state/wishlist';

const KINDS: { kind: SearchKind; label: string }[] = [
  { kind: 'artist', label: 'Artists' },
  { kind: 'release-group', label: 'Albums' },
  { kind: 'recording', label: 'Songs' },
];

/** Network searches are rate limited (1/s), so wait for a pause in typing. */
const DEBOUNCE_MS = 600;

export default function DiscoverScreen() {
  const t = useTheme();
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<SearchKind>('artist');
  const q = useDebounced(query.trim(), DEBOUNCE_MS);

  return (
    <View style={[styles.screen, { backgroundColor: t.bg }]}>
      <ScreenHeader title="Discover" />
      <View style={[styles.inputWrap, { backgroundColor: t.surface }]}>
        <Ionicons name="globe-outline" size={18} color={t.textMuted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search MusicBrainz"
          placeholderTextColor={t.textMuted}
          style={[styles.input, { color: t.text }]}
          autoCorrect={false}
          returnKeyType="search"
          accessibilityLabel="Search MusicBrainz"
        />
        {!!query && <IconButton icon="close-circle" label="Clear search" color={t.textMuted} size={20} onPress={() => setQuery('')} />}
      </View>
      <View style={styles.kinds} accessibilityRole="tablist">
        {KINDS.map((k) => (
          <Pressable
            key={k.kind}
            onPress={() => setKind(k.kind)}
            style={[styles.kind, { backgroundColor: kind === k.kind ? t.accent : t.surface }]}
            accessibilityRole="tab"
            accessibilityState={{ selected: kind === k.kind }}
          >
            <Text style={{ color: kind === k.kind ? t.onAccent : t.text, fontWeight: '600' }}>{k.label}</Text>
          </Pressable>
        ))}
      </View>
      {/* Keyed so switching type or query never renders old results with the new row type. */}
      {q ? <Results key={`${kind}:${q}`} query={q} kind={kind} /> : <Home />}
    </View>
  );
}

function Home() {
  const t = useTheme();
  const wishCount = useWishlist((s) => s.items.length);
  return (
    <ScrollView keyboardShouldPersistTaps="handled">
      <OfflineBanner />
      <Pressable
        style={({ pressed }) => [styles.wishRow, { backgroundColor: pressed ? t.border : t.surface }]}
        onPress={() => router.push('/wishlist')}
        accessibilityRole="button"
      >
        <Ionicons name="bookmark" size={20} color={t.accent} />
        <Text style={{ color: t.text, fontWeight: '600', flex: 1 }}>Wishlist</Text>
        <Text style={{ color: t.textMuted }}>{wishCount}</Text>
        <Ionicons name="chevron-forward" size={18} color={t.textMuted} />
      </Pressable>
      <SectionTitle>Browse by genre</SectionTitle>
      <View style={styles.chips}>
        {GENRES.map((g) => (
          <GenreTile key={g} label={g} onPress={() => router.push({ pathname: '/genre', params: { tag: g } })} />
        ))}
      </View>
      <Text style={[styles.note, { color: t.textMuted }]}>
        Discover uses MusicBrainz, an open music encyclopedia. It has no audio: songs play here only if they’re already
        in your library.
      </Text>
    </ScrollView>
  );
}

function Results({ query, kind }: { query: string; kind: SearchKind }) {
  const matcher = useLibraryMatcher();
  const state = useMb<MbPage<MbArtist | MbReleaseGroup | MbRecording>>(
    (ctx) =>
      kind === 'artist' ? searchArtists(ctx, query) : kind === 'release-group' ? searchReleaseGroups(ctx, query) : searchRecordings(ctx, query),
    [query, kind],
  );
  const items = state.data?.items ?? [];
  return (
    <View style={{ flex: 1 }}>
      <OfflineBanner stale={state.stale} />
      <MbStatus state={state} empty={items.length === 0}>
        <FlatList
          data={items}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          keyExtractor={(i) => i.id}
          renderItem={({ item }) =>
            kind === 'artist' ? (
              <ArtistRow artist={item as MbArtist} inLibrary={!!matcher?.hasArtist((item as MbArtist).name)} />
            ) : kind === 'release-group' ? (
              <ReleaseGroupRow rg={item as MbReleaseGroup} inLibrary={!!matcher?.hasReleaseGroup(item as MbReleaseGroup)} />
            ) : (
              <RecordingRow rec={item as MbRecording} match={matcher?.matchRecording(item as MbRecording)} />
            )
          }
        />
      </MbStatus>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  inputWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, paddingLeft: 12, borderRadius: 12, minHeight: TOUCH },
  input: { flex: 1, fontSize: 16, paddingVertical: 10 },
  kinds: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 10 },
  kind: { minHeight: 36, paddingHorizontal: 16, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  wishRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 16, paddingHorizontal: 14, minHeight: 52, borderRadius: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingHorizontal: 16 },
  note: { fontSize: 13, paddingHorizontal: 16, paddingVertical: 24 },
});
