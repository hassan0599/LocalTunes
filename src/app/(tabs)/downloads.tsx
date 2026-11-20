import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { formatBytes, LicenseChip, ProgressBar } from '@/components/downloads/parts';
import { IconButton } from '@/components/IconButton';
import { ScreenHeader } from '@/components/ScreenHeader';
import { TOUCH, useTheme } from '@/components/theme';
import { getTrack } from '@/db/queries';
import { cancel, deleteAllFromSource, pause, resume, retry, setWifiOnly, storageBySource } from '@/services/downloads/manager';
import type { DownloadRow } from '@/services/downloads/schedule';
import { playTracks } from '@/services/playback/PlaybackService';
import { SOURCE_NAMES } from '@/services/sources';
import { useDownloads } from '@/state/downloads';
import { useLibraryVersion } from '@/state/library';

export default function DownloadsScreen() {
  const t = useTheme();
  const { rows, blocked, wifiOnly } = useDownloads();
  const [q, setQ] = useState('');
  const activeRows = rows.filter((r) => r.status !== 'done');
  const doneRows = rows.filter((r) => r.status === 'done');

  return (
    <View style={[styles.screen, { backgroundColor: t.bg }]}>
      <ScreenHeader title="Downloads" />
      <ScrollView keyboardShouldPersistTaps="handled">
        <View style={[styles.inputWrap, { backgroundColor: t.surface }]}>
          <Ionicons name="download-outline" size={18} color={t.textMuted} />
          <TextInput
            value={q}
            onChangeText={setQ}
            onSubmitEditing={() => q.trim() && router.push({ pathname: '/get', params: { q: q.trim() } })}
            placeholder="Find free, legal music"
            placeholderTextColor={t.textMuted}
            returnKeyType="search"
            style={[styles.input, { color: t.text }]}
            accessibilityLabel="Find free, legal music to download"
          />
        </View>

        <View style={styles.setting}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: t.text, fontSize: 16 }}>Wi-Fi only</Text>
            <Text style={{ color: t.textMuted, fontSize: 12 }}>Pause downloads on mobile data and metered networks</Text>
          </View>
          <Switch value={wifiOnly} onValueChange={(v) => void setWifiOnly(v)} accessibilityLabel="Download on Wi-Fi only" />
        </View>

        {blocked && activeRows.some((r) => r.status === 'queued') && (
          <View style={[styles.banner, { backgroundColor: t.surface }]}>
            <Ionicons name={blocked === 'offline' ? 'cloud-offline-outline' : 'wifi-outline'} size={16} color={t.textMuted} />
            <Text style={{ color: t.textMuted, flex: 1 }}>
              {blocked === 'offline' ? 'Offline. Downloads continue when you’re back online.' : 'Waiting for Wi-Fi.'}
            </Text>
          </View>
        )}

        {activeRows.length > 0 && <Text style={[styles.section, { color: t.text }]}>In progress</Text>}
        {activeRows.map((r) => (
          <ActiveRow key={r.id} row={r} />
        ))}

        <Text style={[styles.section, { color: t.text }]}>Downloaded</Text>
        {doneRows.length === 0 ? (
          <Text style={[styles.empty, { color: t.textMuted }]}>
            Nothing downloaded yet. Search above, or tap Get on an album in Discover.
          </Text>
        ) : (
          doneRows.map((r) => <DoneRow key={r.id} row={r} />)
        )}

        <Storage />
        <View style={{ height: 24 }} />
      </ScrollView>
    </View>
  );
}

function ActiveRow({ row }: { row: DownloadRow }) {
  const t = useTheme();
  const live = useDownloads((s) => s.progress[row.id]);
  const done = live?.done ?? row.bytes_done;
  const total = live?.total ?? row.bytes_total;
  const fraction = total ? done / total : null;
  const status =
    row.status === 'downloading'
      ? `${formatBytes(done) || '0 KB'}${total ? ` of ${formatBytes(total)}` : ''}`
      : row.status === 'paused'
        ? 'Paused'
        : row.status === 'failed'
          ? 'Failed'
          : row.attempts > 0
            ? `Retrying (attempt ${row.attempts + 1} of 3)`
            : 'Queued';
  return (
    <View style={styles.row}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ color: t.text, fontSize: 15, fontWeight: '500' }}>
          {row.title}
        </Text>
        <Text numberOfLines={1} style={{ color: row.status === 'failed' ? t.danger : t.textMuted, fontSize: 12 }}>
          {[row.artist, status].filter(Boolean).join(' · ')}
        </Text>
        {row.status === 'failed' && !!row.error && (
          <Text numberOfLines={2} style={{ color: t.textMuted, fontSize: 12 }}>
            {row.error}
          </Text>
        )}
        {(row.status === 'downloading' || row.status === 'paused') && <ProgressBar value={fraction} />}
      </View>
      {row.status === 'downloading' && <IconButton icon="pause" label={`Pause ${row.title}`} onPress={() => void pause(row.id)} />}
      {row.status === 'paused' && <IconButton icon="play" label={`Resume ${row.title}`} onPress={() => void resume(row.id)} />}
      {row.status === 'failed' && <IconButton icon="refresh" label={`Retry ${row.title}`} onPress={() => void retry(row.id)} />}
      <IconButton icon="close" label={`Cancel ${row.title}`} color={t.textMuted} onPress={() => void cancel(row.id)} />
    </View>
  );
}

function DoneRow({ row }: { row: DownloadRow }) {
  const t = useTheme();
  const db = useSQLiteContext();
  const play = async () => {
    const track = row.track_id ? await getTrack(db, row.track_id) : null;
    if (track) playTracks([track], 0);
    else Alert.alert('Not in your library', 'This song was deleted from your library.');
  };
  return (
    <Pressable
      onPress={() => void play()}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: t.surface }]}
      accessibilityRole="button"
      accessibilityLabel={`${row.title}${row.artist ? ` by ${row.artist}` : ''}. Plays now.`}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ color: t.text, fontSize: 15, fontWeight: '500' }}>
          {row.title}
        </Text>
        <Text numberOfLines={1} style={{ color: t.textMuted, fontSize: 12 }}>
          {[row.artist, SOURCE_NAMES[row.source], formatBytes(row.bytes_done)].filter(Boolean).join(' · ')}
        </Text>
        <LicenseChip url={row.license} />
      </View>
      <Ionicons name="play-circle-outline" size={26} color={t.accent} />
    </Pressable>
  );
}

/** Spec 8 "Storage": per-source usage and bulk delete. */
function Storage() {
  const t = useTheme();
  const db = useSQLiteContext();
  const version = useLibraryVersion((s) => s.version);
  const [usage, setUsage] = useState<{ source: string; count: number; bytes: number }[]>([]);
  useEffect(() => {
    storageBySource(db).then(setUsage, () => setUsage([]));
  }, [db, version]);
  if (!usage.length) return null;

  const confirmDelete = (source: string, count: number) =>
    Alert.alert(
      `Delete ${count} ${count === 1 ? 'song' : 'songs'}?`,
      `Every song from ${SOURCE_NAMES[source] ?? source} will be removed from localtunes and its file deleted from this phone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => void deleteAllFromSource(source as 'imported') },
      ],
    );

  return (
    <>
      <Text style={[styles.section, { color: t.text }]}>Storage</Text>
      {usage.map((u) => (
        <View key={u.source} style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: t.text, fontSize: 15 }}>{SOURCE_NAMES[u.source] ?? u.source}</Text>
            <Text style={{ color: t.textMuted, fontSize: 12 }}>
              {u.count} {u.count === 1 ? 'song' : 'songs'} · {formatBytes(u.bytes) || '0 KB'}
            </Text>
          </View>
          <Pressable
            onPress={() => confirmDelete(u.source, u.count)}
            style={styles.deleteBtn}
            accessibilityRole="button"
            accessibilityLabel={`Delete all songs from ${SOURCE_NAMES[u.source] ?? u.source}`}
          >
            <Text style={{ color: t.danger, fontWeight: '600' }}>Delete all</Text>
          </Pressable>
        </View>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  inputWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, paddingLeft: 12, borderRadius: 12, minHeight: TOUCH },
  input: { flex: 1, fontSize: 16, paddingVertical: 10 },
  setting: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10 },
  section: { fontSize: 18, fontWeight: '700', paddingHorizontal: 16, paddingTop: 20, paddingBottom: 6 },
  empty: { paddingHorizontal: 16, fontSize: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 16, paddingRight: 4, minHeight: 60, paddingVertical: 6 },
  deleteBtn: { minHeight: TOUCH, justifyContent: 'center', paddingHorizontal: 12 },
});
