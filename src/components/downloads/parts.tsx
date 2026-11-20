import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';

import { licenseLabel } from '@/services/sources/license';

import { useTheme } from '../theme';

export function LicenseChip({ url }: { url: string | null | undefined }) {
  const t = useTheme();
  if (!url) return null;
  return (
    <View style={[styles.chip, { borderColor: t.border }]} accessibilityLabel={`License: ${licenseLabel(url)}`}>
      <Ionicons name="ribbon-outline" size={11} color={t.textMuted} />
      <Text style={[styles.chipText, { color: t.textMuted }]}>{licenseLabel(url)}</Text>
    </View>
  );
}

export function ProgressBar({ value }: { value: number | null }) {
  const t = useTheme();
  return (
    <View style={[styles.track, { backgroundColor: t.border }]}>
      <View
        style={[
          styles.fill,
          { backgroundColor: t.accent, width: value === null ? '15%' : `${Math.max(2, Math.min(100, value * 100))}%` },
        ]}
      />
    </View>
  );
}

export function formatBytes(n: number | null | undefined): string {
  if (!n || n <= 0) return '';
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 3,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 1,
    marginTop: 4,
  },
  chipText: { fontSize: 11, fontWeight: '600' },
  track: { height: 4, borderRadius: 2, overflow: 'hidden', marginTop: 6 },
  fill: { height: 4, borderRadius: 2 },
});
