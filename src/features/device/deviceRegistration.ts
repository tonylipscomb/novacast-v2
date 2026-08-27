import { getCachedNetworkDiagnostics } from '@/features/diagnostics/runtimeDiagnostics';
import * as Application from 'expo-application';
import * as Crypto from 'expo-crypto';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { getSecureValue, setSecureValue } from '@/features/providers/providerCredentialStore';
import {
  DEVICE_SECRET_KEY,
  LEGACY_INSTALLATION_ID_KEY,
  readDeviceIdentity,
  readStoredDeviceIdentityKeys,
  writeDeviceIdentity,
} from './deviceStorage';
import type { DeviceIdentity } from './deviceTypes';
import { deviceFeatureFlags } from './deviceFeatureFlags';
import { PAIRING_INSTALLATION_ID_KEY } from '@/features/pairing/pairingStorage';
import { STARTUP_NETWORK_TIMEOUT_MS, withTimeout } from '@/features/startup/startupTimeouts';
import {
  interpretDeviceRegisterResponse,
  isValidInstallationId,
  shouldMintNewDeviceSecret,
  shouldSkipDeviceRegister,
} from './deviceRegisterIdempotency';

function logRegistration(fields: Record<string, unknown>) {
  console.info('[NovaCast Device Registration]', JSON.stringify(fields));
}

function safeErrorCode(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  return /^[a-z][a-z0-9_]{1,63}$/i.test(message) ? message.toLowerCase() : 'device_registration_failed';
}

function apiConfig() {
  const apiUrl = process.env.EXPO_PUBLIC_NOVACAST_PAIRING_API_URL?.trim().replace(/\/+$/, '');
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim();
  return apiUrl && anonKey ? { apiUrl, anonKey } : null;
}

function randomSecret() {
  return Crypto.getRandomBytesAsync(32).then((bytes) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(''));
}

let identityPromise: Promise<DeviceIdentity> | null = null;
let registrationPromise: Promise<DeviceIdentity> | null = null;

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

async function persistCanonicalIdentity(identity: DeviceIdentity) {
  await withTimeout(writeDeviceIdentity(identity), STARTUP_NETWORK_TIMEOUT_MS, 'device_identity_timeout');
  await withTimeout(
    setSecureValue(PAIRING_INSTALLATION_ID_KEY, identity.installationId),
    STARTUP_NETWORK_TIMEOUT_MS,
    'device_identity_timeout',
  );
}

async function resolveOrCreateIdentity() {
  const startedAt = Date.now();
  logRegistration({ event: 'identity-start' });
  try {
    const existing = await withTimeout(readDeviceIdentity(), STARTUP_NETWORK_TIMEOUT_MS, 'device_identity_timeout');
    if (existing) {
      await persistCanonicalIdentity(existing);
      logRegistration({
        event: 'identity-ready',
        durationMs: Date.now() - startedAt,
        installationIdentityPresent: true,
        privateCredentialPresent: Boolean(existing.deviceSecret),
        publicDeviceIdPresent: Boolean(existing.publicDeviceCode),
        backendDeviceIdPresent: Boolean(existing.deviceId),
      });
      return existing;
    }
    const stored = await withTimeout(readStoredDeviceIdentityKeys(), STARTUP_NETWORK_TIMEOUT_MS, 'device_identity_timeout');
    const installationId = await withTimeout(resolveInstallationId(), STARTUP_NETWORK_TIMEOUT_MS, 'device_identity_timeout');
    const deviceSecret = shouldMintNewDeviceSecret(stored.deviceSecret)
      ? await withTimeout(randomSecret(), STARTUP_NETWORK_TIMEOUT_MS, 'device_identity_timeout')
      : stored.deviceSecret!;
    const identity: DeviceIdentity = {
      installationId,
      deviceSecret,
      deviceId: stored.deviceId,
      publicDeviceCode: stored.publicDeviceCode,
    };
    await persistCanonicalIdentity(identity);
    logRegistration({
      event: 'identity-ready',
      durationMs: Date.now() - startedAt,
      installationIdentityPresent: true,
      privateCredentialPresent: true,
      publicDeviceIdPresent: Boolean(identity.publicDeviceCode),
      backendDeviceIdPresent: Boolean(identity.deviceId),
    });
    return identity;
  } catch (error) {
    logRegistration({
      event: 'identity-failed',
      durationMs: Date.now() - startedAt,
      errorCode: safeErrorCode(error),
      errorName: error instanceof Error ? error.name : 'unknown',
    });
    throw error;
  }
}

async function getOrCreateIdentity() {
  if (!identityPromise) {
    identityPromise = resolveOrCreateIdentity();
  }
  return identityPromise;
}

export async function getDeviceIdentity() {
  return getOrCreateIdentity();
}

function androidPlatformModel() {
  if (Platform.OS !== 'android') {
    return null;
  }
  const model = (Platform.constants as Record<string, unknown>).Model;
  return typeof model === 'string' && model.trim() ? model : null;
}

function normalizePhysicalDeviceType(deviceType: Device.DeviceType | null) {
  switch (deviceType) {
    case Device.DeviceType.PHONE:
      return 'phone';
    case Device.DeviceType.TABLET:
      return 'tablet';
    case Device.DeviceType.TV:
      return 'tv';
    case Device.DeviceType.DESKTOP:
      return 'desktop';
    default:
      return null;
  }
}

export function deviceMetadata() {
  const platformModel = androidPlatformModel();
  const looksLikeEmulator =
    Device.isDevice === false ||
    [Device.modelName, platformModel, Device.manufacturer, Device.brand, Device.deviceName]
      .filter((value): value is string => typeof value === 'string')
      .join(' ')
      .toLowerCase()
      .match(
        /sdk_gphone|sdk_googletv|sdk_google_atv|google_sdk|android sdk built for|generic_x86|generic_x86_64|aosp_on_x86|ranchu|goldfish|qemu|emulator|gphone|sdk_phone|android tv on/,
      ) != null;

  return {
    platform: Device.osName ?? Platform.OS ?? 'unknown',
    manufacturer: Device.manufacturer ?? Device.brand ?? null,
    model: Device.modelName ?? platformModel ?? null,
    deviceType: looksLikeEmulator ? 'android_emulator' : normalizePhysicalDeviceType(Device.deviceType),
    osVersion: Device.osVersion ?? null,
    appVersion: Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? 'unknown',
    appBuild: Application.nativeBuildVersion ?? Constants.expoConfig?.android?.versionCode?.toString() ?? Constants.expoConfig?.ios?.buildNumber ?? null,
    network: getCachedNetworkDiagnostics(),
  };
}

async function registerDeviceOnce() {
  const startedAt = Date.now();
  const identity = await getOrCreateIdentity();
  logRegistration({
    event: 'config-check',
    installationIdentityPresent: Boolean(identity.installationId),
    privateCredentialPresent: Boolean(identity.deviceSecret),
    publicDeviceIdPresent: Boolean(identity.publicDeviceCode),
    backendDeviceIdPresent: Boolean(identity.deviceId),
    backendConfigured: Boolean(apiConfig()),
    registrationFunctionConfigured: Boolean(apiConfig()),
    registrationEnabled: deviceFeatureFlags.registrationEnabled,
  });
  if (!deviceFeatureFlags.registrationEnabled) return identity;
  if (shouldSkipDeviceRegister(identity)) return identity;
  const config = apiConfig();
  if (!config) {
    logRegistration({
      event: 'config-unconfigured',
      durationMs: Date.now() - startedAt,
      backendConfigured: false,
      registrationFunctionConfigured: false,
      activationRequired: deviceFeatureFlags.activationRequired,
    });
    if (deviceFeatureFlags.activationRequired) {
      logRegistration({
        event: 'registration-failed',
        durationMs: Date.now() - startedAt,
        errorCode: 'pairing_api_unconfigured',
        sanitizedErrorMessage: 'pairing_api_unconfigured',
        retryable: false,
        statusCode: null,
      });
    }
    return identity;
  }
  logRegistration({
    event: 'registration-start',
    durationMs: Date.now() - startedAt,
    installationIdentityPresent: true,
    privateCredentialPresent: Boolean(identity.deviceSecret),
    backendConfigured: true,
    registrationFunctionConfigured: true,
  });
  let response: Response;
  try {
    response = await withTimeout(fetch(`${config.apiUrl}/device-register`, {
      method: 'POST',
      headers: { apikey: config.anonKey, Authorization: `Bearer ${config.anonKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ installationId: identity.installationId, deviceSecret: identity.deviceSecret, metadata: deviceMetadata() }),
    }), STARTUP_NETWORK_TIMEOUT_MS, 'device_registration_timeout');
    logRegistration({ event: 'registration-response', durationMs: Date.now() - startedAt, statusCode: response.status });
  } catch (error) {
    logRegistration({
      event: safeErrorCode(error) === 'device_registration_timeout' ? 'registration-timeout' : 'registration-failed',
      durationMs: Date.now() - startedAt,
      errorCode: safeErrorCode(error),
      sanitizedErrorMessage: safeErrorCode(error),
      errorName: error instanceof Error ? error.name : 'unknown',
      retryable: true,
      statusCode: null,
      registrationFunctionConfigured: true,
    });
    if (!deviceFeatureFlags.activationRequired) return identity;
    throw new Error(safeErrorCode(error));
  }
  const payload = await withTimeout(response.json().catch(() => ({})), STARTUP_NETWORK_TIMEOUT_MS, 'device_registration_timeout').catch((error) => {
    logRegistration({
      event: safeErrorCode(error) === 'device_registration_timeout' ? 'registration-timeout' : 'registration-failed',
      durationMs: Date.now() - startedAt,
      errorCode: safeErrorCode(error),
      sanitizedErrorMessage: safeErrorCode(error),
      errorName: error instanceof Error ? error.name : 'unknown',
      retryable: true,
      statusCode: response.status,
    });
    if (!deviceFeatureFlags.activationRequired) return {};
    throw new Error(safeErrorCode(error));
  }) as Record<string, unknown>;
  const interpreted = interpretDeviceRegisterResponse({
    ok: response.ok,
    statusCode: response.status,
    payload,
    previousDeviceId: identity.deviceId,
    previousPublicDeviceCode: identity.publicDeviceCode,
  });
  if (!interpreted.ok) {
    logRegistration({
      event: 'registration-failed',
      durationMs: Date.now() - startedAt,
      statusCode: response.status,
      errorCode: interpreted.errorCode,
      sanitizedErrorMessage: interpreted.errorCode,
      retryable: response.status >= 500 || response.status === 429,
    });
    if (!deviceFeatureFlags.activationRequired) return identity;
    throw new Error(interpreted.errorCode);
  }
  logRegistration({
    event: 'device-id-ready',
    durationMs: Date.now() - startedAt,
    statusCode: response.status,
    publicDeviceIdPresent: true,
    backendDeviceIdPresent: true,
    retryable: false,
  });
  const registered = { ...identity, deviceId: interpreted.deviceId, publicDeviceCode: interpreted.publicDeviceCode };
  logRegistration({ event: 'persist-start', durationMs: Date.now() - startedAt, publicDeviceIdPresent: true });
  try {
    await persistCanonicalIdentity(registered);
  } catch (error) {
    logRegistration({
      event: 'registration-failed',
      durationMs: Date.now() - startedAt,
      errorCode: safeErrorCode(error),
      sanitizedErrorMessage: safeErrorCode(error),
      errorName: error instanceof Error ? error.name : 'unknown',
      publicDeviceIdPresent: true,
      retryable: true,
    });
    throw error;
  }
  if (interpreted.recovered) {
    logRegistration({
      event: 'existing-registration-recovered',
      installationIdentityPresent: true,
      publicDeviceIdPresent: true,
      backendDeviceIdPresent: true,
      statusCode: response.status,
      activationRequired: deviceFeatureFlags.activationRequired,
    });
  }
  logRegistration({ event: 'persist-complete', durationMs: Date.now() - startedAt, publicDeviceIdPresent: true });
  logRegistration({ event: 'registration-complete', durationMs: Date.now() - startedAt, publicDeviceIdPresent: true });
  identityPromise = Promise.resolve(registered);
  return registered;
}

export function registerDevice() {
  if (!registrationPromise) {
    registrationPromise = registerDeviceOnce().finally(() => {
      registrationPromise = null;
    });
  }
  return registrationPromise;
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

export function resetDeviceRegistrationCache() {
  identityPromise = null;
  registrationPromise = null;
}
