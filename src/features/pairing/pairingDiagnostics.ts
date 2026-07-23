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

export function pairingInstallationFingerprint(installationId: string) {
  return installationId.slice(0, 8);
}
