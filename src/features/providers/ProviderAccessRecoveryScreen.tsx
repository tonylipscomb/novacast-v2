import { useState } from 'react';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { NovaSpaceLoader } from '@/components/nova';
import { novaTheme } from '@/theme';
import { retryProviderInitialization } from './providerStore';
import type { ProviderAccessState } from './providerAccess';

type Props = { state: Exclude<ProviderAccessState, 'loading' | 'allowed'> };

export function ProviderAccessRecoveryScreen({ state }: Props) {
  const router = useRouter();
  const [retrying, setRetrying] = useState(false);
  const [retryMessage, setRetryMessage] = useState<string | null>(null);

  const retry = async () => {
    if (retrying) return;
    setRetrying(true);
    setRetryMessage(null);
    try {
      await retryProviderInitialization();
    } catch {
      setRetryMessage('The provider still needs attention. Pair another provider or try again.');
    } finally {
      setRetrying(false);
    }
  };

  if (retrying) return <View style={styles.screen}><NovaSpaceLoader label="Checking your provider…" /></View>;

  return (
    <View style={styles.screen}>
      <View style={styles.card}>
        <Text style={styles.badge}>PROVIDER ACCESS</Text>
        <Text style={styles.title}>Provider unavailable</Text>
        <Text style={styles.message}>
          {state === 'no_provider' ? 'Pair a TV provider to continue.' : 'Your current TV provider has expired or needs to be reconnected.'}
        </Text>
        {retryMessage ? <Text style={styles.error}>{retryMessage}</Text> : null}
        <View style={styles.actions}>
          <Pressable accessibilityRole="button" accessibilityLabel="Pair provider" focusable hasTVPreferredFocus onPress={() => router.replace('/pair')} style={styles.action}>
            <Text style={styles.actionText}>Pair Provider</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Open settings" focusable onPress={() => router.replace('/settings')} style={styles.action}>
            <Text style={styles.actionText}>Open Settings</Text>
          </Pressable>
          {state !== 'no_provider' ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Retry provider" focusable onPress={() => void retry()} style={styles.action}>
              <Text style={styles.actionText}>Retry</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: novaTheme.colors.background, alignItems: 'center', justifyContent: 'center', padding: 48 },
  card: { width: '72%', maxWidth: 1100, padding: 48, borderRadius: 24, backgroundColor: novaTheme.colors.surface, borderWidth: 1, borderColor: novaTheme.colors.borderStrong },
  badge: { color: novaTheme.colors.accent, fontSize: 18, fontWeight: '800', letterSpacing: 2 },
  title: { color: novaTheme.colors.textPrimary, fontSize: 42, fontWeight: '800', marginTop: 18 },
  message: { color: novaTheme.colors.textMuted, fontSize: 24, lineHeight: 34, marginTop: 16 },
  error: { color: novaTheme.colors.danger, fontSize: 18, marginTop: 18 },
  actions: { flexDirection: 'row', gap: 18, marginTop: 34 },
  action: { minWidth: 190, paddingHorizontal: 24, paddingVertical: 18, borderRadius: 12, backgroundColor: novaTheme.colors.accent },
  actionText: { color: novaTheme.colors.onAccent, fontSize: 20, fontWeight: '700', textAlign: 'center' },
});
