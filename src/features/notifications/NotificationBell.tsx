import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useSyncExternalStore, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useAppTheme } from '@/theme/AppThemeProvider';

import {
  getNotificationCenterSnapshot,
  hydrateNotificationCenter,
  subscribeNotificationCenter,
} from './notificationCenterStore';

export function NotificationBell() {
  const router = useRouter();
  const { theme } = useAppTheme();
  const [focused, setFocused] = useState(false);
  const entries = useSyncExternalStore(subscribeNotificationCenter, getNotificationCenterSnapshot, getNotificationCenterSnapshot);
  useEffect(() => { void hydrateNotificationCenter(); }, []);
  const unread = entries.filter((entry) => entry.dismissedAt === null && entry.readAt === null).length;

  return (
    <Pressable
      focusable
      accessibilityRole="button"
      accessibilityLabel={unread ? `Notifications, ${unread} unread` : 'Notifications'}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={() => router.push('/notifications')}
      style={[styles.button, { borderColor: focused ? theme.colors.accent : theme.colors.borderSubtle, backgroundColor: theme.colors.surfaceMuted }]}
    >
      <MaterialCommunityIcons name="bell-outline" size={22} color={theme.colors.textPrimary} />
      {unread > 0 ? <View style={[styles.badge, { backgroundColor: theme.colors.accent }]}><Text style={styles.badgeText}>{unread > 99 ? '99+' : unread}</Text></View> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { width: 54, height: 46, borderRadius: 16, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', right: 5, top: 3, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '800' },
});
