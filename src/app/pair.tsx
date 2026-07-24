import { Redirect } from 'expo-router';

import { isClosedBetaManagedFlow, isPersonalPairingEnabled } from '@/features/device';
import { PairingScreen } from '@/features/pairing/PairingScreen';

/**
 * Personal pairing stays available for public launch.
 * During closed beta, deep links to /pair go to the invite activation flow instead.
 */
export default function PairRoute() {
  if (isClosedBetaManagedFlow() || !isPersonalPairingEnabled()) {
    return <Redirect href="/" />;
  }

  return <PairingScreen />;
}
