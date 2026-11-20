import { StyleSheet, Text, View } from 'react-native';

import { ScreenHeader } from './ScreenHeader';
import { useTheme } from './theme';

/** Temporary screen body used until each milestone fills in its screen. */
export function Placeholder({ title, milestone }: { title: string; milestone: string }) {
  const t = useTheme();
  return (
    <View style={[styles.screen, { backgroundColor: t.bg }]}>
      <ScreenHeader title={title} />
      <View style={styles.body}>
        <Text style={{ color: t.textMuted }}>Coming in {milestone}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
