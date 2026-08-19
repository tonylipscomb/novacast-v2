import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { NovaLogo, NovaScreen } from '@/components/nova';
import { novaTvFocus } from '@/components/nova/novaTvFocus';
import { isClosedBetaManagedFlow, isPersonalPairingEnabled } from '@/features/device';
import { useAppNotification } from '@/features/notifications/useAppNotification';
import { clearProvidersForPairing, useProviderStore } from '@/features/providers/providerStore';
import { resolveStartupProvider } from '@/features/startup/resolveStartupProvider';
import { novaTheme } from '@/theme';

import {
  AUTH_INIT_NOTIFICATION_ID,
  AUTH_NOTIFICATION_DURATION_MS,
  resolveAuthInitNotification,
} from './authScreenLogic';

type ProviderInitErrorScreenProps = {
  title?: string;
  message?: string;
  retrying?: boolean;
  onRetry?: () => Promise<unknown>;
};

export function ProviderInitErrorScreen({
  title,
  message,
  retrying = false,
  onRetry,
}: ProviderInitErrorScreenProps = {}) {
  const router = useRouter();
  const authRetryAttemptedRef = useRef(false);
  const lastRetryAtRef = useRef(0);
  const retryInFlightRef = useRef(false);
  const { isSwitchingProvider } = useProviderStore();
  const { showNotification, dismissNotification, clearScope } = useAppNotification();
  const [focusedAction, setFocusedAction] = useState<'retry' | 'pair'>('retry');
  const [initFailed, setInitFailed] = useState(true);
  const [localRetrying, setLocalRetrying] = useState(false);
  const allowPairAnother = isPersonalPairingEnabled() && !isClosedBetaManagedFlow();
  const retryBusy = retrying || localRetrying || isSwitchingProvider;

  const retry = useCallback(async () => {
    const now = Date.now();
    if (retryInFlightRef.current || retrying || now - lastRetryAtRef.current < 400) {
      return;
    }

    lastRetryAtRef.current = now;
    retryInFlightRef.current = true;
    authRetryAttemptedRef.current = true;
    setLocalRetrying(true);

    try {
      if (onRetry) {
        await onRetry();
        setInitFailed(true);
        return;
      }
      const result = await resolveStartupProvider({ source: 'retry' });
      if (!result.ok) {
        setInitFailed(true);
        return;
      }
      setInitFailed(false);
      authRetryAttemptedRef.current = false;
      router.replace('/main-menu');
    } catch {
      setInitFailed(true);
    } finally {
      retryInFlightRef.current = false;
      setLocalRetrying(false);
    }
  }, [onRetry, retrying, router]);

  const pairAnother = useCallback(async () => {
    setInitFailed(false);
    authRetryAttemptedRef.current = false;
    dismissNotification(AUTH_INIT_NOTIFICATION_ID);
    await clearProvidersForPairing();
    router.replace('/pair');
  }, [dismissNotification, router]);

  useEffect(() => {
    const spec = resolveAuthInitNotification(initFailed && !isSwitchingProvider, authRetryAttemptedRef.current);
    if (!spec) {
      dismissNotification(AUTH_INIT_NOTIFICATION_ID);
      return;
    }

    showNotification({
      id: AUTH_INIT_NOTIFICATION_ID,
      type: 'error',
      title: spec.title,
      message: spec.message,
      duration: AUTH_NOTIFICATION_DURATION_MS,
      persistent: spec.persistent,
      position: 'bottom-right',
      scope: 'auth',
    });
  }, [dismissNotification, initFailed, isSwitchingProvider, showNotification]);

  useEffect(() => {
    if (!initFailed) {
      authRetryAttemptedRef.current = false;
    }
  }, [initFailed]);

  useEffect(() => {
    return () => {
      clearScope('auth');
    };
  }, [clearScope]);

  return (
    <NovaScreen>
      <View style={styles.container}>
        <NovaLogo variant="mark" size="xl" />
        <Text style={styles.title}>{title ?? 'Welcome back'}</Text>
        <Text style={styles.copy}>
          {message ?? 'Choose an option below to connect NovaCast to your provider.'}
        </Text>

        {retryBusy ? (
          <>
            <ActivityIndicator color={novaTheme.colors.accentHover} size="large" />
            <Text style={styles.status}>Connecting to your provider...</Text>
          </>
        ) : (
          <View style={styles.actions}>
            <Pressable
              focusable
              hasTVPreferredFocus={focusedAction === 'retry'}
              onFocus={() => setFocusedAction('retry')}
              onPress={() => void retry()}
              disabled={retryBusy}
              style={[styles.button, styles.primaryButton, novaTvFocus.base, focusedAction === 'retry' && novaTvFocus.active]}>
              <Text style={styles.primaryText}>Retry</Text>
            </Pressable>
            {allowPairAnother ? (
              <Pressable
                focusable
                onFocus={() => setFocusedAction('pair')}
                onPress={() => void pairAnother()}
                style={[styles.button, styles.secondaryButton, novaTvFocus.base, focusedAction === 'pair' && novaTvFocus.active]}>
                <Text style={styles.secondaryText}>Pair Another Provider</Text>
              </Pressable>
            ) : null}
          </View>
        )}
      </View>
    </NovaScreen>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    paddingHorizontal: 48,
  },
  title: {
    color: novaTheme.colors.textPrimary,
    fontSize: 34,
    fontWeight: '900',
    textAlign: 'center',
  },
  copy: {
    maxWidth: 720,
    color: novaTheme.colors.textSecondary,
    fontSize: 16,
    lineHeight: 24,
    textAlign: 'center',
  },
  status: {
    color: novaTheme.colors.textSecondary,
    fontSize: 14,
    fontWeight: '700',
  },
  actions: {
    marginTop: 12,
    flexDirection: 'row',
    gap: 12,
  },
  button: {
    minHeight: 52,
    borderRadius: 0,
    paddingHorizontal: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButton: {
    backgroundColor: novaTheme.colors.accent,
  },
  secondaryButton: {
    backgroundColor: novaTheme.colors.surface,
    borderColor: novaTheme.colors.borderSubtle,
  },
  primaryText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
  },
  secondaryText: {
    color: novaTheme.colors.textPrimary,
    fontSize: 16,
    fontWeight: '800',
  },
});
