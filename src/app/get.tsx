/**
 * "Get" (spec 6.4): search the legal sources for a song or album and download it.
 * Opened from Discover (artist + title) or the Downloads tab (free text). When nothing
 * legal is found, link out to places that sell or stream it.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { formatBytes, LicenseChip } from '@/components/downloads/parts';
import { StackScreen } from '@/components/StackScreen';
import { TOUCH, useTheme } from '@/components/theme';
import { enqueue } from '@/services/downloads/manager';
import { formatTime } from '@/services/playback/queue';
import { enabledSources, SOURCES } from '@/services/sources';
import { licenseSummary } from '@/services/sources/license';
import type { SourceQuery, SourceTrack } from '@/services/sources/types';
import { useDownloads } from '@/state/downloads';
import { useNetwork } from '@/state/network';

type Params = { q?: string; artist?: string; title?: string; album?: string; mbid?: string };

interface Group {
  id: string;
  title: string;
  source: string;
  tracks: SourceTrack[];
}

export default function GetScreen() {
  const t = useTheme();
  const params = useLocalSearchParams<Params>();
  const online = useNetwork((s) => s.online);
  const initial = params.q ?? [params.artist, params.title].filter(Boolean).join(' ');
  const [text, setText] = useState(initial);
  const [query, setQuery] = useState<SourceQuery>(() =>
    params.title || params.artist
      ? { artist: params.artist, title: params.title, album: params.album === '1' }
      : { text: params.q ?? '' },
  );
  // Results are tagged with the query they answer; until the current one answers, we're loading.
  const requestKey = JSON.stringify(query);
  const [done, setDone] = useState<{ key: string; results: SourceTrack[]; errors: string[] } | null>(null);
  const current = online && done?.key === requestKey ? done : null;
  const state = { loading: online && !current, results: current?.results ?? [], errors: current?.errors ?? [] };

  useEffect(() => {
    if (!online) return;
    let alive = true;
    Promise.allSettled(enabledSources().map((s) => s.search(query))).then((settled) => {
      if (!alive) return;
      const results: SourceTrack[] = [];
      const errors: string[] = [];
      settled.forEach((r, i) => {
        if (r.status === 'fulfilled') results.push(...r.value);
        else errors.push(`${enabledSources()[i].name}: ${String(r.reason?.message ?? r.reason)}`);
      });
      setDone({ key: requestKey, results, errors });
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `query` is captured via requestKey
  }, [requestKey, online]);

  const groups = useMemo(() => {
    const map = new Map<string, Group>();
    for (const r of state.results) {
      const id = `${r.source}:${r.groupId ?? r.sourceId}`;
      const g = map.get(id) ?? { id, title: r.groupTitle ?? r.album ?? r.title, source: r.source, tracks: [] };
      g.tracks.push(r);
      map.set(id, g);
    }
    return [...map.values()];
  }, [state.results]);

  const download = async (tracks: SourceTrack[]) => {
    try {
      for (const tr of tracks) await enqueue(tr, { mbid: tracks.length === 1 ? params.mbid : undefined });
    } catch (e) {
      Alert.alert('Couldn’t start the download', e instanceof Error ? e.message : String(e));
    }
  };

  const disabled = SOURCES.filter((s) => !s.enabled);
  const linkQuery = encodeURIComponent(initial || text);

  return (
    <StackScreen title="Get music">
      <ScrollView keyboardShouldPersistTaps="handled">
        <View style={[styles.inputWrap, { backgroundColor: t.surface }]}>
          <Ionicons name="search" size={18} color={t.textMuted} />
          <TextInput
            value={text}
            onChangeText={setText}
            onSubmitEditing={() => text.trim() && setQuery({ text: text.trim() })}
            placeholder="Artist, album or song"
            placeholderTextColor={t.textMuted}
            returnKeyType="search"
            style={[styles.input, { color: t.text }]}
            accessibilityLabel="Search free and legal music"
          />
        </View>
        <Text style={[styles.note, { color: t.textMuted }]}>
          Free, legal downloads from {enabledSources().map((s) => s.name).join(' and ')}. Every file keeps its license.
        </Text>

        {!online ? (
          <Text style={[styles.center, { color: t.textMuted }]}>You’re offline. Connect to search for downloads.</Text>
        ) : state.loading ? (
          <ActivityIndicator style={{ marginTop: 32 }} color={t.accent} />
        ) : groups.length === 0 ? (
          <View style={styles.none}>
            <Text style={[styles.noneTitle, { color: t.text }]}>No free, legal copy found</Text>
            <Text style={{ color: t.textMuted }}>You can buy or stream it here:</Text>
            {[
              ['Bandcamp', `https://bandcamp.com/search?q=${linkQuery}`],
              ['Apple Music', `https://music.apple.com/search?term=${linkQuery}`],
              ['Spotify', `https://open.spotify.com/search/${linkQuery}`],
            ].map(([label, url]) => (
              <Pressable key={label} onPress={() => Linking.openURL(url)} style={styles.link} accessibilityRole="link">
                <Ionicons name="open-outline" size={18} color={t.accent} />
                <Text style={{ color: t.accent, fontWeight: '600' }}>{label}</Text>
              </Pressable>
            ))}
          </View>
        ) : (
          groups.map((g) => <GroupView key={g.id} group={g} onDownload={download} />)
        )}

        {state.errors.map((e) => (
          <Text key={e} style={[styles.error, { color: t.danger }]}>
            {e}
          </Text>
        ))}
        {disabled.length > 0 && (
          <Text style={[styles.note, { color: t.textMuted }]}>
            {disabled.map((s) => s.name).join(', ')} is off: it needs an API key (see README.md).
          </Text>
        )}
      </ScrollView>
    </StackScreen>
  );
}

function GroupView({ group, onDownload }: { group: Group; onDownload: (tracks: SourceTrack[]) => void }) {
  const t = useTheme();
  const rows = useDownloads((s) => s.rows);
  const statusOf = (tr: SourceTrack) => rows.find((r) => r.source === tr.source && r.source_id === tr.sourceId)?.status;
  const pending = group.tracks.filter((tr) => !statusOf(tr));
  const first = group.tracks[0];
  return (
    <View style={styles.group}>
      <View style={styles.groupHeader}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.groupTitle, { color: t.text }]} numberOfLines={2}>
            {group.title}
          </Text>
          <Text style={{ color: t.textMuted, fontSize: 13 }}>
            {[first.artist, SOURCES.find((s) => s.id === group.source)?.name].filter(Boolean).join(' · ')}
          </Text>
          <LicenseChip url={first.license} />
          {!!licenseSummary(first.license) && <Text style={{ color: t.textMuted, fontSize: 12, marginTop: 2 }}>{licenseSummary(first.license)}</Text>}
        </View>
        {group.tracks.length > 1 && pending.length > 0 && (
          <Pressable
            onPress={() => onDownload(pending)}
            style={[styles.allBtn, { backgroundColor: t.accent }]}
            accessibilityRole="button"
            accessibilityLabel={`Download ${pending.length} songs from ${group.title}`}
          >
            <Text style={{ color: t.onAccent, fontWeight: '700' }}>Get all {pending.length}</Text>
          </Pressable>
        )}
      </View>
      {group.tracks.map((tr) => {
        const status = statusOf(tr);
        return (
          <View key={tr.sourceId} style={styles.row}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ color: t.text, fontSize: 15 }}>
                {tr.trackNo ? `${tr.trackNo}. ` : ''}
                {tr.title}
              </Text>
              <Text numberOfLines={1} style={{ color: t.textMuted, fontSize: 12 }}>
                {[tr.durationMs ? formatTime(tr.durationMs / 1000) : null, formatBytes(tr.sizeBytes)].filter(Boolean).join(' · ')}
              </Text>
            </View>
            {status === 'done' ? (
              <Ionicons name="checkmark-circle" size={26} color={t.accent} accessibilityLabel="Downloaded" />
            ) : status ? (
              <Text style={{ color: t.textMuted, fontSize: 12 }}>{status === 'failed' ? 'Failed' : 'Queued'}</Text>
            ) : (
              <Pressable
                onPress={() => onDownload([tr])}
                hitSlop={8}
                style={styles.dl}
                accessibilityRole="button"
                accessibilityLabel={`Download ${tr.title}`}
              >
                <Ionicons name="download-outline" size={24} color={t.accent} />
              </Pressable>
            )}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  inputWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, margin: 16, marginBottom: 4, paddingLeft: 12, borderRadius: 12, minHeight: TOUCH },
  input: { flex: 1, fontSize: 16, paddingVertical: 10 },
  note: { fontSize: 12, paddingHorizontal: 16, paddingVertical: 6 },
  center: { textAlign: 'center', padding: 32 },
  none: { padding: 16, gap: 6 },
  noneTitle: { fontSize: 17, fontWeight: '700' },
  link: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: TOUCH },
  error: { fontSize: 12, paddingHorizontal: 16, paddingTop: 4 },
  group: { paddingTop: 12 },
  groupHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingHorizontal: 16, paddingBottom: 6 },
  groupTitle: { fontSize: 17, fontWeight: '700' },
  allBtn: { minHeight: 36, paddingHorizontal: 14, borderRadius: 18, justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, minHeight: 52 },
  dl: { minWidth: TOUCH, minHeight: TOUCH, alignItems: 'center', justifyContent: 'center' },
});
