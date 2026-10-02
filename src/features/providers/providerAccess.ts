import type { ProviderHealthSnapshot, NovaPulseProviderHealthStatus } from './providerHealth.ts';
import { isProviderConnectionReady, type ProviderRecord } from './providerModel.ts';

export type ProviderAccessState =
  | 'loading'
  | 'allowed'
  | 'recovery_available'
  | 'no_provider'
  | 'authentication_required'
  | 'subscription_expired'
  | 'temporarily_unavailable';

export type ProviderAccessDecision = {
  state: ProviderAccessState;
  provider: ProviderRecord | null;
};

export type ProviderAccessInput = {
  ready: boolean;
  provider: ProviderRecord | null | undefined;
  providerHealth?: ProviderHealthSnapshot | null;
  providerInitialized: boolean;
  isSwitchingProvider?: boolean;
  providerSwitchError?: string | null;
  loadingTimedOut?: boolean;
  cachedProviderUsable?: boolean;
};

function isConfirmedHealthBlock(status: NovaPulseProviderHealthStatus | undefined) {
  return status === 'authentication_required' || status === 'subscription_expired';
}

export function resolveProviderAccess({
  ready,
  provider,
  providerHealth,
  providerInitialized,
  isSwitchingProvider = false,
  providerSwitchError = null,
  loadingTimedOut = false,
  cachedProviderUsable = false,
}: ProviderAccessInput): ProviderAccessDecision {
  if (!ready || isSwitchingProvider) {
    if (loadingTimedOut && !cachedProviderUsable) return { state: 'recovery_available', provider: provider ?? null };
    if (loadingTimedOut && cachedProviderUsable) return { state: 'allowed', provider: provider ?? null };
    return { state: 'loading', provider: provider ?? null };
  }
  if (!provider || !isProviderConnectionReady(provider)) return { state: 'no_provider', provider: null };
  if (provider.status === 'expired' || providerHealth?.status === 'subscription_expired') {
    return { state: 'subscription_expired', provider };
  }
  if (isConfirmedHealthBlock(providerHealth?.status)) return { state: 'authentication_required', provider };
  if (!providerInitialized) {
    if (loadingTimedOut && cachedProviderUsable) return { state: 'allowed', provider };
    if (loadingTimedOut) return { state: 'recovery_available', provider };
    return { state: 'loading', provider };
  }
  if (providerSwitchError) return { state: 'temporarily_unavailable', provider };

  // Temporary network loss, degraded/unavailable health, and unknown state do not hard-block access.
  return { state: 'allowed', provider };
}
