import * as Crypto from 'expo-crypto';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { getSecureValue, setSecureValue } from '@/features/providers/providerCredentialStore';
import { readDeviceIdentity, writeDeviceIdentity } from './deviceStorage';
import type { DeviceIdentity } from './deviceTypes';
import { deviceFeatureFlags } from './deviceFeatureFlags';
import { PAIRING_INSTALLATION_ID_KEY } from '@/features/pairing/pairingStorage';

const LEGACY_INSTALLATION_ID_KEY = 'novacast.installation.id';

function apiConfig() {
  const apiUrl = process.env.EXPO_PUBLIC_NOVACAST_PAIRING_API_URL?.trim().replace(/\/+$/, '');
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim();
  return apiUrl && anonKey ? { apiUrl, anonKey } : null;
}

function randomSecret() {
  return Crypto.getRandomBytesAsync(32).then((bytes) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(''));
}

function isValidInstallationId(value: string | null | undefined): value is string {
  return Boolean(value && /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(value));
}

async function resolveInstallationId() {
  const pairingInstallationId = await getSecureValue(PAIRING_INSTALLATION_ID_KEY);
  if (isValidInstallationId(pairingInstallationId)) {
    return pairingInstallationId.toLowerCase();
  }

  const legacyInstallationId = await getSecureValue(LEGACY_INSTALLATION_ID_KEY);
  if (isValidInstallationId(legacyInstallationId)) {
    return legacyInstallationId.toLowerCase();
  }

  return Crypto.randomUUID();
}

async function getOrCreateIdentity() {
  const existing = await readDeviceIdentity();
  if (existing) return existing;
  const installationId = await resolveInstallationId();
  const deviceSecret = await randomSecret();
  const identity: DeviceIdentity = { installationId, deviceSecret, deviceId: null, publicDeviceCode: null };
  await writeDeviceIdentity(identity);
  // Keep the pairing key aligned so create/poll/redeem always share one installation hash.
  await setSecureValue(PAIRING_INSTALLATION_ID_KEY, installationId);
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
  if (!deviceFeatureFlags.registrationEnabled) return identity;
  if (identity.deviceId && identity.publicDeviceCode) return identity;
  const config = apiConfig();
  if (!config) return identity;
  let response: Response;
  try {
    response = await fetch(`${config.apiUrl}/device-register`, {
      method: 'POST',
      headers: { apikey: config.anonKey, Authorization: `Bearer ${config.anonKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ installationId: identity.installationId, deviceSecret: identity.deviceSecret, metadata: deviceMetadata() }),
    });
  } catch {
    if (!deviceFeatureFlags.activationRequired) return identity;
    throw new Error('device_registration_failed');
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || typeof payload.deviceId !== 'string' || typeof payload.publicDeviceCode !== 'string') {
    if (!deviceFeatureFlags.activationRequired) return identity;
    throw new Error(typeof payload.errorCategory === 'string' ? payload.errorCategory : 'device_registration_failed');
  }
  const registered = { ...identity, deviceId: payload.deviceId, publicDeviceCode: payload.publicDeviceCode };
  await writeDeviceIdentity(registered);
  return registered;
}

export async function deviceAuthHeaders(): Promise<Record<string, string>> {
  const identity = await getOrCreateIdentity();
  // Edge Functions authenticate by public Device ID (NC-…), not the backend UUID.
  // Only send credentials when both are present so pairing stays compatible before registration.
  if (!identity.publicDeviceCode || !identity.deviceSecret) {
    return {};
  }

  return {
    'x-novacast-device-id': identity.publicDeviceCode,
    'x-novacast-device-secret': identity.deviceSecret,
  };
}

export function getDeviceSecretKeyForTests() {
  return DEVICE_SECRET_KEY;
}
