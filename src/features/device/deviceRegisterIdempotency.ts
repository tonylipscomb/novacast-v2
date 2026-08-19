import type { DeviceIdentity } from './deviceTypes.ts';

export function isValidInstallationId(value: string | null | undefined): value is string {
  return Boolean(value && /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(value));
}

export type StoredDeviceIdentityKeys = {
  deviceInstallationId: string | null;
  pairingInstallationId: string | null;
  legacyInstallationId: string | null;
  deviceSecret: string | null;
  deviceId: string | null;
  publicDeviceCode: string | null;
};

export type DeviceRegisterLookupRow = {
  id: string;
  publicDeviceCode: string;
  status: string;
  deviceSecretHash: string;
};

export type DeviceRegisterDecision =
  | { type: 'insert' }
  | { type: 'recover'; deviceId: string; publicDeviceCode: string; status: string }
  | { type: 'deny' };

export function assembleDeviceIdentity(keys: StoredDeviceIdentityKeys): DeviceIdentity | null {
  const installationId = [
    keys.deviceInstallationId,
    keys.pairingInstallationId,
    keys.legacyInstallationId,
  ]
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .find(isValidInstallationId);

  if (!installationId || !keys.deviceSecret) {
    return null;
  }

  return {
    installationId: installationId.toLowerCase(),
    deviceSecret: keys.deviceSecret,
    deviceId: keys.deviceId,
    publicDeviceCode: keys.publicDeviceCode,
  };
}

export function mergeDeviceIdentityWrite(
  incoming: DeviceIdentity,
  stored: { deviceId: string | null; publicDeviceCode: string | null },
): DeviceIdentity {
  return {
    installationId: incoming.installationId,
    deviceSecret: incoming.deviceSecret,
    deviceId: incoming.deviceId || stored.deviceId,
    publicDeviceCode: incoming.publicDeviceCode || stored.publicDeviceCode,
  };
}

export function shouldMintNewDeviceSecret(storedSecret: string | null | undefined) {
  return !storedSecret;
}

export function shouldSkipDeviceRegister(identity: Pick<DeviceIdentity, 'deviceId' | 'publicDeviceCode'>) {
  return Boolean(identity.deviceId && identity.publicDeviceCode);
}

export function evaluateExistingDeviceRegistration(input: {
  existing: DeviceRegisterLookupRow | null;
  providedSecretHash: string;
}): DeviceRegisterDecision {
  if (!input.existing) {
    return { type: 'insert' };
  }
  if (input.existing.deviceSecretHash !== input.providedSecretHash) {
    return { type: 'deny' };
  }
  return {
    type: 'recover',
    deviceId: input.existing.id,
    publicDeviceCode: input.existing.publicDeviceCode,
    status: input.existing.status,
  };
}

export function isDuplicateRegistrationConstraint(error: { message?: string; code?: string } | null | undefined) {
  const message = String(error?.message ?? '').toLowerCase();
  return error?.code === '23505' || message.includes('duplicate') || message.includes('unique');
}

export function interpretDeviceRegisterResponse(input: {
  ok: boolean;
  statusCode: number;
  payload: Record<string, unknown>;
  previousDeviceId: string | null;
  previousPublicDeviceCode: string | null;
}):
  | { ok: false; errorCode: string }
  | { ok: true; deviceId: string; publicDeviceCode: string; recovered: boolean } {
  const deviceId = typeof input.payload.deviceId === 'string' ? input.payload.deviceId.trim() : '';
  const publicDeviceCode =
    typeof input.payload.publicDeviceCode === 'string' ? input.payload.publicDeviceCode.trim() : '';
  const errorCode =
    typeof input.payload.errorCategory === 'string' && input.payload.errorCategory.trim()
      ? input.payload.errorCategory.trim()
      : 'device_registration_failed';

  const hasIds = Boolean(deviceId && publicDeviceCode);
  const recoveredConflict = input.statusCode === 409 && hasIds;
  if ((!input.ok && !recoveredConflict) || !hasIds) {
    return { ok: false, errorCode };
  }

  const localIncomplete = !input.previousDeviceId || !input.previousPublicDeviceCode;
  return {
    ok: true,
    deviceId,
    publicDeviceCode,
    recovered: localIncomplete || input.payload.recovered === true || recoveredConflict,
  };
}
