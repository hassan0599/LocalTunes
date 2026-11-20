import { Stack } from 'expo-router';
import { SQLiteProvider, useSQLiteContext } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';
import { useEffect, type ReactNode } from 'react';

import { useTheme } from '@/components/theme';
import { DB_NAME, migrate } from '@/db/schema';
import { setupPlayback } from '@/services/playback/PlaybackService';

function PlaybackBootstrap({ children }: { children: ReactNode }) {
  const db = useSQLiteContext();
  useEffect(() => {
    setupPlayback(db).catch((e) => console.error('playback setup failed', e));
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
