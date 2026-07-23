import { deviceAuthHeaders, deviceMetadata, registerDevice } from './deviceRegistration';
import { checkDeviceStatus, initializeDevice } from './deviceActivation';
import { deviceFeatureFlags } from './deviceFeatureFlags';
import { downloadManagedProviderAssignment } from './managedProviderDownload';

function apiConfig() {
  const apiUrl = process.env.EXPO_PUBLIC_NOVACAST_PAIRING_API_URL?.trim().replace(/\/+$/, '');
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim();
  return apiUrl && anonKey ? { apiUrl, anonKey } : null;
}

export type InviteActivationResult = {
  activated: boolean;
  expiresAt: string | null;
  contentPolicy: string;
  providerAssigned: boolean;
  requiresProviderDownload: boolean;
};

/**
 * TV-side closed-beta activation: invite code only. No pairing website required.
 */
export async function activateDeviceWithInvitationCode(
  invitationCode: string,
  friendlyName?: string,
): Promise<InviteActivationResult> {
  if (!deviceFeatureFlags.betaInvitesEnabled) {
    throw new Error('activation_unavailable');
  }

  const identity = await registerDevice();
  const api = apiConfig();
  const deviceCode = identity.publicDeviceCode;
  if (!api || !deviceCode) {
    throw new Error('activation_unavailable');
  }

  const response = await fetch(`${api.apiUrl}/device-activate`, {
    method: 'POST',
    headers: {
      apikey: api.anonKey,
      Authorization: `Bearer ${api.anonKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      deviceId: deviceCode,
      invitationCode: invitationCode.trim().toUpperCase(),
      friendlyName: friendlyName ?? deviceMetadata().model ?? 'NovaCast TV',
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof payload.errorCategory === 'string' ? payload.errorCategory : 'activation_unavailable');
  }

  await initializeDevice();
  await checkDeviceStatus();

  return {
    activated: true,
    expiresAt: typeof payload.expiresAt === 'string' ? payload.expiresAt : null,
    contentPolicy: typeof payload.contentPolicy === 'string' ? payload.contentPolicy : 'us_only',
    providerAssigned: Boolean(payload.providerAssigned),
    requiresProviderDownload: Boolean(payload.requiresProviderDownload ?? payload.providerAssigned),
  };
}

export async function activateAndBootstrapManagedProvider(invitationCode: string) {
  const activation = await activateDeviceWithInvitationCode(invitationCode);
  if (activation.requiresProviderDownload || deviceFeatureFlags.managedBetaProviderEnabled) {
    await downloadManagedProviderAssignment();
  }
  return activation;
}
