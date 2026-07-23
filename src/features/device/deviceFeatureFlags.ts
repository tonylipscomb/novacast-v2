function envFlag(name: string, fallback: boolean) {
  const value = process.env[name]?.trim().toLowerCase();
  return value === undefined || value === '' ? fallback : value === 'true' || value === '1';
}

export const deviceFeatureFlags = {
  registrationEnabled: envFlag('EXPO_PUBLIC_DEVICE_REGISTRATION_ENABLED', true),
  activationEnabled: envFlag('EXPO_PUBLIC_DEVICE_ACTIVATION_ENABLED', true),
  activationRequired: envFlag('EXPO_PUBLIC_DEVICE_ACTIVATION_REQUIRED', false),
  betaInvitesEnabled: envFlag('EXPO_PUBLIC_BETA_INVITES_ENABLED', true),
  managedBetaProviderEnabled: envFlag('EXPO_PUBLIC_MANAGED_BETA_PROVIDER_ENABLED', false),
  personalProviderPairingEnabled: envFlag('EXPO_PUBLIC_PERSONAL_PROVIDER_PAIRING_ENABLED', true),
};

export function isDeviceActivationRequired() {
  return deviceFeatureFlags.registrationEnabled && deviceFeatureFlags.activationEnabled && deviceFeatureFlags.activationRequired;
}
