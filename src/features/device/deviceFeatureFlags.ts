import * as Device from 'expo-device';
import { Platform } from 'react-native';

function envFlag(name: string, fallback: boolean) {
  const value = process.env[name]?.trim().toLowerCase();
  return value === undefined || value === '' ? fallback : value === 'true' || value === '1';
}

const closedBetaMode = envFlag('EXPO_PUBLIC_CLOSED_BETA_MODE', true);
const localActivationBypassFlag =
  process.env.EXPO_PUBLIC_NOVACAST_LOCAL_ACTIVATION_BYPASS === 'true';

function getAndroidPlatformConstants() {
  return Platform.OS === 'android' ? (Platform.constants as Record<string, unknown>) : {};
}

function hasKnownAndroidEmulatorSignature() {
  const constants = getAndroidPlatformConstants();
  const identity = [
    Device.modelName,
    Device.manufacturer,
    Device.brand,
    Device.deviceName,
    constants.Model,
    constants.Manufacturer,
    constants.Brand,
    constants.Fingerprint,
  ]
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .toLowerCase();

  return /sdk_gphone|android sdk built for|generic_x86|generic_x86_64|aosp_on_x86|ranchu|goldfish|qemu|emulator/.test(identity);
}

export function getLocalActivationBypassDecision(
  activationDecisionSource = 'unknown',
  options?: { log?: boolean },
) {
  const platform = Platform.OS;
  const isEmulator =
    platform === 'android' && (Device.isDevice === false || hasKnownAndroidEmulatorSignature());
  const eligible = localActivationBypassFlag && isEmulator && platform === 'android';
  if (options?.log !== false) {
    console.info('[NovaCast Device Activation]', JSON.stringify({
      event: 'local-test-bypass-check',
      platform,
      bypassFlagEnabled: localActivationBypassFlag,
      isDevice: Device.isDevice ?? null,
      isEmulator,
      eligible,
      activationDecisionSource,
    }));
  }
  return { eligible, isEmulator, bypassFlagEnabled: localActivationBypassFlag };
}

export const deviceFeatureFlags = {
  closedBetaMode,
  registrationEnabled: envFlag('EXPO_PUBLIC_DEVICE_REGISTRATION_ENABLED', true),
  activationEnabled: envFlag('EXPO_PUBLIC_DEVICE_ACTIVATION_ENABLED', true),
  // Closed beta requires activation; otherwise honor the explicit flag.
  activationRequired: closedBetaMode || envFlag('EXPO_PUBLIC_DEVICE_ACTIVATION_REQUIRED', false),
  betaInvitesEnabled: envFlag('EXPO_PUBLIC_BETA_INVITES_ENABLED', true),
  managedBetaProviderEnabled:
    closedBetaMode || envFlag('EXPO_PUBLIC_MANAGED_BETA_PROVIDER_ENABLED', false),
  // Personal pairing stays in the codebase but is inactive during closed beta.
  personalProviderPairingEnabled:
    !closedBetaMode && envFlag('EXPO_PUBLIC_PERSONAL_PROVIDER_PAIRING_ENABLED', true),
  localActivationBypassFlag,
};

export function isDeviceActivationRequired() {
  const bypass = getLocalActivationBypassDecision('activation-gate', { log: false });
  return (
    deviceFeatureFlags.registrationEnabled &&
    deviceFeatureFlags.activationEnabled &&
    deviceFeatureFlags.activationRequired &&
    !bypass.eligible
  );
}

export function isLocalActivationBypassEnabled(options?: { log?: boolean }) {
  return getLocalActivationBypassDecision('device-status', options).eligible;
}

export function isClosedBetaManagedFlow() {
  return deviceFeatureFlags.closedBetaMode || deviceFeatureFlags.managedBetaProviderEnabled;
}

export function isPersonalPairingEnabled() {
  return deviceFeatureFlags.personalProviderPairingEnabled;
}
