import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { spawnSync } from 'node:child_process';

const sqliteDs = fs.readFileSync('src/features/series/data/SqliteSeriesDataSource.ts', 'utf8');
const providerBundle = fs.readFileSync('src/features/providers/providerBundle.ts', 'utf8');
const model = fs.readFileSync('src/features/series/useSeriesScreenModel.ts', 'utf8');
const catalogRepository = fs.readFileSync('src/features/catalog/catalogRepository.ts', 'utf8');
const catalogTableRouting = fs.readFileSync('src/features/catalog/catalogTableRouting.ts', 'utf8');
const catalogSqliteSyncWriter = fs.readFileSync('src/features/catalog/catalogSqliteSyncWriter.ts', 'utf8');
const providerCatalogSync = fs.readFileSync('src/features/providers/providerCatalogSync.ts', 'utf8');
const seriesDiagnostics = fs.readFileSync('src/features/series/seriesDiagnostics.ts', 'utf8');

function sliceBlock(source, startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  assert.notEqual(start, -1, `missing block start: ${startNeedle}`);
  const end = source.indexOf(endNeedle, start);
  assert.notEqual(end, -1, `missing block end: ${endNeedle}`);
  return source.slice(start, end);
}

function runSuite(name) {
  // NODE_TEST_CONTEXT is set by Node's own test runner and, if inherited,
  // makes the child `--test` invocation detect "recursion" and skip running
  // the file entirely (silent 0/0 pass) — strip it so the child suite
  // actually executes standalone.
  const childEnv = { ...process.env };
  delete childEnv.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, ['--experimental-strip-types', '--test', `scripts/${name}`], {
    encoding: 'utf8',
    env: childEnv,
  });
  return result;
}

function countTapPass(output) {
  const match = output.match(/# pass (\d+)/);
  return match ? Number(match[1]) : 0;
}

function countTapFail(output) {
  const match = output.match(/# fail (\d+)/);
  return match ? Number(match[1]) : 0;
}

test('1. Series categories are read from SQLite when a readable generation exists', () => {
  assert.match(sqliteDs, /getCatalogCategoryMetadataOnly/);
  assert.match(sqliteDs, /resolveReadableCatalogGeneration/);
  assert.match(sqliteDs, /async function getCategoriesImpl/);
});

test('2. Series first viewport is read from pinned SQLite generation', () => {
  const block = sliceBlock(sqliteDs, 'async function getSeriesPageImpl', 'async function searchSeriesImpl');
  assert.match(block, /requireReadableGeneration\(queryPurpose\)/);
  assert.match(block, /getCatalogItemsPage\(/);
  assert.match(block, /generation: queryGeneration/);
});

test('3. Provider network is not required for local startup', () => {
  assert.doesNotMatch(sqliteDs, /fetch\(|XtreamClient|get_series/);
  assert.match(sqliteDs, /export function createSqliteSeriesDataSource/);
});

test('4. AsyncStorage snapshot is not treated as the content store', () => {
  // Memory/durable snapshot application is always immediately followed by a
  // reconciliation call into resolvedDataSource.getCategories() (SQLite-first
  // as of this stage), so a stale snapshot never persists as the source of truth.
  const memoryIdx = model.indexOf('if (memory && memory.categories.length > 0)');
  const memoryReconcileIdx = model.indexOf("loadCategoriesFromNetwork('memory-cache-reconcile')");
  const durableIdx = model.indexOf('if (durable && durable.providerId === activeProviderId');
  const durableReconcileIdx = model.indexOf("loadCategoriesFromNetwork('durable-snapshot-reconcile')");
  assert.ok(memoryIdx > 0, 'memory-cache branch not found');
  assert.ok(memoryReconcileIdx > memoryIdx, 'memory branch must reconcile via loadCategoriesFromNetwork');
  assert.ok(durableIdx > memoryReconcileIdx, 'durable-snapshot branch not found after memory branch');
  assert.ok(durableReconcileIdx > durableIdx, 'durable branch must reconcile via loadCategoriesFromNetwork');
});

test('5. Categories and viewport use the same generation via a shared pinning helper', () => {
  const occurrences = sqliteDs.match(/requireReadableGeneration\(/g) ?? [];
  assert.ok(occurrences.length >= 4, 'expected getCategories/getSeriesPage/search/counts to share one generation-pinning helper');
});

test('6. First viewport is bounded (no full catalog scan)', () => {
  assert.match(catalogRepository, /const limit = Math\.min\(Math\.max\(query\.limit \?\? CATALOG_DEFAULT_PAGE_SIZE, 1\), 100\)/);
  assert.match(model, /SERIES_STARTUP_VIEWPORT_LIMIT/);
});

test('7. Startup query does not hydrate seasons/episodes', () => {
  const pageBlock = sliceBlock(sqliteDs, 'function mapCatalogItemToSeries', 'function buildSeriesCategoriesFromMetadata');
  assert.doesNotMatch(pageBlock, /season|episode/i);
  assert.match(sqliteDs, /browse SQLite is card-level only/);
});

test('8. Pagination reads from SQLite (explicit queryPurpose, not offset-inferred)', () => {
  // Stage 4.2P #7 fix: queryPurpose is now passed explicitly by the caller
  // (useSeriesScreenModel.ts) rather than inferred from `offset` — see
  // scripts/stage4p-parity-polish.test.mjs tests 6-8 for full coverage of
  // the corrected startup-viewport / category-switch / pagination labeling.
  assert.match(sqliteDs, /input\.queryPurpose \?\? \(isFirstPage \? 'startup-viewport' : 'pagination'\)/);
});

test('9. Pagination appends without duplicates', () => {
  assert.match(model, /function uniqueSeries\(existing: SeriesSummary\[\], incoming: SeriesSummary\[\]\)/);
  assert.match(model, /const next = uniqueSeries\(current, page\.items\)/);
});

test('10. Search reads from SQLite', () => {
  const block = sliceBlock(sqliteDs, 'async function searchSeriesImpl', 'return {\n    async getCategories');
  assert.match(block, /getCatalogItemsPage\(/);
  assert.match(block, /query: input\.query/);
});

test('11. Search does not call provider when local generation is readable', () => {
  const compositeIdx = sqliteDs.indexOf('export function createSqliteFirstSeriesDataSource');
  assert.ok(compositeIdx > 0);
  const compositeBlock = sqliteDs.slice(compositeIdx);
  assert.match(compositeBlock, /searchSeries\(input\)\s*\{\s*return withSqliteOrNetwork\(/);
  assert.match(compositeBlock, /sqlite\.searchSeries!\(input\)/);
});

test('12. Refresh writes to a staging generation (beginCatalogSync, not the active pointer)', () => {
  assert.match(catalogSqliteSyncWriter, /beginCatalogSync\(input\.providerId, input\.mediaType/);
  assert.match(providerCatalogSync, /startCatalogSqliteMediaSync\(\{\s*providerId,\s*mediaType: 'series'/);
});

test('13. Failed refresh preserves prior readable generation', () => {
  assert.match(catalogRepository, /Keep provider\.catalogGeneration unchanged; do not delete older candidates\./);
  assert.match(providerCatalogSync, /series_sqlite_refresh_failed/);
});

test('14. Promotion is atomic and Series honors the validated result', () => {
  const block = sliceBlock(
    catalogSqliteSyncWriter,
    'Stage 4.2O.2: Series now shares the generation-safe pipeline with Movies',
    'return activated;',
  );
  assert.match(block, /const activated = await completeCatalogSync\(handle\.providerId, handle\.mediaType, handle\.generation/);
  assert.doesNotMatch(block, /return true;/);
});

test('15. Stale generation results are dropped mid-flight', () => {
  assert.match(sqliteDs, /series_sqlite_stale_result_dropped/);
  assert.match(sqliteDs, /series_sqlite_generation_mismatch_blocked/);
  assert.match(sqliteDs, /postGeneration !== generation/);
});

test('16. Offline startup can render categories and cards from local SQLite', () => {
  assert.match(sqliteDs, /getOfflineSnapshot/);
  assert.match(sqliteDs, /series_sqlite_offline_startup/);
  // Offline status is diagnostics-only — it never gates the SQLite read itself.
  const categoriesImpl = sliceBlock(sqliteDs, 'async function getCategoriesImpl', 'async function getSeriesPageImpl');
  const offlineCheckIdx = categoriesImpl.indexOf('getOfflineSnapshot');
  const returnIdx = categoriesImpl.indexOf('return categories;');
  assert.ok(offlineCheckIdx > 0 && returnIdx > offlineCheckIdx);
});

test('17. Offline category switching works (no network dependency in selectCategory)', () => {
  const block = sliceBlock(model, 'const selectCategory = useCallback', 'const selectSeason = useCallback');
  assert.doesNotMatch(block, /fetch\(|XtreamClient/);
});

test('18. Offline pagination works (loadMore has no network-only branch)', () => {
  const block = sliceBlock(model, 'const loadMore = useCallback', 'const library = useMediaLibraryStore');
  assert.match(block, /resolvedDataSource\.getSeriesPage/);
  assert.doesNotMatch(block, /fetch\(|XtreamClient/);
});

test('19. Offline Search works via the same SQLite-first resolvedDataSource', () => {
  const startIdx = model.indexOf('const loadInitialPage = async');
  assert.ok(startIdx > 0);
  const block = model.slice(startIdx, startIdx + 1200);
  assert.match(block, /resolvedDataSource\.searchSeries/);
});

test('20. Detail opens from local card metadata immediately (card comes from SQLite page)', () => {
  assert.match(model, /const selectedItem = useMemo/);
  assert.match(model, /fromGrid = visibleItems\.find/);
});

test('21. Episode enrichment failure remains scoped to the popup (not a full-screen error)', () => {
  const block = sliceBlock(model, 'const loadSeriesDetail = useCallback', 'const selectSeries = useCallback');
  assert.match(block, /setDetailError\('Detailed series information could not be loaded\.'\)/);
  assert.doesNotMatch(block, /throw /);
});

test('22. Series Stage 4.2O tests remain 31/31', () => {
  const result = runSuite('series-stage4o-browse-rebuild.test.mjs');
  assert.equal(countTapFail(result.stdout), 0, result.stdout);
  assert.equal(countTapPass(result.stdout), 31, result.stdout);
});

test('23. Series Stage 4.2O.1 popup tests remain 25/25', () => {
  const result = runSuite('series-stage4o1-detail-popup-v2.test.mjs');
  assert.equal(countTapFail(result.stdout), 0, result.stdout);
  assert.equal(countTapPass(result.stdout), 25, result.stdout);
});

test('24. Movies Stage 4.2N tests remain 24/24', () => {
  const result = runSuite('movies-stage4n-detail-popup-v2.test.mjs');
  assert.equal(countTapFail(result.stdout), 0, result.stdout);
  assert.equal(countTapPass(result.stdout), 24, result.stdout);
});

test('25. Existing Movies SQLite tests remain passing', () => {
  // Baseline (pre-existing on branch tip b0ef2b1, before any Stage 4.2O.2
  // change) known-failing counts per suite — unrelated to this stage
  // (movies-stage3g-sqlite-search-focus.test.mjs#6 checks a `cardFocused`
  // style regex against SearchPosterCard.tsx, a file this stage never
  // touches). This test asserts the failure count has not *increased*
  // beyond that baseline, i.e. no new Movies SQLite regression from Series
  // sharing the same catalogRepository.ts/catalogSqliteSyncWriter.ts pipeline.
  const baselineFailures = {
    'movies-sqlite-datasource-stage3a.test.mjs': 0,
    'movies-sqlite-runtime-diagnostics.test.mjs': 0,
    'movies-sqlite-active-generation-fix.test.mjs': 0,
    'movies-sqlite-feature-flag-stage3b.test.mjs': 0,
    'movies-stage3g-sqlite-search-focus.test.mjs': 1,
  };
  for (const [suite, allowedFailures] of Object.entries(baselineFailures)) {
    const result = runSuite(suite);
    const fails = countTapFail(result.stdout);
    assert.ok(
      fails <= allowedFailures,
      `${suite} regressed: expected <= ${allowedFailures} pre-existing failures, got ${fails}\n${result.stdout}`,
    );
  }
});

test('26. Migration preserves existing Movies generations (shared monotonic generation counter)', () => {
  // resolveNextSyncGeneration folds the shared catalog_providers.catalog_generation
  // pointer into its MAX() floor, so movie and series generation numbers can never
  // collide — Series joining the shared pipeline cannot reuse/overwrite a Movies
  // generation number.
  const block = sliceBlock(catalogRepository, 'async function resolveNextSyncGeneration', 'export async function beginCatalogSync');
  assert.match(block, /SELECT catalog_generation AS g FROM catalog_providers WHERE provider_id = \?/);
  // Movies' readable-generation recovery independently re-scans catalog_items_v2
  // scoped to media_type='movie', so it self-heals even if the shared pointer
  // currently reflects a Series generation.
  assert.match(catalogRepository, /FROM catalog_items_v2\s*WHERE provider_id = \? AND media_type = 'movie'/);
});

test('27. Migration does not require clearing app data', () => {
  assert.doesNotMatch(catalogSqliteSyncWriter, /DROP TABLE|DELETE FROM catalog_items_v2 WHERE provider_id = \?[^A-Z]*$/m);
  assert.match(providerCatalogSync, /startCatalogSqliteMediaSync/);
  // usesGenerationSafeCatalog flipping series to true reuses the existing v2
  // tables/schema version — no schema version bump, no migration wipe.
  assert.match(catalogTableRouting, /mediaType === 'movie' \|\| mediaType === 'series'/);
});

test('28. No accepted Movies UI files were changed', () => {
  const result = spawnSync('git', ['diff', '--name-only', 'HEAD'], { encoding: 'utf8' });
  const changed = result.stdout.split('\n').map((line) => line.trim()).filter(Boolean);
  const forbidden = [
    'src/features/movies/MoviesScreen.tsx',
    'src/features/movies/components/MovieDetailPopupV2.tsx',
  ];
  for (const path of forbidden) {
    assert.ok(!changed.includes(path), `${path} must not change in Stage 4.2O.2`);
  }
});

test('Stage 4.2O.2 marker / SQLite feature flag is present and gated', () => {
  assert.match(providerBundle, /EXPO_PUBLIC_SERIES_SQLITE_READS/);
  assert.match(providerBundle, /createSqliteFirstSeriesDataSource/);
  assert.match(seriesDiagnostics, /SERIES_SQLITE_DIAGNOSTICS_MARKER/);
});
