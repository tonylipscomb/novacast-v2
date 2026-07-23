import { clearPendingPairingSession, resetPairingDeviceForTests } from '@/features/pairing/pairingDevice';
import { resetPairingCompleted } from '@/features/pairing/pairingState';
import { getPairingService } from '@/features/pairing/pairingService';
import { clearProvidersForPairing } from '@/features/providers/providerStore';
import { clearDeviceIdentity } from '@/features/device/deviceStorage';

/**
 * Reset pairing keeps the permanent device identity and secret.
 * It removes local provider assignment, invalidates pending sessions,
 * and leaves the TV ready to request a fresh temporary pairing code.
 */
export async function resetPairingKeepDevice() {
  const service = getPairingService();
  const pending = service ? await service.restoreSession() : null;
  if (pending && service) {
    try {
      await service.cancelSession(pending.id);
    } catch {
      // Local cleanup still proceeds when the server session is already gone.
    }
  } else {
    await clearPendingPairingSession();
  }

  await clearProvidersForPairing();
  resetPairingCompleted();
}

/**
 * Factory reset removes local device identity, secret, providers, and pairing state.
 * The next launch registers as a new installation.
 */
export async function factoryResetNovacast() {
  const service = getPairingService();
  const pending = service ? await service.restoreSession() : null;
  if (pending && service) {
    try {
      await service.cancelSession(pending.id);
    } catch {
      // Continue wiping local state.
    }
  }

  await clearProvidersForPairing();
  await clearPendingPairingSession();
  await clearDeviceIdentity();
  resetPairingCompleted();
  resetPairingDeviceForTests();
}
