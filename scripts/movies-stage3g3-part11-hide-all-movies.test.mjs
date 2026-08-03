import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  ALL_MOVIES_CATEGORY_ID,
  getMovieCategoryRailCategories,
  getVisibleMovieCategories,
  resolveMoviesInitialCategory,
} from '../src/features/movies/moviesVisibleCategories.ts';

const helper = fs.readFileSync('src/features/movies/moviesVisibleCategories.ts', 'utf8');
const model = fs.readFileSync('src/features/movies/useMoviesScreenModel.ts', 'utf8');
const screen = fs.readFileSync('src/features/movies/MoviesScreen.tsx', 'utf8');
const sqlite = fs.readFileSync('src/features/movies/data/SqliteMovieDataSource.ts', 'utf8');
const catalog = fs.readFileSync('src/features/catalog/catalogRepository.ts', 'utf8');
const sync = fs.readFileSync('src/features/providers/providerCatalogSync.ts', 'utf8');
const searchSelection = fs.readFileSync('src/features/search/moviesSearchSelection.ts', 'utf8');
const searchCard = fs.readFileSync('src/features/search/SearchPosterCard.tsx', 'utf8');

const sampleCategories = [
  { id: 'all', renderKey: 'all', name: 'All Movies', count: 173000, countKnown: true, kind: 'provider' },
  { id: 'section:provider', renderKey: 'section:provider', name: 'From Your Provider', count: 0, kind: 'section' },
  { id: 'cat-a', renderKey: 'cat-a', name: 'Action', count: 0, countKnown: true, kind: 'provider' },
  { id: 'cat-b', renderKey: 'cat-b', name: 'Comedy', count: 420, countKnown: true, kind: 'provider' },
  { id: 'cat-c', renderKey: 'cat-c', name: 'Drama', count: 12, countKnown: true, kind: 'provider' },
];

test('1. All Movies is hidden from the visible rail', () => {
  const visible = getVisibleMovieCategories(sampleCategories);
  assert.equal(visible.some((category) => category.id === ALL_MOVIES_CATEGORY_ID), false);
  const rail = getMovieCategoryRailCategories(sampleCategories);
  assert.equal(rail.some((category) => category.id === ALL_MOVIES_CATEGORY_ID), false);
  assert.match(screen, /visibleMovieCategories/);
  assert.match(screen, /railCategories/);
});

test('2. All Movies remains available internally', () => {
  assert.equal(ALL_MOVIES_CATEGORY_ID, 'all');
  assert.match(sqlite, /name: 'All Movies'/);
  assert.match(sqlite, /SQLITE_MOVIES_DISCOVER_ID = 'all'/);
  assert.match(model, /categories: resolvedDataSource \? categories : \[\]/);
  assert.match(helper, /keep available internally/);
});

test('3. first nonzero provider category is selected once', () => {
  const decision = resolveMoviesInitialCategory({
    categories: sampleCategories,
    previousCategoryId: 'all',
    rememberedCategoryId: 'all',
  });
  assert.equal(decision.selectedCategoryId, 'cat-b');
  assert.equal(decision.reason, 'first-provider-category');
  assert.equal(decision.usedAllMoviesFallback, false);
  assert.equal(decision.shouldLog, true);
});

test('4. selection is not forced again on rerender', () => {
  const decision = resolveMoviesInitialCategory({
    categories: sampleCategories,
    previousCategoryId: 'cat-c',
    rememberedCategoryId: 'all',
  });
  assert.equal(decision.selectedCategoryId, 'cat-c');
  assert.equal(decision.reason, 'preserved-existing-selection');
  assert.equal(decision.shouldLog, false);
});

test('5. user-selected category persists', () => {
  const decision = resolveMoviesInitialCategory({
    categories: sampleCategories,
    previousCategoryId: 'cat-b',
    rememberedCategoryId: 'cat-a',
  });
  assert.equal(decision.selectedCategoryId, 'cat-b');
  assert.equal(decision.shouldLog, false);
});

test('6. Search/detail close does not reset category', () => {
  assert.match(screen, /detailSourceRef\.current === 'search'/);
  assert.doesNotMatch(screen, /selectCategory\(['"]all['"]\)/);
  assert.doesNotMatch(screen, /setSelectedCategoryId\(['"]all['"]\)/);
  // Close paths must not call category init helpers.
  const closeDetail = screen.slice(screen.indexOf('const closeDetail'), screen.indexOf('beginFocusAuditCycle'));
  assert.doesNotMatch(closeDetail, /resolveMoviesInitialCategory/);
  assert.doesNotMatch(closeDetail, /selectCategory\(/);
});

test('7. publication refresh preserves a valid selection', () => {
  assert.match(model, /resolveMoviesInitialCategory/);
  assert.match(model, /rememberedCategoryId: remembered/);
  const preserved = resolveMoviesInitialCategory({
    categories: sampleCategories,
    previousCategoryId: 'cat-b',
    rememberedCategoryId: 'cat-b',
  });
  assert.equal(preserved.selectedCategoryId, 'cat-b');
  assert.equal(preserved.shouldLog, false);
});

test('8. empty provider categories fall back safely to All Movies', () => {
  const onlyAll = [
    { id: 'all', renderKey: 'all', name: 'All Movies', count: 10, countKnown: true, kind: 'provider' },
  ];
  const decision = resolveMoviesInitialCategory({
    categories: onlyAll,
    previousCategoryId: '',
    rememberedCategoryId: 'all',
  });
  assert.equal(decision.selectedCategoryId, 'all');
  assert.equal(decision.reason, 'no-visible-categories');
  assert.equal(decision.usedAllMoviesFallback, true);

  const allZero = [
    { id: 'all', renderKey: 'all', name: 'All Movies', count: 99, countKnown: true, kind: 'provider' },
    { id: 'empty-a', renderKey: 'empty-a', name: 'Empty A', count: 0, countKnown: true, kind: 'provider' },
    { id: 'empty-b', renderKey: 'empty-b', name: 'Empty B', count: 0, countKnown: true, kind: 'provider' },
  ];
  const zeroDecision = resolveMoviesInitialCategory({
    categories: allZero,
    previousCategoryId: 'all',
    rememberedCategoryId: 'all',
  });
  assert.equal(zeroDecision.selectedCategoryId, 'all');
  assert.equal(zeroDecision.reason, 'no-nonzero-provider-category');
  assert.equal(zeroDecision.usedAllMoviesFallback, true);

  const railFallback = getMovieCategoryRailCategories(onlyAll);
  assert.equal(railFallback.some((category) => category.id === 'all'), true);
});

test('9. no sync or catalog-generation work is triggered', () => {
  assert.doesNotMatch(helper, /subscribeMovieCatalogReady|startCatalogSync|runCatalogSync/);
  assert.doesNotMatch(helper, /getCatalogCategoryCounts|resolveReadableCatalogGeneration/);
  // Selection helper is pure; model still uses existing loadCategories path only.
  assert.match(model, /resolveMoviesInitialCategory/);
  assert.doesNotMatch(model, /startCatalogSync|forceCatalogRebuild/);
});

test('10. category counts remain unchanged', () => {
  const before = sampleCategories.map((category) => category.count);
  getVisibleMovieCategories(sampleCategories);
  getMovieCategoryRailCategories(sampleCategories);
  resolveMoviesInitialCategory({
    categories: sampleCategories,
    previousCategoryId: 'all',
    rememberedCategoryId: 'all',
  });
  assert.deepEqual(
    sampleCategories.map((category) => category.count),
    before,
  );
  assert.match(sqlite, /allMoviesTotal: totalCount/);
});

test('11. Stage 3G.3 Search behavior remains unchanged', () => {
  assert.match(searchSelection, /stage3g3-search-selection-lifecycle-v1/);
  assert.match(searchCard, /createMoviePosterFocusChrome/);
  assert.match(screen, /openMovieDetailFromSearch/);
  assert.match(screen, /retainMounted=\{searchOpen && !playbackUiActive\}/);
  assert.doesNotMatch(catalog, /stage3g3-part11/);
  assert.doesNotMatch(sync, /stage3g3-part11/);
});

test('12. diagnostics + guard wiring', () => {
  assert.match(helper, /\[NovaCast Movies Initial Category\]/);
  assert.match(helper, /first-provider-category/);
  assert.match(helper, /no-visible-categories/);
  assert.match(model, /logMoviesInitialCategory/);
  assert.match(model, /decision\.shouldLog/);
});
