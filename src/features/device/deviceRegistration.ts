import * as Crypto from 'expo-crypto';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { getSecureValue } from '@/features/providers/providerCredentialStore';
import { readDeviceIdentity, writeDeviceIdentity } from './deviceStorage';
import type { DeviceIdentity } from './deviceTypes';

const DEVICE_SECRET_KEY = 'novacast.device.secret';
const LEGACY_INSTALLATION_ID_KEY = 'novacast.installation.id';

function apiConfig() {
  const apiUrl = process.env.EXPO_PUBLIC_NOVACAST_PAIRING_API_URL?.trim().replace(/\/+$/, '');
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim();
  return apiUrl && anonKey ? { apiUrl, anonKey } : null;
}

function randomSecret() {
  return Crypto.getRandomBytesAsync(32).then((bytes) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(''));
}

async function getOrCreateIdentity() {
  const existing = await readDeviceIdentity();
  if (existing) return existing;
  const legacyInstallationId = await getSecureValue(LEGACY_INSTALLATION_ID_KEY);
  const installationId = legacyInstallationId && /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(legacyInstallationId)
    ? legacyInstallationId.toLowerCase()
    : Crypto.randomUUID();
  const deviceSecret = await randomSecret();
  const identity: DeviceIdentity = { installationId, deviceSecret, deviceId: null, publicDeviceCode: null };
  await writeDeviceIdentity(identity);
  return identity;
}

export async function getDeviceIdentity() {
  return getOrCreateIdentity();
}

export function deviceMetadata() {
  return {
    platform: Device.osName ?? 'unknown',
    manufacturer: Device.manufacturer ?? null,
    model: Device.modelName ?? null,
    deviceType: Device.deviceType ? String(Device.deviceType) : null,
    osVersion: Device.osVersion ?? null,
    appVersion: Constants.expoConfig?.version ?? 'unknown',
    appBuild: Constants.expoConfig?.android?.versionCode?.toString() ?? Constants.expoConfig?.ios?.buildNumber ?? null,
  };
}

export async function registerDevice() {
  const identity = await getOrCreateIdentity();
  if (identity.deviceId && identity.publicDeviceCode) return identity;
  const config = apiConfig();
  if (!config) return identity;
  const response = await fetch(`${config.apiUrl}/device-register`, {
    method: 'POST',
    headers: { apikey: config.anonKey, Authorization: `Bearer ${config.anonKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ installationId: identity.installationId, deviceSecret: identity.deviceSecret, metadata: deviceMetadata() }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || typeof payload.deviceId !== 'string' || typeof payload.publicDeviceCode !== 'string') {
    throw new Error(typeof payload.errorCategory === 'string' ? payload.errorCategory : 'device_registration_failed');
  }
  const registered = { ...identity, deviceId: payload.deviceId, publicDeviceCode: payload.publicDeviceCode };
  await writeDeviceIdentity(registered);
  return registered;
}

export async function deviceAuthHeaders() {
  const identity = await getOrCreateIdentity();
  return { 'x-novacast-device-id': identity.deviceId ?? '', 'x-novacast-device-secret': identity.deviceSecret };
}

export function getDeviceSecretKeyForTests() {
  return DEVICE_SECRET_KEY;
}
