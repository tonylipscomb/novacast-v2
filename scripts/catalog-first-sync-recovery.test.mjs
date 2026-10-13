import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  CATALOG_FIRST_SYNC_MAX_RETRIES,
  CATALOG_FIRST_SYNC_RETRY_DELAYS_MS,
  cancelCatalogFirstSyncRecovery,
  getCatalogFirstSyncRecoveryLifecycleToken,
  getCatalogFirstSyncRecoveryState,
  resetCatalogFirstSyncRecovery,
  resetCatalogFirstSyncRecoveryForTests,
  scheduleCatalogFirstSyncRecovery,
} from '../src/features/catalog/catalogFirstSyncRecovery.ts';
import { classifyCatalogMediaJobResults } from '../src/features/providers/catalogSyncJobAggregation.ts';

const moviesModel = readFileSync('src/features/movies/useMoviesScreenModel.ts', 'utf8');
const seriesModel = readFileSync('src/features/series/useSeriesScreenModel.ts', 'utf8');
const providerSync = readFileSync('src/features/providers/providerCatalogSync.ts', 'utf8');

test.beforeEach(() => {
  resetCatalogFirstSyncRecoveryForTests();
});

test.after(() => {
  resetCatalogFirstSyncRecoveryForTests();
});

test('schedules at most two bounded retries for a missing readable generation', () => {
  const retry = () => undefined;

  assert.deepEqual(
    scheduleCatalogFirstSyncRecovery({
      providerId: 'provider-a',
      mediaType: 'movie',
      readableGeneration: 0,
      retry,
    }),
    { attempts: 1, status: 'scheduled', nextRetryDelayMs: CATALOG_FIRST_SYNC_RETRY_DELAYS_MS[0] },
  );
  assert.deepEqual(
    scheduleCatalogFirstSyncRecovery({
      providerId: 'provider-a',
      mediaType: 'series',
      readableGeneration: 0,
      retry,
    }),
    { attempts: 1, status: 'scheduled', nextRetryDelayMs: CATALOG_FIRST_SYNC_RETRY_DELAYS_MS[0] },
  );

  resetCatalogFirstSyncRecoveryForTests();
  scheduleCatalogFirstSyncRecovery({ providerId: 'provider-a', mediaType: 'movie', readableGeneration: 0, retry });
  const state = getCatalogFirstSyncRecoveryState('provider-a');
  assert.equal(state.attempts, 1);
  assert.equal(CATALOG_FIRST_SYNC_MAX_RETRIES, 2);
});

test('does not retry when a readable generation exists', () => {
  assert.deepEqual(
    scheduleCatalogFirstSyncRecovery({
      providerId: 'provider-a',
      mediaType: 'movie',
      readableGeneration: 17,
      retry: () => undefined,
    }),
    { attempts: 0, status: 'idle', nextRetryDelayMs: null },
  );
});

test('terminal failures become exhausted without an unbounded retry loop', () => {
  const timers = [];
  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = ((callback, _delay) => {
    timers.push(callback);
    return timers.length;
  });

  try {
    const retry = () => undefined;
    scheduleCatalogFirstSyncRecovery({ providerId: 'provider-a', mediaType: 'movie', readableGeneration: 0, retry });
    timers.shift()();
    scheduleCatalogFirstSyncRecovery({ providerId: 'provider-a', mediaType: 'movie', readableGeneration: 0, retry });
    timers.shift()();
    assert.deepEqual(
      scheduleCatalogFirstSyncRecovery({ providerId: 'provider-a', mediaType: 'movie', readableGeneration: 0, retry }),
      { attempts: 2, status: 'exhausted', nextRetryDelayMs: null },
    );
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }
});

test('a successful readable generation resets the recovery state', () => {
  const timers = [];
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  globalThis.setTimeout = ((callback, _delay) => {
    timers.push(callback);
    return timers.length;
  });
  globalThis.clearTimeout = (() => undefined);

  try {
    scheduleCatalogFirstSyncRecovery({ providerId: 'provider-a', mediaType: 'series', readableGeneration: 0, retry: () => undefined });
    resetCatalogFirstSyncRecovery('provider-a');
    assert.deepEqual(getCatalogFirstSyncRecoveryState('provider-a'), {
      attempts: 0,
      status: 'idle',
      nextRetryDelayMs: null,
    });
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test('provider cancellation invalidates a pending retry and stale callback cannot revive it', () => {
  const timers = [];
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  globalThis.setTimeout = ((callback, _delay) => {
    timers.push(callback);
    return timers.length;
  });
  globalThis.clearTimeout = (() => undefined);

  try {
    let retryCalls = 0;
    const lifecycleToken = getCatalogFirstSyncRecoveryLifecycleToken('provider-a');
    scheduleCatalogFirstSyncRecovery({
      providerId: 'provider-a',
      mediaType: 'movie',
      readableGeneration: 0,
      retry: () => { retryCalls += 1; },
      lifecycleToken,
    });

    cancelCatalogFirstSyncRecovery('provider-a');
    timers[0]();

    assert.equal(retryCalls, 0);
    assert.deepEqual(getCatalogFirstSyncRecoveryState('provider-a'), {
      attempts: 0,
      status: 'idle',
      nextRetryDelayMs: null,
    });
    assert.notEqual(getCatalogFirstSyncRecoveryLifecycleToken('provider-a'), lifecycleToken);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test('a late readiness callback with an old lifecycle token cannot schedule provider work', () => {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  globalThis.setTimeout = (() => 1);
  globalThis.clearTimeout = (() => undefined);

  try {
    const lifecycleToken = getCatalogFirstSyncRecoveryLifecycleToken('provider-a');
    cancelCatalogFirstSyncRecovery('provider-a');
    const result = scheduleCatalogFirstSyncRecovery({
      providerId: 'provider-a',
      mediaType: 'series',
      readableGeneration: 0,
      retry: () => undefined,
      lifecycleToken,
    });
    assert.deepEqual(result, { attempts: 0, status: 'idle', nextRetryDelayMs: null });
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test('cancelling one provider does not cancel another provider retry', () => {
  const timers = [];
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  globalThis.setTimeout = ((callback, _delay) => {
    timers.push(callback);
    return timers.length;
  });
  globalThis.clearTimeout = (() => undefined);

  try {
    let providerBRetryCalls = 0;
    scheduleCatalogFirstSyncRecovery({
      providerId: 'provider-a',
      mediaType: 'movie',
      readableGeneration: 0,
      retry: () => undefined,
    });
    scheduleCatalogFirstSyncRecovery({
      providerId: 'provider-b',
      mediaType: 'series',
      readableGeneration: 0,
      retry: () => { providerBRetryCalls += 1; },
    });
    cancelCatalogFirstSyncRecovery('provider-a');
    timers[1]();
    assert.equal(providerBRetryCalls, 1);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test('a Series-only failure enters the provider recovery/error path', () => {
  const classified = classifyCatalogMediaJobResults(
    { status: 'fulfilled', value: undefined },
    { status: 'rejected', reason: new Error('series-timeout') },
    { status: 'fulfilled', value: undefined },
  );

  assert.equal(classified.movieOk, true);
  assert.equal(classified.seriesOk, false);
  assert.equal(classified.notifyProviderError, true);
});

test('Movies and Series Retry reset bounded recovery and request a fresh catalog sync', () => {
  for (const source of [moviesModel, seriesModel]) {
    assert.match(source, /resetCatalogFirstSyncRecovery\(activeProviderId\)/);
    assert.match(source, /syncCatalog\('catalog-user-retry'\)/);
    assert.match(source, /scheduleCatalogFirstSyncRecovery/);
    assert.match(source, /catalog-readiness-recovery/);
    assert.doesNotMatch(source, /resolveReadableCatalogGeneration[\s\S]{0,800}\.catch\(\(\) => undefined\)/);
    assert.match(source, /mounted = false/);
    assert.doesNotMatch(source, /mounted = false;[\s\S]{0,300}resetCatalogFirstSyncRecovery/);
  }
});

test('provider readiness exceptions enter the bounded recovery path with lifecycle validation', () => {
  assert.match(providerSync, /getCatalogFirstSyncRecoveryLifecycleToken\(input\.providerId\)/);
  assert.match(providerSync, /event: 'readiness-check-failed'/);
  assert.match(providerSync, /readableGeneration: 0/);
  assert.match(providerSync, /lifecycleToken/);
});
