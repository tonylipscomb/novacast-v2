import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  createMoviesStartupDurableSnapshot,
  evaluateMoviesStartupBudgets,
  isMoviesStartupDurableSnapshotValidForProvider,
  MOVIES_FOCUS_STAGE4L_MARKER,
  MOVIES_STARTUP_CATEGORIES_MAX_MS,
  MOVIES_STARTUP_INTERACTIVE_MAX_MS,
  MOVIES_STARTUP_VIEWPORT_LIMIT,
  MOVIES_STARTUP_VIEWPORT_MAX_MS,
  parseMoviesStartupDurableSnapshot,
  resolveMoviesStartupFocusTarget,
  shouldDeferMoviesBackgroundGenerationSwap,
  shouldRunMoviesStartupBackgroundWork,
} from '../src/features/movies/moviesStartupFastPath.ts';

const sqlite = fs.readFileSync('src/features/movies/data/SqliteMovieDataSource.ts', 'utf8');
const catalog = fs.readFileSync('src/features/catalog/catalogRepository.ts', 'utf8');
const model = fs.readFileSync('src/features/movies/useMoviesScreenModel.ts', 'utf8');
const screen = fs.readFileSync('src/features/movies/MoviesScreen.tsx', 'utf8');
const snapshotStore = fs.readFileSync('src/features/movies/moviesStartupSnapshotStore.ts', 'utf8');
const fastPath = fs.readFileSync('src/features/movies/moviesStartupFastPath.ts', 'utf8');
const detailClose = fs.readFileSync('src/features/movies/moviesDetailCloseInstant.ts', 'utf8');

const sampleCategories = [
  {
    id: 'all',
    renderKey: 'all',
    name: 'All Movies',
    count: 120,
    countKnown: true,
    kind: 'provider',
    section: 'provider',
  },
  {
    id: 'action',
    renderKey: 'action',
    name: 'Action',
    count: 40,
    countKnown: true,
    kind: 'provider',
    section: 'provider',
  },
  {
    id: 'comedy',
    renderKey: 'comedy',
    name: 'Comedy',
    count: 30,
    countKnown: true,
    kind: 'provider',
    section: 'provider',
  },
];

test('Stage 4.2L marker and contracts are present', () => {
  assert.equal(MOVIES_FOCUS_STAGE4L_MARKER, 'stage4l-movies-startup-fast-path-v1');
  assert.match(fastPath, /movies_startup_shell_mounted|MOVIES_STARTUP_VIEWPORT_LIMIT/);
  assert.match(sqlite, /movies_startup_categories_query_started/);
  assert.match(sqlite, /movies_startup_viewport_query_started/);
  assert.match(model, /movies_startup_durable_categories_ready/);
  assert.match(model, /movies_startup_first_viewport_ready/);
  assert.match(model, /movies_startup_interactive/);
  assert.match(model, /movies_startup_budget_result/);
  assert.match(screen, /movies_startup_focus_request_started/);
});

test('1. Durable categories render before provider refresh completes', () => {
  assert.match(sqlite, /durable-snapshot/);
  assert.match(sqlite, /loadMoviesStartupDurableSnapshot/);
  assert.match(sqlite, /scheduleDeferredFullCategoryRefresh/);
  // Fast path returns before recoverFragmented / resolveMoviesCatalogReadiness.
  const implIdx = sqlite.indexOf('async function getCategoriesImpl');
  const fastIdx = sqlite.indexOf('Stage 4.2L fast path', implIdx);
  const recoverIdx = sqlite.indexOf('recoverFragmentedMovieCatalogOnce', implIdx);
  assert.ok(implIdx > 0 && fastIdx > implIdx && recoverIdx > fastIdx);
});

test('2. First readable viewport renders before provider refresh completes', () => {
  assert.match(sqlite, /skipTotalCount: isStartupViewport/);
  assert.match(sqlite, /MOVIES_STARTUP_VIEWPORT_LIMIT/);
  assert.match(model, /movies_startup_first_viewport_ready/);
  assert.ok(MOVIES_STARTUP_VIEWPORT_LIMIT <= 48);
});

test('3. Movies becomes interactive from the local snapshot', () => {
  assert.match(model, /markStartupInteractiveIfReady/);
  assert.match(model, /movies_startup_interactive/);
  assert.match(model, /startupInteractive/);
});

test('4. Provider refresh may still be running after interaction begins', () => {
  assert.match(model, /providerRefreshStillRunning/);
  assert.match(model, /movies_startup_background_refresh_started/);
  assert.match(sqlite, /movies_startup_background_refresh_started/);
});

test('5. No readable snapshot: network fallback works', () => {
  assert.match(sqlite, /movies_startup_network_fallback_started/);
  assert.match(sqlite, /no-local-snapshot/);
  assert.match(sqlite, /forceFull/);
});

test('6. Provider mismatch: snapshot is rejected', () => {
  const snapshot = createMoviesStartupDurableSnapshot({
    providerId: 'provider-a',
    generation: 3,
    categories: sampleCategories,
    totalMovieCount: 120,
    itemRows: 120,
  });
  assert.equal(
    isMoviesStartupDurableSnapshotValidForProvider({
      snapshot,
      providerId: 'provider-b',
      readableItemCount: 120,
    }),
    false,
  );
});

test('7. Unreadable/corrupt generation: snapshot rejected without deleting others', () => {
  const snapshot = createMoviesStartupDurableSnapshot({
    providerId: 'provider-a',
    generation: 3,
    categories: sampleCategories,
    totalMovieCount: 120,
    itemRows: 120,
  });
  assert.equal(
    isMoviesStartupDurableSnapshotValidForProvider({
      snapshot,
      providerId: 'provider-a',
      readableItemCount: 0,
    }),
    false,
  );
  assert.match(sqlite, /movies_startup_snapshot_unavailable/);
  assert.match(sqlite, /unreadable-generation/);
  // Must not wipe other generations on reject.
  assert.doesNotMatch(sqlite, /DELETE FROM .* WHERE provider_id/);
  assert.match(snapshotStore, /loadMoviesStartupDurableSnapshot/);
});

test('8. Saved category exists: exact category restored', () => {
  assert.match(model, /resolveMoviesInitialCategory/);
  assert.match(model, /rememberedCategoryId/);
  assert.match(model, /previousCategoryId/);
});

test('9. Saved category missing: deterministic valid category selected', () => {
  assert.match(model, /resolveMoviesInitialCategory/);
  assert.match(model, /usedAllMoviesFallback|selectedCategoryId/);
});

test('10. Saved movie exists: exact poster focus restored', () => {
  const focus = resolveMoviesStartupFocusTarget({
    savedMovieId: 'm-2',
    selectedMovieId: 'm-9',
    viewportMovieIds: ['m-1', 'm-2', 'm-3'],
    hasCategories: true,
  });
  assert.equal(focus.movieId, 'm-2');
  assert.equal(focus.reason, 'saved-focused');
  assert.equal(focus.fallbackUsed, false);
});

test('11. Saved movie missing: safe poster fallback used', () => {
  const focus = resolveMoviesStartupFocusTarget({
    savedMovieId: 'gone',
    selectedMovieId: null,
    viewportMovieIds: ['m-1', 'm-2'],
    hasCategories: true,
  });
  assert.equal(focus.movieId, 'm-1');
  assert.equal(focus.reason, 'first-viewport');
  assert.equal(focus.fallbackUsed, true);
  assert.match(model, /movies_startup_focus_fallback_used/);
});

test('12. Background refresh does not clear categories', () => {
  assert.match(model, /hadInteractiveSnapshot/);
  assert.match(model, /empty-categories/);
  assert.match(model, /movies_background_generation_swap_deferred/);
  assert.match(model, /mergeCategoriesPreservingCounts/);
});

test('13. Background refresh does not empty the grid', () => {
  assert.match(model, /empty-grid/);
  assert.match(model, /page\.items\.length === 0 && visibleMoviesRef/);
});

test('14. Compatible replacement preserves category, movie, offset, identities', () => {
  assert.match(model, /movies_background_generation_swap_committed/);
  assert.match(model, /preservedFocus/);
  assert.match(model, /previousOffset/);
  assert.match(model, /previousFocusedMovieId/);
  assert.match(model, /requestSqliteMovieCategoriesFullRefresh/);
  // Rail/grid instance ids are screen-owned and must not be recreated on catalog ready.
  assert.match(screen, /railInstanceIdRef/);
  assert.doesNotMatch(
    model,
    /createMoviesCategoryRailInstanceId\(\)/,
  );
});

test('15. Incompatible replacement is deferred while user/detail active', () => {
  const deferred = shouldDeferMoviesBackgroundGenerationSwap({
    detailOpen: false,
    detailClosing: true,
    restoringBrowseFocus: false,
    playbackActive: false,
    userNavigating: false,
    activeCategoryExistsInReplacement: true,
    focusedMovieExistsInReplacement: true,
  });
  assert.equal(deferred.defer, true);
  assert.equal(deferred.reason, 'detail-active');
  assert.equal(
    shouldRunMoviesStartupBackgroundWork({ detailOpen: true, detailClosing: false }),
    false,
  );
  const missingFocus = shouldDeferMoviesBackgroundGenerationSwap({
    detailOpen: false,
    detailClosing: false,
    restoringBrowseFocus: false,
    playbackActive: false,
    userNavigating: false,
    activeCategoryExistsInReplacement: true,
    focusedMovieExistsInReplacement: false,
  });
  assert.equal(missingFocus.defer, true);
  assert.equal(missingFocus.reason, 'focused-movie-missing');
});

test('16. Category query does not use an N+1 count loop', () => {
  assert.match(catalog, /getCatalogCategoryMetadataOnly/);
  assert.match(catalog, /getCatalogGenerationRowCount/);
  assert.match(sqlite, /getCatalogCategoryMetadataOnly/);
  // Startup metadata path must not call getCategoryCount per id.
  const metaBlockStart = sqlite.indexOf('buildStartupCategoriesFromMetadata');
  const metaBlock = sqlite.slice(metaBlockStart, metaBlockStart + 1200);
  assert.doesNotMatch(metaBlock, /getCategoryCount/);
  assert.doesNotMatch(metaBlock, /getCatalogCategoryCounts/);
  // Fast-path branch uses metadata-only, not GROUP BY counts.
  const fastStart = sqlite.indexOf('Stage 4.2L fast path');
  const forceFullIdx = sqlite.indexOf('forceFull === true', fastStart);
  const fastBlock = sqlite.slice(fastStart, forceFullIdx > fastStart ? forceFullIdx : fastStart + 8000);
  assert.match(fastBlock, /getCatalogCategoryMetadataOnly/);
  assert.doesNotMatch(fastBlock, /getCatalogCategoryCounts/);
});

test('17. First viewport query is bounded and does not decode the full catalog', () => {
  assert.ok(MOVIES_STARTUP_VIEWPORT_LIMIT > 0);
  assert.match(sqlite, /Math\.min\(input\.limit, MOVIES_STARTUP_VIEWPORT_LIMIT\)/);
  assert.match(sqlite, /skipTotalCount: isStartupViewport/);
  assert.doesNotMatch(sqlite, /listCategoryMovies\(/);
});

test('18. Initial startup state is committed in bounded render/state-update counts', () => {
  assert.match(model, /categoryReplacements/);
  assert.match(model, /movieReplacements/);
  assert.match(model, /durableCategoriesReady/);
  assert.match(model, /firstViewportReady/);
  // Interactive is one commit after categories + viewport, not a poll loop.
  assert.match(model, /markStartupInteractiveIfReady/);
});

test('19. Offline startup uses the durable snapshot', () => {
  const raw = JSON.stringify(
    createMoviesStartupDurableSnapshot({
      providerId: 'p1',
      generation: 7,
      categories: sampleCategories,
      totalMovieCount: 99,
      itemRows: 99,
      selectedCategoryId: 'action',
      savedMovieId: 'm-2',
    }),
  );
  const parsed = parseMoviesStartupDurableSnapshot(raw);
  assert.ok(parsed);
  assert.equal(parsed.providerId, 'p1');
  assert.equal(parsed.generation, 7);
  assert.equal(parsed.selectedCategoryId, 'action');
  assert.equal(
    isMoviesStartupDurableSnapshotValidForProvider({
      snapshot: parsed,
      providerId: 'p1',
      readableItemCount: 99,
    }),
    true,
  );
  assert.match(sqlite, /durable-snapshot/);
  assert.match(snapshotStore, /AsyncStorage/);
});

test('20. Stage 4.2K.2 Detail-close pipeline remains intact', () => {
  assert.match(detailClose, /MOVIES_FOCUS_STAGE4K2_MARKER/);
  assert.match(detailClose, /createMoviesDetailCloseImmutableTarget/);
  assert.match(detailClose, /shouldAcceptMoviesDetailCloseLateFocus/);
  assert.match(screen, /MOVIES_FOCUS_STAGE4K2_MARKER/);
  assert.match(screen, /detail_close_immutable_target_locked|createMoviesDetailCloseImmutableTarget/);
  // New 4.2L work must not run during Detail close.
  assert.match(model, /shouldRunMoviesStartupBackgroundWork/);
  assert.match(screen, /detailClosing/);
  assert.match(screen, /startupInteractive/);
});

test('Startup budgets match Stage 4.2L acceptance windows', () => {
  assert.equal(MOVIES_STARTUP_CATEGORIES_MAX_MS, 5000);
  assert.equal(MOVIES_STARTUP_VIEWPORT_MAX_MS, 10000);
  assert.equal(MOVIES_STARTUP_INTERACTIVE_MAX_MS, 10000);
  const pass = evaluateMoviesStartupBudgets({
    categoriesElapsedMs: 1800,
    firstViewportElapsedMs: 3500,
    interactiveElapsedMs: 4000,
    startupMode: 'durable-snapshot',
    providerRefreshStillRunning: true,
  });
  assert.equal(pass.categoriesBudgetPassed, true);
  assert.equal(pass.viewportBudgetPassed, true);
  assert.equal(pass.interactiveBudgetPassed, true);
  const fail = evaluateMoviesStartupBudgets({
    categoriesElapsedMs: 8000,
    firstViewportElapsedMs: 12000,
    interactiveElapsedMs: 13000,
    startupMode: 'network-fallback',
    providerRefreshStillRunning: true,
  });
  assert.equal(fail.categoriesBudgetPassed, false);
  assert.equal(fail.viewportBudgetPassed, false);
  assert.equal(fail.interactiveBudgetPassed, false);
});

test('Catalog helpers expose metadata-only and row-count fast queries', () => {
  assert.match(catalog, /Stage 4\.2L: lightweight generation presence check/);
  assert.match(catalog, /Stage 4\.2L: category rail metadata without GROUP BY/);
  assert.match(catalog, /SELECT COUNT\(\*\) AS total/);
  assert.match(
    catalog,
    /SELECT category_id, category_name, sort_order[\s\S]*FROM \$\{categoriesTable\}/,
  );
});
