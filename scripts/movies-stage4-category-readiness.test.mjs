import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  resolveMoviesInitialCategory,
  getMovieCategoryRailCategories,
} from '../src/features/movies/moviesVisibleCategories.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const repository = read('src/features/catalog/catalogRepository.ts');
const writer = read('src/features/catalog/catalogSqliteSyncWriter.ts');
const sqlite = read('src/features/movies/data/SqliteMovieDataSource.ts');
const smart = read('src/features/movies/smart/SmartMovieDataSource.ts');
const model = read('src/features/movies/useMoviesScreenModel.ts');
const sync = read('src/features/providers/providerCatalogSync.ts');
const loader = read('src/features/movies/moviesLoaderState.ts');
const searchDs = read('src/features/search/moviesSearchDatasource.ts');

test('fresh install: category resolver can use syncing generation independently of item resolver', () => {
  assert.match(repository, /export async function resolveReadableCategoryGeneration/);
  assert.match(repository, /\[NovaCast Category Read Generation\]/);
  assert.match(repository, /current-sync-category-generation/);
  assert.match(repository, /completed-category-generation/);
  assert.match(repository, /no-readable-category-generation/);
  assert.match(repository, /includeZeroCountCategories/);
  // Item resolver remains separate and still requires readable item rows.
  assert.match(repository, /export async function resolveReadableCatalogGeneration/);
  assert.match(repository, /no-readable-generation/);
  assert.match(sqlite, /resolveReadableCategoryGeneration/);
  assert.match(sqlite, /resolveReadableCatalogGeneration/);
  assert.match(sqlite, /category-generation-separated-from-item-generation/);
});

test('categories not arrived: loading state, no smart-wrapper substitute', () => {
  assert.match(smart, /provider-categories-pending/);
  assert.match(smart, /usesSqliteReads/);
  assert.match(smart, /return \[\]/);
  assert.match(loader, /Loading provider categories…/);
  // SQLite path must not emit smart-wrapper when provider cats missing.
  const sqliteBranch = smart.slice(smart.indexOf('if (usesSqliteReads)'));
  assert.doesNotMatch(sqliteBranch.slice(0, 900), /reason: 'smart-wrapper'/);
});

test('categories arrive after mount via movie-categories-updated', () => {
  assert.match(writer, /Stage 4 category-rail/);
  assert.match(writer, /sqlite-categories-streamed/);
  assert.match(writer, /pendingCategories/);
  assert.match(sync, /publishMovieCategoriesUpdated/);
  assert.match(sync, /movie-categories-updated/);
  assert.match(model, /subscribeMovieCategoriesUpdated/);
  assert.match(model, /movie_categories_updated_received/);
  assert.match(model, /void loadCategories\(\)/);
});

test('completed-library path still uses completed category generation wording', () => {
  assert.match(repository, /completed-category-generation/);
  assert.match(sqlite, /provider-categories-applied/);
  assert.match(smart, /provider-categories-applied/);
  assert.match(model, /provider-categories-applied/);
});

test('selection preservation and smart/legacy fallback', () => {
  const syncingCats = [
    { id: 'all', name: 'All Movies', kind: 'provider', count: 0, countKnown: false },
    { id: '10', name: 'Action', kind: 'provider', count: 0, countKnown: false },
    { id: '20', name: 'Comedy', kind: 'provider', count: 0, countKnown: false },
  ];

  const firstWhileSyncing = resolveMoviesInitialCategory({
    categories: syncingCats,
    previousCategoryId: null,
    rememberedCategoryId: null,
  });
  assert.equal(firstWhileSyncing.selectedCategoryId, '10');
  assert.equal(firstWhileSyncing.reason, 'first-provider-category');

  const preserved = resolveMoviesInitialCategory({
    categories: syncingCats,
    previousCategoryId: '20',
    rememberedCategoryId: '10',
  });
  assert.equal(preserved.selectedCategoryId, '20');

  const fromSmart = resolveMoviesInitialCategory({
    categories: syncingCats,
    previousCategoryId: 'smart:favorites',
    rememberedCategoryId: 'smart:continue-watching',
  });
  assert.equal(fromSmart.selectedCategoryId, '10');
  assert.equal(fromSmart.selectedCategoryId.startsWith('smart:'), false);

  const completedCats = [
    { id: 'all', name: 'All Movies', kind: 'provider', count: 10, countKnown: true },
    { id: 'empty', name: 'Empty', kind: 'provider', count: 0, countKnown: true },
    { id: 'live', name: 'Live', kind: 'provider', count: 4, countKnown: true },
  ];
  const skipKnownEmpty = resolveMoviesInitialCategory({
    categories: completedCats,
    previousCategoryId: 'all',
    rememberedCategoryId: 'all',
  });
  assert.equal(skipKnownEmpty.selectedCategoryId, 'live');

  const rail = getMovieCategoryRailCategories(syncingCats);
  assert.ok(rail.every((category) => category.id !== 'all'));
  assert.ok(rail.some((category) => category.id === '10'));
});

test('category integrity: blanks filtered, same-name kept, duplicate ids get render keys', () => {
  assert.match(sqlite, /NovaCast Movies Category Duplicate/);
  assert.match(sqlite, /Category Duplicate/);
  assert.match(sqlite, /categoryId\.trim\(\)|category\.categoryId\.trim/);
  assert.match(sqlite, /categoryName\.trim\(\)|category\.categoryName\.trim/);
  assert.match(repository, /includeZeroCountCategories/);
});

test('search generation safety remains completed-item based', () => {
  assert.match(searchDs, /resolveReadableCatalogGeneration/);
  assert.doesNotMatch(searchDs, /resolveReadableCategoryGeneration/);
  assert.match(searchDs, /providerFallbackAllowed/);
});

test('no direct provider fallback reintroduced on Movies SQLite path', () => {
  assert.match(sqlite, /sourceKind: 'sqlite'/);
  assert.doesNotMatch(sqlite, /getVodStreams|xtream|fetchCategoriesFromProvider/);
  assert.match(model, /createSqliteMovieDataSource/);
  assert.match(smart, /SQLite path: provider-only list|no smart-wrapper substitute/i);
});
