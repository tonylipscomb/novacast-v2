import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { spawnSync } from 'node:child_process';

const model = fs.readFileSync('src/features/series/useSeriesScreenModel.ts', 'utf8');
const fastPath = fs.readFileSync('src/features/series/seriesStartupFastPath.ts', 'utf8');
const sqliteDs = fs.readFileSync('src/features/series/data/SqliteSeriesDataSource.ts', 'utf8');
const dsInterface = fs.readFileSync('src/features/series/data/SeriesDataSource.ts', 'utf8');
const providerStore = fs.readFileSync('src/features/providers/providerStore.ts', 'utf8');
const trustStore = fs.readFileSync('src/features/providers/providerAuthTrustStore.ts', 'utf8');
const localBootstrap = fs.readFileSync('src/features/providers/providerLocalBootstrap.ts', 'utf8');
const startupGate = fs.readFileSync('src/features/startup/StartupGate.tsx', 'utf8');
const smartSeriesDs = fs.readFileSync('src/features/series/smart/SmartSeriesDataSource.ts', 'utf8');

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

// ── #1-5: Series warm-reconcile short-circuit ──────────────────────────────

test('1. Warm Series route does not perform redundant category reconciliation when pinned generation + snapshot are valid', () => {
  const block = sliceBlock(model, 'const validateWarmSnapshotAndMaybeSkip = async', 'const startupFastPath = async');
  assert.match(block, /if \(!validation\.valid\) \{\s*return false;\s*\}/);
  assert.match(block, /startupStateRef\.current\.warmShortCircuited = true;/);

  const fastPathBlock = sliceBlock(model, 'const startupFastPath = async', 'const scheduleSmartCountRefresh');
  // Both the memory-cache and durable-snapshot branches gate the expensive
  // loadCategoriesFromNetwork(...) reconciliation call behind `!shortCircuited`.
  const memoryBranch = sliceBlock(fastPathBlock, 'if (memory && memory.categories.length > 0)', 'const durable =');
  assert.match(memoryBranch, /const shortCircuited = await validateWarmSnapshotAndMaybeSkip\(memory, 'memory-cache-reconcile'\);/);
  assert.match(memoryBranch, /if \(!shortCircuited\) \{[\s\S]*loadCategoriesFromNetwork\('memory-cache-reconcile'\)/);

  const durableBranch = fastPathBlock.slice(fastPathBlock.indexOf('const durable = await loadSeriesStartupDurableSnapshot'));
  assert.match(durableBranch, /const shortCircuited = await validateWarmSnapshotAndMaybeSkip\(durable, 'durable-snapshot-reconcile'\);/);
  assert.match(durableBranch, /if \(!shortCircuited\) \{[\s\S]*loadCategoriesFromNetwork\('durable-snapshot-reconcile'\)/);
});

test('2. Invalid snapshot still reconciles from SQLite', async () => {
  const { validateSeriesWarmStartupSnapshot } = await import('../src/features/series/seriesStartupFastPath.ts');
  const result = await validateSeriesWarmStartupSnapshot({
    providerId: 'p1',
    snapshot: null,
    selectedCategoryId: null,
    resolveReadableGeneration: async () => 5,
  });
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'invalid-snapshot');
  // The reconciliation path itself (loadCategoriesFromNetwork) is never removed.
  assert.match(model, /const loadCategoriesFromNetwork = async \(reason: string\)/);
});

test('3. Generation mismatch forces reconciliation', async () => {
  const { validateSeriesWarmStartupSnapshot } = await import('../src/features/series/seriesStartupFastPath.ts');
  const snapshot = {
    schemaVersion: 1,
    providerId: 'p1',
    generation: 5,
    categories: [{ id: 'c1', kind: 'provider', name: 'C1', count: 1, countKnown: true }],
    selectedCategoryId: null,
    savedSeriesId: null,
    savedOffset: null,
    categoryRows: 1,
    readableRowCount: 1,
    savedAt: Date.now(),
  };
  const result = await validateSeriesWarmStartupSnapshot({
    providerId: 'p1',
    snapshot,
    selectedCategoryId: null,
    resolveReadableGeneration: async () => 6,
  });
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'generation-mismatch');
});

test('4. Provider mismatch rejects snapshot', async () => {
  const { validateSeriesWarmStartupSnapshot } = await import('../src/features/series/seriesStartupFastPath.ts');
  const snapshot = {
    schemaVersion: 1,
    providerId: 'other-provider',
    generation: 5,
    categories: [{ id: 'c1', kind: 'provider', name: 'C1', count: 1, countKnown: true }],
    selectedCategoryId: null,
    savedSeriesId: null,
    savedOffset: null,
    categoryRows: 1,
    readableRowCount: 1,
    savedAt: Date.now(),
  };
  const result = await validateSeriesWarmStartupSnapshot({
    providerId: 'p1',
    snapshot,
    selectedCategoryId: null,
    resolveReadableGeneration: async () => 5,
  });
  assert.equal(result.valid, false);
  // isSeriesStartupDurableSnapshotValidForProvider already rejects a
  // provider-id mismatch as a structurally-invalid snapshot for this caller.
  assert.equal(result.reason, 'invalid-snapshot');
});

test('5. First viewport remains generation-pinned', () => {
  assert.match(sqliteDs, /async function requireReadableGeneration\(requestPurpose: string\): Promise<number>/);
  const pageBlock = sliceBlock(sqliteDs, 'async function getSeriesPageImpl', 'async function searchSeriesImpl');
  assert.match(pageBlock, /const generation = await requireReadableGeneration\(queryPurpose\);/);
  assert.match(pageBlock, /generation: queryGeneration/);
});

// ── #6-8: queryPurpose fix ──────────────────────────────────────────────────

test('6. queryPurpose is startup-viewport only during startup', () => {
  const block = sliceBlock(model, 'const isStartupViewport = !isSearchMode', 'const loadInitialPage = async');
  assert.match(block, /const queryPurpose: SeriesQueryPurpose = isStartupViewport\s*\n\s*\? 'startup-viewport'/);
  // isStartupViewport is false once the route has already gone interactive.
  assert.match(model, /const isStartupViewport = !isSearchMode && !startupStateRef\.current\.interactive;/);
});

test('7. Category switch uses correct queryPurpose', () => {
  const block = sliceBlock(model, 'const isStartupViewport = !isSearchMode', 'const loadInitialPage = async');
  assert.match(block, /: isSearchMode\s*\n\s*\? 'search'\s*\n\s*: 'category-switch';/);
});

test('8. Pagination uses correct queryPurpose', () => {
  const block = sliceBlock(model, 'const loadMore = useCallback', "logSeriesPerf('series_pagination_appended'");
  assert.match(block, /queryPurpose: isSearchMode \? 'search' : 'pagination',/);
  // loadMore never passes 'startup-viewport' or 'category-switch'.
  assert.doesNotMatch(block, /queryPurpose: 'startup-viewport'|queryPurpose: 'category-switch'/);
});

test('8b. Bonus: SmartSeriesDataSource forwards queryPurpose through for non-smart categories (regression caught via physical Mode A verification)', () => {
  // Physically observed on-device: a real category-switch tap logged
  // queryPurpose:'category-switch' at the model layer but 'startup-viewport'
  // at the SQLite layer, because this wrapper (which sits between the model
  // and the SQLite-first composite for *every* category, not just smart
  // ones — see providerBundle.ts's createSmartSeriesDataSource(createSqlite
  // FirstSeriesDataSource(...)) composition) reconstructed the getSeriesPage
  // input without the new field.
  const block = sliceBlock(smartSeriesDs, 'async getSeriesPage({ categoryId, offset, limit, sort', 'return querySmartSeriesPage');
  assert.match(block, /async getSeriesPage\(\{ categoryId, offset, limit, sort = DEFAULT_CONTENT_SORT, queryPurpose \}\)/);
  assert.match(block, /return base\.getSeriesPage\(\{ categoryId, offset, limit, sort, queryPurpose \}\);/);
});

// ── #9-10: Series data-source limit clamp ───────────────────────────────────

test('9. Series browse limit is clamped', () => {
  assert.match(fastPath, /export const SERIES_BROWSE_PAGE_LIMIT_MAX = 200;/);
  const block = sliceBlock(sqliteDs, 'async function getSeriesPageImpl', 'async function searchSeriesImpl');
  // Stage 4.2Q: runtime pagination still clamps to SERIES_BROWSE_PAGE_LIMIT_MAX (200);
  // the startup-viewport purpose now uses a tighter, purpose-specific ceiling instead
  // (see test 10) — both flow into the same `clampedLimit`/`hasMore` computation.
  assert.match(block, /purposeLimitCeiling =\s*\n\s*queryPurpose === 'startup-viewport' \? SERIES_STARTUP_VIEWPORT_LIMIT : SERIES_BROWSE_PAGE_LIMIT_MAX;/);
  assert.match(block, /const clampedLimit = Math\.min\(Math\.max\(input\.limit, 1\), purposeLimitCeiling\);/);
  assert.match(block, /const hasMore = page\.items\.length >= clampedLimit;/);
});

test('10. Normal Series page size remains unchanged; startup viewport unified with Movies (36)', () => {
  // Stage 4.2Q: unified to Movies' MOVIES_STARTUP_VIEWPORT_LIMIT (36) — was 32.
  // Runtime pagination (48) is untouched by this change.
  assert.match(fastPath, /export const SERIES_STARTUP_VIEWPORT_LIMIT = 36;/);
  assert.match(model, /const pageLimit = isStartupViewport \? SERIES_STARTUP_VIEWPORT_LIMIT : 48;/);
  const block = sliceBlock(model, 'const loadMore = useCallback', "logSeriesPerf('series_pagination_appended'");
  assert.match(block, /limit: 48,/);
  // Stage 4.2Q: the DS now also clamps the startup-viewport purpose to
  // SERIES_STARTUP_VIEWPORT_LIMIT at the getSeriesPageImpl boundary (defense-in-depth).
  const pageBlock = sliceBlock(sqliteDs, 'async function getSeriesPageImpl', 'async function searchSeriesImpl');
  assert.match(pageBlock, /SERIES_STARTUP_VIEWPORT_LIMIT/);
  // Search has its own limit semantics — the browse clamp constant is not reused there.
  const searchBlock = sliceBlock(sqliteDs, 'async function searchSeriesImpl', "sourceKind: 'sqlite'");
  assert.doesNotMatch(searchBlock, /SERIES_BROWSE_PAGE_LIMIT_MAX/);
});

// ── #11-16: Auth trust marker ────────────────────────────────────────────────

test('11. Successful online account validation writes auth trust marker', () => {
  assert.match(providerStore, /await recordSuccessfulAccountValidation\(provider, credentials\);/);
  const block = sliceBlock(providerStore, 'async function recordSuccessfulAccountValidation', 'function scheduleProviderAccountValidation');
  assert.match(block, /await saveProviderAuthTrustMarker\(\{/);
  // prepareProviderBundle's validateAccount:true path calls it after a REAL bundle.ready resolution.
  const prepareBlock = sliceBlock(providerStore, 'async function prepareProviderBundle', 'function closeActivePlayback');
  assert.match(prepareBlock, /await bundle\.ready;[\s\S]*await recordSuccessfulAccountValidation\(provider, credentials\);/);
});

test('12. Trust marker contains no plaintext password', () => {
  assert.match(trustStore, /export type ProviderAuthTrustMarker = \{/);
  const typeBlock = sliceBlock(trustStore, 'export type ProviderAuthTrustMarker = {', '};');
  // Strip `/** ... */` doc comments (which may *describe* "never a password")
  // before checking that no actual field name/type carries a secret.
  const fieldLinesOnly = typeBlock.replace(/\/\*\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(fieldLinesOnly, /password/i);
  assert.doesNotMatch(fieldLinesOnly, /credential(?!Identity)/i);
  // saveProviderAuthTrustMarker's parameter shape mirrors the type exactly —
  // no additional secret-bearing field is smuggled in only at the write site.
  const saveBlock = sliceBlock(trustStore, 'export async function saveProviderAuthTrustMarker', '): Promise<ProviderAuthTrustMarker> {');
  assert.doesNotMatch(saveBlock, /password/i);
});

test('13. Local-library cold boot is allowed only with valid trust marker + local readable generation', async () => {
  const { resolveLocalLibraryBootstrapEligibility } = await import('../src/features/providers/providerLocalBootstrap.ts');
  const trustStoreModule = await import('../src/features/providers/providerAuthTrustStore.ts');
  trustStoreModule.clearProviderAuthTrustStoreForTests();

  const provider = {
    id: 'prov-1',
    name: 'Test',
    connection: { type: 'xtream', serverId: 'srv', credentialKey: 'prov-1' },
    status: 'active',
    expirationAt: null,
    selected: true,
    createdAt: 0,
    updatedAt: 0,
  };
  const credentials = { type: 'xtream', baseUrl: 'http://example.com:8080', username: 'user', password: 'pw' };

  // No trust marker at all → ineligible.
  const noMarker = await resolveLocalLibraryBootstrapEligibility(provider, credentials);
  assert.equal(noMarker.eligible, false);
  assert.equal(noMarker.reason, 'no-trust-marker');
});

test('14. Local boot uses validateAccount:false', () => {
  const block = sliceBlock(providerStore, 'async function attemptLocalLibraryBootstrap', 'async function initializeSavedProviderOnStartup');
  assert.match(block, /prepareProviderBundle\(provider, credentials \?\? undefined, \{ validateAccount: false \}\)/);
});

test('15. Deferred validation is scheduled', () => {
  const block = sliceBlock(providerStore, 'async function prepareProviderBundle', 'function closeActivePlayback');
  assert.match(block, /if \(!validateAccount\) \{\s*scheduleProviderAccountValidation\(provider, bundle, credentials\);\s*return \{ bundle, provider \};\s*\}/);
  assert.match(providerStore, /setDeferredValidationPending\(provider\.id, true\);/);
});

test('16. Online validation later succeeds and refreshes trust marker', () => {
  const block = sliceBlock(providerStore, 'function scheduleProviderAccountValidation', 'async function prepareProviderBundle');
  assert.match(block, /await recordSuccessfulAccountValidation\(provider, credentials\);/);
  assert.match(block, /setDeferredValidationPending\(provider\.id, false\);/);
  assert.match(block, /provider_deferred_validation_succeeded/);
});

// ── #17-21: Local-boot fail-closed conditions ───────────────────────────────

test('17. Missing trust marker does not bypass StartupGate', async () => {
  const { resolveLocalLibraryBootstrapEligibility } = await import('../src/features/providers/providerLocalBootstrap.ts');
  const trustStoreModule = await import('../src/features/providers/providerAuthTrustStore.ts');
  trustStoreModule.clearProviderAuthTrustStoreForTests();
  const provider = {
    id: 'prov-missing-marker',
    name: 'Test',
    connection: { type: 'xtream', serverId: 'srv', credentialKey: 'prov-missing-marker' },
    status: 'active',
    expirationAt: null,
    selected: true,
    createdAt: 0,
    updatedAt: 0,
  };
  const credentials = { type: 'xtream', baseUrl: 'http://example.com:8080', username: 'user', password: 'pw' };
  const result = await resolveLocalLibraryBootstrapEligibility(provider, credentials);
  assert.equal(result.eligible, false);
  assert.equal(result.reason, 'no-trust-marker');
});

test('18. Expired trust marker does not bypass StartupGate', async () => {
  const { resolveLocalLibraryBootstrapEligibility } = await import('../src/features/providers/providerLocalBootstrap.ts');
  const trustStoreModule = await import('../src/features/providers/providerAuthTrustStore.ts');
  trustStoreModule.clearProviderAuthTrustStoreForTests();
  const provider = {
    id: 'prov-expired',
    name: 'Test',
    connection: { type: 'xtream', serverId: 'srv', credentialKey: 'prov-expired' },
    status: 'active',
    expirationAt: null,
    selected: true,
    createdAt: 0,
    updatedAt: 0,
  };
  const credentials = { type: 'xtream', baseUrl: 'http://example.com:8080', username: 'user', password: 'pw' };
  await trustStoreModule.saveProviderAuthTrustMarker({
    providerId: provider.id,
    providerEndpointIdentity: 'example.com:8080',
    credentialIdentity: 'example.com:8080::user',
    lastSuccessfulAccountValidationAt: Date.now() - (trustStoreModule.PROVIDER_AUTH_TRUST_FRESHNESS_MS + 60_000),
  });
  const result = await resolveLocalLibraryBootstrapEligibility(provider, credentials);
  assert.equal(result.eligible, false);
  assert.equal(result.reason, 'trust-marker-expired');
});

test('19. Provider/identity mismatch does not bypass StartupGate', async () => {
  const { resolveLocalLibraryBootstrapEligibility } = await import('../src/features/providers/providerLocalBootstrap.ts');
  const trustStoreModule = await import('../src/features/providers/providerAuthTrustStore.ts');
  trustStoreModule.clearProviderAuthTrustStoreForTests();
  const provider = {
    id: 'prov-mismatch',
    name: 'Test',
    connection: { type: 'xtream', serverId: 'srv', credentialKey: 'prov-mismatch' },
    status: 'active',
    expirationAt: null,
    selected: true,
    createdAt: 0,
    updatedAt: 0,
  };
  const credentials = { type: 'xtream', baseUrl: 'http://example.com:8080', username: 'user', password: 'pw' };
  // Marker exists and is fresh, but was recorded for a *different* account identity.
  await trustStoreModule.saveProviderAuthTrustMarker({
    providerId: provider.id,
    providerEndpointIdentity: 'different-host.com',
    credentialIdentity: 'different-host.com::someone-else',
  });
  const result = await resolveLocalLibraryBootstrapEligibility(provider, credentials);
  assert.equal(result.eligible, false);
  assert.equal(result.reason, 'identity-mismatch');
});

test('20. No readable local generation does not bypass StartupGate', () => {
  // Static check: the eligibility function always probes both Movies and
  // Series readable generations and fails closed when both are 0.
  const block = sliceBlock(localBootstrap, 'const [movieGeneration, seriesGeneration]', 'return {\n    eligible: true,');
  assert.match(block, /if \(movieGeneration <= 0 && seriesGeneration <= 0\) \{\s*return \{ eligible: false, reason: 'no-readable-local-generation' \};/);
  assert.match(localBootstrap, /resolveReadableCatalogGeneration\(provider\.id, 'movie'\)/);
  assert.match(localBootstrap, /resolveReadableCatalogGeneration\(provider\.id, 'series'\)/);
});

test('21. Explicit logout/revocation does not bypass StartupGate', () => {
  assert.match(providerStore, /await clearAllProviderAuthTrustMarkers\(current\.providers\.map\(\(provider\) => provider\.id\)\);/);
  const clearBlock = sliceBlock(providerStore, 'export async function clearProvidersForPairing', 'export async function resetProviderState');
  assert.match(clearBlock, /clearAllProviderAuthTrustMarkers/);
  const resetBlock = sliceBlock(providerStore, 'export async function resetProviderState', 'export function clearProviderCacheForTests');
  assert.match(resetBlock, /clearAllProviderAuthTrustMarkers/);
});

// ── #22: Movies shares the same bootstrap mechanism ─────────────────────────

test('22. Movies remains accessible through the same valid local-library bootstrap mechanism', () => {
  // initializeSavedProviderOnStartup is provider-agnostic (keyed on
  // ProviderRecord, not on Movies/Series) and is the single call site
  // ensureSavedProviderInitialized uses for the shared StartupGate flow —
  // Movies benefits from the exact same bypass Series does, with no
  // Movies-specific branch anywhere in this file.
  const block = sliceBlock(providerStore, 'async function initializeSavedProviderOnStartup', 'async function ensureSavedProviderInitialized');
  assert.match(block, /const bypassBundle = await attemptLocalLibraryBootstrap\(provider\);/);
  assert.doesNotMatch(providerStore, /mediaType === 'movie'|mediaType === 'series'/);
  // StartupGate.tsx itself is untouched — the gate condition is shared as-is.
  assert.match(startupGate, /providerInitialized = Boolean\(getActiveRepositoryBundle\(\)\) && !providerSwitchError/);
});

// ── #23-26: Baseline regression suites ──────────────────────────────────────

test('23. Existing Stage 4.2O.2 tests remain 29/29', () => {
  const result = runSuite('series-stage4o2-sqlite-parity.test.mjs');
  assert.equal(countTapFail(result.stdout), 0, result.stdout);
  assert.equal(countTapPass(result.stdout), 29, result.stdout);
});

test('24. Existing Stage 4.2O tests remain 31/31', () => {
  const result = runSuite('series-stage4o-browse-rebuild.test.mjs');
  assert.equal(countTapFail(result.stdout), 0, result.stdout);
  assert.equal(countTapPass(result.stdout), 31, result.stdout);
});

test('25. Existing Stage 4.2O.1 tests remain 25/25', () => {
  const result = runSuite('series-stage4o1-detail-popup-v2.test.mjs');
  assert.equal(countTapFail(result.stdout), 0, result.stdout);
  assert.equal(countTapPass(result.stdout), 25, result.stdout);
});

test('26. Existing Stage 4.2N Movies tests remain 24/24', () => {
  const result = runSuite('movies-stage4n-detail-popup-v2.test.mjs');
  assert.equal(countTapFail(result.stdout), 0, result.stdout);
  assert.equal(countTapPass(result.stdout), 24, result.stdout);
});

test('27. Movies UI styling files remain out-of-scope (Movies is the reference, never edited)', () => {
  // Stage 4.2Q intentionally re-syncs SeriesDetailPopupV2.tsx's typography/padding to
  // Movies' values (see scripts/series-stage4q-visual-consistency.test.mjs) — it is no
  // longer forbidden here. MovieDetailPopupV2.tsx must still never change: Movies is the
  // original accepted reference that Series is re-synced to, not the other way around.
  const result = spawnSync('git', ['diff', '--name-only', 'HEAD'], { encoding: 'utf8' });
  const changed = result.stdout.split('\n').map((line) => line.trim()).filter(Boolean);
  const forbidden = ['src/features/movies/components/MovieDetailPopupV2.tsx'];
  for (const path of forbidden) {
    assert.ok(!changed.includes(path), `${path} must never change — Movies is the visual reference`);
  }
});
