function envFlag(name: string, fallback: boolean) {
  const value = process.env[name]?.trim().toLowerCase();
  return value === undefined || value === '' ? fallback : value === 'true' || value === '1';
}

const closedBetaMode = envFlag('EXPO_PUBLIC_CLOSED_BETA_MODE', false);

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
};

export function isDeviceActivationRequired() {
  return (
    deviceFeatureFlags.registrationEnabled &&
    deviceFeatureFlags.activationEnabled &&
    deviceFeatureFlags.activationRequired
  );
}

export function isClosedBetaManagedFlow() {
  return deviceFeatureFlags.closedBetaMode || deviceFeatureFlags.managedBetaProviderEnabled;
}

export function isPersonalPairingEnabled() {
  return deviceFeatureFlags.personalProviderPairingEnabled;
}
