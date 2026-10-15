export const NOVACAST_PACKAGE_NAME = 'com.novacast.novacastv2';

export type UpdateManifest = {
  packageName: string;
  versionName: string;
  versionCode: number;
  apkUrl: string;
  sha256: string;
};

export type UpdateDecision =
  | { kind: 'invalid-manifest'; reason: string }
  | { kind: 'no-update'; installedVersionCode: number }
  | { kind: 'available'; manifest: UpdateManifest };

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2048) {
    return false;
  }
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

function normalizeSha256(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(normalized) ? normalized : null;
}

export function parseUpdateManifest(value: unknown): UpdateManifest | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const record = value as Record<string, unknown>;
  const packageName = typeof record.packageName === 'string' ? record.packageName.trim() : '';
  const versionName = typeof record.versionName === 'string' ? record.versionName.trim() : '';
  const versionCode = Number.isInteger(record.versionCode) ? Number(record.versionCode) : 0;
  const sha256 = normalizeSha256(record.sha256);

  if (
    packageName !== NOVACAST_PACKAGE_NAME ||
    !versionName ||
    versionCode <= 0 ||
    !isHttpUrl(record.apkUrl) ||
    !sha256
  ) {
    return null;
  }

  return {
    packageName,
    versionName,
    versionCode,
    apkUrl: record.apkUrl,
    sha256,
  };
}

export function resolveUpdateDecision(
  installedVersionCode: number,
  rawManifest: unknown,
): UpdateDecision {
  const manifest = parseUpdateManifest(rawManifest);
  if (!manifest) {
    return { kind: 'invalid-manifest', reason: 'manifest-contract-invalid' };
  }
  if (!Number.isInteger(installedVersionCode) || installedVersionCode < 0) {
    return { kind: 'invalid-manifest', reason: 'installed-version-invalid' };
  }
  if (manifest.versionCode <= installedVersionCode) {
    return { kind: 'no-update', installedVersionCode };
  }
  return { kind: 'available', manifest };
}

export function doesApkSha256Match(expectedSha256: string, actualSha256: string): boolean {
  const expected = normalizeSha256(expectedSha256);
  const actual = normalizeSha256(actualSha256);
  return expected !== null && actual !== null && expected === actual;
}
