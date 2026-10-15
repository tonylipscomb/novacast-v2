export const NOVACAST_PACKAGE_NAME = 'com.novacast.novacastv2';

export type UpdateManifest = {
  packageName: string;
  versionName: string;
  versionCode: number;
  apkUrl: string;
  sha256: string;
  channel: 'production';
  releaseNotes?: string[];
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
    return url.protocol === 'https:';
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
  const channel = record.channel === 'production' ? 'production' : null;

  if (
    packageName !== NOVACAST_PACKAGE_NAME ||
    !versionName ||
    versionCode <= 0 ||
    !isHttpUrl(record.apkUrl) ||
    !sha256 || !channel
  ) {
    return null;
  }

  return {
    packageName,
    versionName,
    versionCode,
    apkUrl: record.apkUrl,
    sha256,
    channel,
    releaseNotes: Array.isArray(record.releaseNotes)
      ? record.releaseNotes.filter((item): item is string => typeof item === 'string').slice(0, 20).map((item) => item.slice(0, 300))
      : undefined,
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

export const UPDATE_MANIFEST_URL_ENV = 'EXPO_PUBLIC_NOVACAST_UPDATE_MANIFEST_URL';
const UPDATE_FETCH_TIMEOUT_MS = 8000;
let cachedProductionManifest: UpdateManifest | null = null;
let lastManifestCheckAt = 0;

export function getConfiguredUpdateManifestUrl(): string | null {
  const value = process.env.EXPO_PUBLIC_NOVACAST_UPDATE_MANIFEST_URL?.trim();
  if (!value) return null;
  try {
    return new URL(value).protocol === 'https:' ? value : null;
  } catch {
    return null;
  }
}

export async function fetchProductionUpdateManifest(options: { force?: boolean } = {}): Promise<UpdateManifest | null> {
  const url = getConfiguredUpdateManifestUrl();
  if (!url) return cachedProductionManifest;
  if (!options.force && cachedProductionManifest && Date.now() - lastManifestCheckAt < 15 * 60 * 1000) {
    return cachedProductionManifest;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPDATE_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!response.ok) return cachedProductionManifest;
    const manifest = parseUpdateManifest(await response.json());
    if (manifest) cachedProductionManifest = manifest;
    lastManifestCheckAt = Date.now();
    return cachedProductionManifest;
  } catch {
    return cachedProductionManifest;
  } finally {
    clearTimeout(timeout);
  }
}

export function resetUpdateManifestCacheForTests() {
  cachedProductionManifest = null;
  lastManifestCheckAt = 0;
}
