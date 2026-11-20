import { Stack } from 'expo-router';
import { SQLiteProvider } from 'expo-sqlite';

import { DB_NAME, migrate } from '@/db/schema';

export default function RootLayout() {
  return (
    <SQLiteProvider databaseName={DB_NAME} onInit={migrate}>
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="player" options={{ presentation: 'modal', title: 'Now Playing' }} />
      </Stack>
    </SQLiteProvider>
  );
}
