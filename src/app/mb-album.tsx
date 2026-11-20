import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useLibraryMatcher, useMb } from '@/components/discover/hooks';
import { InLibraryBadge, MbStatus, OfflineBanner, RemoteCover, WishlistButton } from '@/components/discover/parts';
import { StackScreen } from '@/components/StackScreen';
import { TOUCH, useTheme } from '@/components/theme';
import type { Track } from '@/db/queries';
import { getReleaseGroup } from '@/services/musicbrainz/api';
import { yearOf } from '@/services/musicbrainz/mappers';
import { playTracks } from '@/services/playback/PlaybackService';
import { formatTime } from '@/services/playback/queue';

/** Release group (album) page: tracklist with "In your library" matches that play directly. */
export default function MbAlbumScreen() {
  const t = useTheme();
  const { id = '', title = '' } = useLocalSearchParams<{ id: string; title?: string }>();
  const matcher = useLibraryMatcher();
  const state = useMb((ctx) => getReleaseGroup(ctx, id), [id]);
  const detail = state.data;
  const rg = detail?.releaseGroup;

  const rows = (detail?.tracks ?? []).map((tr) => ({
    tr,
    match: rg
      ? matcher?.matchRecording({
          id: tr.recordingId,
          title: tr.title,
          artistCredit: tr.artistCredit || rg.artistCredit,
          artists: rg.artists,
        })
      : undefined,
  }));
  const owned = rows.map((r) => r.match).filter((m): m is Track => !!m);

  return (
    <StackScreen title={rg?.title ?? title ?? 'Album'}>
      <ScrollView>
        <OfflineBanner stale={state.stale} />
        <View style={styles.header}>
          <RemoteCover releaseGroupId={id} seed={rg?.title ?? title} size={200} />
          <Text style={[styles.title, { color: t.text }]} accessibilityRole="header">
            {rg?.title ?? title}
          </Text>
          {rg && (
            <>
              <Pressable
                disabled={!rg.artists[0]}
                onPress={() => rg.artists[0] && router.push({ pathname: '/mb-artist', params: { id: rg.artists[0].id, name: rg.artists[0].name } })}
                accessibilityRole="link"
              >
                <Text style={{ color: t.accent, fontWeight: '600', fontSize: 16 }}>{rg.artistCredit}</Text>
              </Pressable>
              <Text style={{ color: t.textMuted }}>
                {[rg.primaryType, ...rg.secondaryTypes, yearOf(rg.firstReleaseDate)].filter(Boolean).join(' · ')}
              </Text>
              <View style={styles.actions}>
                {owned.length > 0 && (
                  <Pressable
                    onPress={() => playTracks(owned, 0)}
                    style={[styles.play, { backgroundColor: t.accent }]}
                    accessibilityRole="button"
                    accessibilityLabel={`Play ${owned.length} songs from your library`}
                  >
                    <Ionicons name="play" size={18} color={t.onAccent} />
                    <Text style={{ color: t.onAccent, fontWeight: '700' }}>
                      Play {owned.length === rows.length ? 'album' : `${owned.length} of ${rows.length}`}
                    </Text>
                  </Pressable>
                )}
                <WishlistButton mbid={rg.id} kind="release-group" title={rg.title} artist={rg.artistCredit || null} />
              </View>
            </>
          )}
        </View>

        <MbStatus state={state} empty={rows.length === 0}>
          {rows.map(({ tr, match }) => (
            <Pressable
              key={`${tr.position}-${tr.recordingId}`}
              disabled={!match}
              onPress={() => match && playTracks(owned, owned.indexOf(match))}
              style={({ pressed }) => [styles.track, pressed && { backgroundColor: t.surface }]}
              accessibilityRole={match ? 'button' : 'text'}
              accessibilityLabel={`${tr.position}. ${tr.title}${match ? ', in your library' : ', not in your library'}`}
            >
              <Text style={[styles.pos, { color: t.textMuted }]}>{tr.position}</Text>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={{ color: match ? t.text : t.textMuted, fontSize: 16 }}>
                  {tr.title}
                </Text>
                {match && <InLibraryBadge />}
              </View>
              {!!tr.lengthMs && <Text style={{ color: t.textMuted, fontVariant: ['tabular-nums'] }}>{formatTime(tr.lengthMs / 1000)}</Text>}
            </Pressable>
          ))}
          {rows.length > 0 && owned.length < rows.length && (
            <Text style={[styles.note, { color: t.textMuted }]}>
              Greyed-out songs aren’t in your library. Ways to get legal copies arrive with Downloads.
            </Text>
          )}
        </MbStatus>
      </ScrollView>
    </StackScreen>
  );
}

const styles = StyleSheet.create({
  header: { alignItems: 'center', padding: 16, gap: 6 },
  title: { fontSize: 22, fontWeight: '800', textAlign: 'center', marginTop: 8 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 8 },
  play: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: TOUCH, paddingHorizontal: 20, borderRadius: 22 },
  track: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, minHeight: 52, paddingVertical: 6 },
  pos: { width: 32, textAlign: 'right', fontVariant: ['tabular-nums'] },
  note: { fontSize: 13, padding: 16 },
});
