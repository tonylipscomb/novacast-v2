import { useEffect, useRef, useState } from 'react';
import { findNodeHandle, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { NovaButton, NovaScreen, NovaSpaceLoader } from '@/components/nova';
import { NOVA_GLASS } from '@/components/nova/novaGlassTheme';
import { novaTheme } from '@/theme';
import { retryProviderInitialization } from './providerStore';
import type { ProviderAccessState } from './providerAccess';

type Props = { state: Exclude<ProviderAccessState, 'loading' | 'allowed'> };

export function ProviderAccessRecoveryScreen({ state }: Props) {
  const router = useRouter();
  const [retrying, setRetrying] = useState(false);
  const [retryMessage, setRetryMessage] = useState<string | null>(null);
  const pairRef = useRef<View | null>(null);
  const settingsRef = useRef<View | null>(null);
  const retryRef = useRef<View | null>(null);
  const [focusTargets, setFocusTargets] = useState({ pair: null as number | null, settings: null as number | null, retry: null as number | null });

  useEffect(() => {
    setFocusTargets({
      pair: findNodeHandle(pairRef.current),
      settings: findNodeHandle(settingsRef.current),
      retry: findNodeHandle(retryRef.current),
    });
  }, [state, retrying]);

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

  const hasRetry = state !== 'no_provider';
  return (
    <NovaScreen padded={false} contentStyle={styles.screenFrame}>
      <View style={styles.screen}>
        <View style={styles.card}>
          <Text style={styles.badge}>PROVIDER ACCESS</Text>
          <Text style={styles.title}>Provider unavailable</Text>
          <Text style={styles.message}>
            {state === 'no_provider' ? 'Pair a TV provider to continue.' : 'Your current TV provider has expired or needs to be reconnected.'}
          </Text>
          {retryMessage ? <Text style={styles.error}>{retryMessage}</Text> : null}
          <View style={styles.actions}>
            <NovaButton label="Pair Provider" nativeRef={pairRef} hasTVPreferredFocus nextFocusRight={focusTargets.settings ?? undefined} onPress={() => router.replace('/pair')} style={styles.action} />
            <NovaButton label="Open Settings" nativeRef={settingsRef} nextFocusLeft={focusTargets.pair ?? undefined} nextFocusRight={(hasRetry ? focusTargets.retry : focusTargets.pair) ?? undefined} onPress={() => router.replace('/settings')} style={styles.action} />
            {hasRetry ? <NovaButton label="Retry" nativeRef={retryRef} nextFocusLeft={focusTargets.settings ?? undefined} onPress={() => void retry()} style={styles.action} /> : null}
          </View>
        </View>
      </View>
    </NovaScreen>
  );
}

const styles = StyleSheet.create({
  screenFrame: { flex: 1 },
  screen: { flex: 1, backgroundColor: novaTheme.colors.background, alignItems: 'center', justifyContent: 'center', padding: 48 },
  card: { width: '72%', maxWidth: 1100, padding: 48, borderRadius: NOVA_GLASS.radius.base, backgroundColor: 'rgba(7,9,22,0.82)', borderWidth: 1, borderColor: NOVA_GLASS.focused.borderColor },
  badge: { color: NOVA_GLASS.text.secondary, fontSize: 18, fontWeight: '800', letterSpacing: 2 },
  title: { color: NOVA_GLASS.text.primary, fontSize: 42, fontWeight: '800', marginTop: 18 },
  message: { color: NOVA_GLASS.text.secondary, fontSize: 24, lineHeight: 34, marginTop: 16 },
  error: { color: novaTheme.colors.danger, fontSize: 18, marginTop: 18 },
  actions: { flexDirection: 'row', gap: 18, marginTop: 34 },
  action: { minWidth: 190, minHeight: 60, paddingHorizontal: 24, paddingVertical: 18, borderRadius: NOVA_GLASS.radius.base, backgroundColor: NOVA_GLASS.active.backgroundColor, borderColor: NOVA_GLASS.active.borderColor },
});
