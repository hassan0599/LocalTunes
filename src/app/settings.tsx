import Ionicons from '@expo/vector-icons/Ionicons';
import Constants from 'expo-constants';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Alert, Linking, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { formatBytes } from '@/components/downloads/parts';
import { showPrompt } from '@/components/Sheet';
import { StackScreen } from '@/components/StackScreen';
import { radius, TOUCH, useTheme } from '@/components/theme';
import { setWifiOnly } from '@/services/downloads/manager';
import { hiddenDeviceSongCount, restoreHiddenDeviceSongs, scanDevice, type ScanResult } from '@/services/media/deviceScan';
import { cacheStats, clearCache } from '@/services/musicbrainz/cache';
import { clearCoverCache, coverCacheBytes } from '@/services/musicbrainz/coverArt';
import { getSetting, setSetting } from '@/db/queries';
import { BackupError } from '@/services/backup/backup';
import { exportBackup, pickAndRestore, type RestoreResult } from '@/services/backup/io';
import {
  connect,
  disconnect,
  flushListens,
  pendingListenCount,
  TOKEN_REJECTED_KEY,
  USER_KEY,
  validateToken,
} from '@/services/listenbrainz/listenbrainz';
import { clearLyrics, LYRICS_ONLINE_KEY } from '@/services/lyrics/lyrics';
import { refreshScrobbling, setNormalize, setPlaybackRate } from '@/services/playback/PlaybackService';
import { useDownloads } from '@/state/downloads';
import { useLibraryVersion } from '@/state/library';
import { usePlayer } from '@/state/player';
import { loadWishlist } from '@/state/wishlist';

const REPO_URL = 'https://github.com/hassan0599/LocalTunes';

type Busy = 'scan' | 'restore' | 'cache' | 'backup' | 'import' | 'listenbrainz';

interface LbState {
  user: string | null;
  rejected: boolean;
  pending: number;
}

export default function SettingsScreen() {
  const t = useTheme();
  const db = useSQLiteContext();
  const wifiOnly = useDownloads((s) => s.wifiOnly);
  const [cacheBytes, setCacheBytes] = useState<number | null>(null);
  const [hidden, setHidden] = useState(0);
  const [gainInfo, setGainInfo] = useState<{ tagged: number; total: number } | null>(null);
  const normalize = usePlayer((s) => s.normalize);
  const [lyricsOnline, setLyricsOnline] = useState(true);
  const [lb, setLb] = useState<LbState>({ user: null, rejected: false, pending: 0 });
  const [busy, setBusy] = useState<Busy | null>(null);

  // Bumped after an action to re-read cache size and hidden-song count.
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let alive = true;
    Promise.all([
      cacheStats(db),
      hiddenDeviceSongCount(db),
      db.getFirstAsync<{ tagged: number; total: number }>('SELECT COUNT(replay_gain_db) AS tagged, COUNT(*) AS total FROM tracks'),
      getSetting<boolean>(db, LYRICS_ONLINE_KEY),
      Promise.all([getSetting<string>(db, USER_KEY), getSetting<boolean>(db, TOKEN_REJECTED_KEY), pendingListenCount(db)]),
    ]).then(
      ([stats, hiddenCount, gains, lyricsSetting, [lbUser, lbRejected, lbPending]]) => {
        if (!alive) return;
        setLb({ user: lbUser, rejected: !!lbRejected, pending: lbPending });
        setLyricsOnline(lyricsSetting ?? true);
        setCacheBytes(stats.bytes + coverCacheBytes());
        setHidden(hiddenCount);
        setGainInfo(gains);
      },
      (e) => console.warn('settings: stats failed', e),
    );
    return () => {
      alive = false;
    };
  }, [db, version]);

  const run = async (kind: Busy, fn: () => Promise<void>) => {
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

  const backup = () =>
    run('backup', async () => {
      const r = await exportBackup(db);
      if (r) {
        Alert.alert(
          'Backup saved',
          `“${r.fileName}”${r.playlists ? ` and ${r.playlists} playlist ${r.playlists === 1 ? 'file' : 'files'} (.m3u8)` : ''} were saved in the folder you picked. Keep them somewhere safe, like a cloud drive.`,
        );
      }
    });

  const restoreFile = () =>
    run('import', async () => {
      let r: RestoreResult | null;
      try {
        r = await pickAndRestore(db);
      } catch (e) {
        if (e instanceof BackupError) {
          Alert.alert('Can’t restore this file', e.message);
          return;
        }
        throw e;
      }
      if (!r) return;
      useLibraryVersion.getState().bump();
      if (r.kind === 'm3u') {
        const { name, entries, matched } = r.report;
        Alert.alert('Playlist imported', `“${name}”: ${matched} of ${entries} songs found in your library.`);
        return;
      }
      const rep = r.report;
      // Apply restored settings to the running app too.
      if (typeof rep.settings['player.rate'] === 'number') setPlaybackRate(rep.settings['player.rate']);
      if (typeof rep.settings['player.normalize'] === 'boolean') setNormalize(rep.settings['player.normalize']);
      if (typeof rep.settings['downloads.wifiOnly'] === 'boolean') await setWifiOnly(rep.settings['downloads.wifiOnly']);
      await loadWishlist(db);
      const lines = [
        `${rep.matched} of ${rep.songs} songs found in your library (play counts merged).`,
        `${rep.playlists} ${rep.playlists === 1 ? 'playlist' : 'playlists'} restored${rep.playlistSongsMissing ? `; ${rep.playlistSongsMissing} playlist ${rep.playlistSongsMissing === 1 ? 'song isn’t' : 'songs aren’t'} on this phone yet` : ''}.`,
      ];
      if (rep.wishlist) lines.push(`${rep.wishlist} wishlist ${rep.wishlist === 1 ? 'item' : 'items'} added.`);
      Alert.alert('Backup restored', lines.join('\n'));
    });

  const connectListenBrainz = () =>
    showPrompt({
      title: 'Paste your ListenBrainz user token',
      placeholder: 'User token',
      confirmLabel: 'Connect',
      onSubmit: (token) =>
        void run('listenbrainz', async () => {
          let user: string | null;
          try {
            user = await validateToken(token);
          } catch {
            Alert.alert('Couldn’t reach ListenBrainz', 'Check your connection and try again.');
            return;
          }
          if (!user) {
            Alert.alert('Token not accepted', 'Copy the user token from listenbrainz.org/settings and paste it exactly.');
            return;
          }
          await connect(db, token, user);
          await refreshScrobbling();
          void flushListens(db);
          Alert.alert('Connected', `Listens will be sent to ListenBrainz as ${user}.`);
        }),
    });

  const sendNow = () =>
    run('listenbrainz', async () => {
      const r = await flushListens(db);
      if (r.status === 'sent') Alert.alert('Sent', `${r.sent} ${r.sent === 1 ? 'listen' : 'listens'} sent to ListenBrainz.`);
      else if (r.status === 'nothing') Alert.alert('All caught up', 'There are no listens waiting to be sent.');
      else if (r.status === 'rejected') Alert.alert('Token not accepted', 'ListenBrainz no longer accepts your token. Disconnect and connect again with a new one.');
      else if (r.status === 'retry-later') Alert.alert('Couldn’t send', 'LocalTunes will try again when you’re online.');
    });

  const disconnectListenBrainz = () =>
    Alert.alert('Disconnect ListenBrainz?', lb.pending ? `${lb.pending} unsent ${lb.pending === 1 ? 'listen' : 'listens'} will be discarded.` : 'LocalTunes will stop sending listens.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Disconnect',
        style: 'destructive',
        onPress: () =>
          run('listenbrainz', async () => {
            await disconnect(db);
            await refreshScrobbling();
          }),
      },
    ]);

  const clear = () =>
    Alert.alert('Clear saved online data?', 'Discover pages, cover art and lyrics are looked up again next time you open them online. Your music is not affected.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear',
        style: 'destructive',
        onPress: () =>
          run('cache', async () => {
            await clearCache(db);
            await clearLyrics(db);
            clearCoverCache();
          }),
      },
    ]);

  return (
    <StackScreen title="Settings">
      <ScrollView contentContainerStyle={styles.content}>
        <Section title="Playback">
          <Row
            icon="volume-medium-outline"
            title="Normalize volume"
            subtitle={
              'Plays songs at a similar loudness using their ReplayGain tags' +
              (gainInfo ? ` (${gainInfo.tagged} of ${gainInfo.total} ${gainInfo.total === 1 ? 'song has' : 'songs have'} them)` : '')
            }
            right={
              <Switch
                value={normalize}
                onValueChange={setNormalize}
                trackColor={{ true: t.accent, false: t.elevated }}
                thumbColor="#FFFFFF"
                accessibilityLabel="Normalize volume"
              />
            }
          />
          <Row
            icon="document-text-outline"
            title="Look up lyrics online"
            subtitle="Searches LRCLIB by song title and artist when a song has no lyrics of its own"
            right={
              <Switch
                value={lyricsOnline}
                onValueChange={(v) => {
                  setLyricsOnline(v);
                  void setSetting(db, LYRICS_ONLINE_KEY, v);
                }}
                trackColor={{ true: t.accent, false: t.elevated }}
                thumbColor="#FFFFFF"
                accessibilityLabel="Look up lyrics online"
              />
            }
          />
        </Section>

        <Section title="ListenBrainz">
          {lb.user ? (
            <>
              <Row
                icon={lb.rejected ? 'alert-circle-outline' : 'radio-outline'}
                title={`Connected as ${lb.user}`}
                subtitle={
                  lb.rejected
                    ? 'ListenBrainz no longer accepts the token. Disconnect and connect again.'
                    : lb.pending
                      ? `${lb.pending} ${lb.pending === 1 ? 'listen' : 'listens'} waiting to be sent`
                      : 'Every listen has been sent'
                }
                onPress={() => void Linking.openURL(`https://listenbrainz.org/user/${encodeURIComponent(lb.user!)}/`)}
                external
              />
              {lb.pending > 0 && !lb.rejected && (
                <Row
                  icon="send-outline"
                  title="Send now"
                  onPress={busy ? undefined : sendNow}
                  right={busy === 'listenbrainz' ? <ActivityIndicator color={t.accent} /> : undefined}
                />
              )}
              <Row icon="log-out-outline" title="Disconnect" onPress={busy ? undefined : disconnectListenBrainz} />
            </>
          ) : (
            <>
              <Row
                icon="radio-outline"
                title="Connect ListenBrainz"
                subtitle="Send what you listen to to listenbrainz.org for stats and recommendations. Your listening history is public on your profile there."
                onPress={busy ? undefined : connectListenBrainz}
                right={busy === 'listenbrainz' ? <ActivityIndicator color={t.accent} /> : undefined}
              />
              <Row
                icon="key-outline"
                title="Find your user token"
                subtitle="Sign in at listenbrainz.org, then open Settings"
                onPress={() => void Linking.openURL('https://listenbrainz.org/settings/')}
                external
              />
            </>
          )}
        </Section>

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

        <Section title="Backup">
          <Row
            icon="cloud-upload-outline"
            title="Back up library"
            subtitle="Save playlists, play counts and wishlist to a folder you choose"
            onPress={busy ? undefined : backup}
            right={busy === 'backup' ? <ActivityIndicator color={t.accent} /> : undefined}
          />
          <Row
            icon="cloud-download-outline"
            title="Restore or import a playlist"
            subtitle="Open a LocalTunes backup, or an .m3u playlist from another player"
            onPress={busy ? undefined : restoreFile}
            right={busy === 'import' ? <ActivityIndicator color={t.accent} /> : undefined}
          />
        </Section>

        <Section title="Storage">
          <Row
            icon="trash-outline"
            title="Clear saved online data"
            subtitle={cacheBytes == null ? 'Calculating…' : cacheBytes > 0 ? `${formatBytes(cacheBytes)} of Discover pages and cover art, plus saved lyrics` : 'Saved lyrics and Discover pages'}
            onPress={busy ? undefined : clear}
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
