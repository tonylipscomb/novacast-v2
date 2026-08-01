import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  beginCatalogSync,
  completeCatalogSync,
  getCatalogCategoryCounts,
  getCatalogDatabase,
  getCatalogTotalCount,
  initializeCatalogDatabase,
  resetCatalogDatabaseForTests,
  resetMovieFragmentRecoveryForTests,
  setCatalogDatabaseOpenerForTests,
  upsertCatalogProvider,
  writeCatalogCategoriesBatch,
  writeCatalogItemsBatch,
} from '../src/features/catalog/index.ts';
import { createNodeSqliteCatalogOpener } from '../src/features/catalog/createNodeSqliteCatalogOpener.ts';
import {
  createSqliteMovieDataSource,
  resetLastValidSqliteMovieCategoriesForTests,
} from '../src/features/movies/data/SqliteMovieDataSource.ts';
import {
  createSmartMovieDataSource,
  refreshSmartCategoryCounts,
} from '../src/features/movies/smart/SmartMovieDataSource.ts';
import {
  clearCategoryCountIndexCacheForTests,
  writeCategoryCountIndex,
} from '../src/features/providers/categoryCountIndexStore.ts';

const repository = fs.readFileSync('src/features/catalog/catalogRepository.ts', 'utf8');
const sqliteSource = fs.readFileSync('src/features/movies/data/SqliteMovieDataSource.ts', 'utf8');
const smartSource = fs.readFileSync('src/features/movies/smart/SmartMovieDataSource.ts', 'utf8');
const model = fs.readFileSync('src/features/movies/useMoviesScreenModel.ts', 'utf8');
const screen = fs.readFileSync('src/features/movies/MoviesScreen.tsx', 'utf8');
const seriesSmart = fs.readFileSync('src/features/series/smart/SmartSeriesDataSource.ts', 'utf8');
const liveGuide = fs.readFileSync('src/features/guide/GuideCategoryRail.tsx', 'utf8');
const countPolicy = fs.readFileSync('src/features/movies/movieCategoryCountPolicy.ts', 'utf8');

async function setup() {
  await resetCatalogDatabaseForTests();
  resetMovieFragmentRecoveryForTests();
  resetLastValidSqliteMovieCategoriesForTests();
  clearCategoryCountIndexCacheForTests();
  setCatalogDatabaseOpenerForTests(createNodeSqliteCatalogOpener());
  await initializeCatalogDatabase(':memory:');
}

test.beforeEach(async () => {
  await setup();
});

test.afterEach(async () => {
  await resetCatalogDatabaseForTests();
  resetMovieFragmentRecoveryForTests();
  resetLastValidSqliteMovieCategoriesForTests();
  clearCategoryCountIndexCacheForTests();
  setCatalogDatabaseOpenerForTests(null);
});

async function seedMovieCatalog() {
  await upsertCatalogProvider({ providerId: 'p1', providerType: 'xtream', displayName: 'P' });
  const generation = await beginCatalogSync('p1', 'movie');
  await writeCatalogCategoriesBatch(
    [
      {
        providerId: 'p1',
        mediaType: 'movie',
        categoryId: 'c1',
        categoryName: 'Action',
        sortOrder: 2,
        syncGeneration: generation,
      },
      {
        providerId: 'p1',
        mediaType: 'movie',
        categoryId: 'c2',
        categoryName: 'Comedy',
        sortOrder: 1,
        syncGeneration: generation,
      },
      {
        providerId: 'p1',
        mediaType: 'movie',
        categoryId: 'c3',
        categoryName: 'Empty',
        sortOrder: 3,
        syncGeneration: generation,
      },
    ],
    { mediaType: 'movie' },
  );
  await writeCatalogItemsBatch([
    {
      providerId: 'p1',
      mediaType: 'movie',
      contentId: 'm1',
      categoryId: 'c1',
      title: 'A1',
      syncGeneration: generation,
    },
    {
      providerId: 'p1',
      mediaType: 'movie',
      contentId: 'm2',
      categoryId: 'c1',
      title: 'A2',
      syncGeneration: generation,
    },
    {
      providerId: 'p1',
      mediaType: 'movie',
      contentId: 'm3',
      categoryId: 'c2',
      title: 'C1',
      syncGeneration: generation,
    },
  ]);
  await completeCatalogSync('p1', 'movie', generation, { processedCount: 3 });
  return generation;
}

test('grouped count query runs once, not once per category', () => {
  assert.match(repository, /GROUP BY category_id/);
  assert.match(repository, /grouped-items-v2-merge/);
  assert.match(repository, /\[NovaCast Movies Category Counts\]/);
  assert.doesNotMatch(
    repository,
    /for \(const categoryId of categoryIds\)[\s\S]{0,200}COUNT\(\*\)/,
  );
  assert.match(sqliteSource, /getCatalogCategoryCounts\(providerId, 'movie'/);
});

test('provider category counts come from GROUP BY and hide zero-row categories', async () => {
  await seedMovieCatalog();
  const counts = await getCatalogCategoryCounts('p1', 'movie');
  assert.deepEqual(
    counts.map((row) => ({ id: row.categoryId, count: row.itemCount, sort: row.sortOrder })),
    [
      { id: 'c2', count: 1, sort: 1 },
      { id: 'c1', count: 2, sort: 2 },
    ],
  );
  assert.equal(
    counts.some((row) => row.categoryId === 'c3'),
    false,
  );
});

test('All Movies count comes from total rows and counts appear without selection', async () => {
  await seedMovieCatalog();
  const source = createSqliteMovieDataSource('p1');
  const categories = await source.getCategories();
  const all = categories.find((category) => category.id === 'all');
  assert.equal(all?.count, 3);
  assert.equal(all?.countKnown, true);

  const provider = categories.filter((category) => category.id !== 'all');
  assert.equal(provider.length, 2);
  assert.ok(provider.every((category) => category.countKnown === true && category.count > 0));
  assert.equal(await getCatalogTotalCount('p1', 'movie'), 3);
});

test('category 0 placeholders are replaced before interaction', async () => {
  await seedMovieCatalog();
  const source = createSqliteMovieDataSource('p1');
  const categories = await source.getCategories();
  assert.ok(
    categories.every(
      (category) => category.countKnown !== false && (category.id === 'all' || category.count > 0),
    ),
  );
  assert.match(countPolicy, /countKnown === false/);
  assert.match(countPolicy, /return '\.\.\.'/);
});

test('sort_order is preserved after merge', async () => {
  await seedMovieCatalog();
  const counts = await getCatalogCategoryCounts('p1', 'movie');
  assert.deepEqual(
    counts.map((row) => row.categoryId),
    ['c2', 'c1'],
  );
});

test('stale index zeros do not blank SQLite provider counts', async () => {
  await seedMovieCatalog();
  await writeCategoryCountIndex({
    providerId: 'p1',
    mediaType: 'movie',
    counts: { c1: 0, c2: 0 },
    updatedAt: Date.now(),
  });

  const base = createSqliteMovieDataSource('p1');
  const smart = createSmartMovieDataSource(base, 'p1');
  const categories = await smart.getCategories();
  const action = categories.find((category) => category.id === 'c1');
  const comedy = categories.find((category) => category.id === 'c2');
  assert.equal(action?.count, 2);
  assert.equal(action?.countKnown, true);
  assert.equal(comedy?.count, 1);
  assert.equal(comedy?.countKnown, true);

  const refreshed = await refreshSmartCategoryCounts('p1', categories);
  assert.equal(refreshed.find((category) => category.id === 'c1')?.count, 2);
});

test('failed count refresh preserves previous valid counts', async () => {
  await seedMovieCatalog();
  const source = createSqliteMovieDataSource('p1');
  const first = await source.getCategories();
  assert.ok(first.filter((category) => category.id !== 'all').length >= 2);

  // Keep readable generation + total rows, but orphan every item category_id so the
  // metadata merge yields zero provider categories (suspiciously empty refresh).
  const db = await getCatalogDatabase();
  await db.run(`UPDATE catalog_items_v2 SET category_id = 'orphan' WHERE provider_id = 'p1'`);

  const second = await source.getCategories();
  assert.equal(
    second.filter((category) => category.id !== 'all').length,
    first.filter((category) => category.id !== 'all').length,
  );
  assert.equal(
    second.find((category) => category.id === 'all')?.count,
    first.find((category) => category.id === 'all')?.count,
  );
  assert.equal(second.find((category) => category.id === 'c1')?.count, 2);
});

test('pagination and detail paths do not recompute category counts', () => {
  assert.doesNotMatch(model, /getCatalogCategoryCounts/);
  assert.doesNotMatch(screen, /getCatalogCategoryCounts/);
  assert.match(model, /loadMore/);
  assert.match(screen, /detailOpen/);
  assert.match(sqliteSource, /getCategories\(\): Promise<MovieCategory\[\]>/);
  assert.match(model, /subscribeMovieCatalogReady/);
});

test('category selection is not required to populate counts', () => {
  assert.match(sqliteSource, /countKnown: true/);
  assert.match(sqliteSource, /grouped-counts-applied/);
  assert.match(smartSource, /resolveProviderCategoryCount/);
  assert.match(smartSource, /preferSqliteCounts/);
});

test('Series and Live TV remain unchanged by Movies count preload', () => {
  assert.doesNotMatch(seriesSmart, /grouped-items-v2-merge/);
  assert.doesNotMatch(seriesSmart, /NovaCast Movies Category Counts/);
  assert.doesNotMatch(liveGuide, /NovaCast Movies Category Counts/);
  assert.doesNotMatch(liveGuide, /catalog_items_v2/);
});
