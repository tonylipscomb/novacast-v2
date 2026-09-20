import { assert, assertEquals, assertRejects } from 'jsr:@std/assert@1';
import { validateRecommendationEvent } from './recommendationEvents.ts';

const env = globalThis.Deno.env;

function valid(overrides: Record<string, unknown> = {}) {
  return {
    eventType: 'meaningful_watch',
    contentType: 'movie',
    fingerprint: 'movie|example|2024',
    providerId: 'provider-a',
    providerContentId: 'movie-1',
    sessionId: 'session-1',
    occurredAt: '2026-09-20T00:00:00.000Z',
    watchDurationMs: 300000,
    contentDurationMs: 1800000,
    progressBucket: 'meaningful',
    idempotencyKey: 'session-1|movie|example|2024|meaningful_watch|meaningful',
    ...overrides,
  };
}

Deno.test('valid recommendation events validate and persist only HMAC references', async () => {
  env.set('ANALYTICS_HMAC_SECRET', 'test-secret');
  const result = await validateRecommendationEvent(valid(), Date.parse('2026-09-20T00:05:00.000Z'));
  assert(result.refs.providerRef?.startsWith('p1_'));
  assert(result.refs.contentFingerprintRef?.startsWith('c1_'));
  assert(!JSON.stringify(result).includes('example'));
});

Deno.test('unknown types, invalid content, negative duration, oversized fields, and live completion reject', async () => {
  env.set('ANALYTICS_HMAC_SECRET', 'test-secret');
  await assertRejects(() => validateRecommendationEvent(valid({ eventType: 'unknown' })));
  await assertRejects(() => validateRecommendationEvent(valid({ contentType: 'unknown' })));
  await assertRejects(() => validateRecommendationEvent(valid({ watchDurationMs: -1 })));
  await assertRejects(() => validateRecommendationEvent(valid({ fingerprint: 'x'.repeat(513) })));
  await assertRejects(() => validateRecommendationEvent(valid({ contentType: 'live', eventType: 'complete' })));
});

Deno.test('unexpected raw metadata and impossible timestamps reject', async () => {
  env.set('ANALYTICS_HMAC_SECRET', 'test-secret');
  await assertRejects(() => validateRecommendationEvent(valid({ title: 'Secret title' })));
  await assertRejects(() => validateRecommendationEvent(valid({ occurredAt: '2099-01-01T00:00:00.000Z' }), Date.parse('2026-09-20T00:00:00.000Z')));
  assertEquals((await validateRecommendationEvent(valid({ eventType: 'play_start', progressBucket: undefined }))).eventType, 'play_start');
});
