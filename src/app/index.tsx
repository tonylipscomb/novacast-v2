import { deviceFeatureFlags, isClosedBetaManagedFlow } from '@/features/device';
import { StartupGate } from '@/features/startup/StartupGate';
import { NovaPortalScreen } from '@/features/portal/NovaPortalScreen';

/**
 * Closed beta uses StartupGate as the coordinator (invite → provider → Home).
 * Production/self-service keeps the Hub entry and personal pairing path.
 */
export default function IndexRoute() {
  if (isClosedBetaManagedFlow() || deviceFeatureFlags.closedBetaMode) {
    return <StartupGate />;
  }

  return <NovaPortalScreen />;
}
