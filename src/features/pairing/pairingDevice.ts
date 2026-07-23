import * as Crypto from 'expo-crypto';

import { getSecureValue, removeSecureValue, setSecureValue } from '../providers/providerCredentialStore.ts';
import { pairingDiagnostic, pairingInstallationFingerprint } from './pairingDiagnostics.ts';
import { PAIRING_INSTALLATION_ID_KEY, PAIRING_PENDING_SESSION_KEY } from './pairingStorage.ts';
import type { PendingPairingSession } from './pairingTypes.ts';
import { getDeviceIdentity } from '@/features/device/deviceRegistration';

export type { PendingPairingSession } from './pairingTypes.ts';

let cachedInstallationId: string | null = null;
let installationIdPromise: Promise<string> | null = null;

function isValidInstallationId(value: string | null): value is string {
  return Boolean(value && /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(value));
}

function createInstallationId() {
  return Crypto.randomUUID();
}

function isValidSession(value: unknown): value is PendingPairingSession {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const session = value as PendingPairingSession;
  return (
    typeof session.id === 'string' &&
    typeof session.code === 'string' &&
    typeof session.pairUrl === 'string' &&
    Number.isFinite(session.expiresAt) &&
    (session.redemptionToken === undefined || typeof session.redemptionToken === 'string') &&
    (session.providerName === undefined || typeof session.providerName === 'string') &&
    (session.redeemedPayload === undefined ||
      (typeof session.redeemedPayload === 'object' &&
        typeof session.redeemedPayload.baseUrl === 'string' &&
        typeof session.redeemedPayload.username === 'string' &&
        typeof session.redeemedPayload.password === 'string'))
  );
}

export async function getPairingInstallationId() {
  // Device identity owns the installation UUID. Prefer it, but if an older
  // pairing-only ID exists and device identity was minted separately, keep
  // using the device identity for new traffic (already persisted).
  const deviceIdentity = await getDeviceIdentity();
  if (deviceIdentity.installationId) {
    cachedInstallationId = deviceIdentity.installationId;
    // Mirror into the pairing key so both subsystems stay aligned.
    const storedPairingId = await getSecureValue(PAIRING_INSTALLATION_ID_KEY);
    if (storedPairingId !== deviceIdentity.installationId) {
      await setSecureValue(PAIRING_INSTALLATION_ID_KEY, deviceIdentity.installationId);
    }
    return deviceIdentity.installationId;
  }

  if (cachedInstallationId && isValidInstallationId(cachedInstallationId)) {
    return cachedInstallationId;
  }

  if (installationIdPromise) {
    return installationIdPromise;
  }

  installationIdPromise = (async () => {
    const stored = await getSecureValue(PAIRING_INSTALLATION_ID_KEY);
    if (isValidInstallationId(stored)) {
      cachedInstallationId = stored;
      pairingDiagnostic('installation-id-restored', {
        installation: pairingInstallationFingerprint(stored),
      });
      return stored;
    }

    const installationId = createInstallationId();
    await setSecureValue(PAIRING_INSTALLATION_ID_KEY, installationId);
    cachedInstallationId = installationId;
    pairingDiagnostic('installation-id-created', {
      installation: pairingInstallationFingerprint(installationId),
    });
    return installationId;
  })();

  try {
    return await installationIdPromise;
  } finally {
    installationIdPromise = null;
  }
}

export async function getPendingPairingSession() {
  const stored = await getSecureValue(PAIRING_PENDING_SESSION_KEY);
  if (!stored) {
    return null;
  }

  try {
    const session = JSON.parse(stored) as PendingPairingSession;
    if (isValidSession(session)) {
      return session;
    }
  } catch {
    // Remove malformed local state below.
  }

  await clearPendingPairingSession();
  return null;
}

export async function savePendingPairingSession(session: PendingPairingSession) {
  await setSecureValue(PAIRING_PENDING_SESSION_KEY, JSON.stringify(session));
  pairingDiagnostic('pending-session-saved', {
    session: session.id.slice(0, 8),
    hasToken: Boolean(session.redemptionToken),
    hasPayload: Boolean(session.redeemedPayload),
  });
}

export async function clearPendingPairingSession() {
  await removeSecureValue(PAIRING_PENDING_SESSION_KEY);
  pairingDiagnostic('pending-session-cleared');
}

export function resetPairingDeviceForTests() {
  cachedInstallationId = null;
  installationIdPromise = null;
}
