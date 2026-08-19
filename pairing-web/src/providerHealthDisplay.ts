export type ProviderHealthStatus = 'unvalidated' | 'testing' | 'healthy' | 'degraded' | 'failed';
export type ProviderActivationStatus = 'draft' | 'active' | 'paused' | 'revoked';

export function displayHealthLabel(input: {
  activationStatus: string;
  healthStatus: string;
  validationStale: boolean;
}) {
  if (input.activationStatus === 'paused' || input.activationStatus === 'revoked') return 'DISABLED';
  if (input.activationStatus === 'draft' && (input.healthStatus === 'unvalidated' || input.validationStale)) return 'DRAFT';
  if (input.healthStatus === 'testing') return 'TESTING';
  if (input.validationStale) return 'VALIDATION REQUIRED';
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
  if (label === 'FAILED') return 'fail';
  if (label === 'DISABLED') return 'disabled';
  return 'draft';
}

export function formatCount(value: unknown) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number)) return '—';
  return number.toLocaleString();
}

export function formatTimestamp(value: unknown) {
  const time = Date.parse(String(value ?? ''));
  if (!Number.isFinite(time)) return 'Never';
  return new Date(time).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
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
