/**
 * Privacy-safe activation diagnostics for Stage 4A+.
 * Never log secrets, tokens, private device credentials, or full payloads.
 */

export const ACTIVATION_DIAGNOSTICS_MARKER = 'stage4a-activation-audit-v1';

export type ActivationClientStage =
  | 'submit-start'
  | 'feature-flag-check'
  | 'api-config-check'
  | 'device-register'
  | 'device-activate-request'
  | 'device-activate-response'
  | 'bootstrap-provider'
  | 'complete'
  | 'failure';

export type ActivationClientDiagnostic = {
  stage: ActivationClientStage;
  deviceId: string | null;
  invitationCodePresent: boolean;
  requestStarted: boolean;
  responseStatus: number | null;
  responseErrorCode: string | null;
  pairingSessionIdPresent: boolean;
  activationStatus: string | null;
  failureStage: string | null;
  betaInvitesEnabled?: boolean;
  apiConfigured?: boolean;
  publicDeviceCodePresent?: boolean;
};

export function logActivationClient(diagnostic: ActivationClientDiagnostic) {
  console.info(
    '[NovaCast Activation Client] ' +
      JSON.stringify({
        ...diagnostic,
        marker: ACTIVATION_DIAGNOSTICS_MARKER,
      }),
  );
}

export function sanitizeActivationErrorCode(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }
  const code = value.trim().slice(0, 64);
  if (!/^[a-z][a-z0-9_]{1,63}$/i.test(code)) {
    return 'activation_unavailable';
  }
  return code.toLowerCase();
}

/** Pre-network gates that must not collapse into opaque activation_unavailable. */
export type ActivationClientGate =
  | { ok: true }
  | {
      ok: false;
      errorCode:
        | 'beta_invites_disabled'
        | 'pairing_api_unconfigured'
        | 'device_code_missing';
      failureStage: string;
    };

export function resolveActivationClientGate(input: {
  betaInvitesEnabled: boolean;
  apiConfigured: boolean;
  publicDeviceCodePresent: boolean;
}): ActivationClientGate {
  if (!input.betaInvitesEnabled) {
    return {
      ok: false,
      errorCode: 'beta_invites_disabled',
      failureStage: 'beta-invites-disabled',
    };
  }
  if (!input.apiConfigured) {
    return {
      ok: false,
      errorCode: 'pairing_api_unconfigured',
      failureStage: 'pairing-api-unconfigured',
    };
  }
  if (!input.publicDeviceCodePresent) {
    return {
      ok: false,
      errorCode: 'device_code_missing',
      failureStage: 'device-code-missing',
    };
  }
  return { ok: true };
}

/** True when a code is a known precise activation failure (not the unknown fallback). */
export function isPreciseActivationErrorCode(code: string | null | undefined): boolean {
  if (!code) return false;
  const known = new Set([
    'beta_invites_disabled',
    'pairing_api_unconfigured',
    'device_code_missing',
    'device_not_found',
    'device_blocked',
    'device_revoked',
    'device_credential_invalid',
    'device_registration_failed',
    'invalid_device',
    'invite_not_found',
    'invite_inactive',
    'invite_not_started',
    'invite_expired',
    'invite_exhausted',
    'invitation_not_found',
    'invitation_expired',
    'invitation_revoked',
    'invitation_already_used',
    'provider_not_found',
    'provider_not_assigned',
    'managed_provider_unavailable',
    'provider_unavailable',
    'provider_download_failed',
    'activation_rpc_missing',
    'activation_expired',
    'rate_limited',
    'environment_mismatch',
  ]);
  return known.has(code.toLowerCase());
}
