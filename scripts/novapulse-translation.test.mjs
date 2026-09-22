import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const client = fs.readFileSync(new URL('../src/features/novapulse/novaPulseTranslationClient.ts', import.meta.url), 'utf8');
const enrichment = fs.readFileSync(new URL('../src/features/novapulse/novaPulseEnrichment.ts', import.meta.url), 'utf8');
const presentation = fs.readFileSync(new URL('../src/features/novapulse/novaPulsePresentation.ts', import.meta.url), 'utf8');
const edge = fs.readFileSync(new URL('../supabase/functions/novapulse-description-translate/index.ts', import.meta.url), 'utf8');

test('translation cache key includes provider, media, item, source hash, and language', () => {
  assert.match(client, /providerId, input\.mediaType, input\.itemId, hash, input\.targetLanguage/);
  assert.match(client, /AsyncStorage/);
  assert.match(client, /CACHE_LIMIT = 64/);
});

test('translation requests are bounded, authenticated, and deduplicated', () => {
  assert.match(client, /EXPO_PUBLIC_NOVAPULSE_TRANSLATION_ENABLED/);
  assert.match(client, /if \(!NOVA_PULSE_TRANSLATION_ENABLED\) return null/);
  assert.match(client, /deviceAuthHeaders/);
  assert.match(client, /AbortController/);
  assert.match(client, /inFlight/);
  assert.match(client, /MAX_TRANSLATION_MAX_LENGTH|NOVA_PULSE_TRANSLATION_MAX_LENGTH/);
});

test('enrichment carries translations without changing catalog identity', () => {
  assert.match(enrichment, /translateNovaPulseDescription/);
  assert.match(enrichment, /translations\.set/);
  assert.match(presentation, /input\.translations/);
  assert.match(presentation, /sourceItemId/);
  assert.match(presentation, /selectDescription\(localDescription, cachedDescription\) \?\? selectDescription\(localDescription, translatedDescription\)/);
});

test('Edge Function requires device auth and keeps Google credential server-side', () => {
  assert.match(edge, /authenticateDevice/);
  assert.match(edge, /GOOGLE_CLOUD_TRANSLATE_API_KEY/);
  assert.doesNotMatch(edge, /EXPO_PUBLIC|service_role/);
  assert.match(edge, /consume_analytics_rate_limit/);
});
