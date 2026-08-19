import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';

const model = fs.readFileSync('src/features/movies/useMoviesScreenModel.ts', 'utf8');
const diagnostics = fs.readFileSync('src/features/movies/moviesDiagnosticsState.ts', 'utf8');
const screen = fs.readFileSync('src/features/movies/MoviesScreen.tsx', 'utf8');
const boundary = fs.readFileSync('src/features/resilience/NovaErrorBoundary.tsx', 'utf8');
const commitSource = fs.readFileSync('src/features/movies/moviesPageCommit.ts', 'utf8');
const sqlite = fs.readFileSync('src/features/movies/data/SqliteMovieDataSource.ts', 'utf8');
const popup = fs.readFileSync('src/features/movies/components/MovieDetailPopupV2.tsx', 'utf8');
const hostFocus = fs.readFileSync('src/features/movies/moviesBrowseListHostFocus.ts', 'utf8');
const sync = fs.readFileSync('src/features/providers/providerCatalogSync.ts', 'utf8');

function transpileToModule(source) {
  const output = transpileModule(source, {
    compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(
    output,
    { module, exports: module.exports, require: () => ({}), console, process, __DEV__: true },
    { filename: 'moviesPageCommit.ts' },
  );
  return module.exports;
}

function loadCommitHelpers() {
  return transpileToModule(commitSource);
}

test('1. successful 30-row page commits 30 visible rows', () => {
  const { resolveMoviesPageCommitDecision } = loadCommitHelpers();
  const decision = resolveMoviesPageCommitDecision({
    browseUiFrozenForDetail: false,
    detailOpenForDiagnostics: false,
    currentRequestTokenMatches: true,
    selectedCategoryMatches: true,
    mounted: true,
    cancelled: false,
    rowCount: 30,
    visibleCountBefore: 0,
    reason: 'category-first-page-load',
  });
  assert.equal(decision.apply, true);
  assert.equal(decision.rejectReason, null);
  assert.match(model, /phase: 'commit-accepted'/);
  assert.match(model, /updateVisibleMovies\(/);
});

test('2. firstPageReady cannot be true with zero visible rows when result had rows', () => {
  const { isMoviesFirstPageReadyInvariantHeld } = loadCommitHelpers();
  assert.equal(
    isMoviesFirstPageReadyInvariantHeld({
      firstPageReady: true,
      resultRowCount: 30,
      visibleCount: 0,
      commitAccepted: false,
    }),
    false,
  );
  assert.equal(
    isMoviesFirstPageReadyInvariantHeld({
      firstPageReady: true,
      resultRowCount: 30,
      visibleCount: 30,
      commitAccepted: true,
    }),
    true,
  );
  assert.match(model, /onApplied\?\.\(next\.length\)/);
  assert.match(model, /setFirstPageLoadGate\(\(previous\) => \{/);
  const acceptedIndex = model.indexOf("phase: 'commit-accepted'");
  const gateIndex = model.lastIndexOf('setFirstPageLoadGate((previous) => {', acceptedIndex + 1);
  const readyIndex = model.indexOf('firstPageResolvedCategoryId: selectedCategoryId', acceptedIndex);
  assert.ok(acceptedIndex > -1 && readyIndex > acceptedIndex);
  assert.ok(gateIndex === -1 || gateIndex > model.indexOf("phase: 'commit-attempt'"));
});

test('3. ErrorBoundary-style remount with session already interactive rehydrates Movies', () => {
  const { shouldRehydrateMoviesAfterInteractiveRemount } = loadCommitHelpers();
  assert.equal(
    shouldRehydrateMoviesAfterInteractiveRemount({
      sessionAlreadyInteractive: true,
      localVisibleCount: 0,
      readyGenerationPresent: true,
    }),
    true,
  );
  assert.match(model, /resetMoviesBrowsePresentationLatches\(\)/);
  assert.match(model, /phase: 'component-mounted'/);
  assert.match(model, /phase: 'sessionAlreadyInteractive'/);
  assert.match(model, /phase: 'localPresentationHydrated'/);
  assert.match(boundary, /phase: 'boundaryRetry'/);
  assert.match(screen, /resetMoviesBrowsePresentationLatches\(\)/);
});

test('4. global session flag does not block local hydration', () => {
  const { resolveMoviesPageCommitDecision } = loadCommitHelpers();
  const decision = resolveMoviesPageCommitDecision({
    browseUiFrozenForDetail: true,
    detailOpenForDiagnostics: true,
    currentRequestTokenMatches: true,
    selectedCategoryMatches: true,
    mounted: true,
    cancelled: false,
    rowCount: 30,
    visibleCountBefore: 0,
    reason: 'category-first-page-load',
  });
  assert.equal(decision.apply, true);
  assert.match(model, /dropLateStartup && detailActive && visibleMoviesRef\.current\.length > 0/);
  assert.match(sqlite, /session-already-interactive/);
});

test('5. old request\/subscription cannot commit into new instance', () => {
  const { resolveMoviesPageCommitDecision } = loadCommitHelpers();
  assert.equal(
    resolveMoviesPageCommitDecision({
      browseUiFrozenForDetail: false,
      detailOpenForDiagnostics: false,
      currentRequestTokenMatches: false,
      selectedCategoryMatches: true,
      mounted: true,
      cancelled: false,
      rowCount: 30,
      visibleCountBefore: 0,
      reason: 'category-first-page-load',
    }).rejectReason,
    'request-token-mismatch',
  );
  assert.equal(
    resolveMoviesPageCommitDecision({
      browseUiFrozenForDetail: false,
      detailOpenForDiagnostics: false,
      currentRequestTokenMatches: true,
      selectedCategoryMatches: true,
      mounted: false,
      cancelled: true,
      rowCount: 30,
      visibleCountBefore: 0,
      reason: 'category-first-page-load',
    }).rejectReason,
    'cancelled-or-unmounted',
  );
  assert.match(model, /phase: 'commit-rejected'/);
  assert.match(model, /rejectReason: cancelled \? 'cancelled-or-unmounted' : 'request-token-mismatch'/);
});

test('6. new request after remount can commit', () => {
  const { resolveMoviesPageCommitDecision } = loadCommitHelpers();
  assert.equal(
    resolveMoviesPageCommitDecision({
      browseUiFrozenForDetail: false,
      detailOpenForDiagnostics: false,
      currentRequestTokenMatches: true,
      selectedCategoryMatches: true,
      mounted: true,
      cancelled: false,
      rowCount: 30,
      visibleCountBefore: 0,
      reason: 'category-first-page-load',
    }).apply,
    true,
  );
  assert.match(model, /nextMoviesPresentationInstance/);
  assert.match(diagnostics, /resetMoviesBrowsePresentationLatches/);
});

test('7. category switch after Retry displays returned page', () => {
  const { resolveMoviesPageCommitDecision } = loadCommitHelpers();
  assert.equal(
    resolveMoviesPageCommitDecision({
      browseUiFrozenForDetail: false,
      detailOpenForDiagnostics: false,
      currentRequestTokenMatches: true,
      selectedCategoryMatches: true,
      mounted: true,
      cancelled: false,
      rowCount: 30,
      visibleCountBefore: 30,
      reason: 'category-first-page-replace',
    }).apply,
    true,
  );
  assert.match(model, /category-first-page-replace/);
  assert.match(model, /selectCategory/);
});

test('8. catalog READY is preserved', () => {
  assert.match(sqlite, /movies_startup_reentry_blocked/);
  assert.match(sqlite, /lastValidSqliteCategoriesByProvider/);
  assert.doesNotMatch(model, /clearCatalogGeneration|resetCatalogGeneration/);
  assert.match(sync, /catalog_subscription_added/);
  assert.match(sync, /catalog_subscription_removed/);
});

test('9. no new catalog generation\/sync triggered', () => {
  assert.doesNotMatch(model, /startProviderCatalogSync|forceCatalogSync|requestFullCatalogSync/);
  assert.doesNotMatch(screen, /startProviderCatalogSync|forceCatalogSync/);
  assert.doesNotMatch(boundary, /startProviderCatalogSync|forceCatalogSync/);
});

test('10. Detail focus fixes remain unchanged', () => {
  assert.match(popup, /reason: 'detail-v2-initial-cta'/);
  assert.match(popup, /claimInitialCtaFocus/);
  assert.match(popup, /pinDetailCtaLeftEdge/);
  assert.match(popup, /destinations: guideDestinations/);
  assert.match(hostFocus, /applyMoviesBrowseListHostNativeFocus/);
  assert.match(hostFocus, /getNativeScrollRef/);
  assert.doesNotMatch(popup, /Platform\.isTV \? 90/);
});

test('frozen Detail with existing posters still defers', () => {
  const { resolveMoviesPageCommitDecision } = loadCommitHelpers();
  const decision = resolveMoviesPageCommitDecision({
    browseUiFrozenForDetail: true,
    detailOpenForDiagnostics: true,
    currentRequestTokenMatches: true,
    selectedCategoryMatches: true,
    mounted: true,
    cancelled: false,
    rowCount: 30,
    visibleCountBefore: 30,
    reason: 'category-first-page-replace',
  });
  assert.equal(decision.apply, false);
  assert.equal(decision.rejectReason, 'browse-ui-frozen-for-detail');
});
