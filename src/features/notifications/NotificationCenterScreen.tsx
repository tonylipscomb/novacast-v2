import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useSyncExternalStore, useState } from 'react';
import { BackHandler, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { NovaScreen } from '@/components/nova/NovaScreen';
import { useAppTheme } from '@/theme/AppThemeProvider';

import {
  dismissCenterNotification,
  getNotificationCenterSnapshot,
  markAllNotificationsRead,
  markNotificationRead,
  subscribeNotificationCenter,
} from './notificationCenterStore';

export function NotificationCenterScreen() {
  const router = useRouter();
  const { theme } = useAppTheme();
  const [focused, setFocused] = useState<string | null>(null);
  const entries = useSyncExternalStore(subscribeNotificationCenter, getNotificationCenterSnapshot, getNotificationCenterSnapshot)
    .filter((entry) => entry.dismissedAt === null);
  const styles = useMemo(() => createStyles(theme), [theme]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { router.back(); return true; });
    return () => sub.remove();
  }, [router]);

  return (
    <NovaScreen contentStyle={styles.screen}>
      <View style={styles.header}>
        <View><Text style={styles.title}>Notifications</Text><Text style={styles.subtitle}>Updates and service notices from NovaCast.</Text></View>
        <View style={styles.headerActions}>
          <CenterButton label="Mark all read" icon="email-open-outline" onPress={markAllNotificationsRead} />
          <CenterButton label="Back" icon="arrow-left" onPress={() => router.back()} />
        </View>
      </View>
      <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
        {entries.length === 0 ? <View style={styles.empty}><MaterialCommunityIcons name="bell-check-outline" size={42} color={theme.colors.accent} /><Text style={styles.emptyTitle}>You’re all caught up</Text><Text style={styles.body}>New updates and service notices will appear here.</Text></View> : null}
        {entries.map((entry) => (
          <Pressable
            key={entry.id}
            focusable
            onFocus={() => setFocused(entry.id)}
            onBlur={() => setFocused(null)}
            onPress={() => {
              markNotificationRead(entry.id);
              if (entry.category === 'app-update') router.push('/upgrade');
            }}
            style={[styles.card, !entry.readAt && styles.unread, focused === entry.id && { borderColor: theme.colors.accent, backgroundColor: theme.colors.surfaceMuted }]}
          >
            <MaterialCommunityIcons name={entry.category === 'app-update' ? 'download-circle-outline' : 'information-outline'} size={26} color={theme.colors.accent} />
            <View style={styles.cardBody}><Text style={styles.cardTitle}>{entry.title}</Text>{entry.message ? <Text style={styles.body}>{entry.message}</Text> : null}<Text style={styles.date}>{new Date(entry.createdAt).toLocaleString()}</Text></View>
            <Pressable focusable accessibilityLabel="Dismiss notification" onPress={() => dismissCenterNotification(entry.id)} style={styles.dismiss}><MaterialCommunityIcons name="close" size={20} color={theme.colors.textMuted} /></Pressable>
          </Pressable>
        ))}
      </ScrollView>
    </NovaScreen>
  );
}

function CenterButton({ label, icon, onPress }: { label: string; icon: 'email-open-outline' | 'arrow-left'; onPress: () => void }) {
  const { theme } = useAppTheme();
  const [focused, setFocused] = useState(false);
  return <Pressable focusable accessibilityRole="button" accessibilityLabel={label} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} onPress={onPress} style={[buttonStyles.button, { borderColor: focused ? theme.colors.accent : theme.colors.borderSubtle }]}><MaterialCommunityIcons name={icon} size={18} color={theme.colors.textPrimary} /><Text style={buttonStyles.text}>{label}</Text></Pressable>;
}

function createStyles(theme: ReturnType<typeof useAppTheme>['theme']) { return StyleSheet.create({
  screen: { padding: 30 }, header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, headerActions: { flexDirection: 'row', gap: 10 }, title: { color: theme.colors.textPrimary, fontSize: 30, fontWeight: '800' }, subtitle: { color: theme.colors.textMuted, marginTop: 5 }, list: { gap: 14, paddingTop: 28, paddingBottom: 40 }, card: { minHeight: 94, borderRadius: 18, borderWidth: 2, borderColor: theme.colors.borderSubtle, backgroundColor: theme.colors.surface, padding: 18, flexDirection: 'row', alignItems: 'center', gap: 16 }, unread: { borderColor: theme.colors.accent }, cardBody: { flex: 1, gap: 5 }, cardTitle: { color: theme.colors.textPrimary, fontSize: 18, fontWeight: '800' }, body: { color: theme.colors.textMuted, fontSize: 14 }, date: { color: theme.colors.textMuted, fontSize: 11 }, dismiss: { padding: 8 }, empty: { alignItems: 'center', padding: 80, gap: 12 }, emptyTitle: { color: theme.colors.textPrimary, fontSize: 22, fontWeight: '800' }, }); }
const buttonStyles = StyleSheet.create({ button: { minHeight: 44, borderRadius: 14, borderWidth: 2, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 8, borderColor: 'rgba(255,255,255,0.16)' }, text: { color: '#fff', fontWeight: '700' } });
