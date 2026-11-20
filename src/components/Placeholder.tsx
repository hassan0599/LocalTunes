import { StyleSheet, Text, View } from 'react-native';

/** Temporary screen body used until each milestone fills in its screen. */
export function Placeholder({ title, milestone }: { title: string; milestone: string }) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.note}>Coming in {milestone}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  title: { fontSize: 22, fontWeight: '600' },
  note: { opacity: 0.6 },
});
