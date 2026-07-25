import { getAppLifecycleState } from '@/features/resilience/appLifecycle';
import { getOfflineSnapshot } from '@/features/resilience/offlineStatus';
import { getUnifiedPlayerState } from '@/features/playback/unified/unifiedPlayerStore';
import { getProviderState } from '@/features/providers/providerStore';
import { getSelectedProvider, isProviderConnectionReady } from '@/features/providers/providerModel';

import { getAnalyticsCurrentRoute, flushNovaAnalytics, setAnalyticsState } from './novaAnalytics';

export async function sendNovaAnalyticsHeartbeat() {
  const providerState = await getProviderState().catch(() => null);
  const provider = providerState ? getSelectedProvider(providerState) : null;
  const player = getUnifiedPlayerState();
  setAnalyticsState({
    currentActivity: player.item ? 'playback' : getAnalyticsCurrentRoute()?.includes('search') ? 'search' : 'browse',
    providerState: provider ? (isProviderConnectionReady(provider) ? 'ready' : 'disconnected') : 'none',
    playbackState: player.machineState,
    networkConnected: getOfflineSnapshot().status === 'online',
    currentRoute: getAnalyticsCurrentRoute() ?? undefined,
  });
  return flushNovaAnalytics({ includeState: true, lifecycle: getAppLifecycleState() });
}

