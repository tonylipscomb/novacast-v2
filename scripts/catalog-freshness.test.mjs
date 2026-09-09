import assert from 'node:assert/strict';
import test from 'node:test';

import { CATALOG_FRESHNESS_MS, decideCatalogFreshness } from '../src/features/catalog/catalogFreshness.ts';

const now = 1_000_000;

test('catalog freshness stays fresh below the six-hour threshold', () => {
  assert.deepEqual(decideCatalogFreshness({ hasReadableGeneration: true, lastSuccessfulSyncAt: now - CATALOG_FRESHNESS_MS + 1, nowMs: now }), {
    ageMs: CATALOG_FRESHNESS_MS - 1,
    state: 'fresh',
    action: 'skip',
  });
});

test('catalog freshness schedules one background refresh at six hours or older', () => {
  assert.deepEqual(decideCatalogFreshness({ hasReadableGeneration: true, lastSuccessfulSyncAt: now - CATALOG_FRESHNESS_MS, nowMs: now }), {
    ageMs: CATALOG_FRESHNESS_MS,
    state: 'stale',
    action: 'background_refresh',
  });
  assert.equal(decideCatalogFreshness({ hasReadableGeneration: true, lastSuccessfulSyncAt: null, nowMs: now }).action, 'background_refresh');
});

test('missing readable generation preserves bootstrap behavior', () => {
  assert.deepEqual(decideCatalogFreshness({ hasReadableGeneration: false, lastSuccessfulSyncAt: now, nowMs: now }), {
    ageMs: null,
    state: 'missing',
    action: 'bootstrap',
  });
});
