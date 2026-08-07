import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { spawnSync } from 'node:child_process';

const seriesPopup = fs.readFileSync('src/features/series/components/SeriesDetailPopupV2.tsx', 'utf8');
const moviesPopup = fs.readFileSync('src/features/movies/components/MovieDetailPopupV2.tsx', 'utf8');
const catalogRepository = fs.readFileSync('src/features/catalog/catalogRepository.ts', 'utf8');
const distributionValidation = fs.readFileSync('src/features/catalog/moviesCategoryDistributionValidation.ts', 'utf8');
const seriesSparseRepair = fs.readFileSync('src/features/series/seriesSparseCatalogRepair.ts', 'utf8');
const seriesSqliteDs = fs.readFileSync('src/features/series/data/SqliteSeriesDataSource.ts', 'utf8');
const seriesDsInterface = fs.readFileSync('src/features/series/data/SeriesDataSource.ts', 'utf8');
const seriesSearchRepository = fs.readFileSync('src/features/search/repositories/seriesSearchRepository.ts', 'utf8');
const movieSearchRepository = fs.readFileSync('src/features/search/repositories/movieSearchRepository.ts', 'utf8');
const smartSeriesDs = fs.readFileSync('src/features/series/smart/SmartSeriesDataSource.ts', 'utf8');
const seriesFastPath = fs.readFileSync('src/features/series/seriesStartupFastPath.ts', 'utf8');
const moviesFastPath = fs.readFileSync('src/features/movies/moviesStartupFastPath.ts', 'utf8');

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

// ── 1. Popup typography/spacing parity ──────────────────────────────────────

test('1. Series popup contentRow.paddingVertical matches Movies (30)', () => {
  const moviesBlock = sliceBlock(moviesPopup, 'contentRow: {', 'posterPanel: {');
  const seriesBlock = sliceBlock(seriesPopup, 'contentRow: {', 'posterPanel: {');
  assert.match(moviesBlock, /paddingVertical: 30,/);
  assert.match(seriesBlock, /paddingVertical: 30,/);
});

test('2. Series popup copyPanel.gap matches Movies (12)', () => {
  const moviesBlock = sliceBlock(moviesPopup, 'copyPanel: {', 'title: {');
  const seriesBlock = sliceBlock(seriesPopup, 'copyPanel: {', 'title: {');
  assert.match(moviesBlock, /gap: 12,/);
  assert.match(seriesBlock, /gap: 12,/);
});

test('3. Series popup title fontSize matches Movies (30)', () => {
  const moviesBlock = sliceBlock(moviesPopup, '  title: {', '  meta: {');
  const seriesBlock = sliceBlock(seriesPopup, '  title: {', '  meta: {');
  assert.match(moviesBlock, /fontSize: 30,/);
  assert.match(seriesBlock, /fontSize: 30,/);
});

test('4. Series popup meta fontSize matches Movies (15)', () => {
  const moviesBlock = sliceBlock(moviesPopup, '  meta: {', '  description: {');
  const seriesBlock = sliceBlock(seriesPopup, '  meta: {', '  description: {');
  assert.match(moviesBlock, /fontSize: 15,/);
  assert.match(seriesBlock, /fontSize: 15,/);
});

test('5. Series popup description fontSize/lineHeight matches Movies (15/22)', () => {
  const moviesBlock = sliceBlock(moviesPopup, '  description: {', '  statusLine: {');
  const seriesBlock = sliceBlock(seriesPopup, '  description: {', '  statusLine: {');
  assert.match(moviesBlock, /fontSize: 15,/);
  assert.match(moviesBlock, /lineHeight: 22,/);
  assert.match(seriesBlock, /fontSize: 15,/);
  assert.match(seriesBlock, /lineHeight: 22,/);
});

test('6. Series popup actionsRow.marginTop matches Movies (8)', () => {
  const moviesBlock = sliceBlock(moviesPopup, 'actionsRow: {', 'action: {');
  const seriesBlock = sliceBlock(seriesPopup, 'actionsRow: {', 'action: {');
  assert.match(moviesBlock, /marginTop: 8,/);
  assert.match(seriesBlock, /marginTop: 8,/);
});

test('7. Movies popup values are unchanged (regression guard)', () => {
  // Exact pre-Stage-4.2Q baseline values, unmoved.
  assert.match(moviesPopup, /paddingHorizontal: 30,\s*\n\s*paddingVertical: 30,\s*\n\s*gap: 26,/);
  assert.match(moviesPopup, /gap: 12,\s*\n\s*\},\s*\n\s*title: \{\s*\n\s*color: novaTheme\.colors\.textPrimary,\s*\n\s*fontSize: 30,/);
});

// ── 2. Sparse-catalog promotion validator parity ────────────────────────────

test('8. Sparse-distribution validator runs for Series generations, not just Movies', () => {
  const block = sliceBlock(catalogRepository, "if (validationPassed && mediaType === 'series')", 'if (!validationPassed) {');
  assert.match(block, /validateCatalogCategoryDistribution\('series', \{/);
  assert.match(block, /series_generation_activation_rejected|series_generation_activation_passed/);
});

test('9. Series validator is a generic extension, not a parallel implementation', () => {
  assert.match(distributionValidation, /export function validateCatalogCategoryDistribution\(\s*mediaType: CatalogMediaType,/);
  assert.match(distributionValidation, /export function assessCatalogIntegrity\(\s*mediaType: CatalogMediaType,/);
  // Movies wrappers delegate into the shared implementation rather than duplicating thresholds.
  assert.match(distributionValidation, /validateCatalogCategoryDistribution\('movie', input\)/);
  assert.match(distributionValidation, /assessCatalogIntegrity\('movie', input\)/);
});

test("10. Movies' sparse-distribution validation behavior/thresholds are unchanged (regression guard)", () => {
  // Same exact threshold constants as the pre-Stage-4.2Q Movies-only implementation.
  assert.match(distributionValidation, /stats\.totalItems < 500 &&\s*\n\s*stats\.distinctCategoryIds <= 2 &&\s*\n\s*stats\.nonzeroCategoryCount <= 2/);
  assert.match(distributionValidation, /stats\.metadataCategoryCount >= 50 &&\s*\n\s*stats\.totalItems < 200/);
  assert.match(distributionValidation, /stats\.metadataCategoryCount >= 100 && stats\.nonzeroCategoryCount < 10/);
  assert.match(distributionValidation, /stats\.metadataCategoryCount >= 100 &&\s*\n\s*stats\.coverageRatio < 0\.03/);
  assert.match(distributionValidation, /stats\.metadataCategoryCount >= 10 && stats\.nonzeroCategoryCount < 5/);
  assert.match(distributionValidation, /largestCategoryShare >= 0\.85/);
  assert.match(distributionValidation, /export function validateMoviesCategoryDistribution\(input: \{/);
  assert.match(distributionValidation, /export function assessMoviesCatalogIntegrity\(input: \{/);
});

test('11. Series has an equivalent runtime degraded-catalog repair path', () => {
  assert.match(seriesSparseRepair, /export async function repairDegradedSeriesCatalogIfNeeded/);
  assert.match(seriesSparseRepair, /assessCatalogIntegrity\('series', \{/);
  assert.match(seriesSqliteDs, /repairDegradedSeriesCatalogIfNeeded\(providerId,/);
});

// ── 3. Search repository SQLite-authority parity ────────────────────────────

test('12. Series search repository treats SQLite as authoritative (no fallback on zero hits)', () => {
  const block = sliceBlock(seriesSearchRepository, 'export async function searchSeries', 'withSearchTimeout(');
  assert.match(block, /const sqliteAuthoritative = dataSource\?\.sourceKind === 'sqlite';/);
  assert.match(block, /if \(sqliteAuthoritative\) \{/);
  assert.match(block, /Zero results are authoritative — never fall through to provider\/network\./);
  // The authoritative branch must not use the provider-fallback timeout wrapper.
  assert.doesNotMatch(block, /withSearchTimeout/);
});

test('13. Series search policy statement mirrors Movies (documented in code)', () => {
  assert.match(seriesSearchRepository, /SQLite is authoritative when the datasource is sqlite-backed/);
  assert.match(movieSearchRepository, /SQLite is authoritative when the datasource is sqlite-backed/);
  assert.match(movieSearchRepository, /Zero SQLite hits are valid and must not fall through to provider\/network\./);
});

test('14. SeriesDataSource exposes sourceKind, mirroring MovieDataSource', () => {
  assert.match(seriesDsInterface, /sourceKind\?: 'legacy' \| 'sqlite';/);
  assert.match(seriesSqliteDs, /sourceKind: 'sqlite',/);
});

test('15. SmartSeriesDataSource routes search by sourceKind, mirroring SmartMovieDataSource', () => {
  assert.match(smartSeriesDs, /const usesSqliteReads = base\.sourceKind === 'sqlite';/);
  const block = sliceBlock(smartSeriesDs, 'async searchSeries(input) {', 'const indexed = getSeriesCatalogIndex(providerId);');
  assert.match(block, /if \(usesSqliteReads\) \{\s*return base\.searchSeries!\(input\);/);
});

// ── 4. Viewport-limit consistency (32 -> 36) ────────────────────────────────

test('16. Series startup viewport limit is unified with Movies (36)', () => {
  assert.match(moviesFastPath, /export const MOVIES_STARTUP_VIEWPORT_LIMIT = 36;/);
  assert.match(seriesFastPath, /export const SERIES_STARTUP_VIEWPORT_LIMIT = 36;/);
});

test('17. Series DS-level startup-viewport clamp exists, mirroring Movies', () => {
  const block = sliceBlock(seriesSqliteDs, 'async function getSeriesPageImpl', 'async function searchSeriesImpl');
  assert.match(block, /queryPurpose === 'startup-viewport' \? SERIES_STARTUP_VIEWPORT_LIMIT : SERIES_BROWSE_PAGE_LIMIT_MAX/);
  assert.match(block, /const clampedLimit = Math\.min\(Math\.max\(input\.limit, 1\), purposeLimitCeiling\);/);
});

test('18. Runtime pagination ceiling (SERIES_BROWSE_PAGE_LIMIT_MAX = 200) is unchanged', () => {
  assert.match(seriesFastPath, /export const SERIES_BROWSE_PAGE_LIMIT_MAX = 200;/);
});

// ── 5. Stale comments/docs cleanup ───────────────────────────────────────────

test('19. Stale "no SQLite catalog" comment in seriesStartupFastPath.ts is gone', () => {
  assert.doesNotMatch(
    seriesFastPath,
    /Series has no local SQLite catalog, so "generation" here is a simple/,
  );
  assert.match(seriesFastPath, /Series has a real local SQLite catalog/);
});

test('20. No other stale "Series has no SQLite" style comments remain in Series sources', () => {
  const result = spawnSync('git', ['grep', '-l', '-iE', 'Series (has no|does not have a|lacks a) (local )?SQLite'], {
    encoding: 'utf8',
  });
  const matches = result.stdout.split('\n').map((line) => line.trim()).filter(Boolean);
  assert.deepEqual(matches, []);
});

// ── 6-10. Existing baseline suites remain green ──────────────────────────────

test('21. Existing Stage 4.2P tests remain 28/28', () => {
  const result = runSuite('stage4p-parity-polish.test.mjs');
  assert.equal(countTapFail(result.stdout), 0, result.stdout);
  assert.equal(countTapPass(result.stdout), 28, result.stdout);
});

test('22. Existing Stage 4.2O.2 tests remain 29/29', () => {
  const result = runSuite('series-stage4o2-sqlite-parity.test.mjs');
  assert.equal(countTapFail(result.stdout), 0, result.stdout);
  assert.equal(countTapPass(result.stdout), 29, result.stdout);
});

test('23. Existing Stage 4.2O tests remain 31/31', () => {
  const result = runSuite('series-stage4o-browse-rebuild.test.mjs');
  assert.equal(countTapFail(result.stdout), 0, result.stdout);
  assert.equal(countTapPass(result.stdout), 31, result.stdout);
});

test('24. Existing Stage 4.2O.1 tests remain 25/25', () => {
  const result = runSuite('series-stage4o1-detail-popup-v2.test.mjs');
  assert.equal(countTapFail(result.stdout), 0, result.stdout);
  assert.equal(countTapPass(result.stdout), 25, result.stdout);
});

test('25. Existing Stage 4.2N Movies tests remain 24/24', () => {
  const result = runSuite('movies-stage4n-detail-popup-v2.test.mjs');
  assert.equal(countTapFail(result.stdout), 0, result.stdout);
  assert.equal(countTapPass(result.stdout), 24, result.stdout);
});

test('26. Movies popup/search/startup-fastpath files are untouched by this stage (Movies is the reference)', () => {
  const result = spawnSync('git', ['diff', '--name-only', 'HEAD'], { encoding: 'utf8' });
  const changed = result.stdout.split('\n').map((line) => line.trim()).filter(Boolean);
  const forbidden = [
    'src/features/movies/components/MovieDetailPopupV2.tsx',
    'src/features/movies/moviesStartupFastPath.ts',
    'src/features/movies/data/SqliteMovieDataSource.ts',
    'src/features/movies/smart/SmartMovieDataSource.ts',
    'src/features/search/repositories/movieSearchRepository.ts',
  ];
  for (const path of forbidden) {
    assert.ok(!changed.includes(path), `${path} must not change — Movies is the accepted reference for this stage`);
  }
});
