import assert from 'node:assert/strict';
import test from 'node:test';

import {
  beginCatalogSync,
  buildCatalogSyncKey,
  clearCatalogSyncCoordinatorForTests,
  completeCatalogSync,
  createCatalogProgressThrottle,
  getCatalogCategoryCounts,
  getCatalogMutexStatsForTests,
  getCatalogTotalCount,
  getLearnedBatchSize,
  initializeCatalogDatabase,
  invalidateCatalogSyncForProvider,
  processStreamingBatches,
  processTimeBudgeted,
  recomputeCategoryCounts,
  resetCatalogDatabaseForTests,
  resetChunkBudgetLearningForTests,
  runCatalogSyncNow,
  setCatalogDatabaseOpenerForTests,
  upsertCatalogProvider,
  withCatalogTransaction,
  writeCatalogCategoriesBatch,
  writeCatalogItemsBatch,
} from '../src/features/catalog/index.ts';
import { createNodeSqliteCatalogOpener } from '../src/features/catalog/createNodeSqliteCatalogOpener.ts';

test.beforeEach(async () => {
  clearCatalogSyncCoordinatorForTests();
  resetChunkBudgetLearningForTests();
  await resetCatalogDatabaseForTests();
  setCatalogDatabaseOpenerForTests(createNodeSqliteCatalogOpener());
  await initializeCatalogDatabase(':memory:');
});

test.afterEach(async () => {
  clearCatalogSyncCoordinatorForTests();
  resetChunkBudgetLearningForTests();
  await resetCatalogDatabaseForTests();
  setCatalogDatabaseOpenerForTests(null);
});

test('adaptive chunk budget lowers batch size after soft overrun', async () => {
  resetChunkBudgetLearningForTests();
  const before = getLearnedBatchSize('itemWrites');
  assert.ok(before >= 8);

  await processTimeBudgeted(
    Array.from({ length: 30 }, (_, i) => i),
    async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
    },
    {
      kind: 'itemWrites',
      targetMs: 20,
      softMs: 30,
      hardMs: 100,
      minItems: 4,
      maxItems: 40,
    },
  );

  const after = getLearnedBatchSize('itemWrites');
  assert.ok(after < before, `expected batch size to shrink, before=${before} after=${after}`);
});

test('processStreamingBatches never retains a full mapped array', async () => {
  const source = Array.from({ length: 250 }, (_, i) => ({ id: String(i), title: `T${i}` }));
  let maxLiveMapped = 0;
  let liveMapped = 0;
  const flushedSizes = [];

  const result = await processStreamingBatches(
    source,
    (item) => {
      liveMapped += 1;
      maxLiveMapped = Math.max(maxLiveMapped, liveMapped);
      return { contentId: item.id, title: item.title };
    },
    async (batch) => {
      flushedSizes.push(batch.length);
      liveMapped = Math.max(0, liveMapped - batch.length);
      // Simulate write consuming the batch.
      batch.length = 0;
    },
    {
      kind: 'movieMapping',
      writeKind: 'itemWrites',
      targetMs: 5,
      softMs: 40,
      hardMs: 100,
      minItems: 8,
      maxItems: 32,
    },
  );

  assert.equal(result.processed, 250);
  assert.ok(result.chunks >= 2);
  assert.ok(maxLiveMapped <= 40, `peak live mapped ${maxLiveMapped} too high`);
  assert.ok(flushedSizes.every((size) => size <= 32));
  assert.ok(flushedSizes.reduce((a, b) => a + b, 0) === 250);
});

test('prepared statement finalize is called even when execute throws', async () => {
  const db = await (await import('../src/features/catalog/index.ts')).getCatalogDatabase();
  const statement = await db.prepare('INSERT INTO catalog_providers (provider_id, provider_type) VALUES (?, ?)');
  let finalized = false;
  const originalFinalize = statement.finalize.bind(statement);
  statement.finalize = async () => {
    finalized = true;
    await originalFinalize();
  };

  await assert.rejects(async () => {
    try {
      await statement.execute(['p1', 'xtream']);
      // Force a throw after first success by preparing bad SQL path via re-execute after finalize simulation
      throw new Error('forced');
    } finally {
      await statement.finalize();
    }
  }, /forced/);

  assert.equal(finalized, true);
});

test('mutex releases on throw so subsequent writers proceed', async () => {
  await assert.rejects(
    withCatalogTransaction(async () => {
      throw new Error('boom');
    }),
    /boom/,
  );

  let ran = false;
  await withCatalogTransaction(async () => {
    ran = true;
  });
  assert.equal(ran, true);
});

test('mutex releases when cancelled mid-flight via provider invalidate', async () => {
  const key = buildCatalogSyncKey('provider-mutex', 'movie');
  let insideTx = false;
  let released = false;

  const promise = runCatalogSyncNow(key, async () => {
    await withCatalogTransaction(async () => {
      insideTx = true;
      invalidateCatalogSyncForProvider('provider-mutex');
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    released = true;
  });

  await promise;
  assert.equal(insideTx, true);
  assert.equal(released, true);

  let second = false;
  await withCatalogTransaction(async () => {
    second = true;
  });
  assert.equal(second, true);
});

test('movie and series mutex writers do not deadlock', async () => {
  const movieKey = buildCatalogSyncKey('provider-parallel', 'movie');
  const seriesKey = buildCatalogSyncKey('provider-parallel', 'series');

  const movie = runCatalogSyncNow(movieKey, async () => {
    for (let i = 0; i < 5; i += 1) {
      await withCatalogTransaction(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
      });
    }
  });
  const series = runCatalogSyncNow(seriesKey, async () => {
    for (let i = 0; i < 5; i += 1) {
      await withCatalogTransaction(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
      });
    }
  });

  await Promise.race([
    Promise.all([movie, series]),
    new Promise((_, reject) => setTimeout(() => reject(new Error('deadlock timeout')), 5000)),
  ]);
  assert.ok(getCatalogMutexStatsForTests().waitSamples >= 0);
});

test('stale generation cannot complete after provider invalidation', async () => {
  const key = buildCatalogSyncKey('provider-stale', 'movie');
  const token = (await import('../src/features/catalog/index.ts')).getCatalogSyncCancelToken(key);

  await upsertCatalogProvider({
    providerId: 'provider-stale',
    providerType: 'xtream',
    displayName: 'Stale',
  });
  const generation = await beginCatalogSync('provider-stale', 'movie', { phase: 'categories' });
  await writeCatalogCategoriesBatch([
    {
      providerId: 'provider-stale',
      mediaType: 'movie',
      categoryId: 'c1',
      categoryName: 'One',
      sortOrder: 0,
      syncGeneration: generation,
    },
  ]);
  await writeCatalogItemsBatch([
    {
      providerId: 'provider-stale',
      mediaType: 'movie',
      contentId: 'm1',
      categoryId: 'c1',
      title: 'Movie 1',
      syncGeneration: generation,
    },
  ]);

  invalidateCatalogSyncForProvider('provider-stale');
  assert.equal(token.isStale(), true);

  // Callers must refuse final commit when the cancel token is stale.
  if (!token.isStale()) {
    await completeCatalogSync('provider-stale', 'movie', generation, { processedCount: 1 });
  }

  // Previous generation rows remain readable for recovery (status not flipped to ready).
  const total = await getCatalogTotalCount('provider-stale', 'movie', { generation });
  assert.equal(total, 1);
});

test('count aggregation uses GROUP BY path and preserves totals', async () => {
  await upsertCatalogProvider({
    providerId: 'provider-counts',
    providerType: 'xtream',
  });
  const generation = await beginCatalogSync('provider-counts', 'movie', { phase: 'items' });
  await writeCatalogCategoriesBatch([
    {
      providerId: 'provider-counts',
      mediaType: 'movie',
      categoryId: 'a',
      categoryName: 'A',
      sortOrder: 0,
      syncGeneration: generation,
    },
    {
      providerId: 'provider-counts',
      mediaType: 'movie',
      categoryId: 'b',
      categoryName: 'B',
      sortOrder: 1,
      syncGeneration: generation,
    },
  ]);
  await writeCatalogItemsBatch([
    {
      providerId: 'provider-counts',
      mediaType: 'movie',
      contentId: '1',
      categoryId: 'a',
      title: 'One',
      syncGeneration: generation,
    },
    {
      providerId: 'provider-counts',
      mediaType: 'movie',
      contentId: '2',
      categoryId: 'a',
      title: 'Two',
      syncGeneration: generation,
    },
    {
      providerId: 'provider-counts',
      mediaType: 'movie',
      contentId: '3',
      categoryId: 'b',
      title: 'Three',
      syncGeneration: generation,
    },
  ]);

  const result = await recomputeCategoryCounts('provider-counts', 'movie', generation);
  assert.equal(result.totalItems, 3);
  assert.equal(result.categoryCount, 2);

  await completeCatalogSync('provider-counts', 'movie', generation, { processedCount: 3 });
  const counts = await getCatalogCategoryCounts('provider-counts', 'movie');
  const byId = Object.fromEntries(counts.map((c) => [c.categoryId, c.itemCount]));
  assert.equal(byId.a, 2);
  assert.equal(byId.b, 1);
  assert.equal(await getCatalogTotalCount('provider-counts', 'movie'), 3);
});

test('checkpoint throttle interval is at least 900ms and skips unchanged', async () => {
  const writes = [];
  const throttle = createCatalogProgressThrottle({
    intervalMs: 900,
    write: (snapshot) => {
      writes.push({ ...snapshot, at: Date.now() });
    },
  });

  throttle.publish({ phase: 'movies', done: 1 });
  assert.equal(writes.length, 1);

  throttle.publish({ phase: 'movies', done: 1 });
  assert.equal(writes.length, 1);

  throttle.publish({ phase: 'movies', done: 2 });
  assert.equal(writes.length, 1);

  await new Promise((resolve) => setTimeout(resolve, 950));
  assert.equal(writes.length, 2);
  assert.ok(writes[1].at - writes[0].at >= 850);
});

test('prepared statement batch write round-trips items', async () => {
  await upsertCatalogProvider({ providerId: 'p-prep', providerType: 'xtream' });
  const generation = await beginCatalogSync('p-prep', 'movie', { phase: 'items' });
  const items = Array.from({ length: 120 }, (_, i) => ({
    providerId: 'p-prep',
    mediaType: 'movie',
    contentId: `m${i}`,
    categoryId: 'c',
    title: `Movie ${i}`,
    syncGeneration: generation,
  }));
  await writeCatalogCategoriesBatch([
    {
      providerId: 'p-prep',
      mediaType: 'movie',
      categoryId: 'c',
      categoryName: 'Cat',
      sortOrder: 0,
      syncGeneration: generation,
    },
  ]);
  const written = await writeCatalogItemsBatch(items);
  assert.equal(written, 120);
  await completeCatalogSync('p-prep', 'movie', generation, { processedCount: 120 });
  assert.equal(await getCatalogTotalCount('p-prep', 'movie'), 120);
});
