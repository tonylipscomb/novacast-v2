import { useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { NovaSpaceLoader } from '@/components/nova';
import {
  getDeviceStartupSnapshot,
  startDeviceStartup,
  subscribeDeviceStartup,
} from '@/features/device/deviceStartup';
import { novaTheme } from '@/theme';

export function PublicStartupGate({ children }: { children: ReactNode }) {
  const startup = useSyncExternalStore(
    subscribeDeviceStartup,
    getDeviceStartupSnapshot,
    getDeviceStartupSnapshot,
  );

  useEffect(() => {
    void startDeviceStartup().catch(() => undefined);
  }, []);

  if (startup.phase === 'failed') {
    return (
      <View style={styles.failure}>
        <Text style={styles.title}>NovaCast could not finish starting</Text>
        <Text style={styles.copy}>Check your connection and try again.</Text>
        <Pressable focusable hasTVPreferredFocus onPress={() => void startDeviceStartup().catch(() => undefined)} style={styles.retry}>
          <Text style={styles.retryText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  if (startup.phase !== 'ready') {
    return <NovaSpaceLoader label="Starting NovaCast…" />;
  }

  return children;
}

const styles = StyleSheet.create({
  failure: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    backgroundColor: novaTheme.colors.background,
    paddingHorizontal: 40,
  },
  title: { color: novaTheme.colors.textPrimary, fontSize: 30, fontWeight: '800', textAlign: 'center' },
  copy: { color: novaTheme.colors.textSecondary, fontSize: 17, textAlign: 'center' },
  retry: { minHeight: 52, paddingHorizontal: 28, justifyContent: 'center', borderRadius: 10, backgroundColor: novaTheme.colors.accent },
  retryText: { color: novaTheme.colors.textPrimary, fontSize: 17, fontWeight: '700' },
});
