import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  resolveMoviesInitialCategory,
  getMovieCategoryRailCategories,
} from '../src/features/movies/moviesVisibleCategories.ts';
import { decideMoviesCatalogReadiness } from '../src/features/movies/moviesCatalogReadiness.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const repository = read('src/features/catalog/catalogRepository.ts');
const writer = read('src/features/catalog/catalogSqliteSyncWriter.ts');
const sqlite = read('src/features/movies/data/SqliteMovieDataSource.ts');
const smart = read('src/features/movies/smart/SmartMovieDataSource.ts');
const model = read('src/features/movies/useMoviesScreenModel.ts');
const sync = read('src/features/providers/providerCatalogSync.ts');
const loader = read('src/features/movies/moviesLoaderState.ts');
const readiness = read('src/features/movies/moviesCatalogReadiness.ts');
const searchDs = read('src/features/search/moviesSearchDatasource.ts');
const moviesScreen = read('src/features/movies/MoviesScreen.tsx');

test('1) categoriesGeneration=1 and readableItemGeneration=0 → waiting-fresh-sync', () => {
  assert.equal(
    decideMoviesCatalogReadiness({
      categoriesGeneration: 1,
      readableItemGeneration: 0,
      syncingGeneration: 1,
      syncStatus: 'syncing',
      previousReadableGeneration: 0,
    }),
    'waiting-fresh-sync',
  );

  assert.match(sqlite, /waiting-fresh-sync/);
  assert.match(sqlite, /waiting-fresh-sync-categories-pending/);
  assert.match(sqlite, /return \[\]/);
  assert.match(model, /catalog-not-ready-categories-pending/);
  assert.match(model, /setSelectedCategoryId\(''\)/);
  assert.match(model, /setLoadStatus\(\(current\) => \(current === 'error' \? current : 'loading'\)\)/);
  assert.match(loader, /Preparing movie library…/);
  // Must not arm a first-page request against an empty / gen-0 rail.
  assert.match(model, /movies_page_gated_waiting_categories/);
});

test('2) generation 1 becomes active → activating then usable categories + first page', () => {
  assert.equal(
    decideMoviesCatalogReadiness({
      categoriesGeneration: 1,
      readableItemGeneration: 1,
      syncingGeneration: 1,
      syncStatus: 'ready',
      previousReadableGeneration: 0,
    }),
    'activating-completed-generation',
  );

  assert.match(sqlite, /resolveMoviesCatalogReadiness/);
  assert.match(sqlite, /categoryReadGeneration = itemsGeneration/);
  assert.match(sqlite, /MoviesCatalogNotReadyError/);
  assert.match(model, /catalog_ready_received/);
  assert.match(model, /void loadCategories\(\)/);
  assert.match(model, /subscribeMovieCatalogReady/);
  assert.match(sqlite, /provider-categories-applied/);
});

test('3) generation 44 readable while 45 syncs → preserve completed rail', () => {
  assert.equal(
    decideMoviesCatalogReadiness({
      categoriesGeneration: 45,
      readableItemGeneration: 44,
      syncingGeneration: 45,
      syncStatus: 'syncing',
      previousReadableGeneration: 44,
    }),
    'preserving-completed-generation',
  );

  assert.match(sqlite, /preserving-completed-generation/);
  assert.match(sqlite, /previous\.categories/);
  // Categories are read from the readable item generation, not the syncing category stream.
  assert.match(sqlite, /categoryReadGeneration = itemsGeneration/);
  assert.doesNotMatch(sqlite, /resolveReadableCategoryGeneration\(providerId, 'movie'\)/);
});

test('4) catalog-not-ready must not become loadStatus empty', () => {
  assert.match(model, /isMoviesCatalogNotReadyError/);
  assert.match(model, /movies_page_catalog_not_ready/);
  assert.match(model, /keepPendingForCatalogReady/);
  assert.match(readiness, /MoviesCatalogNotReadyError/);
  assert.match(readiness, /catalog-not-ready/);
  // When not-ready, loadStatus stays loading — never coerced to empty from gen-0.
  const notReadyIdx = model.indexOf('movies_page_catalog_not_ready');
  assert.ok(notReadyIdx >= 0);
  const notReadyBlock = model.slice(notReadyIdx, notReadyIdx + 500);
  assert.match(notReadyBlock, /setLoadStatus\('loading'\)/);
  assert.doesNotMatch(notReadyBlock, /setLoadStatus\('empty'\)/);
});

test('5) completed category with zero real rows may still show genuine empty', () => {
  // After a successful page from a readable generation, empty arrays are allowed.
  assert.match(model, /Genuine completed-generation zero-result categories may show empty/);
  assert.match(model, /setLoadStatus\(page\.items\.length > 0 \? 'ready' : 'empty'\)/);
  assert.equal(
    decideMoviesCatalogReadiness({
      categoriesGeneration: 1,
      readableItemGeneration: 1,
      syncingGeneration: 1,
      syncStatus: 'ready',
      previousReadableGeneration: 1,
      readableItemCount: 0,
    }),
    'completed-empty',
  );
  assert.match(model, /reason: 'completed-empty'/);

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
});

test('6) no provider/network fallback is introduced', () => {
  assert.match(sqlite, /sourceKind: 'sqlite'/);
  assert.doesNotMatch(sqlite, /getVodStreams|xtream|fetchCategoriesFromProvider/);
  assert.match(model, /createSqliteMovieDataSource/);
  assert.match(smart, /SQLite path: provider-only list|no smart-wrapper substitute/i);
  assert.match(smart, /provider-categories-pending/);
});

test('7) no direct reads from an incomplete generation', () => {
  assert.match(sqlite, /readableGeneration <= 0/);
  assert.match(sqlite, /throw new MoviesCatalogNotReadyError/);
  assert.match(sqlite, /category-item-readiness-barrier/);
  // Page queries must use resolveReadableCatalogGeneration (items), not category-only gen.
  assert.match(sqlite, /resolveReadableCatalogGeneration\(providerId, 'movie'\)/);
  assert.doesNotMatch(
    sqlite.slice(sqlite.indexOf('async getMoviesPage')),
    /resolveReadableCategoryGeneration/,
  );
});

test('bounded readiness diagnostic event', () => {
  assert.match(readiness, /\[NovaCast Movies Catalog Readiness\]/);
  assert.match(readiness, /waiting-fresh-sync/);
  assert.match(readiness, /preserving-completed-generation/);
  assert.match(readiness, /activating-completed-generation/);
  assert.match(readiness, /completed-empty/);
  assert.match(readiness, /readableItemGeneration/);
  assert.match(readiness, /activeProviderGeneration/);
  assert.match(readiness, /readableItemCount/);
  assert.match(readiness, /inProgressItemCount/);
  assert.match(readiness, /previousReadableGeneration/);
  assert.match(sqlite, /logMoviesCatalogReadiness/);
});

test('movie-categories-updated is metadata-only preparing signal', () => {
  assert.match(writer, /Stage 4 \/ 4\.2A/);
  assert.match(writer, /sqlite-categories-streamed/);
  assert.match(sync, /publishMovieCategoriesUpdated/);
  assert.match(sync, /Preparing movie library/);
  assert.match(sync, /must not imply the Movies library is ready/);
  assert.match(model, /subscribeMovieCategoriesUpdated/);
  assert.match(model, /movie_categories_updated_received/);
  // Categories-updated may reload, but incomplete cats stay non-interactive via barrier.
  assert.match(model, /catalog-not-ready-categories-pending/);
});

test('category resolver still exists for sync diagnostics; Movies UI gates on item readiness', () => {
  assert.match(repository, /export async function resolveReadableCategoryGeneration/);
  assert.match(repository, /current-sync-category-generation/);
  assert.match(repository, /export async function resolveReadableCatalogGeneration/);
  assert.match(repository, /no-readable-generation/);
  assert.match(searchDs, /resolveReadableCatalogGeneration/);
  assert.doesNotMatch(searchDs, /resolveReadableCategoryGeneration/);
});

test('selection helpers still work for completed usable categories', () => {
  const completedCats = [
    { id: 'all', name: 'All Movies', kind: 'provider', count: 10, countKnown: true },
    { id: '10', name: 'Action', kind: 'provider', count: 5, countKnown: true },
    { id: '20', name: 'Comedy', kind: 'provider', count: 3, countKnown: true },
  ];

  const first = resolveMoviesInitialCategory({
    categories: completedCats,
    previousCategoryId: null,
    rememberedCategoryId: null,
  });
  assert.equal(first.selectedCategoryId, '10');
  assert.equal(first.reason, 'first-populated-provider-category');

  const preserved = resolveMoviesInitialCategory({
    categories: completedCats,
    previousCategoryId: '20',
    rememberedCategoryId: '10',
  });
  assert.equal(preserved.selectedCategoryId, '20');

  const rail = getMovieCategoryRailCategories(completedCats);
  assert.ok(rail.every((category) => category.id !== 'all'));
  assert.ok(rail.some((category) => category.id === '10'));
});

test('ready decision when completed generation is stable', () => {
  assert.equal(
    decideMoviesCatalogReadiness({
      categoriesGeneration: 44,
      readableItemGeneration: 44,
      syncingGeneration: 44,
      syncStatus: 'ready',
      previousReadableGeneration: 44,
      readableItemCount: 1200,
    }),
    'ready',
  );
});

test('catalog-not-ready pending is distinct from completed-empty loadStatus', () => {
  assert.match(model, /catalogPending/);
  assert.match(model, /waiting-fresh-sync/);
  assert.match(model, /setLoadStatus\('empty'\)/);
  assert.match(model, /resolveMoviesCatalogReadiness\(activeProviderId\)/);
});

test('Stage 4.2D sparse active generation shows repairing, not empty rail', () => {
  assert.match(sqlite, /repairing-sparse-generation/);
  assert.match(sqlite, /repairDegradedMoviesCatalogIfNeeded/);
  assert.match(model, /isMoviesCatalogRepairing|clearMoviesSparseRepairSchedule/);
  assert.match(model, /repairing-sparse-generation|atomic_generation_swap/);
  assert.match(loader, /Repairing movie library…/);
  assert.match(moviesScreen, /catalogRepairing/);
});

test('Stage 4.2E preserving path pins categoriesGeneration to readable item generation', () => {
  assert.match(sqlite, /categoryReadGeneration = itemsGeneration/);
  assert.match(sqlite, /categoriesGeneration: itemsGeneration/);
  assert.match(sqlite, /generationAligned: true/);
  assert.match(sqlite, /filterInteractiveMovieCategories/);
  assert.match(sqlite, /stage4e-atomic-generation-pinning-v1/);
  assert.match(model, /atomic_generation_swap_committed|atomicBrowseCommitRef/);
});
