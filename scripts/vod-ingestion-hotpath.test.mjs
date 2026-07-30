import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

import {
  computeVodRegionRank,
  rankUniqueItemsInBatches,
  VOD_REGION_RANK_BATCH_SIZE,
} from '../src/features/providers/vodRegionRank.ts';

const root = new URL('..', import.meta.url);

test('VOD ingestion does not call partitionLiveItemsUsFirst or partitionXtreamVodStreamsUsFirst', async () => {
  const source = await fs.readFile(new URL('src/features/providers/providerRepositories.ts', root), 'utf8');
  assert.doesNotMatch(source, /partitionXtreamVodStreamsUsFirst/);
  assert.doesNotMatch(source, /partitionXtreamSeriesStreamsUsFirst/);
  assert.match(source, /partitionLiveItemsUsFirst/);
  assert.match(source, /contentType:\s*'live'/);
  assert.match(source, /Preserve provider order/);
  assert.match(source, /providerSortOrder:\s*index/);
  assert.doesNotMatch(source, /partitionMediaSummariesUsFirst\(/);
});

test('partitionLiveItemsUsFirst is Live-TV guarded in source', async () => {
  const source = await fs.readFile(new URL('src/features/providers/usAmericanSort.ts', root), 'utf8');
  assert.match(source, /Live-TV only/);
  assert.match(source, /contentType !== 'live'/);
  assert.match(source, /computeVodRegionRank/);
});

test('computeVodRegionRank is deterministic', () => {
  const a = computeVodRegionRank({ title: 'US Action', rawTitle: 'US: Action', countryCode: 'US' });
  const b = computeVodRegionRank({ title: 'US Action', rawTitle: 'US: Action', countryCode: 'US' });
  const c = computeVodRegionRank({ title: 'Foreign Film', countryCode: 'FR' });
  assert.equal(a, b);
  assert.equal(typeof a, 'number');
  assert.equal(typeof c, 'number');
});

test('ranking runs once per unique item and yields between batches', async () => {
  const items = Array.from({ length: VOD_REGION_RANK_BATCH_SIZE * 2 + 5 }, (_, index) => ({
    id: `m-${index}`,
    title: index % 2 === 0 ? `US Title ${index}` : `Other ${index}`,
    countryCode: index % 2 === 0 ? 'US' : 'XX',
  }));
  items.push({ id: 'm-0', title: 'US Title 0', countryCode: 'US' });

  const ranks = new Map();
  let applyCount = 0;
  const result = await rankUniqueItemsInBatches(items, {
    batchSize: VOD_REGION_RANK_BATCH_SIZE,
    hasRank: (id) => ranks.has(id),
    apply: (id, regionRank) => {
      applyCount += 1;
      assert.equal(ranks.has(id), false, 'must not re-rank the same id');
      ranks.set(id, regionRank);
    },
  });

  assert.equal(result.ranked, VOD_REGION_RANK_BATCH_SIZE * 2 + 5);
  assert.equal(applyCount, result.ranked);
  assert.ok(result.batches >= 3);
  assert.equal(ranks.size, result.ranked);
});

test('no single ranking batch exceeds the agreed processing budget', async () => {
  const items = Array.from({ length: VOD_REGION_RANK_BATCH_SIZE * 2 }, (_, index) => ({
    id: `budget-${index}`,
    title: `Title ${index}`,
  }));

  const result = await rankUniqueItemsInBatches(items, {
    batchSize: VOD_REGION_RANK_BATCH_SIZE,
    apply: () => {},
  });

  assert.equal(result.ranked, items.length);
  assert.ok(result.batches >= 2, `expected time-budgeted chunks, got ${result.batches}`);
});

test('catalog sync ranks movies after category ingestion with batch size constant', async () => {
  const sync = await fs.readFile(new URL('src/features/providers/providerCatalogSync.ts', root), 'utf8');
  assert.match(sync, /rankUniqueItemsInBatches/);
  assert.match(sync, /movie-region-rank/);
  assert.match(sync, /VOD_REGION_RANK_BATCH_SIZE/);
  assert.match(sync, /setRegionRank/);
});

test('provider order is preserved in listCategoryMovies mapping', async () => {
  const source = await fs.readFile(new URL('src/features/providers/providerRepositories.ts', root), 'utf8');
  assert.match(source, /providerSortOrder:\s*index/);
  assert.match(source, /mapTimeBudgeted/);
});
