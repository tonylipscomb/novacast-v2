export const CATALOG_FRESHNESS_MS = 6 * 60 * 60 * 1000;

export type CatalogFreshnessDecision = {
  ageMs: number | null;
  state: 'fresh' | 'stale' | 'missing';
  action: 'skip' | 'background_refresh' | 'bootstrap';
};

export function decideCatalogFreshness(input: {
  hasReadableGeneration: boolean;
  lastSuccessfulSyncAt?: number | null;
  nowMs?: number;
  thresholdMs?: number;
}): CatalogFreshnessDecision {
  if (!input.hasReadableGeneration) {
    return { ageMs: null, state: 'missing', action: 'bootstrap' };
  }

  const thresholdMs = input.thresholdMs ?? CATALOG_FRESHNESS_MS;
  const ageMs = input.lastSuccessfulSyncAt == null
    ? null
    : Math.max(0, (input.nowMs ?? Date.now()) - input.lastSuccessfulSyncAt);
  const state = ageMs != null && ageMs < thresholdMs ? 'fresh' : 'stale';
  return { ageMs, state, action: state === 'fresh' ? 'skip' : 'background_refresh' };
}
