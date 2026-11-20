import { useLocalSearchParams } from 'expo-router';
import { ScrollView } from 'react-native';

import { useLibraryMatcher, useMb } from '@/components/discover/hooks';
import { ArtistRow, MbStatus, OfflineBanner, ReleaseGroupRow, SectionTitle } from '@/components/discover/parts';
import { StackScreen } from '@/components/StackScreen';
import { artistsByTag, releaseGroupsByTag } from '@/services/musicbrainz/api';

/** Spec 6.3 #1: albums and artists tagged with a genre. */
export default function GenreScreen() {
  const { tag = '' } = useLocalSearchParams<{ tag: string }>();
  const matcher = useLibraryMatcher();
  // Sequential on purpose: the client queue spaces requests anyway.
  const albums = useMb((ctx) => releaseGroupsByTag(ctx, tag), [tag]);
  const artists = useMb((ctx) => artistsByTag(ctx, tag), [tag]);
  const title = tag ? tag[0].toUpperCase() + tag.slice(1) : 'Genre';

  return (
    <StackScreen title={title}>
      <ScrollView>
        <OfflineBanner stale={albums.stale || artists.stale} />
        <SectionTitle>Albums</SectionTitle>
        <MbStatus state={albums} empty={!albums.data?.items.length}>
          {albums.data?.items.map((rg) => (
            <ReleaseGroupRow key={rg.id} rg={rg} inLibrary={!!matcher?.hasReleaseGroup(rg)} />
          ))}
        </MbStatus>
        <SectionTitle>Artists</SectionTitle>
        <MbStatus state={artists} empty={!artists.data?.items.length}>
          {artists.data?.items.map((a) => (
            <ArtistRow key={a.id} artist={a} inLibrary={!!matcher?.hasArtist(a.name)} />
          ))}
        </MbStatus>
      </ScrollView>
    </StackScreen>
  );
}
