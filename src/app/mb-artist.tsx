import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useLibraryMatcher, useMb } from '@/components/discover/hooks';
import { ArtistRow, Chip, InLibraryBadge, MbStatus, OfflineBanner, ReleaseGroupRow, SectionTitle } from '@/components/discover/parts';
import { StackScreen } from '@/components/StackScreen';
import { TOUCH, useTheme } from '@/components/theme';
import { getArtist, getDiscography, getSimilarArtists } from '@/services/musicbrainz/api';
import { yearOf } from '@/services/musicbrainz/mappers';
import type { MbArtistDetail } from '@/services/musicbrainz/types';
import { useNetwork } from '@/state/network';

const LINK_LABELS: Record<string, string> = {
  'official homepage': 'Official website',
  bandcamp: 'Bandcamp',
  'purchase for download': 'Buy',
  'free streaming': 'Listen free',
  streaming: 'Stream',
  wikidata: 'Wikidata',
  allmusic: 'AllMusic',
  discogs: 'Discogs',
  'last.fm': 'Last.fm',
};

/** Spec 6.3 #2: artist page with discography, tags, similar artists and links. */
export default function MbArtistScreen() {
  const t = useTheme();
  const { id = '', name = '' } = useLocalSearchParams<{ id: string; name?: string }>();
  const matcher = useLibraryMatcher();
  const online = useNetwork((s) => s.online);
  const artist = useMb((ctx) => getArtist(ctx, id), [id]);
  const discography = useMb((ctx) => getDiscography(ctx, id), [id]);
  const a = artist.data;
  const similar = useMb(a ? (ctx) => getSimilarArtists(ctx, a) : null, [a?.id]);

  const displayName = a?.name ?? name;
  const inLibrary = !!displayName && !!matcher?.hasArtist(displayName);

  return (
    <StackScreen title={displayName || 'Artist'}>
      <ScrollView>
        <OfflineBanner stale={artist.stale || discography.stale} />
        <MbStatus state={artist}>
          {a && <Header artist={a} inLibrary={inLibrary} />}
        </MbStatus>

        <SectionTitle>Discography</SectionTitle>
        <MbStatus state={discography} empty={!discography.data?.length}>
          {discography.data?.map((rg) => (
            <ReleaseGroupRow key={rg.id} rg={rg} inLibrary={!!matcher?.hasReleaseGroup(rg)} />
          ))}
        </MbStatus>

        {a && (
          <>
            <SectionTitle>Similar artists</SectionTitle>
            <MbStatus state={similar} empty={!similar.data?.length}>
              {similar.data?.map((s) => (
                <ArtistRow key={s.id} artist={s} inLibrary={!!matcher?.hasArtist(s.name)} />
              ))}
            </MbStatus>
          </>
        )}

        {!!a?.links.length && (
          <>
            <SectionTitle>Links</SectionTitle>
            {a.links.map((l) => (
              <Pressable
                key={l.url}
                style={styles.link}
                onPress={() => Linking.openURL(l.url)}
                disabled={!online}
                accessibilityRole="link"
                accessibilityLabel={`${LINK_LABELS[l.type] ?? l.type}, opens in browser`}
              >
                <Ionicons name="open-outline" size={18} color={online ? t.accent : t.textMuted} />
                <Text style={{ color: online ? t.accent : t.textMuted, fontWeight: '600' }}>{LINK_LABELS[l.type] ?? l.type}</Text>
                <Text numberOfLines={1} style={{ color: t.textMuted, flex: 1, fontSize: 12 }}>
                  {l.url.replace(/^https?:\/\/(www\.)?/, '')}
                </Text>
              </Pressable>
            ))}
          </>
        )}
        <View style={{ height: 24 }} />
      </ScrollView>
    </StackScreen>
  );
}

function Header({ artist, inLibrary }: { artist: MbArtistDetail; inLibrary: boolean }) {
  const t = useTheme();
  const begin = yearOf(artist.lifeSpan?.begin);
  const end = yearOf(artist.lifeSpan?.end);
  const span = begin ? `${begin}${end ? `–${end}` : artist.lifeSpan?.ended ? '–?' : '–present'}` : undefined;
  const facts = [artist.type, artist.country, span].filter(Boolean).join(' · ');
  return (
    <View style={styles.header}>
      <Text style={[styles.name, { color: t.text }]} accessibilityRole="header">
        {artist.name}
      </Text>
      {!!facts && <Text style={{ color: t.textMuted }}>{facts}</Text>}
      {!!artist.disambiguation && <Text style={{ color: t.textMuted, fontStyle: 'italic' }}>{artist.disambiguation}</Text>}
      {inLibrary && (
        <Pressable
          onPress={() => router.push({ pathname: '/artist', params: { name: artist.name } })}
          style={styles.libraryLink}
          accessibilityRole="button"
          accessibilityLabel={`Open ${artist.name} in your library`}
        >
          <InLibraryBadge />
          <Text style={{ color: t.accent, fontWeight: '600', marginTop: 4 }}>Open in your library</Text>
        </Pressable>
      )}
      {artist.tags.length > 0 && (
        <View style={styles.tags}>
          {artist.tags.slice(0, 8).map((tag) => (
            <Chip key={tag} label={tag} onPress={() => router.push({ pathname: '/genre', params: { tag } })} />
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { padding: 16, gap: 4 },
  name: { fontSize: 28, fontWeight: '800' },
  libraryLink: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: TOUCH },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  link: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, minHeight: TOUCH },
});
