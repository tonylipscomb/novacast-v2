import { useSyncExternalStore } from 'react';
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { NOVA_GLASS } from '@/components/nova/novaGlassTheme';
import { useAppTheme } from '@/theme/AppThemeProvider';
import { getOfflineSnapshot, subscribeOfflineStatus } from './offlineStatus';

/**
 * Subtle passive offline chip — never focusable, never blocking.
 */
export function OfflineStatusBanner() {
  const { theme } = useAppTheme();
  const snapshot = useSyncExternalStore(subscribeOfflineStatus, getOfflineSnapshot, getOfflineSnapshot);
  const styles = useMemo(() => createStyles(theme), [theme]);
  if (snapshot.status !== 'offline') {
    return null;
  }

  return (
    <View pointerEvents="none" style={styles.banner} accessibilityElementsHidden>
      <Text style={styles.text}>Offline — browsing cached content when available</Text>
    </View>
  );
}

function createStyles(theme: ReturnType<typeof useAppTheme>['theme']) {
  return StyleSheet.create({
    banner: {
    position: 'absolute',
    top: 12,
    alignSelf: 'center',
    zIndex: 9000,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: NOVA_GLASS.radius.subtle,
    backgroundColor: NOVA_GLASS.subtle.backgroundColor,
    borderWidth: 1,
    borderColor: NOVA_GLASS.subtle.borderColor,
    },
    text: {
    color: theme.colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    },
  });
}
