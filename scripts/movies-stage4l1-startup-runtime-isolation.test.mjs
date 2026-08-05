import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';

import {
  beginMoviesStartupSession,
  buildSanitizedPlaybackSourceSnapshot,
  classifyPlaybackHttpStatus,
  extractPlaybackHttpStatus,
  isValidExpoBlurTargetRef,
  markMoviesStartupSessionInteractive,
  MOVIES_FOCUS_STAGE4L1_MARKER,
  releaseMoviesStartupFocusOwnership,
  resetMoviesStartupSessionsForTests,
  shouldAllowMoviesToolbarSearchPreferredFocus,
  shouldBlockMoviesStartupReentry,
  shouldCorrectMoviesToolbarSearchFocusSteal,
  shouldDropLateMoviesStartupFocusResult,
} from '../src/features/movies/moviesStartupRuntimeIsolation.ts';

const screen = fs.readFileSync('src/features/movies/MoviesScreen.tsx', 'utf8');
const toolbar = fs.readFileSync('src/features/movies/components/MovieToolbar.tsx', 'utf8');
const grid = fs.readFileSync('src/features/movies/components/MoviePosterGrid.tsx', 'utf8');
const overlay = fs.readFileSync('src/features/movies/components/MovieDetailOverlay.tsx', 'utf8');
const model = fs.readFileSync('src/features/movies/useMoviesScreenModel.ts', 'utf8');
const sqlite = fs.readFileSync('src/features/movies/data/SqliteMovieDataSource.ts', 'utf8');
const analytics = fs.readFileSync('src/features/analytics/playbackAnalytics.ts', 'utf8');
const controller = fs.readFileSync(
  'src/features/playback/unified/UnifiedPlayerController.tsx',
  'utf8',
);
const detailClose = fs.readFileSync('src/features/movies/moviesDetailCloseInstant.ts', 'utf8');
const isolation = fs.readFileSync(
  'src/features/movies/moviesStartupRuntimeIsolation.ts',
  'utf8',
);

function loadNormalizePlaybackFailure() {
  const output = transpileModule(analytics, {
    compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(
    output,
    {
      module,
      exports: module.exports,
      require: (request) =>
        request.endsWith('novaAnalytics')
          ? { enqueueAnalyticsEvent: () => Promise.resolve(true) }
          : {},
      console,
    },
    { filename: 'playbackAnalytics.ts' },
  );
  return module.exports.normalizePlaybackFailure;
}

test('Stage 4.2L.1 marker present', () => {
  assert.equal(MOVIES_FOCUS_STAGE4L1_MARKER, 'stage4l1-movies-startup-runtime-isolation-v1');
  assert.match(isolation, /stage4l1-movies-startup-runtime-isolation-v1/);
  assert.match(screen, /MOVIES_FOCUS_STAGE4L1_MARKER/);
});

test('1. Search button cannot have preferred focus during browse Detail close', () => {
  assert.equal(
    shouldAllowMoviesToolbarSearchPreferredFocus({
      detailPhase: 'closing-focus',
      detailOpen: true,
      detailClosing: true,
      restoringBrowseFocus: true,
      postRestoreLatchActive: false,
      startupFocusOwnershipActive: false,
      playbackReturnRestoring: false,
    }),
    false,
  );
  assert.equal(
    shouldAllowMoviesToolbarSearchPreferredFocus({
      detailPhase: 'browse-restored',
      detailOpen: false,
      detailClosing: false,
      restoringBrowseFocus: false,
      postRestoreLatchActive: true,
      startupFocusOwnershipActive: false,
      playbackReturnRestoring: false,
    }),
    false,
  );
  assert.match(screen, /hasTVPreferredFocus=\{false\}/);
  assert.match(screen, /movies_toolbar_search_focus_eligibility_changed/);
  assert.match(toolbar, /hasTVPreferredFocus/);
});

test('2. Search-button onFocus during poster restore logs violation but never corrects', () => {
  // Stage 4.2L.2: correction disabled — Search onFocus must not call requestTvFocus.
  const first = shouldCorrectMoviesToolbarSearchFocusSteal({
    browseDetailCloseActive: true,
    searchPreferredFocus: true,
    correctionAlreadyIssuedForToken: false,
  });
  assert.equal(first.correct, false);
  assert.match(screen, /movies_toolbar_search_focus_steal_violation/);
  assert.doesNotMatch(screen, /movies-search-steal-correction/);
  assert.doesNotMatch(screen, /searchFocusCorrectionTokenRef/);
});

test('3. Poster confirmation releases focus ownership only after the committed frame', () => {
  assert.match(screen, /movies_detail_close_focus_owner_released/);
  assert.match(screen, /releasePostRestoreLatch/);
  assert.match(
    grid,
    /closingFocusMovieId != null\s*\n\s*\? closingFocusMovieId === item\.id/,
  );
});

test('4. Startup focus preference is cleared permanently after first confirmation', () => {
  resetMoviesStartupSessionsForTests();
  beginMoviesStartupSession('p1');
  const released = releaseMoviesStartupFocusOwnership('p1');
  assert.equal(released.released, true);
  assert.equal(released.session?.focusOwnershipActive, false);
  assert.equal(released.session?.focusReleased, true);
  const again = releaseMoviesStartupFocusOwnership('p1');
  assert.equal(again.released, false);
  assert.match(screen, /movies_startup_focus_ownership_released/);
  assert.match(screen, /startupFocusFrameRef/);
});

test('5. Category changes cannot restart startup', () => {
  resetMoviesStartupSessionsForTests();
  beginMoviesStartupSession('p2');
  assert.equal(shouldBlockMoviesStartupReentry('p2'), false);
  markMoviesStartupSessionInteractive('p2');
  assert.equal(shouldBlockMoviesStartupReentry('p2'), true);
  assert.match(sqlite, /movies_startup_reentry_blocked/);
  assert.match(model, /beginMoviesStartupSession/);
  assert.match(model, /queryPurpose: startupStateRef\.current\.interactive/);
  assert.match(model, /'runtime'/);
});

test('6. Late startup viewport completion during Detail cannot change focus', () => {
  assert.equal(
    shouldDropLateMoviesStartupFocusResult({
      startupInteractive: true,
      startupFocusReleased: false,
      detailOpen: true,
      detailClosing: false,
    }),
    true,
  );
  assert.equal(
    shouldDropLateMoviesStartupFocusResult({
      startupInteractive: false,
      startupFocusReleased: true,
      detailOpen: false,
      detailClosing: false,
    }),
    true,
  );
  assert.match(model, /movies_startup_late_focus_result_dropped/);
});

test('7. Pinned startup viewport query does not call full readiness/recovery', () => {
  const pinnedStart = sqlite.indexOf('true pinned-generation viewport');
  assert.ok(pinnedStart > 0);
  const pinnedEnd = sqlite.indexOf('Runtime / post-interactive page loads', pinnedStart);
  const pinnedBlock = sqlite.slice(pinnedStart, pinnedEnd);
  assert.match(pinnedBlock, /pinned-generation-sql/);
  assert.match(pinnedBlock, /getCatalogItemsPage/);
  assert.doesNotMatch(pinnedBlock, /recoverFragmentedMovieCatalogOnce/);
  assert.doesNotMatch(pinnedBlock, /resolveMoviesCatalogReadiness/);
  assert.doesNotMatch(pinnedBlock, /resolveReadableCatalogGeneration/);
  assert.doesNotMatch(pinnedBlock, /getCatalogCategoryCounts/);
  assert.doesNotMatch(pinnedBlock, /repairDegradedMoviesCatalogIfNeeded/);
});

test('8. Invalid regular View tag is never passed as blurTargetId (Stage 4.2L.2: no blur target)', () => {
  // Stage 4.2L.2: Movies Detail no longer uses BlurTargetView / blurTarget on Android TV.
  assert.equal(isValidExpoBlurTargetRef({ current: {} }), false);
  assert.equal(isValidExpoBlurTargetRef(null), false);
  assert.doesNotMatch(screen, /BlurTargetView/);
  assert.doesNotMatch(screen, /__expoBlurTarget/);
  assert.doesNotMatch(overlay, /blurTarget=\{/);
  assert.match(overlay, /intensity=\{28\}/);
});

test('9. Blur fallback preserves stable Detail shell and focus', () => {
  // Stage 4.2L.2: intensity + scrim only; focus trap still stable.
  assert.match(overlay, /keepFocusTrap|overlayInstanceId/);
  assert.match(screen, /keepFocusTrap/);
  assert.match(overlay, /backgroundScrim/);
  assert.doesNotMatch(overlay, /validBlurTarget \? \(/);
});

test('10. HTTP 458 is not labeled user_cancelled', () => {
  const normalize = loadNormalizePlaybackFailure();
  const message =
    'HttpDataSource$InvalidResponseCodeException: 458 Response code: 458';
  assert.equal(normalize(message), 'provider');
  assert.notEqual(normalize(message), 'user_cancelled');
  // Legacy bug: bare /back/ matched "playback".
  assert.notEqual(normalize('Playback unavailable'), 'user_cancelled');
  assert.equal(extractPlaybackHttpStatus(message), 458);
  assert.equal(classifyPlaybackHttpStatus(458), 'provider_source_rejected');
  assert.equal(classifyPlaybackHttpStatus(401), 'authorization');
  assert.equal(classifyPlaybackHttpStatus(404), 'unavailable_stream');
  assert.equal(classifyPlaybackHttpStatus(429), 'provider_rate_limit');
  assert.equal(classifyPlaybackHttpStatus(503), 'provider_server_failure');
  assert.match(analytics, /InvalidResponseCodeException/);
  assert.match(analytics, /458/);
});

test('11. Playback source error restores usable Detail focus', () => {
  assert.match(screen, /movies_playback_http_source_error/);
  assert.match(screen, /setLaunchingPlayback\(false\)/);
  assert.match(screen, /movies_playback_launch_source_snapshot|buildSanitizedPlaybackSourceSnapshot/);
  assert.match(controller, /movies_playback_http_source_error/);
  assert.match(screen, /isMoviesPlaybackReturnToDetail/);
  const snap = buildSanitizedPlaybackSourceSnapshot({
    movieId: '123',
    streamUrl: 'https://cdn.example/movie/user/pass/123.mp4',
    providerId: 'prov',
    httpResponseCode: 458,
  });
  assert.equal(snap.sourceHost, 'cdn.example');
  assert.equal(snap.credentialsEmbedded, true);
  assert.equal(snap.finalPathExtension, 'mp4');
  assert.equal(snap.httpResponseCode, 458);
  assert.doesNotMatch(JSON.stringify(snap), /password|token|user\/pass/);
});

test('12. Stage 4.2K.2 close behavior remains passing', () => {
  assert.match(detailClose, /MOVIES_FOCUS_STAGE4K2_MARKER/);
  assert.match(detailClose, /createMoviesDetailCloseImmutableTarget/);
  assert.match(detailClose, /shouldAcceptMoviesDetailCloseLateFocus/);
  assert.match(screen, /MOVIES_FOCUS_STAGE4K2_MARKER/);
  assert.match(screen, /createMoviesDetailCloseImmutableTarget|getImmutableCloseTargetMovieId/);
});
