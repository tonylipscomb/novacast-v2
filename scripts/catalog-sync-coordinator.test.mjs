import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCatalogSyncKey,
  cancelCatalogSync,
  clearCatalogSyncCoordinatorForTests,
  createCatalogProgressThrottle,
  getCatalogSyncCancelToken,
  getCatalogSyncJobStatus,
  invalidateCatalogSyncForProvider,
  isCatalogSyncRunning,
  processTimeBudgeted,
  runCatalogSyncNow,
  scheduleCatalogSync,
} from '../src/features/catalog/index.ts';

test.beforeEach(() => {
  clearCatalogSyncCoordinatorForTests();
});

test.afterEach(() => {
  clearCatalogSyncCoordinatorForTests();
});

test('duplicate schedule shares one promise', async () => {
  const key = buildCatalogSyncKey('provider-a', 'movie');
  let runs = 0;

  const runner = async () => {
    runs += 1;
    await new Promise((resolve) => setTimeout(resolve, 20));
  };

  const first = scheduleCatalogSync(key, runner);
  const second = scheduleCatalogSync(key, runner);

  assert.equal(first, second);
  await first;
  assert.equal(runs, 1);
});

test('movie and series sync jobs are independent', async () => {
  const movieKey = buildCatalogSyncKey('provider-a', 'movie');
  const seriesKey = buildCatalogSyncKey('provider-a', 'series');
  const seen = [];

  const moviePromise = runCatalogSyncNow(movieKey, async () => {
    seen.push('movie');
    await new Promise((resolve) => setTimeout(resolve, 15));
  });
  const seriesPromise = runCatalogSyncNow(seriesKey, async () => {
    seen.push('series');
    await new Promise((resolve) => setTimeout(resolve, 15));
  });

  assert.notEqual(moviePromise, seriesPromise);
  assert.ok(isCatalogSyncRunning('provider-a', 'movie'));
  assert.ok(isCatalogSyncRunning('provider-a', 'series'));

  await Promise.all([moviePromise, seriesPromise]);
  assert.deepEqual(seen.sort(), ['movie', 'series']);
});

test('provider invalidate cancels stale runs', async () => {
  const key = buildCatalogSyncKey('provider-a', 'movie');
  const tokenAtStart = getCatalogSyncCancelToken(key);
  let staleDuringRun = false;

  const promise = runCatalogSyncNow(key, async () => {
    invalidateCatalogSyncForProvider('provider-a');
    staleDuringRun = tokenAtStart.isStale();
    await new Promise((resolve) => setTimeout(resolve, 10));
  });

  await promise;
  assert.equal(staleDuringRun, true);
  assert.equal(getCatalogSyncJobStatus('provider-a', 'movie').status, 'cancelled');
});

test('failure releases lock so second run works', async () => {
  const key = buildCatalogSyncKey('provider-a', 'movie');
  let runs = 0;

  await assert.rejects(
    runCatalogSyncNow(key, async () => {
      runs += 1;
      throw new Error('sync failed');
    }),
    /sync failed/,
  );

  assert.equal(isCatalogSyncRunning('provider-a', 'movie'), false);
  assert.equal(getCatalogSyncJobStatus('provider-a', 'movie').status, 'failed');

  await runCatalogSyncNow(key, async () => {
    runs += 1;
  });

  assert.equal(runs, 2);
  assert.equal(getCatalogSyncJobStatus('provider-a', 'movie').status, 'completed');
});

test('completed sync can run again', async () => {
  const key = buildCatalogSyncKey('provider-a', 'series');
  let runs = 0;

  await runCatalogSyncNow(key, async () => {
    runs += 1;
  });
  assert.equal(getCatalogSyncJobStatus('provider-a', 'series').status, 'completed');

  await runCatalogSyncNow(key, async () => {
    runs += 1;
  });

  assert.equal(runs, 2);
  assert.equal(getCatalogSyncJobStatus('provider-a', 'series').status, 'completed');
});

test('processTimeBudgeted yields across multiple chunks', async () => {
  const items = Array.from({ length: 200 }, (_, index) => index);
  const result = await processTimeBudgeted(
    items,
    () => {
      const start = Date.now();
      while (Date.now() - start < 2) {
        // burn a little sync time per item
      }
    },
    {
      targetMs: 1,
      hardMs: 25,
      maxItems: 5,
      minItems: 2,
    },
  );

  assert.equal(result.processed, 200);
  assert.ok(result.chunks >= 2, `expected multiple chunks, got ${result.chunks}`);
  assert.ok(result.maxChunkMs >= 0);
});

test('processTimeBudgeted reports chunk timing under hard budget with tiny targets', async () => {
  const items = Array.from({ length: 120 }, (_, index) => index);
  const chunkMsValues = [];

  const result = await processTimeBudgeted(
    items,
    () => {},
    {
      targetMs: 0,
      hardMs: 100,
      maxItems: 10,
      minItems: 4,
      onChunk: ({ chunkMs }) => {
        chunkMsValues.push(chunkMs);
      },
    },
  );

  assert.equal(result.processed, 120);
  assert.ok(result.chunks >= 2);
  assert.ok(chunkMsValues.every((chunkMs) => chunkMs <= 100));
});

test('progress throttle skips unchanged snapshots and rate limits writes', async () => {
  const writes = [];
  const throttle = createCatalogProgressThrottle({
    intervalMs: 100,
    write: (snapshot) => {
      writes.push(snapshot);
    },
  });

  throttle.publish({ phase: 'categories', done: 1 });
  assert.equal(writes.length, 1);

  throttle.publish({ phase: 'categories', done: 1 });
  assert.equal(writes.length, 1, 'unchanged snapshot should not write');

  throttle.publish({ phase: 'categories', done: 2 });
  assert.equal(writes.length, 1, 'rate limit should defer second distinct write');

  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal(writes.length, 2, 'deferred write should flush after interval');

  throttle.flush();
  assert.equal(writes.length, 2, 'flush with no pending should not duplicate');
});

test('cancelCatalogSync bumps generation for matching media type', async () => {
  const movieKey = buildCatalogSyncKey('provider-a', 'movie');
  const seriesKey = buildCatalogSyncKey('provider-a', 'series');
  const movieToken = getCatalogSyncCancelToken(movieKey);
  const seriesToken = getCatalogSyncCancelToken(seriesKey);

  cancelCatalogSync('provider-a', 'movie');

  assert.equal(movieToken.isStale(), true);
  assert.equal(seriesToken.isStale(), false);
});

test('large category processing stays incremental under time budget', async () => {
  const items = Array.from({ length: 9000 }, (_, index) => index);
  const chunkSizes = [];

  const result = await processTimeBudgeted(
    items,
    () => {
      // Simulate light per-item work.
      for (let i = 0; i < 20; i += 1) {
        Math.sqrt(i);
      }
    },
    {
      targetMs: 5,
      hardMs: 40,
      maxItems: 80,
      minItems: 8,
      onChunk: ({ chunkItems }) => {
        chunkSizes.push(chunkItems);
      },
    },
  );

  assert.equal(result.processed, 9000);
  assert.ok(result.chunks > 50, `expected many chunks, got ${result.chunks}`);
  assert.ok(chunkSizes.every((size) => size <= 80));
  assert.ok(result.maxChunkMs <= 100, `maxChunkMs ${result.maxChunkMs} exceeded hard ceiling`);
});
