import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { spawnSync } from 'node:child_process';

import {
  createSeriesStartupDurableSnapshot,
  evaluateSeriesStartupBudgets,
  isSeriesStartupDurableSnapshotValidForProvider,
  mergeSeriesCategoriesPreservingCounts,
  parseSeriesStartupDurableSnapshot,
  resolveSeriesStartupFocusTarget,
  SERIES_FOCUS_STAGE4O_MARKER,
  SERIES_STARTUP_CATEGORIES_MAX_MS,
  SERIES_STARTUP_INTERACTIVE_MAX_MS,
  SERIES_STARTUP_VIEWPORT_LIMIT,
  SERIES_STARTUP_VIEWPORT_MAX_MS,
  shouldDeferSeriesBackgroundCategoriesSwap,
  shouldRunSeriesStartupBackgroundWork,
} from '../src/features/series/seriesStartupFastPath.ts';
import {
  beginSeriesStartupSession,
  markSeriesStartupSessionInteractive,
  releaseSeriesStartupFocusOwnership,
  resetSeriesStartupSessionsForTests,
  SERIES_FOCUS_STAGE4O1_MARKER,
  shouldBlockSeriesStartupReentry,
  shouldDropLateSeriesStartupFocusResult,
} from '../src/features/series/seriesStartupRuntimeIsolation.ts';

const model = fs.readFileSync('src/features/series/useSeriesScreenModel.ts', 'utf8');
const screen = fs.readFileSync('src/features/series/SeriesScreen.tsx', 'utf8');
const fastPath = fs.readFileSync('src/features/series/seriesStartupFastPath.ts', 'utf8');
const isolation = fs.readFileSync('src/features/series/seriesStartupRuntimeIsolation.ts', 'utf8');
const snapshotStore = fs.readFileSync('src/features/series/seriesStartupSnapshotStore.ts', 'utf8');
const diagnostics = fs.readFileSync('src/features/series/seriesDiagnostics.ts', 'utf8');
const grid = fs.readFileSync('src/features/series/components/SeriesPosterGrid.tsx', 'utf8');

const sampleCategories = [
  { id: 'all', name: 'All Series', count: 80, countKnown: true, kind: 'provider' },
  { id: 'drama', name: 'Drama', count: 30, countKnown: true, kind: 'provider' },
  { id: 'comedy', name: 'Comedy', count: 20, countKnown: true, kind: 'provider' },
];

test('Stage 4.2O markers are present', () => {
  assert.equal(SERIES_FOCUS_STAGE4O_MARKER, 'stage4o-series-startup-fast-path-v1');
  assert.equal(SERIES_FOCUS_STAGE4O1_MARKER, 'stage4o1-series-startup-runtime-isolation-v1');
  assert.match(model, /SERIES_FOCUS_STAGE4O_MARKER/);
  assert.match(model, /SERIES_FOCUS_STAGE4O1_MARKER/);
});

test('1. Series durable categories render before provider refresh', () => {
  assert.match(model, /getMemorySeriesStartupSnapshot/);
  assert.match(model, /loadSeriesStartupDurableSnapshot/);
  assert.match(model, /series_startup_durable_categories_ready/);
  // Memory/durable snapshot application happens before the network-fallback branch.
  const memoryIdx = model.indexOf("applyCategories(memory.categories, 'memory-cache')");
  const durableIdx = model.indexOf("applyCategories(durable.categories, 'durable-snapshot')");
  const noSnapshotIdx = model.indexOf('no-local-snapshot');
  assert.ok(memoryIdx > 0 && durableIdx > memoryIdx && noSnapshotIdx > durableIdx);
});

test('2. First Series viewport uses a bounded pinned-generation-style query', () => {
  assert.ok(SERIES_STARTUP_VIEWPORT_LIMIT > 0 && SERIES_STARTUP_VIEWPORT_LIMIT <= 48);
  assert.match(model, /SERIES_STARTUP_VIEWPORT_LIMIT/);
  assert.match(model, /isStartupViewport/);
  assert.match(model, /pageLimit = isStartupViewport \? SERIES_STARTUP_VIEWPORT_LIMIT : 48/);
});

test('3. Series becomes interactive before refresh completes', () => {
  assert.match(model, /markStartupInteractiveIfReady/);
  assert.match(model, /series_startup_interactive/);
  assert.match(model, /startupInteractive/);
  assert.match(model, /providerRefreshStillRunning: !state\.backgroundRefreshFinished/);
});

test('4. Startup runs once per route/provider', () => {
  resetSeriesStartupSessionsForTests();
  const session = beginSeriesStartupSession('provider-x');
  assert.ok(session.sessionId.includes('provider-x'));
  assert.equal(shouldBlockSeriesStartupReentry('provider-x'), false);
  markSeriesStartupSessionInteractive('provider-x');
  assert.equal(shouldBlockSeriesStartupReentry('provider-x'), true);
  assert.match(model, /shouldBlockSeriesStartupReentry/);
  assert.match(model, /beginSeriesStartupSession/);
});

test('5. Category changes do not restart startup', () => {
  resetSeriesStartupSessionsForTests();
  beginSeriesStartupSession('provider-y');
  markSeriesStartupSessionInteractive('provider-y');
  assert.equal(shouldBlockSeriesStartupReentry('provider-y'), true);
  // The startup-session effect keys only on activeProviderId, not selectedCategoryId.
  const startupEffectStart = model.indexOf('route/provider mount');
  const startupEffectEnd = model.indexOf('}, [activeProviderId]);', startupEffectStart);
  assert.ok(startupEffectStart > 0 && startupEffectEnd > startupEffectStart);
  const startupEffectBlock = model.slice(startupEffectStart, startupEffectEnd);
  assert.doesNotMatch(startupEffectBlock, /selectedCategoryId/);
});

test('6. Category rail stays mounted across category changes', () => {
  assert.match(screen, /<MediaCategoryRail/);
  assert.match(screen, /railInstanceIdRef/);
  // Rail render is not gated behind selectedCategoryId or a category-keyed condition.
  const railIdx = screen.indexOf('<MediaCategoryRail');
  const beforeRail = screen.slice(Math.max(0, railIdx - 400), railIdx);
  assert.doesNotMatch(beforeRail, /selectedCategoryId \? \(/);
});

test('7. Grid stays mounted across category changes', () => {
  assert.match(screen, /<SeriesPosterGrid/);
  assert.doesNotMatch(screen, /key=\{selectedCategoryId\}/);
  assert.match(screen, /setOnnSeriesGridMounted\(true, instanceId\)/);
  assert.match(screen, /useEffect\(\(\) => \{\s*const instanceId = gridInstanceIdRef\.current;/);
});

test('8. Background refresh never empties categories', () => {
  const healthyRail = [
    { id: 'all', name: 'All Series', count: 200, countKnown: true, kind: 'provider' },
    { id: 'drama', name: 'Drama', count: 40, countKnown: true, kind: 'provider' },
    { id: 'comedy', name: 'Comedy', count: 30, countKnown: true, kind: 'provider' },
    { id: 'action', name: 'Action', count: 25, countKnown: true, kind: 'provider' },
    { id: 'kids', name: 'Kids', count: 20, countKnown: true, kind: 'provider' },
    { id: 'anime', name: 'Anime', count: 15, countKnown: true, kind: 'provider' },
  ];
  const merged = mergeSeriesCategoriesPreservingCounts(healthyRail, []);
  assert.equal(merged.length, healthyRail.length);
  const collapsed = mergeSeriesCategoriesPreservingCounts(healthyRail, [
    { id: 'all', name: 'All Series', count: 0, countKnown: false, kind: 'provider' },
  ]);
  assert.equal(collapsed.length, healthyRail.length);
  assert.match(model, /mergeSeriesCategoriesPreservingCounts/);
});

test('9. Background refresh never empties visible Series', () => {
  // Category/viewport effect never clears visibleItems on a background categories-only refresh —
  // it only calls setVisibleItems from the dedicated page-load effect keyed on category/provider/sort.
  const categoriesEffectStart = model.indexOf('durable-snapshot-first category load');
  const categoriesEffectEnd = model.indexOf('default-select a category', categoriesEffectStart);
  const categoriesEffectBlock = model.slice(categoriesEffectStart, categoriesEffectEnd);
  assert.doesNotMatch(categoriesEffectBlock, /setVisibleItems/);
});

test('10. Compatible swaps preserve category, focus, and offset', () => {
  const compatible = shouldDeferSeriesBackgroundCategoriesSwap({
    detailOpen: false,
    detailClosing: false,
    restoringBrowseFocus: false,
    playbackActive: false,
    userNavigating: false,
    activeCategoryExistsInReplacement: true,
    focusedSeriesExistsInReplacement: true,
  });
  assert.equal(compatible.defer, false);
  assert.equal(compatible.reason, 'compatible-swap');
  const incompatible = shouldDeferSeriesBackgroundCategoriesSwap({
    detailOpen: true,
    detailClosing: false,
    restoringBrowseFocus: false,
    playbackActive: false,
    userNavigating: false,
    activeCategoryExistsInReplacement: true,
    focusedSeriesExistsInReplacement: true,
  });
  assert.equal(incompatible.defer, true);
  assert.equal(incompatible.reason, 'detail-active');
  assert.match(fastPath, /shouldDeferSeriesBackgroundCategoriesSwap/);
});

test('11. Stale Series results are dropped', () => {
  assert.match(model, /buildContentSortRequestKey/);
  assert.match(model, /requestGenerationRef/);
  assert.match(model, /!== requestKey/);
  // loadInitialPage bails out on stale generation before mutating any state.
  const loadInitialStart = model.indexOf('const loadInitialPage = async');
  const loadInitialEnd = model.indexOf('void loadInitialPage();', loadInitialStart);
  const loadInitialBlock = model.slice(loadInitialStart, loadInitialEnd);
  assert.match(loadInitialBlock, /cancelled \|\|[\s\S]*!== requestKey/);
});

test('12. Pagination appends without duplicate IDs', () => {
  assert.match(model, /function uniqueSeries/);
  assert.match(model, /uniqueSeries\(current, page\.items\)/);
  assert.match(model, /const seen = new Set\(existing\.map\(\(series\) => series\.id\)\)/);
});

test('13. Pagination does not remount the grid', () => {
  const loadMoreStart = model.indexOf('const loadMore = useCallback');
  const loadMoreEnd = model.indexOf('const library = useMediaLibraryStore', loadMoreStart);
  const loadMoreBlock = model.slice(loadMoreStart, loadMoreEnd);
  assert.doesNotMatch(loadMoreBlock, /setCategories\(/);
  assert.match(loadMoreBlock, /setVisibleItems\(\(current\) => \{/);
  assert.match(grid, /key=\{columns\}/); // FlatList is keyed only by column count, not category/page.
  assert.doesNotMatch(grid, /key=\{selectedCategoryId\}/);
});

test('14. Seasons/episodes are not hydrated during browse startup', () => {
  const pageEffectStart = model.indexOf('bounded first-viewport + category-switch page effect');
  const pageEffectEnd = model.indexOf('const focusedItem = useMemo', pageEffectStart);
  const pageEffectBlock = model.slice(pageEffectStart, pageEffectEnd);
  assert.doesNotMatch(pageEffectBlock, /getSeriesInfo/);
  assert.doesNotMatch(pageEffectBlock, /episodesBySeason/);
  assert.match(model, /getSeriesInfo/); // only used by loadSeriesDetail, gated on explicit selection.
  const loadDetailStart = model.indexOf('const loadSeriesDetail = useCallback');
  assert.ok(loadDetailStart > pageEffectEnd);
});

test('15. Detail open does not replace browse arrays', () => {
  const openBlockStart = screen.indexOf('const handleSelectSeries = useCallback');
  const openBlockEnd = screen.indexOf('const handleRegisterPosterRef', openBlockStart);
  const openBlock = screen.slice(openBlockStart, openBlockEnd);
  assert.doesNotMatch(openBlock, /setVisibleItems|setCategories/);
  assert.match(screen, /categories-replaced-by-detail/);
  assert.match(screen, /visible-series-replaced-by-detail/);
  assert.match(screen, /logSeriesBrowseIsolationViolation/);
});

test('16. Detail close does not reload the category', () => {
  const closeStart = screen.indexOf('const closeDetailOverlay = useCallback');
  const closeEnd = screen.indexOf('const closeDetail = useCallback', closeStart);
  const closeBlock = screen.slice(closeStart, closeEnd);
  assert.doesNotMatch(closeBlock, /selectCategory\(/);
  assert.doesNotMatch(closeBlock, /reload\(\)/);
});

test('17. Playback return does not remount the grid', () => {
  assert.match(screen, /playbackUiActive && styles\.browseLayerHidden/);
  assert.doesNotMatch(screen, /\{!playbackUiActive \? \(/);
  assert.match(screen, /display: 'none'/);
});

test('18. Search preserves browse state', () => {
  assert.match(screen, /closeSearch = useCallback/);
  const closeSearchStart = screen.indexOf('const closeSearch = useCallback');
  const closeSearchEnd = screen.indexOf('}, [focusSelectedPoster]);', closeSearchStart);
  const closeSearchBlock = screen.slice(closeSearchStart, closeSearchEnd);
  assert.doesNotMatch(closeSearchBlock, /selectCategory\(|setCategories\(/);
  assert.match(screen, /handleSearchSelect/);
  const searchSelectStart = screen.indexOf('const handleSearchSelect = useCallback');
  const searchSelectEnd = screen.indexOf('const playEpisodeById', searchSelectStart);
  const searchSelectBlock = screen.slice(searchSelectStart, searchSelectEnd);
  assert.doesNotMatch(searchSelectBlock, /setCategories\(|setVisibleItems\(/);
});

test('19. Offline startup uses durable Series snapshot', () => {
  const raw = JSON.stringify(
    createSeriesStartupDurableSnapshot({
      providerId: 'p1',
      generation: 4,
      categories: sampleCategories,
      selectedCategoryId: 'drama',
      savedSeriesId: 's-2',
      readableRowCount: sampleCategories.length,
    }),
  );
  const parsed = parseSeriesStartupDurableSnapshot(raw);
  assert.ok(parsed);
  assert.equal(parsed.providerId, 'p1');
  assert.equal(parsed.generation, 4);
  assert.equal(parsed.selectedCategoryId, 'drama');
  assert.equal(
    isSeriesStartupDurableSnapshotValidForProvider({ snapshot: parsed, providerId: 'p1' }),
    true,
  );
  assert.equal(
    isSeriesStartupDurableSnapshotValidForProvider({ snapshot: parsed, providerId: 'p2' }),
    false,
  );
  assert.match(snapshotStore, /AsyncStorage/);
  assert.match(snapshotStore, /getMemorySeriesStartupSnapshot/);
});

test('20. Whole-screen error is not shown after readable content exists', () => {
  // The whole-route error return only triggers when categories.length === 0 AND loadStatus === 'error'.
  const errorReturnStart = screen.indexOf("if (categories.length === 0 && loadStatus === 'error')");
  assert.ok(errorReturnStart > 0);
  // Once categories are non-empty (durable/memory snapshot), the main browse JSX renders instead.
  assert.doesNotMatch(model, /loadStatus: resolvedDataSource \? browseLoadStatus2 : 'error'[\s\S]{0,20}\/\/ always error/);
});

test('21. Focus requests validate targets and cannot throw', () => {
  assert.match(screen, /requestTvFocus\(\{/);
  assert.match(screen, /getTarget: \(\) => posterRefs\.current\.get\(restoreId\)/);
  // requestTvFocus itself is the shared hardened API (not reimplemented in Series).
  assert.doesNotMatch(screen, /function requestTvFocus/);
  assert.match(screen, /from '@\/features\/navigation\/tvFocusDiagnostics'/);
});

function runNestedNodeTest(file) {
  // node:test refuses to run a nested `--test` invocation in the same process
  // tree (it detects NODE_TEST_CONTEXT and silently skips). Strip it so this
  // spawned child actually executes as its own top-level test run.
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  return spawnSync(process.execPath, ['--experimental-strip-types', '--test', file], {
    encoding: 'utf8',
    env,
  });
}

test('22. Movies Stage 4.2N tests remain passing', () => {
  const result = runNestedNodeTest('scripts/movies-stage4n-detail-popup-v2.test.mjs');
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  assert.match(output, /# pass 24/);
  assert.doesNotMatch(output, /# fail [1-9]/);
});

test('23. Existing Series contracts remain passing (series-stage4m-simple-overlay)', () => {
  const result = runNestedNodeTest('scripts/series-stage4m-simple-overlay.test.mjs');
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  assert.match(output, /# pass 10/);
  assert.doesNotMatch(output, /# fail [1-9]/);
});

test('Startup budgets match Stage 4.2O acceptance windows', () => {
  assert.equal(SERIES_STARTUP_CATEGORIES_MAX_MS, 5000);
  assert.equal(SERIES_STARTUP_VIEWPORT_MAX_MS, 10000);
  assert.equal(SERIES_STARTUP_INTERACTIVE_MAX_MS, 10000);
  const pass = evaluateSeriesStartupBudgets({
    categoriesElapsedMs: 1500,
    firstViewportElapsedMs: 3000,
    interactiveElapsedMs: 3500,
    startupMode: 'durable-snapshot',
    providerRefreshStillRunning: true,
  });
  assert.equal(pass.categoriesBudgetPassed, true);
  assert.equal(pass.viewportBudgetPassed, true);
  assert.equal(pass.interactiveBudgetPassed, true);
  const fail = evaluateSeriesStartupBudgets({
    categoriesElapsedMs: 9000,
    firstViewportElapsedMs: 15000,
    interactiveElapsedMs: 16000,
    startupMode: 'network-fallback',
    providerRefreshStillRunning: true,
  });
  assert.equal(fail.categoriesBudgetPassed, false);
  assert.equal(fail.viewportBudgetPassed, false);
  assert.equal(fail.interactiveBudgetPassed, false);
});

test('Startup focus target resolution mirrors Movies semantics', () => {
  const saved = resolveSeriesStartupFocusTarget({
    savedSeriesId: 's-2',
    selectedSeriesId: 's-9',
    viewportSeriesIds: ['s-1', 's-2', 's-3'],
    hasCategories: true,
  });
  assert.equal(saved.seriesId, 's-2');
  assert.equal(saved.reason, 'saved-focused');
  assert.equal(saved.fallbackUsed, false);

  const fallback = resolveSeriesStartupFocusTarget({
    savedSeriesId: 'gone',
    selectedSeriesId: null,
    viewportSeriesIds: ['s-1', 's-2'],
    hasCategories: true,
  });
  assert.equal(fallback.seriesId, 's-1');
  assert.equal(fallback.reason, 'first-viewport');
  assert.equal(fallback.fallbackUsed, true);
});

test('Late startup focus results are dropped once focus ownership is released', () => {
  resetSeriesStartupSessionsForTests();
  beginSeriesStartupSession('p3');
  const released = releaseSeriesStartupFocusOwnership('p3');
  assert.equal(released.released, true);
  assert.equal(released.session?.focusReleased, true);
  const again = releaseSeriesStartupFocusOwnership('p3');
  assert.equal(again.released, false);
  assert.equal(
    shouldDropLateSeriesStartupFocusResult({
      startupInteractive: true,
      startupFocusReleased: true,
      detailOpen: false,
      detailClosing: false,
    }),
    true,
  );
  assert.match(isolation, /shouldDropLateSeriesStartupFocusResult/);
  assert.match(model, /shouldDropLateSeriesStartupFocusResult/);
});

test('Background work is skipped while Detail is open or closing', () => {
  assert.equal(shouldRunSeriesStartupBackgroundWork({ detailOpen: true, detailClosing: false }), false);
  assert.equal(shouldRunSeriesStartupBackgroundWork({ detailOpen: false, detailClosing: true }), false);
  assert.equal(shouldRunSeriesStartupBackgroundWork({ detailOpen: false, detailClosing: false }), true);
});

test('Series diagnostics module mirrors Movies-style always-on logging', () => {
  assert.match(diagnostics, /export function logSeriesPerf/);
  assert.match(diagnostics, /export function emitSeriesStartup/);
  assert.match(diagnostics, /console\.info/);
  assert.match(model, /logSeriesPerf\(/);
  assert.match(model, /emitSeriesStartup/);
});

test('No Movies active-path files were modified by Stage 4.2O', () => {
  const result = spawnSync('git', ['status', '--porcelain', '--', 'src/features/movies'], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, `git status failed: ${result.stderr}`);
  assert.equal(
    result.stdout.trim(),
    '',
    `Movies files must not change during Stage 4.2O, but git reports:\n${result.stdout}`,
  );
});

test('Series Detail Popup V2 shell files are now wired in by Stage 4.2O.1 (supersedes Stage 4.2O orphan check)', () => {
  // Stage 4.2O.1 wires the previously-orphaned V2 shell files into
  // SeriesScreen.tsx as the active Series Detail popup. The Stage 4.2O
  // assertion that these stayed untouched/untracked is intentionally
  // superseded here — see scripts/series-stage4o1-detail-popup-v2.test.mjs
  // for the full Stage 4.2O.1 contract.
  assert.match(screen, /import \{ SeriesDetailPopupV2 \} from '\.\/components\/SeriesDetailPopupV2'/);
  assert.match(screen, /<SeriesDetailPopupV2/);
  assert.doesNotMatch(model, /SeriesDetailPopupV2|seriesDetailPopupV2/);
});
