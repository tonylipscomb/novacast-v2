import type { ReactNode } from 'react';
import { View } from 'react-native';

import { NovaSpaceLoader } from '@/components/nova';
import { deviceFeatureFlags, isClosedBetaManagedFlow } from '@/features/device';
import { useNovaPulseProviderHealth } from './providerHealth';
import { ProviderAccessRecoveryScreen } from './ProviderAccessRecoveryScreen';
import { resolveProviderAccess } from './providerAccess';
import { useProviderStore } from './providerStore';

export function ProviderAccessGate({ children }: { children: ReactNode }) {
  const providerState = useProviderStore();
  const providerId = providerState.selectedProvider?.id ?? '';
  const health = useNovaPulseProviderHealth(providerId, providerState.bundleGeneration);

  if (isClosedBetaManagedFlow() || deviceFeatureFlags.closedBetaMode) return <>{children}</>;

  const decision = resolveProviderAccess({
    ready: providerState.ready,
    provider: providerState.selectedProvider,
    providerHealth: health,
    providerInitialized: providerState.providerInitialized,
    isSwitchingProvider: providerState.isSwitchingProvider,
    providerSwitchError: providerState.providerSwitchError,
  });

  if (decision.state === 'loading') return <View style={{ flex: 1 }}><NovaSpaceLoader label="Preparing NovaCast…" /></View>;
  if (decision.state === 'allowed' || decision.state === 'temporarily_unavailable') return <>{children}</>;
  return <ProviderAccessRecoveryScreen state={decision.state} />;
}
