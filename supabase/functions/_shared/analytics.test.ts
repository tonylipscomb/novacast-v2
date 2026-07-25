import { assert, assertEquals, assertRejects, assertThrows } from 'jsr:@std/assert@1';
import {
  EVENT_CATEGORIES,
  MAX_BATCH_EVENTS,
  MAX_BODY_BYTES,
  clampTimestamp,
  hashContentReference,
  hashProviderReference,
  validateEventName,
  validateMetadata,
} from './analytics.ts';

Deno.test('analytics event allow-list accepts approved events and rejects unknown events', () => {
  assertEquals(validateEventName('playback_started').category, 'playback');
  assertEquals(Object.keys(EVENT_CATEGORIES).includes('session_heartbeat'), false);
  assertThrows(() => validateEventName('session_heartbeat'), Error, 'invalid_event_name');
  assert(Object.keys(EVENT_CATEGORIES).length > 20);
});

Deno.test('analytics validation constants enforce Stage A request limits', () => {
  assertEquals(MAX_BATCH_EVENTS, 50);
  assertEquals(MAX_BODY_BYTES, 32 * 1024);
});

Deno.test('metadata allow-list rejects forbidden keys and arbitrary keys', () => {
  assertEquals(validateMetadata({ retry_count: 2, classification: 'timeout' }).retry_count, 2);
  assertThrows(() => validateMetadata({ password: 'secret' }), Error, 'forbidden_metadata');
  assertThrows(() => validateMetadata({ arbitrary: 'value' }), Error, 'forbidden_metadata');
  assertThrows(() => validateMetadata({ search_query: 'news' }), Error, 'forbidden_metadata');
});

Deno.test('metadata rejects oversized values, arrays, and deep objects', () => {
  assertThrows(() => validateMetadata({ classification: 'x'.repeat(161) }), Error, 'forbidden_metadata');
  assertThrows(() => validateMetadata({ result_count: [1, 2] }), Error, 'invalid_metadata');
  assertThrows(() => validateMetadata({ classification: { nested: { tooDeep: true } } }), Error, 'invalid_metadata');
  assertThrows(() => validateMetadata(Object.fromEntries(Array.from({ length: 13 }, (_, index) => [`k${index}`, index]))), Error, 'metadata_key_limit');
});

Deno.test('HMAC references are versioned, deterministic, and do not contain raw identifiers', async () => {
  const original = Deno.env.get('ANALYTICS_HMAC_SECRET');
  Deno.env.set('ANALYTICS_HMAC_SECRET', 'stage-a-test-secret');
  try {
    const provider = await hashProviderReference('provider-internal-id');
    const content = await hashContentReference('movie-123');
    assert(provider?.startsWith('p1_'));
    assert(content?.startsWith('c1_'));
    assert(!provider?.includes('provider-internal-id'));
    assert(!content?.includes('movie-123'));
    assertEquals(provider, await hashProviderReference('provider-internal-id'));
  } finally {
    if (original === undefined) Deno.env.delete('ANALYTICS_HMAC_SECRET');
    else Deno.env.set('ANALYTICS_HMAC_SECRET', original);
  }
});

Deno.test('timestamps use server time when absent and clamp outside the safe window', () => {
  const now = Date.parse('2026-07-24T12:00:00.000Z');
  assertEquals(clampTimestamp(undefined, now).getTime(), now);
  assertEquals(clampTimestamp('2020-01-01T00:00:00.000Z', now).getTime(), now - 24 * 60 * 60 * 1000);
  assertEquals(clampTimestamp('2030-01-01T00:00:00.000Z', now).getTime(), now + 5 * 60 * 1000);
  assertRejects(() => Promise.resolve().then(() => clampTimestamp('not-a-date', now)), Error, 'malformed_timestamp');
});
