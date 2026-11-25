import { Pressable, StyleSheet, Text, View } from 'react-native';

import { radius, useTheme } from './theme';

interface Props<T extends string> {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}

/**
 * One rounded track with the selected option raised inside it (localtunes' replacement for
 * a row of pill chips). Options share the width equally, so it never needs to scroll.
 */
export function SegmentedControl<T extends string>({ options, value, onChange }: Props<T>) {
  const t = useTheme();
  return (
    <View style={[styles.track, { backgroundColor: t.surface }]} accessibilityRole="tablist">
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            style={[styles.segment, selected && { backgroundColor: t.elevated }]}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
          >
            <Text numberOfLines={1} style={[styles.label, { color: selected ? t.text : t.textMuted, fontWeight: selected ? '700' : '500' }]}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: { flexDirection: 'row', marginHorizontal: 16, padding: 3, borderRadius: radius.md },
  // 38 + 2 * 3 padding = 44 pt touch target.
  segment: { flex: 1, minHeight: 38, borderRadius: radius.md - 3, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  label: { fontSize: 14 },
});
