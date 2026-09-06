import { deviceMetadata, registerDevice } from './deviceRegistration';
import { checkDeviceStatus } from './deviceActivation';
import { deviceFeatureFlags } from './deviceFeatureFlags';
import { downloadManagedProviderAssignment } from './managedProviderDownload';
import {
  logActivationClient,
  resolveActivationClientGate,
  sanitizeActivationErrorCode,
} from './activationDiagnostics';

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
  const invitationCodePresent = Boolean(invitationCode?.trim());
  logActivationClient({
    stage: 'submit-start',
    deviceId: null,
    invitationCodePresent,
    requestStarted: false,
    responseStatus: null,
    responseErrorCode: null,
    pairingSessionIdPresent: false,
    activationStatus: null,
    failureStage: null,
    betaInvitesEnabled: deviceFeatureFlags.betaInvitesEnabled,
    apiConfigured: Boolean(apiConfig()),
  });

  const earlyGate = resolveActivationClientGate({
    betaInvitesEnabled: deviceFeatureFlags.betaInvitesEnabled,
    apiConfigured: Boolean(apiConfig()),
    // Device code is validated after registerDevice; treat as present for the
    // feature-flag / API gates so we fail with the precise env codes first.
    publicDeviceCodePresent: true,
  });
  if (!earlyGate.ok && earlyGate.errorCode !== 'device_code_missing') {
    logActivationClient({
      stage: 'failure',
      deviceId: null,
      invitationCodePresent,
      requestStarted: false,
      responseStatus: null,
      responseErrorCode: earlyGate.errorCode,
      pairingSessionIdPresent: false,
      activationStatus: null,
      failureStage: earlyGate.failureStage,
      betaInvitesEnabled: deviceFeatureFlags.betaInvitesEnabled,
      apiConfigured: Boolean(apiConfig()),
    });
    throw new Error(earlyGate.errorCode);
  }

  logActivationClient({
    stage: 'device-register',
    deviceId: null,
    invitationCodePresent,
    requestStarted: false,
    responseStatus: null,
    responseErrorCode: null,
    pairingSessionIdPresent: false,
    activationStatus: null,
    failureStage: null,
    betaInvitesEnabled: true,
    apiConfigured: Boolean(apiConfig()),
  });

  const identity = await registerDevice();
  const api = apiConfig();
  const deviceCode = identity.publicDeviceCode;

  logActivationClient({
    stage: 'api-config-check',
    deviceId: deviceCode ?? null,
    invitationCodePresent,
    requestStarted: false,
    responseStatus: null,
    responseErrorCode: null,
    pairingSessionIdPresent: false,
    activationStatus: null,
    failureStage: null,
    betaInvitesEnabled: true,
    apiConfigured: Boolean(api),
    publicDeviceCodePresent: Boolean(deviceCode),
  });

  const postRegisterGate = resolveActivationClientGate({
    betaInvitesEnabled: true,
    apiConfigured: Boolean(api),
    publicDeviceCodePresent: Boolean(deviceCode),
  });
  if (!postRegisterGate.ok) {
    logActivationClient({
      stage: 'failure',
      deviceId: deviceCode ?? null,
      invitationCodePresent,
      requestStarted: false,
      responseStatus: null,
      responseErrorCode: postRegisterGate.errorCode,
      pairingSessionIdPresent: false,
      activationStatus: null,
      failureStage: postRegisterGate.failureStage,
      betaInvitesEnabled: true,
      apiConfigured: Boolean(api),
      publicDeviceCodePresent: Boolean(deviceCode),
    });
    throw new Error(postRegisterGate.errorCode);
  }
  if (!api) {
    throw new Error('pairing_api_not_configured');
  }

  logActivationClient({
    stage: 'device-activate-request',
    deviceId: deviceCode,
    invitationCodePresent,
    requestStarted: true,
    responseStatus: null,
    responseErrorCode: null,
    pairingSessionIdPresent: false,
    activationStatus: null,
    failureStage: null,
    betaInvitesEnabled: true,
    apiConfigured: true,
    publicDeviceCodePresent: true,
  });

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
  const responseErrorCode = response.ok
    ? null
    : sanitizeActivationErrorCode(
        typeof (payload as { errorCategory?: unknown }).errorCategory === 'string'
          ? (payload as { errorCategory: string }).errorCategory
          : 'activation_unavailable',
      );

  logActivationClient({
    stage: 'device-activate-response',
    deviceId: deviceCode,
    invitationCodePresent,
    requestStarted: true,
    responseStatus: response.status,
    responseErrorCode,
    pairingSessionIdPresent: false,
    activationStatus:
      typeof (payload as { activationStatus?: unknown }).activationStatus === 'string'
        ? (payload as { activationStatus: string }).activationStatus
        : null,
    failureStage: response.ok ? null : 'device-activate-rejected',
    betaInvitesEnabled: true,
    apiConfigured: true,
    publicDeviceCodePresent: true,
  });

  if (!response.ok) {
    throw new Error(responseErrorCode ?? 'activation_unavailable');
  }

  await checkDeviceStatus();

  logActivationClient({
    stage: 'complete',
    deviceId: deviceCode,
    invitationCodePresent,
    requestStarted: true,
    responseStatus: response.status,
    responseErrorCode: null,
    pairingSessionIdPresent: false,
    activationStatus: 'active',
    failureStage: null,
    betaInvitesEnabled: true,
    apiConfigured: true,
    publicDeviceCodePresent: true,
  });

  return {
    activated: true,
    expiresAt: typeof (payload as { expiresAt?: unknown }).expiresAt === 'string'
      ? (payload as { expiresAt: string }).expiresAt
      : null,
    contentPolicy:
      typeof (payload as { contentPolicy?: unknown }).contentPolicy === 'string'
        ? (payload as { contentPolicy: string }).contentPolicy
        : 'us_only',
    providerAssigned: Boolean((payload as { providerAssigned?: unknown }).providerAssigned),
    requiresProviderDownload: Boolean(
      (payload as { requiresProviderDownload?: unknown }).requiresProviderDownload ??
        (payload as { providerAssigned?: unknown }).providerAssigned,
    ),
  };
}

export async function activateAndBootstrapManagedProvider(invitationCode: string) {
  const activation = await activateDeviceWithInvitationCode(invitationCode);
  if (activation.requiresProviderDownload || deviceFeatureFlags.managedBetaProviderEnabled) {
    logActivationClient({
      stage: 'bootstrap-provider',
      deviceId: null,
      invitationCodePresent: true,
      requestStarted: true,
      responseStatus: null,
      responseErrorCode: null,
      pairingSessionIdPresent: false,
      activationStatus: 'active',
      failureStage: null,
    });
    await downloadManagedProviderAssignment();
  }
  return activation;
}
