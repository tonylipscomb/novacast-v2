import { getSecureValue, pendingPairingKey, removeSecureValue, setSecureValue } from '../providers/providerCredentialStore.ts';
import { PAIRING_PENDING_SESSION_KEY } from './pairingStorage.ts';
import type { PairingConnectionPayload } from './pairingTypes.ts';

export type { PairingConnectionPayload } from './pairingTypes.ts';

/** Development credential injection is intentionally disabled; pairing must use the server flow. */
export function getDevPairingPayload(): PairingConnectionPayload | null {
  return null;
}

export async function savePendingPairingPayload(payload: PairingConnectionPayload) {
  await setSecureValue(pendingPairingKey(), JSON.stringify(payload));
}

export async function readPendingPairingPayload() {
  const stored = await getSecureValue(pendingPairingKey());
  if (!stored) {
    return null;
  }

  try {
    const parsed = JSON.parse(stored) as PairingConnectionPayload;
    if (parsed?.baseUrl && parsed?.username && parsed?.password) {
      return parsed;
    }
  } catch {
    // Remove malformed secure state below.
  }

  await removeSecureValue(pendingPairingKey());
  return null;
}

export async function consumePendingPairingPayload() {
  const payload = await readPendingPairingPayload();
  if (payload) {
    await removeSecureValue(pendingPairingKey());
  }
  return payload;
}

export async function clearPendingPairingPayload() {
  await removeSecureValue(pendingPairingKey());
}

export async function finalizePersistedPairingSession() {
  await clearPendingPairingPayload();
  await removeSecureValue(PAIRING_PENDING_SESSION_KEY);
}
