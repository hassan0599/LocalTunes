import { Stack } from 'expo-router';
import { SQLiteProvider, useSQLiteContext } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';
import { useEffect, type ReactNode } from 'react';
import { AppState } from 'react-native';

import { useTheme } from '@/components/theme';
import { DB_NAME, migrate } from '@/db/schema';
import { scanDevice, type ScanTrigger } from '@/services/media/deviceScan';
import { setupPlayback } from '@/services/playback/PlaybackService';

function PlaybackBootstrap({ children }: { children: ReactNode }) {
  const db = useSQLiteContext();
  useEffect(() => {
    setupPlayback(db).catch((e) => console.error('playback setup failed', e));
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
      <PlaybackBootstrap>
        <StatusBar style="auto" />
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
        </Stack>
      </PlaybackBootstrap>
    </SQLiteProvider>
  );
}
