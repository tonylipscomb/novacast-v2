import { useSyncExternalStore } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { getOfflineSnapshot, subscribeOfflineStatus } from './offlineStatus';

/**
 * Subtle passive offline chip — never focusable, never blocking.
 */
export function OfflineStatusBanner() {
  const snapshot = useSyncExternalStore(subscribeOfflineStatus, getOfflineSnapshot, getOfflineSnapshot);
  if (snapshot.status !== 'offline') {
    return null;
  }

  return (
    <View pointerEvents="none" style={styles.banner} accessibilityElementsHidden>
      <Text style={styles.text}>Offline — browsing cached content when available</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    top: 12,
    alignSelf: 'center',
    zIndex: 9000,
    paddingHorizontal: 14,
    paddingVertical: 6,
    backgroundColor: 'rgba(0, 0, 0, 0.72)',
    borderWidth: 1,
    borderColor: 'rgba(255, 200, 80, 0.45)',
  },
  text: {
    color: '#F5E6C8',
    fontSize: 12,
    fontWeight: '700',
  },
});
