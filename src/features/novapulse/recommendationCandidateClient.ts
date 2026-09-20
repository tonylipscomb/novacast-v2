import { analyticsConfig } from '../analytics/analyticsConfig.ts';

export type RecommendationCandidateContentType = 'movie' | 'series';
export type RecommendationCandidateReason = 'viewers_also_watched' | 'trending_novacast';

export type RecommendationSeed = {
  fingerprint: string;
  contentType: RecommendationCandidateContentType;
  strength: 'repeat' | 'complete' | 'meaningful' | 'favorite' | 'watchlist';
  occurredAt?: string;
};

export type RecommendationCatalogFingerprint = {
  token: string;
  fingerprint: string;
  contentType: RecommendationCandidateContentType;
};

export type RecommendationCandidate = {
  contentFingerprintRef: string;
  contentType: RecommendationCandidateContentType;
  reason: RecommendationCandidateReason;
  behaviorScore: number;
  trendScore: number;
  affinityScore: number;
  velocity: number;
  supportBucket: 'supported' | 'strong' | 'established';
  scope: 'global' | 'provider';
  seedCorrelationToken?: string;
  catalogMatchToken?: string;
};

export type RecommendationCandidateResponse = {
  ok: true;
  candidates: RecommendationCandidate[];
  meta?: {
    seedCount?: number;
    providerScopedUsed?: boolean;
    coldStart?: boolean;
    cacheHit?: boolean;
  };
};

export type RecommendationCandidateRequest = {
  providerId: string;
  seeds: readonly RecommendationSeed[];
  catalogFingerprints: readonly RecommendationCatalogFingerprint[];
  supportedContentTypes?: readonly RecommendationCandidateContentType[];
  limit?: number;
};

const CACHE_TTL_MS = 12 * 60 * 1000;
const MAX_SEEDS = 12;
const MAX_CATALOG = 200;
const MAX_RESULTS = 30;

type CacheEntry = {
  expiresAt: number;
  response?: RecommendationCandidateResponse;
  promise?: Promise<RecommendationCandidateResponse | null>;
};

const cache = new Map<string, CacheEntry>();

export class RecommendationCandidateClientError extends Error {
  readonly retryable: boolean;

  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = 'RecommendationCandidateClientError';
    this.retryable = retryable;
  }
}

function cacheKey(providerId: string, seedSignature: string) {
  return `${providerId}|${seedSignature}`;
}

function validCandidate(value: unknown): value is RecommendationCandidate {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<RecommendationCandidate>;
  return typeof candidate.contentFingerprintRef === 'string' &&
    (candidate.contentType === 'movie' || candidate.contentType === 'series') &&
    (candidate.reason === 'viewers_also_watched' || candidate.reason === 'trending_novacast') &&
    typeof candidate.behaviorScore === 'number' && Number.isFinite(candidate.behaviorScore) &&
    typeof candidate.trendScore === 'number' && Number.isFinite(candidate.trendScore) &&
    typeof candidate.affinityScore === 'number' && Number.isFinite(candidate.affinityScore) &&
    typeof candidate.velocity === 'number' && Number.isFinite(candidate.velocity) &&
    (candidate.scope === 'global' || candidate.scope === 'provider');
}

function parseResponse(value: unknown): RecommendationCandidateResponse | null {
  if (!value || typeof value !== 'object') return null;
  const body = value as { ok?: unknown; candidates?: unknown };
  if (body.ok !== true || !Array.isArray(body.candidates) || body.candidates.length > MAX_RESULTS) return null;
  const candidates = body.candidates.filter(validCandidate);
  if (candidates.length !== body.candidates.length) return null;
  return { ok: true, candidates, meta: (value as RecommendationCandidateResponse).meta };
}

async function requestNetwork(input: RecommendationCandidateRequest) {
  if (!analyticsConfig.endpoint) throw new RecommendationCandidateClientError('recommendation_endpoint_missing', false);
  const { deviceAuthHeaders } = await import('../device/deviceRegistration.ts');
  const response = await fetch(`${analyticsConfig.endpoint}/novapulse-recommendation-candidates`, {
    method: 'POST',
    headers: {
      apikey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '',
      Authorization: `Bearer ${process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? ''}`,
      'Content-Type': 'application/json',
      ...(await deviceAuthHeaders()),
    },
    body: JSON.stringify({
      providerId: input.providerId,
      seeds: input.seeds.slice(0, MAX_SEEDS),
      catalogFingerprints: input.catalogFingerprints.slice(0, MAX_CATALOG),
      supportedContentTypes: input.supportedContentTypes ?? ['movie', 'series'],
      limit: Math.min(input.limit ?? MAX_RESULTS, MAX_RESULTS),
    }),
  }).catch((error) => {
    throw new RecommendationCandidateClientError(error instanceof Error ? error.message : 'recommendation_network_error', true);
  });
  const payload = await response.json().catch(() => null);
  const parsed = parseResponse(payload);
  if (!response.ok || !parsed) {
    throw new RecommendationCandidateClientError('recommendation_candidates_failed', response.status >= 500 || response.status === 408 || response.status === 429);
  }
  return parsed;
}

export async function getRecommendationCandidates(
  input: RecommendationCandidateRequest,
  seedSignature: string,
  send: (request: RecommendationCandidateRequest) => Promise<RecommendationCandidateResponse> = requestNetwork,
) {
  if (!input.providerId || !seedSignature) return null;
  const key = cacheKey(input.providerId, seedSignature);
  const existing = cache.get(key);
  if (existing?.response && existing.expiresAt > Date.now()) return { ...existing.response, meta: { ...existing.response.meta, cacheHit: true } };
  if (existing?.promise) return existing.promise;
  const promise = send(input).then((response) => {
    const cachedResponse = { ...response, meta: { ...response.meta, cacheHit: false } };
    cache.set(key, { response: cachedResponse, expiresAt: Date.now() + CACHE_TTL_MS });
    return cachedResponse;
  }).catch(() => null).finally(() => {
    const current = cache.get(key);
    if (current?.promise === promise) cache.set(key, { response: current.response, expiresAt: current.expiresAt });
  });
  cache.set(key, { expiresAt: 0, promise });
  return promise;
}

export function clearRecommendationCandidateCache() {
  cache.clear();
}

export const NOVA_PULSE_RECOMMENDATION_CACHE_TTL_MS = CACHE_TTL_MS;
