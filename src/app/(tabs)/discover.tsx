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
import { useLibraryQuery } from '@/components/useLibraryQuery';
import { prefixMatches, tokenize } from '@/db/fts';
import { ScreenHeader } from '@/components/ScreenHeader';
import { SegmentedControl } from '@/components/SegmentedControl';
import { TOUCH, useTheme } from '@/components/theme';
import {
  GENRES,
  searchArtists,
  searchRecordings,
  searchReleaseGroups,
  type SearchKind,
} from '@/services/musicbrainz/api';
import { becauseYouListened, topArtists } from '@/services/musicbrainz/suggestions';
import type { MbArtist, MbPage, MbRecording, MbReleaseGroup } from '@/services/musicbrainz/types';
import { usePlaysVersion } from '@/state/library';
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
      <View style={styles.kinds}>
        <SegmentedControl
          options={KINDS.map((k) => ({ value: k.kind, label: k.label }))}
          value={kind}
          onChange={setKind}
        />
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
      <BecauseYouListened />
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

/** Artists similar to the one you play most, that aren't in your library yet. */
function BecauseYouListened() {
  const plays = usePlaysVersion((s) => s.version);
  const { data: seeds } = useLibraryQuery((d) => topArtists(d, 1), [plays], [] as string[]);
  const matcher = useLibraryMatcher();
  const seed = seeds[0];
  const state = useMb(
    seed && matcher ? (ctx) => becauseYouListened(ctx, seed, (name) => matcher.hasArtist(name)) : null,
    [seed ?? '', !!matcher],
  );
  const s = state.data;
  if (!s) return null;
  return (
    <>
      <SectionTitle>Because you listened to {s.seed.name}</SectionTitle>
      {s.artists.map((a) => (
        <ArtistRow key={a.id} artist={a} inLibrary={false} />
      ))}
    </>
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
  // Genre shortcuts: known genres the query prefix-matches, or the query itself as a tag
  // (MusicBrainz has far more tags than the fixed list: "synthwave", "city pop"…).
  const tokens = tokenize(query);
  const known = GENRES.filter((g) => prefixMatches(tokens, g));
  const genres = known.length ? known.slice(0, 6) : tokens.length <= 3 ? [query.toLowerCase()] : [];
  return (
    <View style={{ flex: 1 }}>
      <OfflineBanner stale={state.stale} />
      {genres.length > 0 && (
        <View style={styles.genreRow}>
          {genres.map((g) => (
            <GenreTile key={g} label={known.length ? g : `${g} (genre)`} onPress={() => router.push({ pathname: '/genre', params: { tag: g } })} />
          ))}
        </View>
      )}
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
  kinds: { paddingVertical: 10 },
  genreRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16, paddingBottom: 8 },
  wishRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 16, paddingHorizontal: 14, minHeight: 52, borderRadius: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingHorizontal: 16 },
  note: { fontSize: 13, paddingHorizontal: 16, paddingVertical: 24 },
});
