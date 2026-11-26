import Ionicons from '@expo/vector-icons/Ionicons';
import Constants from 'expo-constants';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Alert, Linking, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { formatBytes } from '@/components/downloads/parts';
import { StackScreen } from '@/components/StackScreen';
import { radius, TOUCH, useTheme } from '@/components/theme';
import { setWifiOnly } from '@/services/downloads/manager';
import { hiddenDeviceSongCount, restoreHiddenDeviceSongs, scanDevice, type ScanResult } from '@/services/media/deviceScan';
import { cacheStats, clearCache } from '@/services/musicbrainz/cache';
import { clearCoverCache, coverCacheBytes } from '@/services/musicbrainz/coverArt';
import { useDownloads } from '@/state/downloads';
import { useLibraryVersion } from '@/state/library';

const REPO_URL = 'https://github.com/hassan0599/LocalTunes';

export default function SettingsScreen() {
  const t = useTheme();
  const db = useSQLiteContext();
  const wifiOnly = useDownloads((s) => s.wifiOnly);
  const [cacheBytes, setCacheBytes] = useState<number | null>(null);
  const [hidden, setHidden] = useState(0);
  const [busy, setBusy] = useState<'scan' | 'restore' | 'cache' | null>(null);

  // Bumped after an action to re-read cache size and hidden-song count.
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let alive = true;
    Promise.all([cacheStats(db), hiddenDeviceSongCount(db)]).then(
      ([stats, hiddenCount]) => {
        if (!alive) return;
        setCacheBytes(stats.bytes + coverCacheBytes());
        setHidden(hiddenCount);
      },
      (e) => console.warn('settings: stats failed', e),
    );
    return () => {
      alive = false;
    };
  }, [db, version]);

  const run = async (kind: 'scan' | 'restore' | 'cache', fn: () => Promise<void>) => {
    setBusy(kind);
    try {
      await fn();
    } catch (e) {
      Alert.alert('Something went wrong', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
      refresh();
    }
  };

  const scan = () =>
    run('scan', async () => {
      const r = await scanDevice(db, 'manual');
      useLibraryVersion.getState().bump();
      Alert.alert('Scan finished', describeScan(r));
    });

  const restore = () =>
    Alert.alert(
      `Bring back ${hidden} ${hidden === 1 ? 'song' : 'songs'}?`,
      'Songs on this phone that you deleted from LocalTunes will be added to your library again.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Bring back',
          onPress: () =>
            run('restore', async () => {
              const r = await restoreHiddenDeviceSongs(db);
              useLibraryVersion.getState().bump();
              Alert.alert('Done', describeScan(r));
            }),
        },
      ],
    );

  const clear = () =>
    Alert.alert('Clear saved Discover pages?', 'Artist pages, albums and cover art from Discover are downloaded again next time you open them online. Your music is not affected.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear',
        style: 'destructive',
        onPress: () =>
          run('cache', async () => {
            await clearCache(db);
            clearCoverCache();
          }),
      },
    ]);

  return (
    <StackScreen title="Settings">
      <ScrollView contentContainerStyle={styles.content}>
        <Section title="Downloads">
          <Row
            icon="wifi-outline"
            title="Wi-Fi only"
            subtitle="Pause downloads on mobile data and metered networks"
            right={
              <Switch
                value={wifiOnly}
                onValueChange={(v) => void setWifiOnly(v)}
                trackColor={{ true: t.accent, false: t.elevated }}
                thumbColor="#FFFFFF"
                accessibilityLabel="Download on Wi-Fi only"
              />
            }
          />
        </Section>

        {Platform.OS === 'android' && (
          <Section title="Music on this phone">
            <Row
              icon="refresh-outline"
              title="Scan for music now"
              subtitle="LocalTunes also checks automatically when you open the app"
              onPress={busy ? undefined : scan}
              right={busy === 'scan' ? <ActivityIndicator color={t.accent} /> : undefined}
            />
            <Row
              icon="eye-outline"
              title="Bring back deleted songs"
              subtitle={hidden ? `${hidden} ${hidden === 1 ? 'song' : 'songs'} on this phone kept out of your library` : 'None: no songs from this phone were deleted'}
              onPress={busy || !hidden ? undefined : restore}
              right={busy === 'restore' ? <ActivityIndicator color={t.accent} /> : undefined}
            />
          </Section>
        )}

        <Section title="Storage">
          <Row
            icon="trash-outline"
            title="Clear saved Discover pages"
            subtitle={cacheBytes == null ? 'Calculating…' : cacheBytes > 0 ? `${formatBytes(cacheBytes)} of artist pages and cover art` : 'Nothing saved yet'}
            onPress={busy || !cacheBytes ? undefined : clear}
            right={busy === 'cache' ? <ActivityIndicator color={t.accent} /> : undefined}
          />
        </Section>

        <Section title="About">
          <Row icon="musical-notes-outline" title="LocalTunes" subtitle={`Version ${Constants.expoConfig?.version ?? 'unknown'} · MIT licence`} />
          <Row
            icon="logo-github"
            title="Source code"
            subtitle="Report a problem or suggest a feature"
            onPress={() => void Linking.openURL(REPO_URL)}
            external
          />
          <Row icon="information-circle-outline" title="Music data" subtitle="Artist and album info from MusicBrainz; cover art from the Cover Art Archive" />
          <Row icon="download-outline" title="Free music" subtitle="Downloads from Internet Archive and Jamendo, under the licence shown for each song" />
        </Section>
      </ScrollView>
    </StackScreen>
  );
}

function describeScan(r: ScanResult): string {
  if (r.skipped === 'permission') return 'LocalTunes needs permission to read music on this phone. You can allow it in Android settings.';
  const parts = [`${r.added} added`, `${r.removed} removed`];
  if (r.failed) parts.push(`${r.failed} couldn’t be read`);
  return parts.join(', ') + '.';
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const t = useTheme();
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: t.textMuted }]} accessibilityRole="header">
        {title}
      </Text>
      <View style={[styles.card, { backgroundColor: t.surface }]}>{children}</View>
    </View>
  );
}

function Row({
  icon,
  title,
  subtitle,
  right,
  onPress,
  external,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  subtitle?: string;
  right?: ReactNode;
  onPress?: () => void;
  external?: boolean;
}) {
  const t = useTheme();
  const body = (
    <>
      <Ionicons name={icon} size={22} color={t.textMuted} />
      <View style={{ flex: 1 }}>
        <Text style={{ color: t.text, fontSize: 16 }}>{title}</Text>
        {!!subtitle && <Text style={{ color: t.textMuted, fontSize: 13, marginTop: 2 }}>{subtitle}</Text>}
      </View>
      {right}
      {external && <Ionicons name="open-outline" size={18} color={t.textFaint} />}
    </>
  );
  if (!onPress) return <View style={styles.row}>{body}</View>;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: t.elevated }]}
      accessibilityRole={external ? 'link' : 'button'}
      accessibilityLabel={subtitle ? `${title}. ${subtitle}` : title}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 24, paddingBottom: 32 },
  section: { gap: 8 },
  sectionTitle: { fontSize: 13, fontWeight: '600', marginLeft: 4 },
  card: { borderRadius: radius.lg, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 14, paddingVertical: 12, minHeight: TOUCH + 12 },
});
