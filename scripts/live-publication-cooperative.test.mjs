import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getCatalogDatabase,
  initializeCatalogDatabase,
  resetCatalogDatabaseForTests,
  setCatalogDatabaseOpenerForTests,
} from '../src/features/catalog/index.ts';
import { createNodeSqliteCatalogOpener } from '../src/features/catalog/createNodeSqliteCatalogOpener.ts';
import {
  publishLiveSearchCatalogFromDump,
  resetLiveSearchCatalogForTests,
} from '../src/features/search/liveSearchSqliteCatalog.ts';

test.beforeEach(async () => {
  resetLiveSearchCatalogForTests();
  await resetCatalogDatabaseForTests();
  setCatalogDatabaseOpenerForTests(createNodeSqliteCatalogOpener());
  await initializeCatalogDatabase(':memory:');
});

test.afterEach(async () => {
  resetLiveSearchCatalogForTests();
  await resetCatalogDatabaseForTests();
  setCatalogDatabaseOpenerForTests(null);
});

function channels(count, prefix = 'live') {
  return Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-${index}`,
    categoryId: `cat-${index % 20}`,
    number: index + 1,
    name: `Channel ${index}`,
    current: '',
    next: '',
    following: '',
    description: '',
    resolution: 'HD',
    audio: 'Stereo',
    remaining: 'Live',
    progress: 0,
    tone: '#173B67',
    currentStart: 'Now',
    currentEnd: 'Later',
  }));
}

test('60K live publication persists every row with bounded transactions and yields', async () => {
  const rowCount = 60_000;
  const startedAt = Date.now();
  const result = await publishLiveSearchCatalogFromDump({
    providerId: 'publication-test',
    channels: channels(rowCount),
    categories: Array.from({ length: 20 }, (_, index) => ({ id: `cat-${index}`, name: `Category ${index}` })),
  });
  const durationMs = Date.now() - startedAt;
  const db = await getCatalogDatabase();
  const count = await db.getFirst(
    `SELECT COUNT(*) AS count
       FROM live_search_channels
      WHERE provider_id = ? AND generation = ?`,
    ['publication-test', result.generation],
  );
  const state = await db.getFirst(
    `SELECT status, active_generation, building_generation, channel_count
       FROM live_search_state
      WHERE provider_id = ?`,
    ['publication-test'],
  );

  assert.equal(result.ready, true);
  assert.equal(result.channelCount, rowCount);
  assert.equal(Number(count?.count), rowCount);
  assert.equal(state?.status, 'ready');
  assert.equal(Number(state?.active_generation), result.generation);
  assert.equal(Number(state?.building_generation), 0);
  assert.equal(Number(state?.channel_count), rowCount);
  assert.ok(durationMs < 30_000, `publication took ${durationMs}ms`);
});

test('publication cancellation does not activate a partial generation', async () => {
  let checks = 0;
  const result = await publishLiveSearchCatalogFromDump({
    providerId: 'publication-cancel-test',
    channels: channels(10_000, 'cancel'),
    isCancelled: () => ++checks > 1_000,
  });
  assert.equal(result.rebuilt, false);
  assert.equal(result.generation, 0);
});
