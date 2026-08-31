import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Redirect } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { NovaSpaceLoader } from '@/components/nova';
import { MainMenuScreen } from '@/features/hub/MainMenuScreen';
import {
  checkDeviceStatus,
  getDeviceState,
  hydrateCachedDeviceState,
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
import { enableCatalogInteractiveStartupProtection, markCatalogInteractiveUiReady } from '@/features/catalog/catalogInteractiveStartup';
import {
  STARTUP_NETWORK_TIMEOUT_MS,
  resolveManagedLibraryMissingState,
  withTimeout,
} from '@/features/startup/startupTimeouts';
import { recordSanitizedDiagnostic } from '@/features/resilience/sanitizedDiagnostics';
import { reportNetworkOutcome } from '@/features/resilience/offlineStatus';
import { novaTheme } from '@/theme';
import { BetaDiagnosticsDisclosure } from '@/features/diagnostics/BetaDiagnosticsDisclosure';
import { DIAGNOSTICS_DISCLOSURE_KEY, DIAGNOSTICS_DISCLOSURE_VERSION } from '@/features/diagnostics/diagnosticsConfig';
import { getSecureValue } from '@/features/providers/providerCredentialStore';
import { resetPairingKeepDevice } from '@/features/pairing/resetPairing';

/**
 * Central closed-beta / production startup coordinator.
 * Preserves personal pairing as a fallback when closed-beta managed flow is off.
 */
export function StartupGate() {
  useLayoutEffect(() => {
    enableCatalogInteractiveStartupProtection();
  }, []);
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
  const [diagnosticsDisclosure, setDiagnosticsDisclosure] = useState<boolean | null>(null);
  const initAttemptRef = useRef(0);
  const providerInitialized = Boolean(getActiveRepositoryBundle()) && !providerSwitchError;

  useEffect(() => {
    let cancelled = false;
    initAttemptRef.current += 1;
    console.info('[NovaCast Startup Gate]', JSON.stringify({
      event: 'activation-network-check-start',
      timestamp: Date.now(),
    }));
    void hydrateCachedDeviceState()
      .then(() => {
        if (!cancelled) {
          console.info('[NovaCast Startup Gate]', JSON.stringify({
            event: 'startup-state-loaded',
            timestamp: Date.now(),
            effectiveAuthorized: getDeviceState().authorization.effectiveAuthorized,
          }));
        }
        return withTimeout(initializeDevice(), STARTUP_NETWORK_TIMEOUT_MS, 'device_status_timeout');
      })
      .then((result) => {
        console.info('[NovaCast Startup Gate]', JSON.stringify({
          event: 'activation-network-check-complete',
          timestamp: Date.now(),
          effectiveAuthorized: result.authorization.effectiveAuthorized,
          state: result.state,
        }));
      })
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
    reportNetworkOutcome(false, 'provider');
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

  useEffect(() => {
    if (!device.authorization.effectiveAuthorized || device.status?.diagnosticsEnabled !== true) {
      setDiagnosticsDisclosure(true);
      return;
    }
    let cancelled = false;
    void getSecureValue(DIAGNOSTICS_DISCLOSURE_KEY).then((value) => {
      if (!cancelled) setDiagnosticsDisclosure(value === DIAGNOSTICS_DISCLOSURE_VERSION);
    }).catch(() => {
      if (!cancelled) setDiagnosticsDisclosure(false);
    });
    return () => { cancelled = true; };
  }, [device.authorization.effectiveAuthorized, device.status?.diagnosticsEnabled]);

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
      <StartupHomeShell
        label={bootstrapping ? 'Preparing your library…' : 'Starting NovaCast…'}
        showHome={device.authorization.effectiveAuthorized}
      />
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
      <StartupHomeShell label="Loading your provider…" showHome={device.authorization.effectiveAuthorized} />
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

  if (device.authorization.effectiveAuthorized && device.status?.diagnosticsEnabled === true && diagnosticsDisclosure !== true) {
    return diagnosticsDisclosure === null
      ? <View style={styles.loading}><NovaSpaceLoader label="Preparing NovaCast…" /></View>
      : <BetaDiagnosticsDisclosure
          onAcknowledged={() => setDiagnosticsDisclosure(true)}
          onExit={() => { void resetPairingKeepDevice(); }}
        />;
  }

  return <StartupHomeShell label="" showHome />;
}

function StartupHomeShell({ label, showHome }: { label: string; showHome: boolean }) {
  useLayoutEffect(() => {
    if (showHome) {
      markCatalogInteractiveUiReady();
    }
  }, [showHome]);
  if (showHome) {
    console.info('[NovaCast Startup Gate]', JSON.stringify({
      event: 'shell-render-eligible',
      timestamp: Date.now(),
      activeId: 'home',
    }));
  }

  return (
    <View style={styles.startupShell}>
      {showHome ? <MainMenuScreen /> : null}
      <View pointerEvents="none" focusable={false} style={[styles.startupStatus, showHome && styles.startupStatusHome]}>
        {label ? <NovaSpaceLoader label={label} /> : null}
      </View>
    </View>
  );
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
  startupShell: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  startupStatusHome: {
    backgroundColor: 'transparent',
  },
  startupStatus: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.24)',
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
