import Ionicons from '@expo/vector-icons/Ionicons';
import { useSQLiteContext } from 'expo-sqlite';
import { Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { scanDevice } from '@/services/media/deviceScan';
import { useScan } from '@/state/scan';

import { TOUCH, useTheme } from './theme';

/**
 * Library header strip for the Android device scan: asks for audio access when it is
 * missing, and shows progress while new files are being added.
 */
export function DeviceMusicBanner() {
  const t = useTheme();
  const db = useSQLiteContext();
  const { permission, scanning, done, total } = useScan();

  if (Platform.OS !== 'android') return null;

  if (scanning && total > 0) {
    return (
      <View style={[styles.banner, { backgroundColor: t.surface }]} accessibilityLiveRegion="polite">
        <Ionicons name="phone-portrait-outline" size={18} color={t.accent} />
        <Text style={[styles.text, { color: t.text }]}>
          Adding music from this phone… {done}/{total}
        </Text>
      </View>
    );
  }

  if (permission !== 'undetermined' && permission !== 'denied') return null;
  const denied = permission === 'denied';
  return (
    <View style={[styles.banner, { backgroundColor: t.surface }]}>
      <Ionicons name="phone-portrait-outline" size={18} color={t.accent} />
      <Text style={[styles.text, { color: t.text }]}>
        {denied ? 'Music access is off. Turn it on in Settings to see songs on this phone.' : 'Show songs already on this phone?'}
      </Text>
      <Pressable
        onPress={() => (denied ? Linking.openSettings() : scanDevice(db, 'manual'))}
        style={styles.action}
        accessibilityRole="button"
      >
        <Text style={{ color: t.accent, fontWeight: '700' }}>{denied ? 'Settings' : 'Allow'}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 16,
    marginBottom: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    minHeight: TOUCH,
  },
  text: { flex: 1, fontSize: 14, paddingVertical: 10 },
  action: { minHeight: TOUCH, justifyContent: 'center', paddingHorizontal: 8 },
});
