/**
 * App-wide bottom sheet (actions menu) and text prompt, rendered once by <SheetHost/>.
 * Android's Alert allows only three buttons and has no text input, so menus with more
 * options and "New playlist" use these instead.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { create } from 'zustand';

import { CoverImage } from './CoverImage';
import { radius, TOUCH, useTheme } from './theme';

type IconName = ComponentProps<typeof Ionicons>['name'];

export interface SheetOption {
  label: string;
  icon: IconName;
  onPress: () => void;
  destructive?: boolean;
}

interface SheetSpec {
  title: string;
  subtitle?: string;
  artwork?: { uri: string | null; seed: string };
  options: SheetOption[];
}

interface PromptSpec {
  title: string;
  placeholder?: string;
  initial?: string;
  confirmLabel: string;
  onSubmit: (value: string) => void;
}

const useSheet = create<{ sheet: SheetSpec | null; prompt: PromptSpec | null }>(() => ({ sheet: null, prompt: null }));

export function showSheet(spec: SheetSpec) {
  useSheet.setState({ sheet: spec });
}

export function showPrompt(spec: PromptSpec) {
  useSheet.setState({ prompt: spec, sheet: null });
}

const closeSheet = () => useSheet.setState({ sheet: null });
const closePrompt = () => useSheet.setState({ prompt: null });

export function SheetHost() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { sheet, prompt } = useSheet();
  return (
    <>
      <Modal visible={!!sheet} transparent animationType="slide" onRequestClose={closeSheet} statusBarTranslucent>
        <Pressable style={styles.backdrop} onPress={closeSheet} accessibilityLabel="Close menu" />
        {sheet && (
          <View style={[styles.sheet, { backgroundColor: t.elevated, paddingBottom: insets.bottom + 8 }]}>
            <View style={[styles.grabber, { backgroundColor: t.textFaint }]} />
            <View style={styles.head}>
              {sheet.artwork && <CoverImage uri={sheet.artwork.uri} seed={sheet.artwork.seed} size={48} />}
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={[styles.title, { color: t.text }]} accessibilityRole="header">
                  {sheet.title}
                </Text>
                {!!sheet.subtitle && (
                  <Text numberOfLines={1} style={{ color: t.textMuted }}>
                    {sheet.subtitle}
                  </Text>
                )}
              </View>
            </View>
            <View style={[styles.divider, { backgroundColor: t.border }]} />
            <ScrollView style={{ maxHeight: 420 }}>
              {sheet.options.map((o) => (
                <Pressable
                  key={o.label}
                  onPress={() => {
                    closeSheet();
                    // Let the sheet close before opening another modal (prompt, alert).
                    setTimeout(o.onPress, 250);
                  }}
                  style={({ pressed }) => [styles.option, pressed && { backgroundColor: t.surface }]}
                  accessibilityRole="button"
                >
                  <Ionicons name={o.icon} size={22} color={o.destructive ? t.danger : t.textMuted} />
                  <Text style={[styles.optionText, { color: o.destructive ? t.danger : t.text }]}>{o.label}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        )}
      </Modal>
      <PromptModal spec={prompt} />
    </>
  );
}

function PromptModal({ spec }: { spec: PromptSpec | null }) {
  const t = useTheme();
  const [value, setValue] = useState('');
  useEffect(() => setValue(spec?.initial ?? ''), [spec]);
  const submit = () => {
    const v = value.trim();
    if (!v || !spec) return;
    closePrompt();
    spec.onSubmit(v);
  };
  return (
    <Modal visible={!!spec} transparent animationType="fade" onRequestClose={closePrompt} statusBarTranslucent>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.center}>
        <Pressable style={StyleSheet.absoluteFill} onPress={closePrompt} accessibilityLabel="Cancel" />
        {spec && (
          <View style={[styles.dialog, { backgroundColor: t.elevated }]}>
            <Text style={[styles.dialogTitle, { color: t.text }]} accessibilityRole="header">
              {spec.title}
            </Text>
            <TextInput
              value={value}
              onChangeText={setValue}
              autoFocus
              placeholder={spec.placeholder}
              placeholderTextColor={t.textFaint}
              onSubmitEditing={submit}
              returnKeyType="done"
              selectionColor={t.accent}
              style={[styles.input, { color: t.text, borderBottomColor: t.accent }]}
              accessibilityLabel={spec.title}
            />
            <View style={styles.dialogButtons}>
              <Pressable onPress={closePrompt} style={styles.dialogBtn} accessibilityRole="button">
                <Text style={{ color: t.textMuted, fontWeight: '700' }}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={submit}
                disabled={!value.trim()}
                style={[styles.dialogBtn, styles.primary, { backgroundColor: t.accent, opacity: value.trim() ? 1 : 0.4 }]}
                accessibilityRole="button"
              >
                <Text style={{ color: t.onAccent, fontWeight: '700' }}>{spec.confirmLabel}</Text>
              </Pressable>
            </View>
          </View>
        )}
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: { borderTopLeftRadius: radius.lg + 4, borderTopRightRadius: radius.lg + 4, paddingTop: 8 },
  grabber: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, marginBottom: 8 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 8 },
  title: { fontSize: 16, fontWeight: '700' },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: 4 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 20, minHeight: TOUCH + 8 },
  optionText: { fontSize: 16, fontWeight: '500' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.6)', padding: 24 },
  dialog: { alignSelf: 'stretch', borderRadius: radius.lg, padding: 20, gap: 16 },
  dialogTitle: { fontSize: 20, fontWeight: '700', textAlign: 'center' },
  input: { fontSize: 22, fontWeight: '700', textAlign: 'center', borderBottomWidth: 2, paddingVertical: 8 },
  dialogButtons: { flexDirection: 'row', justifyContent: 'center', gap: 12 },
  dialogBtn: { minHeight: TOUCH, paddingHorizontal: 20, borderRadius: radius.md, justifyContent: 'center' },
  primary: {},
});
