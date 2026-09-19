import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  beginCatalogSync,
  completeCatalogSync,
  getCatalogDatabase,
  getCatalogItemsPage,
  initializeCatalogDatabase,
  resetCatalogDatabaseForTests,
  setCatalogDatabaseOpenerForTests,
  upsertCatalogProvider,
  writeCatalogCategoriesBatch,
  writeCatalogItemsBatch,
} from '../src/features/catalog/index.ts';
import { createNodeSqliteCatalogOpener } from '../src/features/catalog/createNodeSqliteCatalogOpener.ts';
import { mapMovieSummaryToCatalogItem } from '../src/features/catalog/catalogSqliteSyncWriter.ts';

test.beforeEach(async () => {
  await resetCatalogDatabaseForTests();
  setCatalogDatabaseOpenerForTests(createNodeSqliteCatalogOpener());
  await initializeCatalogDatabase(':memory:');
});

test.afterEach(async () => {
  await resetCatalogDatabaseForTests();
  setCatalogDatabaseOpenerForTests(null);
});

test('regional rank is persisted and applied before every explicit provider sort', async () => {
  await upsertCatalogProvider({ providerId: 'regional', providerType: 'xtream', displayName: 'Regional' });
  const generation = await beginCatalogSync('regional', 'movie');
  await writeCatalogCategoriesBatch([{
    providerId: 'regional', mediaType: 'movie', categoryId: 'all', categoryName: 'All', syncGeneration: generation,
  }]);
  await writeCatalogItemsBatch([
    { providerId: 'regional', mediaType: 'movie', contentId: 'foreign', categoryId: 'all', title: 'Foreign', regionRank: 2, providerSortOrder: 0, rating: 10, syncGeneration: generation },
    { providerId: 'regional', mediaType: 'movie', contentId: 'us', categoryId: 'all', title: 'US', regionRank: 0, providerSortOrder: 1, rating: 1, syncGeneration: generation },
    { providerId: 'regional', mediaType: 'movie', contentId: 'neutral', categoryId: 'all', title: 'Neutral', regionRank: 1, providerSortOrder: 2, rating: 5, syncGeneration: generation },
  ]);
  await completeCatalogSync('regional', 'movie', generation, { processedCount: 3 });

  const db = await getCatalogDatabase();
  const columns = await db.getAll('PRAGMA table_info(catalog_items_v2)');
  assert.ok(columns.some((column) => column.name === 'region_rank'));

  for (const sort of ['newest', 'oldest', 'title', 'title-desc', 'rating', 'recently-added', 'popularity', 'provider']) {
    const page = await getCatalogItemsPage({
      providerId: 'regional', mediaType: 'movie', generation, sort, regionalFirst: true, limit: 3,
    });
    assert.equal(page.items[0]?.contentId, 'us', `regional rank must lead ${sort}`);
  }
});

test('pagination retains regional ordering without an in-memory catalog sort', async () => {
  await upsertCatalogProvider({ providerId: 'regional', providerType: 'xtream', displayName: 'Regional' });
  const generation = await beginCatalogSync('regional', 'movie');
  await writeCatalogItemsBatch(Array.from({ length: 1200 }, (_, index) => ({
    providerId: 'regional', mediaType: 'movie', contentId: `m-${index}`, categoryId: 'all',
    title: `Movie ${index}`, regionRank: index < 40 ? 0 : 2, syncGeneration: generation,
  })));
  await completeCatalogSync('regional', 'movie', generation, { processedCount: 1200 });
  const first = await getCatalogItemsPage({ providerId: 'regional', mediaType: 'movie', generation, regionalFirst: true, limit: 25, offset: 0 });
  const second = await getCatalogItemsPage({ providerId: 'regional', mediaType: 'movie', generation, regionalFirst: true, limit: 25, offset: 25 });
  assert.equal(first.items.length, 25);
  assert.equal(second.items.length, 25);
  assert.ok(first.items.every((item) => item.regionRank === 0));
  assert.ok(second.items.slice(0, 15).every((item) => item.regionRank === 0));
});

test('regional SQL ordering is opt-in and smart/search paths remain separate', () => {
  const repository = fs.readFileSync('src/features/catalog/catalogRepository.ts', 'utf8');
  const sqliteSource = fs.readFileSync('src/features/movies/data/SqliteMovieDataSource.ts', 'utf8');
  assert.match(repository, /regionalFirst: query\.regionalFirst/);
  assert.match(sqliteSource, /regionalFirst: true/);
  const searchBlock = sqliteSource.slice(sqliteSource.indexOf('async searchMovies'));
  assert.doesNotMatch(searchBlock, /regionalFirst: true/);
});

test('Movie sync mapping supplies a deterministic rank before SQLite persistence', () => {
  const us = mapMovieSummaryToCatalogItem({
    id: 'us', categoryId: 'c', title: 'US: Example', genres: [], posterStyleKey: 'ember',
  }, 'p', 1);
  const foreign = mapMovieSummaryToCatalogItem({
    id: 'foreign', categoryId: 'c', title: 'CL: Example', genres: [], posterStyleKey: 'ember',
  }, 'p', 1);
  assert.equal(us.regionRank, 0);
  assert.equal(foreign.regionRank, 2);
});
