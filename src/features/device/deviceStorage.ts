import { getSecureValue, removeSecureValue, setSecureValue } from '@/features/providers/providerCredentialStore';
import type { DeviceIdentity } from './deviceTypes';

const INSTALLATION_ID_KEY = 'novacast.device.installation-id';
const DEVICE_SECRET_KEY = 'novacast.device.secret';
const DEVICE_ID_KEY = 'novacast.device.backend-id';
const PUBLIC_DEVICE_CODE_KEY = 'novacast.device.public-code';
const DEVICE_STATUS_CACHE_KEY = 'novacast.device.status-cache';

export async function readDeviceIdentity(): Promise<DeviceIdentity | null> {
  const installationId = await getSecureValue(INSTALLATION_ID_KEY);
  const deviceSecret = await getSecureValue(DEVICE_SECRET_KEY);
  if (!installationId || !deviceSecret) return null;
  return {
    installationId,
    deviceSecret,
    deviceId: await getSecureValue(DEVICE_ID_KEY),
    publicDeviceCode: await getSecureValue(PUBLIC_DEVICE_CODE_KEY),
  };
}

export async function writeDeviceIdentity(identity: DeviceIdentity) {
  await Promise.all([
    setSecureValue(INSTALLATION_ID_KEY, identity.installationId),
    setSecureValue(DEVICE_SECRET_KEY, identity.deviceSecret),
    identity.deviceId ? setSecureValue(DEVICE_ID_KEY, identity.deviceId) : removeSecureValue(DEVICE_ID_KEY),
    identity.publicDeviceCode ? setSecureValue(PUBLIC_DEVICE_CODE_KEY, identity.publicDeviceCode) : removeSecureValue(PUBLIC_DEVICE_CODE_KEY),
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

export function clearDeviceStorageForTests() {
  return Promise.all([
    removeSecureValue(INSTALLATION_ID_KEY),
    removeSecureValue(DEVICE_SECRET_KEY),
    removeSecureValue(DEVICE_ID_KEY),
    removeSecureValue(PUBLIC_DEVICE_CODE_KEY),
    removeSecureValue(DEVICE_STATUS_CACHE_KEY),
  ]);
}
