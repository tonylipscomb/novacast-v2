import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Application from 'expo-application';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { BackHandler, Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { NovaScreen } from '@/components/nova/NovaScreen';
import { useAppTheme } from '@/theme/AppThemeProvider';

import { fetchProductionUpdateManifest, resolveUpdateDecision, type UpdateManifest } from './updateCenter';

type UpgradeState = 'checking' | 'unavailable' | 'current' | 'available' | 'error';

export function UpgradeCenterScreen() {
  const router = useRouter();
  const { theme } = useAppTheme();
  const [state, setState] = useState<UpgradeState>('checking');
  const [manifest, setManifest] = useState<UpdateManifest | null>(null);
  const [focused, setFocused] = useState(false);
  const installedCode = Number(Application.nativeBuildVersion ?? 0);
  const installedName = Application.nativeApplicationVersion ?? 'unknown';
  const styles = useMemo(() => createStyles(theme), [theme]);

  const check = useCallback(async () => {
    setState('checking');
    const next = await fetchProductionUpdateManifest({ force: true });
    if (!next) { setManifest(null); setState('unavailable'); return; }
    const decision = resolveUpdateDecision(installedCode, next);
    if (decision.kind === 'available') { setManifest(decision.manifest); setState('available'); }
    else if (decision.kind === 'no-update') { setManifest(next); setState('current'); }
    else setState('error');
  }, [installedCode]);

  useEffect(() => {
    const timer = setTimeout(() => { void check(); }, 0);
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { router.back(); return true; });
    return () => { clearTimeout(timer); sub.remove(); };
  }, [check, router]);

  return <NovaScreen contentStyle={styles.screen}>
    <View style={styles.header}><View><Text style={styles.title}>Upgrade Center</Text><Text style={styles.subtitle}>Secure production update discovery.</Text></View><ActionButton label="Back" icon="arrow-left" onPress={() => router.back()} /></View>
    <View style={styles.panel}>
      <Text style={styles.sectionTitle}>Installed version</Text><Text style={styles.version}>{installedName} · build {installedCode || 'unknown'}</Text>
      {state === 'checking' ? <Status icon="sync" text="Checking for an approved production update…" /> : null}
      {state === 'unavailable' ? <Status icon="cloud-off-outline" text="Update checking is unavailable in this build. No download was started." /> : null}
      {state === 'error' ? <Status icon="alert-outline" text="The update manifest did not pass validation." /> : null}
      {state === 'current' ? <Status icon="check-circle-outline" text="NovaCast is up to date." /> : null}
      {state === 'available' && manifest ? <>
        <Status icon="download-circle-outline" text={`Production update available: ${manifest.versionName} · build ${manifest.versionCode}`} />
        <Text style={styles.body}>{manifest.releaseNotes?.join(' • ') || 'A verified production update is available.'}</Text>
        <ActionButton label="Open official download" icon="open-in-new" onPress={() => void Linking.openURL(manifest.apkUrl)} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} focused={focused} />
        <Text style={styles.note}>This build does not include a native installer or local APK verification bridge. Download handoff is explicit; installation remains an Android system action.</Text>
      </> : null}
      <ActionButton label="Check again" icon="refresh" onPress={() => void check()} />
    </View>
  </NovaScreen>;
}

function Status({ icon, text }: { icon: 'sync' | 'cloud-off-outline' | 'alert-outline' | 'check-circle-outline' | 'download-circle-outline'; text: string }) { const { theme } = useAppTheme(); return <View style={statusStyles.row}><MaterialCommunityIcons name={icon} size={26} color={theme.colors.accent} /><Text style={[statusStyles.text, { color: theme.colors.textPrimary }]}>{text}</Text></View>; }
function ActionButton({ label, icon, onPress, onFocus, onBlur, focused = false }: { label: string; icon: 'arrow-left' | 'open-in-new' | 'refresh'; onPress: () => void; onFocus?: () => void; onBlur?: () => void; focused?: boolean }) { const { theme } = useAppTheme(); return <Pressable focusable accessibilityRole="button" accessibilityLabel={label} onFocus={onFocus} onBlur={onBlur} onPress={onPress} style={[buttonStyles.button, { borderColor: focused ? theme.colors.accent : theme.colors.borderSubtle }]}><MaterialCommunityIcons name={icon} size={19} color={theme.colors.textPrimary} /><Text style={[buttonStyles.text, { color: theme.colors.textPrimary }]}>{label}</Text></Pressable>; }
function createStyles(theme: ReturnType<typeof useAppTheme>['theme']) { return StyleSheet.create({ screen: { padding: 30 }, header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, title: { color: theme.colors.textPrimary, fontSize: 30, fontWeight: '800' }, subtitle: { color: theme.colors.textMuted, marginTop: 5 }, panel: { marginTop: 30, gap: 18, maxWidth: 760, padding: 24, borderRadius: 22, borderWidth: 1, borderColor: theme.colors.borderSubtle, backgroundColor: theme.colors.surface }, sectionTitle: { color: theme.colors.textMuted, fontSize: 13, textTransform: 'uppercase', letterSpacing: 1 }, version: { color: theme.colors.textPrimary, fontSize: 25, fontWeight: '800' }, body: { color: theme.colors.textMuted, lineHeight: 21 }, note: { color: theme.colors.textMuted, fontSize: 12, lineHeight: 18 } }); }
const statusStyles = StyleSheet.create({ row: { flexDirection: 'row', alignItems: 'center', gap: 14 }, text: { flex: 1, fontSize: 17, fontWeight: '700' } });
const buttonStyles = StyleSheet.create({ button: { alignSelf: 'flex-start', minHeight: 46, borderRadius: 14, borderWidth: 2, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 9 }, text: { fontWeight: '800' } });
