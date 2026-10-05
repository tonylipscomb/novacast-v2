import { isDevelopmentBuild } from './pairingState.ts';

export function pairingDiagnostic(event: string, details: Record<string, string | number | boolean | null | undefined> = {}) {
  if (!isDevelopmentBuild()) {
    return;
  }

  const sanitized = Object.fromEntries(
    Object.entries(details).filter(([, value]) => value !== undefined),
  );
  console.log(`[pairing] ${event}`, sanitized);
}

/** Release-safe pairing logs for device logcat. Filter: adb logcat | findstr /i "[NovaCast Pairing]" */
export function logPairingEvent(event: string, payload: Record<string, unknown> = {}) {
  console.info('[NovaCast Pairing]', event, payload);
}

type PairingHttpCategory = 'success' | 'client_error' | 'server_error' | 'network_error' | 'timeout';

export function classifyPairingHttpStatus(status: number): PairingHttpCategory {
  if (status >= 200 && status < 300) return 'success';
  if (status >= 400 && status < 500) return 'client_error';
  if (status >= 500) return 'server_error';
  return 'server_error';
}

export function logPairingReleaseDiagnostic(
  event: string,
  fields: {
    apiConfigured?: boolean;
    anonKeyConfigured?: boolean;
    httpCategory?: PairingHttpCategory;
    statusCode?: number | null;
    serverErrorCode?: string | null;
    deviceIdentityFieldsPresent?: boolean;
    activationDeviceAuthHeadersPresent?: boolean;
    responseSchemaValid?: boolean;
    failureCategory?: string | null;
    sessionGeneration?: number;
    state?: string | null;
    remainingMs?: number;
    expiresInMs?: number;
    elapsedMs?: number;
    reason?: string | null;
    pollDelayMs?: number;
    backoffStep?: number;
  } = {},
) {
  const failureCategory = fields.failureCategory?.replace(/[^a-z0-9_-]/gi, '').slice(0, 64) || undefined;
  const serverErrorCode = fields.serverErrorCode?.replace(/[^a-z0-9_-]/gi, '').slice(0, 64) || undefined;
  const state = fields.state?.replace(/[^a-z0-9_-]/gi, '').slice(0, 64) || undefined;
  const reason = fields.reason?.replace(/[^a-z0-9_-]/gi, '').slice(0, 64) || undefined;
  const sessionGeneration = Number.isInteger(fields.sessionGeneration) ? fields.sessionGeneration : undefined;
  const remainingMs = Number.isFinite(fields.remainingMs) ? Math.max(0, Math.round(fields.remainingMs ?? 0)) : undefined;
  const expiresInMs = Number.isFinite(fields.expiresInMs) ? Math.max(0, Math.round(fields.expiresInMs ?? 0)) : undefined;
  const elapsedMs = Number.isFinite(fields.elapsedMs) ? Math.max(0, Math.round(fields.elapsedMs ?? 0)) : undefined;
  const pollDelayMs = Number.isFinite(fields.pollDelayMs) ? Math.max(0, Math.round(fields.pollDelayMs ?? 0)) : undefined;
  const backoffStep = Number.isInteger(fields.backoffStep) ? Math.max(0, fields.backoffStep ?? 0) : undefined;
  console.info('[NovaCast Pairing Diagnostics]', {
    event,
    ...(fields.apiConfigured !== undefined ? { apiConfigured: fields.apiConfigured } : {}),
    ...(fields.anonKeyConfigured !== undefined ? { anonKeyConfigured: fields.anonKeyConfigured } : {}),
    ...(fields.httpCategory ? { httpCategory: fields.httpCategory } : {}),
    ...(fields.statusCode !== undefined ? { statusCode: fields.statusCode } : {}),
    ...(serverErrorCode ? { serverErrorCode } : {}),
    ...(fields.deviceIdentityFieldsPresent !== undefined ? { deviceIdentityFieldsPresent: fields.deviceIdentityFieldsPresent } : {}),
    ...(fields.activationDeviceAuthHeadersPresent !== undefined ? { activationDeviceAuthHeadersPresent: fields.activationDeviceAuthHeadersPresent } : {}),
    ...(fields.responseSchemaValid !== undefined ? { responseSchemaValid: fields.responseSchemaValid } : {}),
    ...(failureCategory ? { failureCategory } : {}),
    ...(sessionGeneration !== undefined ? { sessionGeneration } : {}),
    ...(state ? { state } : {}),
    ...(remainingMs !== undefined ? { remainingMs } : {}),
    ...(expiresInMs !== undefined ? { expiresInMs } : {}),
    ...(elapsedMs !== undefined ? { elapsedMs } : {}),
    ...(reason ? { reason } : {}),
    ...(pollDelayMs !== undefined ? { pollDelayMs } : {}),
    ...(backoffStep !== undefined ? { backoffStep } : {}),
  });
}

export function pairingInstallationFingerprint(installationId: string) {
  return installationId.slice(0, 8);
}
