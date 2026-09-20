export type ProviderHealthStatus = 'unvalidated' | 'testing' | 'healthy' | 'degraded' | 'failed';
export type ProviderActivationStatus = 'draft' | 'active' | 'paused' | 'revoked';

export function displayHealthLabel(input: {
  activationStatus: string;
  healthStatus: string;
  validationStale: boolean;
  testingLeaseFresh?: boolean;
  expired?: boolean;
  offline?: boolean;
}) {
  if (input.activationStatus === 'paused' || input.activationStatus === 'revoked') return 'DISABLED';
  if (input.activationStatus === 'draft' && (input.healthStatus === 'unvalidated' || input.validationStale)) return 'DRAFT';
  if (input.healthStatus === 'testing') return input.testingLeaseFresh === false ? 'VALIDATION REQUIRED' : 'TESTING';
  if (input.validationStale) return 'VALIDATION REQUIRED';
  if (input.expired) return 'EXPIRED';
  if (input.offline) return 'OFFLINE';
  if (input.healthStatus === 'healthy') return 'HEALTHY';
  if (input.healthStatus === 'degraded') return 'DEGRADED';
  if (input.healthStatus === 'failed') return 'FAILED';
  return 'DRAFT';
}

export function canActivateProvider(input: {
  healthStatus: string;
  validationStale: boolean;
  activationStatus: string;
}) {
  if (input.validationStale) return false;
  if (input.healthStatus !== 'healthy' && input.healthStatus !== 'degraded') return false;
  if (input.activationStatus === 'revoked') return false;
  return true;
}

export function healthTone(label: string) {
  if (label === 'HEALTHY') return 'healthy';
  if (label === 'DEGRADED' || label === 'VALIDATION REQUIRED' || label === 'TESTING') return 'warn';
  if (label === 'FAILED' || label === 'OFFLINE' || label === 'EXPIRED') return 'fail';
  if (label === 'DISABLED') return 'disabled';
  return 'draft';
}

export function formatCount(value: unknown, atLeast = false) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number)) return '—';
  return `${number.toLocaleString()}${atLeast ? '+' : ''}`;
}

export function isCappedCatalogCount(value: unknown, truncated?: boolean, exactCountAvailable?: boolean) {
  if (exactCountAvailable === true) return false;
  if (exactCountAvailable === false) return true;
  if (truncated === true) return true;
  if (truncated === false) return false;
  return Number(value) >= 12_000;
}

export function formatTimestamp(value: unknown) {
  const time = Date.parse(String(value ?? ''));
  if (!Number.isFinite(time)) return 'Never';
  return new Date(time).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function formatInventoryCount(value: unknown, diagnosticValue: unknown, diagnosticAtLeast: boolean) {
  if (value !== null && value !== undefined && Number.isInteger(Number(value)) && Number(value) >= 0) {
    return formatCount(value);
  }
  if (diagnosticValue !== null && diagnosticValue !== undefined && Number.isFinite(Number(diagnosticValue))) {
    return formatCount(diagnosticValue, diagnosticAtLeast);
  }
  return 'Not counted';
}

export const HEALTH_STEPS = [
  { id: 'server', label: 'Server' },
  { id: 'authentication', label: 'Authentication' },
  { id: 'live-catalog', label: 'Live Catalog' },
  { id: 'movie-catalog', label: 'Movies' },
  { id: 'series-catalog', label: 'Series' },
  { id: 'playback', label: 'Playback' },
  { id: 'epg', label: 'EPG' },
  { id: 'compatibility', label: 'NovaCast Compatibility' },
] as const;
