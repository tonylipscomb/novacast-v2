import { useEffect, useRef, useState, type ReactNode } from 'react';
import { View } from 'react-native';

import { NovaSpaceLoader } from '@/components/nova';
import { deviceFeatureFlags, isClosedBetaManagedFlow } from '@/features/device';
import { useNovaPulseProviderHealth } from './providerHealth';
import { ProviderAccessRecoveryScreen } from './ProviderAccessRecoveryScreen';
import { resolveProviderAccess } from './providerAccess';
import { useProviderStore } from './providerStore';
import { logProviderStartupPhase } from './providerStartupDiagnostics';
import { getAssignmentRetryBackoffState } from '@/features/device/deviceAssignmentReconcile';
import { logProviderAccessDecision } from './providerRecoveryDiagnostics';

const PROVIDER_ACCESS_LOADING_DEADLINE_MS = 12_000;

export function ProviderAccessGate({ children }: { children: ReactNode }) {
  const providerState = useProviderStore();
  const providerId = providerState.selectedProvider?.id ?? '';
  const health = useNovaPulseProviderHealth(providerId, providerState.bundleGeneration);
  const [loadingTimedOut, setLoadingTimedOut] = useState(false);
  const loadingStartedAtRef = useRef<number | null>(null);
  const cachedProviderUsable = providerState.isRealProviderActive;
  const providerPresent = Boolean(providerState.selectedProvider);
  const retryBackoffActive = getAssignmentRetryBackoffState().active;

  useEffect(() => {
    const loading = !providerState.ready || providerState.isSwitchingProvider || !providerState.providerInitialized;
    if (!loading) {
      loadingStartedAtRef.current = null;
      const resetTimer = setTimeout(() => setLoadingTimedOut(false), 0);
      logProviderStartupPhase('shell-allowed', {
        providerPresent,
        cachedProviderUsable,
        managedRefreshInFlight: providerState.isSwitchingProvider,
        retryBackoffActive,
      });
      return () => clearTimeout(resetTimer);
    }
    if (loadingStartedAtRef.current === null) {
      loadingStartedAtRef.current = Date.now();
      logProviderStartupPhase('provider-init-start', {
        providerPresent,
        cachedProviderUsable,
        providerInitInFlight: true,
        managedRefreshInFlight: providerState.isSwitchingProvider,
        retryBackoffActive,
      });
    }
    const remaining = Math.max(0, PROVIDER_ACCESS_LOADING_DEADLINE_MS - (Date.now() - loadingStartedAtRef.current));
    const timer = setTimeout(() => {
      setLoadingTimedOut(true);
      logProviderStartupPhase('recovery-visible', {
        providerPresent,
        cachedProviderUsable,
        providerInitInFlight: true,
        deadlineExceeded: true,
        managedRefreshInFlight: providerState.isSwitchingProvider,
        retryBackoffActive,
      });
    }, remaining);
    return () => clearTimeout(timer);
  }, [cachedProviderUsable, providerId, providerPresent, retryBackoffActive, providerState.isSwitchingProvider, providerState.providerInitialized, providerState.ready]);

  const decision = resolveProviderAccess({
    ready: providerState.ready,
    provider: providerState.selectedProvider,
    providerHealth: health,
    providerInitialized: providerState.providerInitialized,
    isSwitchingProvider: providerState.isSwitchingProvider,
    providerSwitchError: providerState.providerSwitchError,
    loadingTimedOut,
    cachedProviderUsable,
  });

  useEffect(() => {
    if (isClosedBetaManagedFlow() || deviceFeatureFlags.closedBetaMode || decision.state === 'loading' || decision.state === 'allowed' || decision.state === 'temporarily_unavailable') return;
    logProviderAccessDecision({
      accessState: decision.state,
      providerStatus: providerState.selectedProvider?.status,
      healthStatus: health?.status,
      providerInitialized: providerState.providerInitialized,
      retryInFlight: providerState.isSwitchingProvider,
      metadataFreshnessCategory: providerState.selectedProvider?.status === 'expired'
        ? 'persisted-expired'
        : health?.status === 'subscription_expired'
          ? 'persisted-health-expired'
          : 'unknown',
      validationResultCategory: providerState.providerInitialized ? 'initialized' : 'not-validated',
    });
  }, [decision.state, health?.status, providerState.isSwitchingProvider, providerState.providerInitialized, providerState.selectedProvider?.status]);

  if (isClosedBetaManagedFlow() || deviceFeatureFlags.closedBetaMode) return <>{children}</>;

  if (decision.state === 'loading') return <View style={{ flex: 1 }}><NovaSpaceLoader label="Preparing NovaCast…" /></View>;
  if (decision.state === 'allowed' || decision.state === 'temporarily_unavailable') return <>{children}</>;
  return <ProviderAccessRecoveryScreen state={decision.state} />;
}
