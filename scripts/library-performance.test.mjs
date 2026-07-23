import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCategoryCountIndex,
  clearCategoryCountIndexCacheForTests,
  sumCategoryCounts,
} from '../src/features/providers/categoryCountIndexStore.ts';
import {
  clearProviderLibrarySummaryCacheForTests,
  writeProviderLibrarySummary,
  readProviderLibrarySummary,
} from '../src/features/providers/providerLibrarySummaryStore.ts';
import {
  clearSmartCategoryCacheForTests,
  writeSmartCategoryCache,
  getSmartCategoryCountSync,
  SMART_CATEGORY_CACHE_VERSION,
} from '../src/features/providers/smartCategoryCacheStore.ts';

test('buildCategoryCountIndex counts categories in one pass', () => {
  clearCategoryCountIndexCacheForTests();

  const index = buildCategoryCountIndex('demo', 'movie', [
    { categoryId: 'action' },
    { categoryId: 'action' },
    { categoryId: 'comedy' },
  ]);

  assert.equal(index.counts.action, 2);
  assert.equal(index.counts.comedy, 1);
  assert.equal(sumCategoryCounts(index), 3);
});

test('provider library summary persists totals separately from catalog records', async () => {
  clearProviderLibrarySummaryCacheForTests('demo-provider');

  await writeProviderLibrarySummary('demo-provider', {
    movieCount: 32482,
    seriesCount: 8942,
    movieCategoryCount: 42,
    seriesCategoryCount: 18,
    lastProviderSyncAt: Date.now(),
  });

  const summary = await readProviderLibrarySummary('demo-provider');
  assert.equal(summary.movieCount, 32482);
  assert.equal(summary.seriesCount, 8942);
  assert.equal(summary.movieCategoryCount, 42);
});

test('smart category cache serves counts without scanning the catalog at read time', async () => {
  clearSmartCategoryCacheForTests('demo-provider');

  await writeSmartCategoryCache({
    providerId: 'demo-provider',
    mediaType: 'movie',
    version: SMART_CATEGORY_CACHE_VERSION,
    generatedAt: Date.now(),
    entries: {
      action: {
        categoryKey: 'action',
        title: 'Action',
        count: 128,
        itemIds: ['1', '2', '3'],
      },
    },
  });

  assert.equal(getSmartCategoryCountSync('demo-provider', 'movie', 'action'), 128);
});
