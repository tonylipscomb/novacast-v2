import { getSecureValue, removeSecureValue, setSecureValue } from '@/features/providers/providerCredentialStore';
import { PAIRING_INSTALLATION_ID_KEY } from '@/features/pairing/pairingStorage';
import type { DeviceIdentity } from './deviceTypes';
import { assembleDeviceIdentity, mergeDeviceIdentityWrite } from './deviceRegisterIdempotency';

export const DEVICE_INSTALLATION_ID_KEY = 'novacast.device.installation-id';
export const DEVICE_SECRET_KEY = 'novacast.device.secret';
export const DEVICE_ID_KEY = 'novacast.device.backend-id';
export const PUBLIC_DEVICE_CODE_KEY = 'novacast.device.public-code';
export const LEGACY_INSTALLATION_ID_KEY = 'novacast.installation.id';
const DEVICE_STATUS_CACHE_KEY = 'novacast.device.status-cache';

export async function readStoredDeviceIdentityKeys() {
  const [
    deviceInstallationId,
    pairingInstallationId,
    legacyInstallationId,
    deviceSecret,
    deviceId,
    publicDeviceCode,
  ] = await Promise.all([
    getSecureValue(DEVICE_INSTALLATION_ID_KEY),
    getSecureValue(PAIRING_INSTALLATION_ID_KEY),
    getSecureValue(LEGACY_INSTALLATION_ID_KEY),
    getSecureValue(DEVICE_SECRET_KEY),
    getSecureValue(DEVICE_ID_KEY),
    getSecureValue(PUBLIC_DEVICE_CODE_KEY),
  ]);
  return {
    deviceInstallationId,
    pairingInstallationId,
    legacyInstallationId,
    deviceSecret,
    deviceId,
    publicDeviceCode,
  };
}

export async function readDeviceIdentity(): Promise<DeviceIdentity | null> {
  return assembleDeviceIdentity(await readStoredDeviceIdentityKeys());
}

export async function writeDeviceIdentity(identity: DeviceIdentity) {
  const [currentId, currentCode] = await Promise.all([
    getSecureValue(DEVICE_ID_KEY),
    getSecureValue(PUBLIC_DEVICE_CODE_KEY),
  ]);
  const merged = mergeDeviceIdentityWrite(identity, {
    deviceId: currentId,
    publicDeviceCode: currentCode,
  });
  await Promise.all([
    setSecureValue(DEVICE_INSTALLATION_ID_KEY, merged.installationId),
    setSecureValue(DEVICE_SECRET_KEY, merged.deviceSecret),
    merged.deviceId ? setSecureValue(DEVICE_ID_KEY, merged.deviceId) : Promise.resolve(),
    merged.publicDeviceCode ? setSecureValue(PUBLIC_DEVICE_CODE_KEY, merged.publicDeviceCode) : Promise.resolve(),
  ]);
}

export async function readCachedDeviceStatus() {
  const value = await getSecureValue(DEVICE_STATUS_CACHE_KEY);
  if (!value) return null;
  try { return JSON.parse(value); } catch { return null; }
}

export function writeCachedDeviceStatus(value: unknown) {
  return setSecureValue(DEVICE_STATUS_CACHE_KEY, JSON.stringify(value));
}

export function clearCachedDeviceStatus() {
  return removeSecureValue(DEVICE_STATUS_CACHE_KEY);
}

export async function clearDeviceIdentity() {
  return Promise.all([
    removeSecureValue(DEVICE_INSTALLATION_ID_KEY),
    removeSecureValue(DEVICE_SECRET_KEY),
    removeSecureValue(DEVICE_ID_KEY),
    removeSecureValue(PUBLIC_DEVICE_CODE_KEY),
    removeSecureValue(DEVICE_STATUS_CACHE_KEY),
  ]);
}

export function clearDeviceStorageForTests() {
  return clearDeviceIdentity();
}
