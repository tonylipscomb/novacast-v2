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
  } = {},
) {
  const failureCategory = fields.failureCategory?.replace(/[^a-z0-9_-]/gi, '').slice(0, 64) || undefined;
  const serverErrorCode = fields.serverErrorCode?.replace(/[^a-z0-9_-]/gi, '').slice(0, 64) || undefined;
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
  });
}

export function pairingInstallationFingerprint(installationId: string) {
  return installationId.slice(0, 8);
}
