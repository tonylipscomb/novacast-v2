import { useEffect, useRef, useState } from 'react';
import { findNodeHandle, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { NovaButton, NovaScreen, NovaSpaceLoader } from '@/components/nova';
import { NOVA_GLASS } from '@/components/nova/novaGlassTheme';
import { novaTheme } from '@/theme';
import { retryProviderInitialization } from './providerStore';
import { clearAssignmentRetryBackoff } from '@/features/device/deviceAssignmentReconcile';
import type { ProviderAccessState } from './providerAccess';
import { focusProviderRecoveryViewWhenReady } from './providerRecoveryFocus';
import { logProviderRecoveryFocus } from './providerRecoveryDiagnostics';

type Props = { state: Exclude<ProviderAccessState, 'loading' | 'allowed'> };

export function ProviderAccessRecoveryScreen({ state }: Props) {
  const router = useRouter();
  const [retrying, setRetrying] = useState(false);
  const [retryMessage, setRetryMessage] = useState<string | null>(null);
  const pairRef = useRef<View | null>(null);
  const settingsRef = useRef<View | null>(null);
  const retryRef = useRef<View | null>(null);
  const [focusTarget, setFocusTarget] = useState<'pair' | 'retry'>('pair');
  const [focusTargets, setFocusTargets] = useState({ pair: null as number | null, settings: null as number | null, retry: null as number | null });
  const mountedAtRef = useRef<number | null>(null);

  useEffect(() => {
    mountedAtRef.current ??= Date.now();
    logProviderRecoveryFocus({ surface: 'provider-access', action: 'surface-mounted', accessState: state });
    const cancel = focusProviderRecoveryViewWhenReady(
      () => (focusTarget === 'retry' ? retryRef.current : pairRef.current),
      (attempt, focusHandlePresent) => {
        logProviderRecoveryFocus({
          surface: 'provider-access',
          action: 'preferred-focus-requested',
          controlId: focusTarget,
          accessState: state,
          focusHandlePresent,
          elapsedMs: Date.now() - (mountedAtRef.current ?? Date.now()),
          retryAttempt: attempt,
          resultCategory: focusHandlePresent ? 'requested' : 'not-ready',
        });
      },
    );
    return cancel;
  }, [focusTarget, retrying, state]);

  useEffect(() => {
    setFocusTargets({
      pair: pairRef.current ? findNodeHandle(pairRef.current) : null,
      settings: settingsRef.current ? findNodeHandle(settingsRef.current) : null,
      retry: retryRef.current ? findNodeHandle(retryRef.current) : null,
    });
  }, [focusTarget, retrying, state]);

  const retry = async () => {
    if (retrying) return;
    setRetrying(true);
    setRetryMessage(null);
    logProviderRecoveryFocus({ surface: 'provider-access', action: 'retry-start', controlId: 'retry', accessState: state, retryAttempt: 1 });
    try {
      clearAssignmentRetryBackoff();
      await retryProviderInitialization();
      logProviderRecoveryFocus({ surface: 'provider-access', action: 'retry-success', controlId: 'retry', accessState: state, retryAttempt: 1, resultCategory: 'validated' });
    } catch {
      setRetryMessage('The provider still needs attention. Pair another provider or try again.');
      setFocusTarget('retry');
      logProviderRecoveryFocus({ surface: 'provider-access', action: 'retry-failed', controlId: 'retry', accessState: state, retryAttempt: 1, resultCategory: 'validation-failed' });
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
          <Text style={styles.title}>
            {state === 'recovery_available' ? 'Provider refresh unavailable' : 'Provider unavailable'}
          </Text>
          <Text style={styles.message}>
            {state === 'no_provider'
              ? 'Pair a TV provider to continue.'
              : state === 'recovery_available'
                ? 'NovaCast could not refresh the provider promptly. Retry or open Settings while the current connection is preserved.'
                : 'Your current TV provider has expired or needs to be reconnected.'}
          </Text>
          {retryMessage ? <Text style={styles.error}>{retryMessage}</Text> : null}
          <View style={styles.actions}>
            <NovaButton label="Pair Provider" nativeRef={pairRef} hasTVPreferredFocus={focusTarget === 'pair'} nextFocusRight={focusTargets.settings ?? undefined} onFocus={() => logProviderRecoveryFocus({ surface: 'provider-access', action: 'preferred-focus-received', controlId: 'pair', accessState: state })} onPress={() => { logProviderRecoveryFocus({ surface: 'provider-access', action: 'action-pressed', controlId: 'pair', accessState: state }); router.replace('/pair'); }} style={styles.action} />
            <NovaButton label="Open Settings" nativeRef={settingsRef} nextFocusLeft={focusTargets.pair ?? undefined} nextFocusRight={(hasRetry ? focusTargets.retry : focusTargets.pair) ?? undefined} onFocus={() => logProviderRecoveryFocus({ surface: 'provider-access', action: 'preferred-focus-received', controlId: 'settings', accessState: state })} onPress={() => { logProviderRecoveryFocus({ surface: 'provider-access', action: 'action-pressed', controlId: 'settings', accessState: state }); router.replace('/settings'); }} style={styles.action} />
            {hasRetry ? <NovaButton label="Retry" nativeRef={retryRef} hasTVPreferredFocus={focusTarget === 'retry'} nextFocusLeft={focusTargets.settings ?? undefined} onFocus={() => logProviderRecoveryFocus({ surface: 'provider-access', action: 'preferred-focus-received', controlId: 'retry', accessState: state })} onPress={() => void retry()} style={styles.action} /> : null}
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
