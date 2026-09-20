import { assert, assertEquals, assertFalse, assertRejects } from 'jsr:@std/assert@1';
import { hashContentReference, hashProviderReference } from './analytics.ts';
import {
  buildRecommendationCandidates,
  MAX_CANDIDATE_SEEDS,
  validateCandidateRequest,
  type AffinityRow,
  type TrendRow,
} from './novapulseCandidates.ts';

const env = globalThis.Deno.env;

function request(overrides: Record<string, unknown> = {}) {
  return {
    providerId: 'provider-a',
    seeds: [{ fingerprint: 'movie|viewer seed|2024', contentType: 'movie', strength: 'complete' }],
    supportedContentTypes: ['movie', 'series'],
    limit: 30,
    catalogFingerprints: [{ token: 'movie-token-1', fingerprint: 'movie|candidate|2024', contentType: 'movie' }],
    ...overrides,
  };
}

Deno.test('bounded local fingerprints map deterministically to server HMAC references', async () => {
  env.set('ANALYTICS_HMAC_SECRET', 'candidate-test-secret');
  const first = await validateCandidateRequest(request());
  const second = await validateCandidateRequest(request());
  assertEquals(first.seeds[0].fingerprintRef, second.seeds[0].fingerprintRef);
  assertEquals(first.catalogFingerprints[0].fingerprintRef, second.catalogFingerprints[0].fingerprintRef);
  assertFalse(JSON.stringify(first).includes('candidate-test-secret'));
  assertFalse(JSON.stringify(first).includes('title'));
});

Deno.test('different local fingerprints produce different references in normal cases', async () => {
  env.set('ANALYTICS_HMAC_SECRET', 'candidate-test-secret');
  const first = await validateCandidateRequest(request());
  const second = await validateCandidateRequest(request({ seeds: [{ fingerprint: 'movie|other seed|2024', contentType: 'movie', strength: 'meaningful' }] }));
  assert(first.seeds[0].fingerprintRef !== second.seeds[0].fingerprintRef);
});

Deno.test('candidate request rejects over-limit seeds, malformed fingerprints, URLs, and raw title fields', async () => {
  env.set('ANALYTICS_HMAC_SECRET', 'candidate-test-secret');
  const seeds = Array.from({ length: MAX_CANDIDATE_SEEDS + 1 }, (_, index) => ({ fingerprint: `movie|seed-${index}`, contentType: 'movie' }));
  await assertRejects(() => validateCandidateRequest(request({ seeds })));
  await assertRejects(() => validateCandidateRequest(request({ seeds: [{ fingerprint: 'movie|bad\u0000value', contentType: 'movie' }] })));
  await assertRejects(() => validateCandidateRequest(request({ providerId: 'https://provider.example/player_api.php?username=x' })));
  await assertRejects(() => validateCandidateRequest(request({ title: 'raw title' })));
});

function rows() {
  const affinityRows: Array<{ seedIndex: number; row: AffinityRow }> = [
    { seedIndex: 0, row: { target_fingerprint_ref: 'c1_target', target_type: 'movie', co_watch_count: 4, unique_viewers: 4, weighted_score: 8, scope: 'provider' } },
    { seedIndex: 0, row: { target_fingerprint_ref: 'c1_seed', target_type: 'movie', co_watch_count: 20, unique_viewers: 20, weighted_score: 20, scope: 'provider' } },
    { seedIndex: 1, row: { target_fingerprint_ref: 'c1_target', target_type: 'movie', co_watch_count: 5, unique_viewers: 5, weighted_score: 6, scope: 'global' } },
    { seedIndex: 0, row: { target_fingerprint_ref: 'c1_weak', target_type: 'movie', co_watch_count: 1, unique_viewers: 1, weighted_score: 99, scope: 'provider' } },
  ];
  const trendRows: TrendRow[] = [
    { content_fingerprint_ref: 'c1_target', content_type: 'movie', unique_viewers: 5, trend_score: 40, trend_velocity: 2, scope: 'provider' },
    { content_fingerprint_ref: 'c1_trend', content_type: 'series', unique_viewers: 3, trend_score: 30, trend_velocity: 1, scope: 'global' },
    { content_fingerprint_ref: 'c1_suppressed', content_type: 'movie', unique_viewers: 2, trend_score: 100, trend_velocity: 10, scope: 'global' },
  ];
  return { affinityRows, trendRows };
}

Deno.test('supported affinity strengthens across seeds, dedupes, and rejects seed self-recommendation', async () => {
  env.set('ANALYTICS_HMAC_SECRET', 'candidate-test-secret');
  const input = await validateCandidateRequest(request({
    seeds: [
      { fingerprint: 'movie|viewer seed|2024', contentType: 'movie', strength: 'complete' },
      { fingerprint: 'movie|second seed|2024', contentType: 'movie', strength: 'repeat' },
    ],
    catalogFingerprints: [],
  }));
  const seedRef = input.seeds[0].fingerprintRef;
  const result = buildRecommendationCandidates({ request: { ...input, seeds: [...input.seeds, { ...input.seeds[0], fingerprintRef: seedRef }] }, ...rows() });
  assertEquals(result.filter((candidate) => candidate.contentFingerprintRef === 'c1_target').length, 1);
  assertEquals(result.find((candidate) => candidate.contentFingerprintRef === 'c1_target')?.reason, 'viewers_also_watched');
  assertFalse(result.some((candidate) => candidate.contentFingerprintRef === seedRef));
  assertFalse(result.some((candidate) => candidate.contentFingerprintRef === 'c1_weak'));
});

Deno.test('provider trends are preferred, global trends fill sparse provider data, and matches return only opaque local tokens', async () => {
  env.set('ANALYTICS_HMAC_SECRET', 'candidate-test-secret');
  const candidateFingerprint = 'movie|candidate|2024';
  const input = await validateCandidateRequest(request({ catalogFingerprints: [{ token: 'candidate-token', fingerprint: candidateFingerprint, contentType: 'movie' }] }));
  const candidateRef = await hashContentReference(`recommendation-fingerprint:${candidateFingerprint}`);
  const trendRows = rows().trendRows.map((row) => row.content_fingerprint_ref === 'c1_target' ? { ...row, content_fingerprint_ref: candidateRef! } : row);
  const result = buildRecommendationCandidates({ request: input, affinityRows: [], trendRows });
  const target = result.find((candidate) => candidate.catalogMatchToken === 'candidate-token');
  const trend = result.find((candidate) => candidate.contentFingerprintRef === 'c1_trend');
  assertEquals(target?.scope, 'provider');
  assertEquals(target?.catalogMatchToken, 'candidate-token');
  assertEquals(trend, undefined);
  assertEquals(result.length, 1);
});

Deno.test('empty aggregate data succeeds with an empty candidate set', async () => {
  env.set('ANALYTICS_HMAC_SECRET', 'candidate-test-secret');
  const input = await validateCandidateRequest({ seeds: [], limit: 30 });
  const result = buildRecommendationCandidates({ request: input, affinityRows: [], trendRows: [] });
  assertEquals(result, []);
});

Deno.test('candidate output contains no raw viewer identifiers or raw fingerprint text', async () => {
  env.set('ANALYTICS_HMAC_SECRET', 'candidate-test-secret');
  const input = await validateCandidateRequest(request({ catalogFingerprints: [] }));
  const result = buildRecommendationCandidates({ request: input, affinityRows: [{ seedIndex: 0, row: rows().affinityRows[0].row }], trendRows: [] });
  const serialized = JSON.stringify(result);
  assertFalse(serialized.includes('viewer seed'));
  assertFalse(serialized.includes('device_id'));
  assertFalse(serialized.includes('viewer-a'));
});

Deno.test('server HMAC helpers do not expose their secret', async () => {
  env.set('ANALYTICS_HMAC_SECRET', 'candidate-test-secret');
  const refs = await Promise.all([hashContentReference('recommendation-fingerprint:movie|x'), hashProviderReference('provider-a')]);
  assert(refs.every((ref) => typeof ref === 'string' && !ref.includes('candidate-test-secret')));
});
