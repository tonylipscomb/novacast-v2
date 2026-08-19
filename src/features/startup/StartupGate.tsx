import { useCallback, useEffect, useRef, useState } from 'react';
import { Redirect } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { NovaSpaceLoader } from '@/components/nova';
import {
  checkDeviceStatus,
  getDeviceState,
  initializeDevice,
  isClosedBetaManagedFlow,
  isDeviceActivationRequired,
  isPersonalPairingEnabled,
  useDeviceState,
} from '@/features/device';
import { getActiveRepositoryBundle } from '@/features/providers/providerBundle';
import { isProviderConnectionReady } from '@/features/providers/providerModel';
import { useProviderStore } from '@/features/providers/providerStore';
import { BetaInviteActivationScreen } from '@/features/device/BetaInviteActivationScreen';
import { BetaExpiredScreen } from '@/features/device/BetaExpiredScreen';
import { ProviderInitErrorScreen } from '@/features/startup/ProviderInitErrorScreen';
import {
  resolveStartupProvider,
  type StartupProviderSource,
} from '@/features/startup/resolveStartupProvider';
import { markStartupReady } from '@/features/startup/startupReadiness';
import {
  STARTUP_NETWORK_TIMEOUT_MS,
  resolveManagedLibraryMissingState,
  withTimeout,
} from '@/features/startup/startupTimeouts';
import { recordSanitizedDiagnostic } from '@/features/resilience/sanitizedDiagnostics';
import { reportNetworkOutcome } from '@/features/resilience/offlineStatus';
import { novaTheme } from '@/theme';

/**
 * Central closed-beta / production startup coordinator.
 * Preserves personal pairing as a fallback when closed-beta managed flow is off.
 */
export function StartupGate() {
  const device = useDeviceState();
  const {
    ready,
    hasSavedProvider: storeHasProvider,
    selectedProvider,
    providerSwitchError,
    isSwitchingProvider,
  } = useProviderStore();

  const [bootstrapping, setBootstrapping] = useState(false);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [startupTimedOut, setStartupTimedOut] = useState(false);
  const [libraryMissing, setLibraryMissing] = useState(false);
  const initAttemptRef = useRef(0);
  const providerInitialized = Boolean(getActiveRepositoryBundle()) && !providerSwitchError;

  useEffect(() => {
    let cancelled = false;
    initAttemptRef.current += 1;
    void withTimeout(initializeDevice(), STARTUP_NETWORK_TIMEOUT_MS, 'device_status_timeout')
      .then(() => {
        if (!cancelled) {
          reportNetworkOutcome(true);
          setStartupTimedOut(false);
        }
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        reportNetworkOutcome(false);
        recordSanitizedDiagnostic({
          operation: 'startup_device_init',
          screen: 'StartupGate',
          errorType: error instanceof Error ? error.message : 'device_init_failed',
          outcome: 'timeout_or_error',
        });
        // Allow UI to escape indefinite "Starting…" when the network never returns.
        if (getDeviceState().state === 'idle' || getDeviceState().state === 'checking' || getDeviceState().state === 'registering') {
          setStartupTimedOut(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (ready && !isSwitchingProvider && !bootstrapping) {
      markStartupReady();
    }
  }, [bootstrapping, isSwitchingProvider, ready]);

  const applyProviderResolution = useCallback((
    result: Awaited<ReturnType<typeof resolveStartupProvider>>,
  ) => {
    setBootstrapping(false);
    if (result.ok) {
      setLibraryMissing(false);
      setBootstrapError(null);
      reportNetworkOutcome(true);
      return;
    }
    if (result.errorCode === 'not_authorized') {
      setLibraryMissing(false);
      setBootstrapError(null);
      return;
    }
    setLibraryMissing(result.libraryMissing);
    setBootstrapError(result.libraryMissing ? null : result.errorCode);
    reportNetworkOutcome(false);
    recordSanitizedDiagnostic({
      operation: result.libraryMissing ? 'startup_managed_library' : 'startup_managed_download',
      screen: 'StartupGate',
      errorType: result.errorCode ?? 'managed_provider_unavailable',
      outcome: 'actionable_error',
    });
  }, []);

  const resolveProvider = useCallback(async (source: StartupProviderSource) => {
    await Promise.resolve();
    setBootstrapping(true);
    setBootstrapError(null);
    if (source === 'retry') {
      setLibraryMissing(false);
    }
    const result = await resolveStartupProvider({ source });
    applyProviderResolution(result);
    return result;
  }, [applyProviderResolution]);

  const ensureManagedProvider = useCallback(async () => {
    await resolveProvider('startup');
  }, [resolveProvider]);

  const retryStartupProvider = useCallback(async () => {
    await resolveProvider('retry');
  }, [resolveProvider]);

  useEffect(() => {
    if (!device.authorization.effectiveAuthorized) {
      return;
    }
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled) {
        void ensureManagedProvider();
      }
    });
    return () => {
      cancelled = true;
    };
  }, [
    device.authorization.effectiveAuthorized,
    device.status?.providerAssigned,
    device.status?.requiresProviderDownload,
    device.status?.managedProviderId,
    ensureManagedProvider,
  ]);

  if (startupTimedOut && (device.state === 'idle' || device.state === 'checking' || device.state === 'registering')) {
    return (
      <StartupActionScreen
        title="NovaCast could not finish starting"
        message="The activation service took too long to respond. Check your internet connection and try again."
        primaryLabel="Retry"
        onPrimary={() => {
          setStartupTimedOut(false);
          void withTimeout(initializeDevice(), STARTUP_NETWORK_TIMEOUT_MS, 'device_status_timeout').catch(() => {
            setStartupTimedOut(true);
          });
        }}
      />
    );
  }

  if (device.state === 'idle' || device.state === 'registering' || device.state === 'checking' || bootstrapping) {
    return (
      <View style={styles.loading}>
        <NovaSpaceLoader label={bootstrapping ? 'Preparing your library…' : 'Starting NovaCast…'} />
      </View>
    );
  }

  if (device.state === 'revoked') {
    return <BetaInviteActivationScreen onActivated={() => void ensureManagedProvider()} />;
  }

  if (isDeviceActivationRequired()) {
    const activation = device.status?.activationStatus;
    if (activation === 'expired') {
      return (
        <BetaExpiredScreen
          expiresAt={device.status?.activationExpiresAt ?? null}
          onRefresh={() => void checkDeviceStatus()}
        />
      );
    }
    if (!activation || activation === 'inactive' || activation === 'revoked' || activation === 'suspended') {
      return <BetaInviteActivationScreen onActivated={() => void ensureManagedProvider()} />;
    }
  }

  if (bootstrapError || libraryMissing) {
    return (
      <ProviderInitErrorScreen
        title={libraryMissing ? 'Library not assigned' : undefined}
        message={
          libraryMissing
            ? 'This device is activated, but no NovaCast library is assigned yet. Ask your beta admin to assign a provider, then retry.'
            : 'NovaCast could not connect to your saved provider. Retry or pair another provider.'
        }
        retrying={bootstrapping}
        onRetry={retryStartupProvider}
      />
    );
  }

  if (!ready || isSwitchingProvider) {
    return (
      <View style={styles.loading}>
        <NovaSpaceLoader label="Loading your provider…" />
      </View>
    );
  }

  if (!storeHasProvider || !selectedProvider || !isProviderConnectionReady(selectedProvider)) {
    const missing = resolveManagedLibraryMissingState({
      closedBeta: isClosedBetaManagedFlow(),
      providerAssigned: Boolean(device.status?.providerAssigned),
      requiresProviderDownload: Boolean(device.status?.requiresProviderDownload),
      hasProvider: false,
    });
    if (missing === 'actionable_error' || missing === 'wait') {
      if (missing === 'actionable_error') {
        return (
          <ProviderInitErrorScreen
            title="Library not assigned"
            message="This device is activated, but no NovaCast library is assigned yet. Ask your beta admin to assign a provider, then retry."
            retrying={bootstrapping}
            onRetry={retryStartupProvider}
          />
        );
      }
      return (
        <View style={styles.loading}>
          <NovaSpaceLoader label="Downloading your NovaCast library…" />
        </View>
      );
    }
    if (isPersonalPairingEnabled()) {
      return <Redirect href="/pair" />;
    }
    if (device.authorization.localBypassAuthorized) {
      return (
        <ProviderInitErrorScreen
          message="Local emulator activation bypass is enabled, but no provider is configured."
          retrying={bootstrapping}
          onRetry={retryStartupProvider}
        />
      );
    }
    return <BetaInviteActivationScreen onActivated={() => void ensureManagedProvider()} />;
  }

  if (providerSwitchError || !providerInitialized) {
    return <ProviderInitErrorScreen retrying={bootstrapping} onRetry={retryStartupProvider} />;
  }

  return <Redirect href="/main-menu" />;
}

function StartupActionScreen({
  title,
  message,
  primaryLabel,
  onPrimary,
}: {
  title: string;
  message: string;
  primaryLabel: string;
  onPrimary: () => void;
}) {
  return (
    <View style={styles.loading}>
      <Text style={styles.errorTitle}>{title}</Text>
      <Text style={styles.errorCopy}>{message}</Text>
      <Pressable
        focusable
        hasTVPreferredFocus
        onPress={onPrimary}
        style={[styles.retryButton, styles.retryButtonFocused]}>
        <Text style={styles.retryLabel}>{primaryLabel}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: novaTheme.colors.background,
    paddingHorizontal: 40,
    gap: 14,
  },
  errorTitle: {
    color: novaTheme.colors.textPrimary,
    fontSize: 24,
    fontWeight: '800',
    textAlign: 'center',
  },
  errorCopy: {
    color: novaTheme.colors.textSecondary,
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
    maxWidth: 560,
    lineHeight: 22,
  },
  retryButton: {
    marginTop: 8,
    minWidth: 160,
    minHeight: 48,
    paddingHorizontal: 18,
    borderWidth: 2,
    borderColor: 'transparent',
    backgroundColor: novaTheme.colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryButtonFocused: {
    borderColor: 'rgba(131, 180, 255, 0.72)',
    backgroundColor: 'rgba(18, 36, 72, 0.42)',
  },
  retryLabel: {
    color: novaTheme.colors.textPrimary,
    fontSize: 15,
    fontWeight: '800',
  },
});
