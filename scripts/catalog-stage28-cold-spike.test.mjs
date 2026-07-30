import assert from 'node:assert/strict';
import test from 'node:test';

import {
  beginCatalogWriteQuietPeriod,
  endCatalogWriteQuietPeriod,
  isCatalogWriteQuietPeriodActive,
  resetCatalogWriteQuietPeriodForTests,
  waitOutCatalogWriteQuietPeriod,
} from '../src/features/catalog/catalogWriteQuietPeriod.ts';
import {
  resetColdCategorySpikeAuditForTests,
  recordColdCategorySubPhase,
  getColdCategorySpikeSamplesForTests,
} from '../src/features/catalog/coldCategorySpikeAudit.ts';
import {
  beginCatalogSync,
  initializeCatalogDatabase,
  processStreamingBatches,
  resetCatalogDatabaseForTests,
  setCatalogDatabaseOpenerForTests,
  upsertCatalogProvider,
  writeCatalogCategoriesBatch,
} from '../src/features/catalog/index.ts';
import { createNodeSqliteCatalogOpener } from '../src/features/catalog/createNodeSqliteCatalogOpener.ts';

test.beforeEach(async () => {
  resetCatalogWriteQuietPeriodForTests();
  resetColdCategorySpikeAuditForTests();
  await resetCatalogDatabaseForTests();
  setCatalogDatabaseOpenerForTests(createNodeSqliteCatalogOpener());
  await initializeCatalogDatabase(':memory:');
});

test.afterEach(async () => {
  await resetCatalogDatabaseForTests();
  setCatalogDatabaseOpenerForTests(null);
  resetColdCategorySpikeAuditForTests();
  resetCatalogWriteQuietPeriodForTests();
});

test('quiet period blocks until released', async () => {
  beginCatalogWriteQuietPeriod(5_000);
  assert.equal(isCatalogWriteQuietPeriodActive(), true);
  const started = Date.now();
  setTimeout(() => endCatalogWriteQuietPeriod(), 40);
  await waitOutCatalogWriteQuietPeriod({ pollMs: 10, maxWaitMs: 2_000 });
  assert.ok(Date.now() - started >= 30);
  assert.equal(isCatalogWriteQuietPeriodActive(), false);
});

test('category streaming stays within transaction budget locally', async () => {
  await upsertCatalogProvider({ providerId: 'p', providerType: 'xtream' });
  const generation = await beginCatalogSync('p', 'movie', { phase: 'categories' });
  const categories = Array.from({ length: 120 }, (_, i) => ({
    providerId: 'p',
    mediaType: 'movie',
    categoryId: `c${i}`,
    categoryName: `C${i}`,
    sortOrder: i,
    syncGeneration: generation,
  }));

  let maxChunk = 0;
  let written = 0;
  await processStreamingBatches(
    categories,
    (c) => c,
    async (batch) => {
      written += await writeCatalogCategoriesBatch(batch, { mediaType: 'movie' });
    },
    {
      kind: 'categories',
      writeKind: 'categories',
      minItems: 4,
      maxItems: 12,
      onChunk: ({ chunkMs }) => {
        maxChunk = Math.max(maxChunk, chunkMs);
      },
    },
  );

  assert.equal(written, 120);
  assert.ok(maxChunk < 100, `maxChunk ${maxChunk}`);
});

test('diagnostics do not retain full category payloads in spike samples', () => {
  process.env.EXPO_PUBLIC_NOVACAST_CATALOG_AUDIT = '1';
  resetColdCategorySpikeAuditForTests();
  recordColdCategorySubPhase({
    phase: 'batchTotal',
    mediaType: 'movie',
    batchIndex: 1,
    itemCount: 8,
    wallMs: 40,
    cold: true,
  });
  const samples = getColdCategorySpikeSamplesForTests();
  assert.ok(samples.length >= 1);
  const serialized = JSON.stringify(samples);
  assert.equal(serialized.includes('categoryName'), false);
  assert.equal(serialized.includes('Category '), false);
  delete process.env.EXPO_PUBLIC_NOVACAST_CATALOG_AUDIT;
});

test('nested quiet period stays active until outer end', () => {
  beginCatalogWriteQuietPeriod(5_000);
  beginCatalogWriteQuietPeriod(5_000);
  endCatalogWriteQuietPeriod();
  assert.equal(isCatalogWriteQuietPeriodActive(), true);
  endCatalogWriteQuietPeriod();
  assert.equal(isCatalogWriteQuietPeriodActive(), false);
});

test('mutex is not held across category stream yields locally', async () => {
  await upsertCatalogProvider({ providerId: 'p', providerType: 'xtream' });
  const generation = await beginCatalogSync('p', 'movie', { phase: 'categories' });
  const categories = Array.from({ length: 48 }, (_, i) => ({
    providerId: 'p',
    mediaType: 'movie',
    categoryId: `c${i}`,
    categoryName: `C${i}`,
    sortOrder: i,
    syncGeneration: generation,
  }));

  let yields = 0;
  await processStreamingBatches(
    categories,
    (c) => c,
    async (batch) => {
      await writeCatalogCategoriesBatch(batch, { mediaType: 'movie' });
    },
    {
      kind: 'categories',
      writeKind: 'categories',
      minItems: 4,
      maxItems: 8,
      onChunk: () => {
        yields += 1;
      },
    },
  );
  assert.ok(yields >= 4, `expected multiple chunk yields, got ${yields}`);
});
