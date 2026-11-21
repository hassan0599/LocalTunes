import { Stack } from 'expo-router';
import { SQLiteProvider, useSQLiteContext } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';
import { useEffect, type ReactNode } from 'react';
import { AppState } from 'react-native';

import { SheetHost } from '@/components/Sheet';
import { useTheme } from '@/components/theme';
import { DB_NAME, migrate } from '@/db/schema';
import { startDownloads } from '@/services/downloads/manager';
import { scanDevice, type ScanTrigger } from '@/services/media/deviceScan';
import { pruneCache } from '@/services/musicbrainz/cache';
import { setupPlayback } from '@/services/playback/PlaybackService';
import { startNetworkMonitoring } from '@/state/network';
import { loadWishlist } from '@/state/wishlist';

/** App-wide services that need the database: playback, device scan, network, wishlist. */
function Bootstrap({ children }: { children: ReactNode }) {
  const db = useSQLiteContext();

  useEffect(() => {
    setupPlayback(db).catch((e) => console.error('playback setup failed', e));
    loadWishlist(db).catch((e) => console.warn('wishlist load failed', e));
    pruneCache(db).catch((e) => console.warn('cache prune failed', e));
    const stopNetwork = startNetworkMonitoring();
    // Download queue resumes after restarts and when the connection returns (spec 2, rule 3).
    const stopDownloads = startDownloads(db).catch((e) => {
      console.warn('downloads start failed', e);
      return () => {};
    });
    return () => {
      stopNetwork();
      void stopDownloads.then((stop) => stop());
    };
  }, [db]);

  // Device scan (spec 6.1): on launch, and whenever the app returns to the foreground.
  // Unchanged MediaStore contents make the foreground scan a cheap no-op.
  useEffect(() => {
    const scan = (trigger: ScanTrigger) =>
      scanDevice(db, trigger).then(
        (r) => __DEV__ && console.log('device scan', trigger, JSON.stringify(r)),
        (e) => console.warn('device scan failed', e),
      );
    void scan('launch');
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void scan('foreground');
    });
    return () => sub.remove();
  }, [db]);

  return children;
}

export default function RootLayout() {
  const t = useTheme();
  return (
    <SQLiteProvider databaseName={DB_NAME} onInit={migrate}>
      <Bootstrap>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: t.bg },
            headerTintColor: t.text,
            contentStyle: { backgroundColor: t.bg },
          }}
        >
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="player" options={{ presentation: 'modal', headerShown: false }} />
          <Stack.Screen name="album" options={{ title: 'Album' }} />
          <Stack.Screen name="artist" options={{ title: 'Artist' }} />
          <Stack.Screen name="genre" options={{ title: 'Genre' }} />
          <Stack.Screen name="mb-artist" options={{ title: 'Artist' }} />
          <Stack.Screen name="mb-album" options={{ title: 'Album' }} />
          <Stack.Screen name="wishlist" options={{ title: 'Wishlist' }} />
          <Stack.Screen name="get" options={{ title: 'Get music' }} />
          <Stack.Screen name="playlist" options={{ title: 'Playlist' }} />
        </Stack>
        <SheetHost />
      </Bootstrap>
    </SQLiteProvider>
  );
}
