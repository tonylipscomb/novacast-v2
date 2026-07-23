import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FALLBACK_PROVIDER_CATEGORY_NAME,
  fallbackProviderCategoryId,
  normalizeProviderCategory,
  normalizeProviderCategoryId,
  normalizeProviderCategoryText,
} from '../src/features/providers/categoryNormalization.ts';
import { sanitizeCategoryCountIndex } from '../src/features/providers/categoryCountIndexStore.ts';

test('category text decodes entities, removes controls, and preserves internal separators', () => {
  assert.equal(normalizeProviderCategoryText('  US\u0000 MLB &amp; Sports  '), 'US MLB & Sports');
  assert.equal(normalizeProviderCategoryText('--- News / Events ---'), 'News / Events');
});

test('quality and numeric category names remain valid when the provider supplies an ID', () => {
  assert.equal(normalizeProviderCategory({ contentType: 'live', id: 0, name: 'HD' }).name, 'HD');
  assert.equal(normalizeProviderCategory({ contentType: 'movie', id: '6', name: '6' }).name, '6');
  assert.equal(normalizeProviderCategoryId('  6  '), '6');
});

test('malformed names without a provider mapping use the content-type fallback', () => {
  const numeric = normalizeProviderCategory({ contentType: 'series', id: null, name: '6' });
  const quality = normalizeProviderCategory({ contentType: 'movie', id: undefined, name: 'HD' });
  const object = normalizeProviderCategory({ contentType: 'live', id: undefined, name: {} });

  assert.deepEqual(numeric, {
    id: fallbackProviderCategoryId('series'),
    name: FALLBACK_PROVIDER_CATEGORY_NAME,
    hasProviderId: false,
    usedFallbackName: true,
    reason: 'numeric-without-id',
  });
  assert.equal(quality.reason, 'quality-without-id');
  assert.equal(object.reason, 'object');
});

test('empty and punctuation-only categories are normalized without throwing', () => {
  assert.equal(normalizeProviderCategory({ contentType: 'movie', id: '1', name: '' }).name, FALLBACK_PROVIDER_CATEGORY_NAME);
  assert.equal(normalizeProviderCategory({ contentType: 'movie', id: '2', name: '***' }).name, FALLBACK_PROVIDER_CATEGORY_NAME);
});

test('malformed cached count records are sanitized without crossing provider scope', () => {
  const sanitized = sanitizeCategoryCountIndex('provider-a', 'movie', {
    providerId: 'provider-b',
    mediaType: 'series',
    updatedAt: Number.NaN,
    counts: { ' 1 ': 4.8, '': 9, invalid: -2, other: 'not-a-number', empty: '', nullValue: null },
  });

  assert.deepEqual(sanitized.index, {
    providerId: 'provider-a',
    mediaType: 'movie',
    updatedAt: 0,
    counts: { '1': 4 },
  });
  assert.equal(sanitized.changed, true);
});
