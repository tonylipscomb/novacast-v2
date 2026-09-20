import { AnalyticsValidationError, hashContentReference, hashProviderReference, requiredString } from './analytics.ts';

export const MAX_CANDIDATE_SEEDS = 12;
export const MAX_AFFINITY_ROWS_PER_SEED = 20;
export const MAX_TREND_ROWS = 50;
export const MAX_RETURNED_CANDIDATES = 30;
export const MAX_CATALOG_FINGERPRINTS = 200;
export const MAX_CANDIDATE_BODY_BYTES = 160 * 1024;
export const CANDIDATE_RATE_LIMIT_PER_HOUR = 12;

export const CANDIDATE_CONTENT_TYPES = ['movie', 'series', 'episode', 'live'] as const;
export type CandidateContentType = typeof CANDIDATE_CONTENT_TYPES[number];
export const CANDIDATE_SEED_STRENGTHS = ['repeat', 'complete', 'meaningful', 'favorite', 'watchlist'] as const;
export type CandidateSeedStrength = typeof CANDIDATE_SEED_STRENGTHS[number];

const ALLOWED_REQUEST_KEYS = new Set(['providerId', 'providerRef', 'seeds', 'supportedContentTypes', 'limit', 'catalogFingerprints']);

export type CandidateSeed = {
  index: number;
  fingerprint: string;
  fingerprintRef: string;
  contentType: CandidateContentType;
  strength: CandidateSeedStrength;
  weight: number;
  correlationToken: string;
};

export type CatalogFingerprint = {
  token: string;
  fingerprintRef: string;
  contentType: CandidateContentType;
};

export type CandidateRequest = {
  providerRef?: string;
  seeds: CandidateSeed[];
  supportedContentTypes: CandidateContentType[];
  limit: number;
  catalogFingerprints: CatalogFingerprint[];
};

const strengthWeight: Record<CandidateSeedStrength, number> = {
  repeat: 5,
  complete: 4,
  meaningful: 3,
  favorite: 2,
  watchlist: 2,
};

function enumValue<T extends readonly string[]>(value: unknown, values: T, category: string): T[number] {
  const text = requiredString(value, 48, category);
  if (!values.includes(text)) throw new AnalyticsValidationError(category);
  return text as T[number];
}

function safeFingerprint(value: unknown) {
  const fingerprint = requiredString(value, 512, 'invalid_fingerprint').trim();
  if (!fingerprint || /[\u0000-\u001f\u007f]/.test(fingerprint)) throw new AnalyticsValidationError('invalid_fingerprint');
  return fingerprint;
}

function safeProviderId(value: unknown) {
  const providerId = requiredString(value, 256, 'invalid_provider_reference').trim();
  if (!providerId || /:\/\//.test(providerId) || /(?:username|password|passwd|token|secret)\s*[=:]/i.test(providerId)) {
    throw new AnalyticsValidationError('invalid_provider_reference');
  }
  return providerId;
}

function seedWeight(strength: CandidateSeedStrength, occurredAt: unknown) {
  if (occurredAt == null) return strengthWeight[strength];
  const raw = requiredString(occurredAt, 80, 'invalid_seed_timestamp');
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed) || parsed > Date.now() + 5 * 60_000 || parsed < Date.now() - 90 * 24 * 60 * 60_000) {
    throw new AnalyticsValidationError('invalid_seed_timestamp');
  }
  const ageDays = Math.max(0, (Date.now() - parsed) / (24 * 60 * 60_000));
  return strengthWeight[strength] * Math.max(0.5, 1 - ageDays / 90);
}

async function hashFingerprint(fingerprint: string) {
  return await hashContentReference(`recommendation-fingerprint:${fingerprint}`) ?? '';
}

export async function validateCandidateRequest(input: unknown): Promise<CandidateRequest> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AnalyticsValidationError('invalid_field_type');
  const body = input as Record<string, unknown>;
  for (const key of Object.keys(body)) if (!ALLOWED_REQUEST_KEYS.has(key)) throw new AnalyticsValidationError('unexpected_field');

  let providerRef: string | undefined;
  if (body.providerRef !== undefined && body.providerRef !== null) {
    providerRef = requiredString(body.providerRef, 96, 'invalid_provider_reference');
    if (!/^p1_[0-9a-f]{64}$/.test(providerRef)) throw new AnalyticsValidationError('invalid_provider_reference');
  } else if (body.providerId !== undefined && body.providerId !== null) {
    providerRef = await hashProviderReference(safeProviderId(body.providerId)) ?? undefined;
  }

  const rawSeeds = body.seeds === undefined ? [] : body.seeds;
  if (!Array.isArray(rawSeeds)) throw new AnalyticsValidationError('invalid_seed_type');
  if (rawSeeds.length > MAX_CANDIDATE_SEEDS) throw new AnalyticsValidationError('seed_limit');
  const seeds: CandidateSeed[] = [];
  for (let index = 0; index < rawSeeds.length; index += 1) {
    const raw = rawSeeds[index];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new AnalyticsValidationError('invalid_seed_type');
    const seed = raw as Record<string, unknown>;
    for (const key of Object.keys(seed)) if (!['fingerprint', 'contentType', 'strength', 'occurredAt'].includes(key)) throw new AnalyticsValidationError('unexpected_seed_field');
    const fingerprint = safeFingerprint(seed.fingerprint);
    const contentType = enumValue(seed.contentType, CANDIDATE_CONTENT_TYPES, 'invalid_content_type');
    const strength = enumValue(seed.strength ?? 'meaningful', CANDIDATE_SEED_STRENGTHS, 'invalid_seed_strength');
    seeds.push({
      index,
      fingerprint,
      fingerprintRef: await hashFingerprint(fingerprint),
      contentType,
      strength,
      weight: seedWeight(strength, seed.occurredAt),
      correlationToken: `seed-${index}`,
    });
  }

  const rawTypes = body.supportedContentTypes === undefined ? CANDIDATE_CONTENT_TYPES : body.supportedContentTypes;
  if (!Array.isArray(rawTypes) || rawTypes.length > CANDIDATE_CONTENT_TYPES.length) throw new AnalyticsValidationError('invalid_content_type');
  const supportedContentTypes = [...new Set(rawTypes.map((value) => enumValue(value, CANDIDATE_CONTENT_TYPES, 'invalid_content_type')))];
  const limit = body.limit === undefined ? MAX_RETURNED_CANDIDATES : body.limit;
  if (!Number.isInteger(limit) || Number(limit) < 1 || Number(limit) > MAX_RETURNED_CANDIDATES) throw new AnalyticsValidationError('invalid_limit');

  const rawCatalog = body.catalogFingerprints === undefined ? [] : body.catalogFingerprints;
  if (!Array.isArray(rawCatalog) || rawCatalog.length > MAX_CATALOG_FINGERPRINTS) throw new AnalyticsValidationError('catalog_fingerprint_limit');
  const catalogFingerprints: CatalogFingerprint[] = [];
  for (const raw of rawCatalog) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new AnalyticsValidationError('invalid_catalog_fingerprint');
    const catalog = raw as Record<string, unknown>;
    for (const key of Object.keys(catalog)) if (!['token', 'fingerprint', 'contentType'].includes(key)) throw new AnalyticsValidationError('unexpected_catalog_field');
    const token = requiredString(catalog.token, 96, 'invalid_catalog_token').trim();
    if (!token || /[\u0000-\u001f\u007f]/.test(token)) throw new AnalyticsValidationError('invalid_catalog_token');
    const fingerprint = safeFingerprint(catalog.fingerprint);
    catalogFingerprints.push({ token, fingerprintRef: await hashFingerprint(fingerprint), contentType: enumValue(catalog.contentType, CANDIDATE_CONTENT_TYPES, 'invalid_content_type') });
  }

  return { providerRef, seeds, supportedContentTypes, limit: Number(limit), catalogFingerprints };
}

export type AffinityRow = {
  target_fingerprint_ref: string;
  target_type: CandidateContentType;
  co_watch_count: number;
  unique_viewers: number;
  weighted_score: number;
  scope: 'global' | 'provider';
};

export type TrendRow = {
  content_fingerprint_ref: string;
  content_type: CandidateContentType;
  unique_viewers: number;
  trend_score: number;
  trend_velocity: number;
  scope: 'global' | 'provider';
};

export type RecommendationCandidate = {
  contentFingerprintRef: string;
  contentType: CandidateContentType;
  reason: 'viewers_also_watched' | 'trending_novacast';
  behaviorScore: number;
  trendScore: number;
  affinityScore: number;
  velocity: number;
  supportBucket: 'supported' | 'strong' | 'established';
  scope: 'global' | 'provider';
  seedCorrelationToken?: string;
  catalogMatchToken?: string;
  candidateScore: number;
};

function supportBucket(uniqueViewers: number) {
  return uniqueViewers >= 10 ? 'established' as const : uniqueViewers >= 5 ? 'strong' as const : 'supported' as const;
}

export function buildRecommendationCandidates(input: {
  request: CandidateRequest;
  affinityRows: Array<{ seedIndex: number; row: AffinityRow }>;
  trendRows: TrendRow[];
}) {
  const seedRefs = new Set(input.request.seeds.map((seed) => seed.fingerprintRef));
  const catalogMap = new Map(input.request.catalogFingerprints.map((entry) => [`${entry.fingerprintRef}|${entry.contentType}`, entry.token]));
  const candidates = new Map<string, RecommendationCandidate & { seedIndexes: Set<number>; support: number }>();
  const allowed = new Set(input.request.supportedContentTypes);

  for (const { seedIndex, row } of input.affinityRows.slice(0, MAX_CANDIDATE_SEEDS * MAX_AFFINITY_ROWS_PER_SEED)) {
    if (!allowed.has(row.target_type) || row.unique_viewers < 2 || row.co_watch_count < 2) continue;
    const seed = input.request.seeds[seedIndex];
    if (!seed || seedRefs.has(row.target_fingerprint_ref)) continue;
    const key = `${row.target_fingerprint_ref}|${row.target_type}`;
    const current = candidates.get(key) ?? {
      contentFingerprintRef: row.target_fingerprint_ref,
      contentType: row.target_type,
      reason: 'viewers_also_watched',
      behaviorScore: 0,
      trendScore: 0,
      affinityScore: 0,
      velocity: 0,
      supportBucket: supportBucket(row.unique_viewers),
      scope: row.scope,
      seedCorrelationToken: seed.correlationToken,
      candidateScore: 0,
      seedIndexes: new Set<number>(),
      support: row.unique_viewers,
    };
    current.affinityScore += row.weighted_score * seed.weight;
    current.behaviorScore += row.weighted_score * seed.weight;
    current.seedIndexes.add(seedIndex);
    current.support = Math.max(current.support, row.unique_viewers);
    if ((row.scope === 'provider' ? 1 : 0) > (current.scope === 'provider' ? 1 : 0)) current.scope = row.scope;
    if ((seedIndex < Number(current.seedCorrelationToken?.slice(5) ?? 999))) current.seedCorrelationToken = seed.correlationToken;
    current.supportBucket = supportBucket(current.support);
    candidates.set(key, current);
  }

  for (const row of input.trendRows.slice(0, MAX_TREND_ROWS)) {
    if (!allowed.has(row.content_type) || row.unique_viewers < 3 || seedRefs.has(row.content_fingerprint_ref)) continue;
    const key = `${row.content_fingerprint_ref}|${row.content_type}`;
    const current = candidates.get(key) ?? {
      contentFingerprintRef: row.content_fingerprint_ref,
      contentType: row.content_type,
      reason: 'trending_novacast',
      behaviorScore: 0,
      trendScore: 0,
      affinityScore: 0,
      velocity: 0,
      supportBucket: supportBucket(row.unique_viewers),
      scope: row.scope,
      candidateScore: 0,
      seedIndexes: new Set<number>(),
      support: row.unique_viewers,
    };
    current.trendScore = Math.max(current.trendScore, row.trend_score);
    current.velocity = Math.max(current.velocity, row.trend_velocity);
    current.support = Math.max(current.support, row.unique_viewers);
    if ((row.scope === 'provider' ? 1 : 0) > (current.scope === 'provider' ? 1 : 0)) current.scope = row.scope;
    if (current.affinityScore === 0) current.reason = 'trending_novacast';
    current.supportBucket = supportBucket(current.support);
    candidates.set(key, current);
  }

  const result = [...candidates.values()].map((candidate) => {
    candidate.candidateScore = candidate.behaviorScore + candidate.seedIndexes.size * 5 + candidate.trendScore * 0.1 + candidate.velocity * 0.5;
    candidate.reason = candidate.affinityScore > 0 ? 'viewers_also_watched' : 'trending_novacast';
    const match = catalogMap.get(`${candidate.contentFingerprintRef}|${candidate.contentType}`);
    if (match) candidate.catalogMatchToken = match;
    return candidate;
  }).sort((a, b) => b.candidateScore - a.candidateScore || b.behaviorScore - a.behaviorScore || a.contentFingerprintRef.localeCompare(b.contentFingerprintRef));

  const resolved = input.request.catalogFingerprints.length
    ? result.filter((candidate) => candidate.catalogMatchToken)
    : result;
  return resolved.slice(0, input.request.limit).map(({ seedIndexes: _seedIndexes, support: _support, candidateScore: _candidateScore, ...candidate }) => candidate);
}
