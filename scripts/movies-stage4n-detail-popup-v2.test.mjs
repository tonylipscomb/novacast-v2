import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';

const screen = fs.readFileSync('src/features/movies/MoviesScreen.tsx', 'utf8');
const popup = fs.readFileSync('src/features/movies/components/MovieDetailPopupV2.tsx', 'utf8');
const helpers = fs.readFileSync('src/features/movies/moviesDetailPopupV2.ts', 'utf8');
const sqlite = fs.readFileSync('src/features/movies/data/SqliteMovieDataSource.ts', 'utf8');
const focusDiag = fs.readFileSync('src/features/navigation/tvFocusDiagnostics.ts', 'utf8');
const seriesScreen = fs.readFileSync('src/features/series/SeriesScreen.tsx', 'utf8');
const seriesOverlay = fs.readFileSync('src/features/series/components/SeriesDetailOverlay.tsx', 'utf8');

function sliceBlock(source, startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  assert.notEqual(start, -1, `missing block start: ${startNeedle}`);
  const end = source.indexOf(endNeedle, start);
  assert.notEqual(end, -1, `missing block end: ${endNeedle}`);
  return source.slice(start, end);
}

const closeBlock = sliceBlock(
  screen,
  'const closeMovieDetailPopupV2 = useCallback',
  "// Stage 4.2G natural: return-focus-requested",
);

function transpileToModule(source, requireImpl) {
  const output = transpileModule(source, {
    compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(
    output,
    {
      module,
      exports: module.exports,
      require: requireImpl ?? (() => ({})),
      console,
      process,
      __DEV__: true,
    },
    { filename: 'helpers.ts' },
  );
  return module.exports;
}

function loadPopupHelpers() {
  return transpileToModule(helpers);
}

function loadRequestTvFocus() {
  const rafQueue = [];
  const module = transpileToModule(focusDiag, (request) => {
    if (request.includes('tvPerfStore')) {
      return {
        tvPerfRecordFocusRequest: () => undefined,
        tvPerfSetLatestFocusRequest: () => undefined,
      };
    }
    if (request.includes('appForegroundGate')) {
      return { isAppForegroundActive: () => true };
    }
    if (request.includes('focusRequestAudit')) {
      return { recordFocusAudit: () => undefined };
    }
    return {};
  });
  return module.requestTvFocus;
}

// 1. Movies renders MovieDetailPopupV2.
test('1. Movies renders MovieDetailPopupV2', () => {
  assert.match(screen, /import \{ MovieDetailPopupV2 \} from '\.\/components\/MovieDetailPopupV2';/);
  assert.match(screen, /<MovieDetailPopupV2/);
});

// 2. Old MovieDetailOverlay is not rendered by MoviesScreen.
test('2. Old MovieDetailOverlay is not rendered by MoviesScreen', () => {
  assert.doesNotMatch(screen, /<MovieDetailOverlay/);
  assert.doesNotMatch(screen, /from '\.\/components\/MovieDetailOverlay'/);
});

// 3. Popup width is not full-screen.
test('3. Popup width is not full-screen (~58-64% of screen width)', () => {
  const { computeMovieDetailPopupV2Layout } = loadPopupHelpers();
  const layout = computeMovieDetailPopupV2Layout({ screenWidth: 1920, screenHeight: 1080 });
  const ratio = layout.popupWidth / 1920;
  assert.ok(ratio >= 0.55 && ratio <= 0.66, `popup width ratio out of range: ${ratio}`);
  assert.match(popup, /computeMovieDetailPopupV2Layout/);
  assert.doesNotMatch(popup, /width: '100%'[\s\S]{0,20}card/);
});

// 4. Poster cannot occupy the full popup.
test('4. Poster cannot occupy the full popup', () => {
  const { computeMovieDetailPopupV2Layout } = loadPopupHelpers();
  const layout = computeMovieDetailPopupV2Layout({ screenWidth: 1920, screenHeight: 1080 });
  const ratio = layout.posterWidth / layout.popupWidth;
  assert.ok(ratio >= 0.24 && ratio <= 0.32, `poster width ratio out of range: ${ratio}`);
  assert.match(popup, /posterPanel:/);
  assert.doesNotMatch(popup, /posterPanel:[\s\S]{0,80}width: '100%'/);
});

// 5. Blur/scrim layer is translucent.
test('5. Blur/scrim layer is translucent', () => {
  assert.match(popup, /BlurView intensity=\{\d+\} tint="dark"/);
  assert.match(popup, /rgba\(0, 0, 0, 0\.62\)/);
});

// 6. No BlurTargetView/blurTarget/blurTargetId.
test('6. No BlurTargetView/blurTarget/blurTargetId', () => {
  assert.doesNotMatch(popup, /BlurTargetView/);
  assert.doesNotMatch(popup, /blurTargetId/);
  assert.doesNotMatch(popup, /\bblurTarget\b/);
});

// 7. Play receives initial preferred focus.
test('7. Play receives initial preferred focus', () => {
  const { resolveMovieDetailPopupV2InitialFocusId } = loadPopupHelpers();
  assert.equal(
    resolveMovieDetailPopupV2InitialFocusId([
      { id: 'play', disabled: false },
      { id: 'favorite', disabled: false },
    ]),
    'play',
  );
  assert.equal(
    resolveMovieDetailPopupV2InitialFocusId([
      { id: 'play', disabled: true },
      { id: 'favorite', disabled: false },
    ]),
    'favorite',
  );
  assert.equal(resolveMovieDetailPopupV2InitialFocusId([]), null);
  assert.match(popup, /resolveMovieDetailPopupV2InitialFocusId/);
  assert.match(popup, /hasTVPreferredFocus=\{preferred && focusable\}/);
  assert.match(popup, /requestTvFocus\(/);
  assert.match(popup, /reason: 'detail-v2-initial-cta'/);
  assert.doesNotMatch(popup, /Platform\.isTV \? 90/);
});

// 8. Visible focused action styling exists.
test('8. Visible focused action styling exists', () => {
  assert.match(popup, /actionFocused: \{/);
  assert.match(popup, /transform: \[\{ scale: 1\.06 \}\]/);
  assert.match(popup, /borderColor: novaTheme\.colors\.focusRing/);
  assert.match(popup, /closeButtonFocused: \{/);
});

// 9. Back and X call the same close function.
test('9. Back and X call the same close function', () => {
  assert.match(screen, /onClose=\{\(source\) => closeMovieDetailPopupV2\(source\)\}/);
  assert.match(screen, /const onPopupBackPress = \(\) => \{[\s\S]{0,500}closeMovieDetailPopupV2\('back'\)/);
  assert.match(popup, /onPress=\{\(\) => requestClose\('x'\)\}/);
});

// 10. Close is one state transition.
test('10. Close is one state transition', () => {
  const setDetailPopupCalls = closeBlock.match(/setDetailPopup\(/g) ?? [];
  assert.equal(setDetailPopupCalls.length, 1);
  for (const phase of [
    'closing-prepare',
    'closing-viewport',
    'closing-focus',
    'closing-confirm',
    'return-focus-requested',
    'return-focus-confirmed',
    'browse-restored',
  ]) {
    assert.doesNotMatch(closeBlock, new RegExp(phase));
  }
});

// 11. Close does not wait for focus.
test('11. Close does not wait for focus', () => {
  assert.doesNotMatch(closeBlock, /await requestTvFocus/);
  const closeIndex = closeBlock.indexOf('setDetailPopup({ open: false');
  const focusIndex = closeBlock.indexOf('requestTvFocus({');
  assert.ok(closeIndex > -1 && focusIndex > -1 && closeIndex < focusIndex);
});

// 12. Close does not invoke legacy transactions.
test('12. Close does not invoke legacy transactions', () => {
  assert.doesNotMatch(closeBlock, /beginDetailFocusClose\(/);
  assert.doesNotMatch(closeBlock, /createMoviesDetailCloseTransaction\(/);
  assert.doesNotMatch(closeBlock, /cleanupDetailCloseVisualState\(/);
  assert.doesNotMatch(closeBlock, /setVisualIsolationSafe\(/);
  assert.doesNotMatch(closeBlock, /setDetailVisualHoldSafe\(/);
  assert.doesNotMatch(closeBlock, /xCloseActivationLockRef/);
});

// 13. Search is never used as focus bridge.
test('13. Search is never used as focus bridge', () => {
  assert.doesNotMatch(closeBlock, /closeSearch\(/);
  assert.match(closeBlock, /if \(originItemId && !fromSearch\)/);
});

// 14. Grid and rail stay mounted.
test('14. Grid and rail stay mounted', () => {
  assert.match(screen, /MoviePosterGrid/);
  assert.match(screen, /MovieCategoryRail/);
  assert.match(screen, /railInstanceIdRef/);
  assert.doesNotMatch(screen, /detailPopup\.open[\s\S]{0,80}return null[\s\S]{0,40}MoviePosterGrid/);
});

// 15. Category and visibleMovies stay unchanged.
test('15. Category and visibleMovies stay unchanged', () => {
  assert.doesNotMatch(closeBlock, /selectCategory\(/);
  assert.doesNotMatch(closeBlock, /setViewportRestoreCommand/);
  assert.doesNotMatch(closeBlock, /scrollToOffset/);
});

// 16. Detail error remains inside popup.
test('16. Detail error remains inside popup', () => {
  assert.match(screen, /error=\{detailError\}/);
  assert.match(popup, /errorLine/);
  assert.doesNotMatch(popup, /Something went wrong/);
});

// 17. Playback error remains inside popup.
test('17. Playback error remains inside popup', () => {
  assert.match(screen, /normalizePlaybackFailure|buildSanitizedPlaybackSourceSnapshot/);
  assert.doesNotMatch(screen, /detailError[\s\S]{0,120}Something went wrong/);
});

// 18. Valid origin focus requested at most once.
test('18. Valid origin focus requested at most once', () => {
  const requestCount = (closeBlock.match(/requestTvFocus\(\{/g) ?? []).length;
  assert.equal(requestCount, 1);

  const requestTvFocus = loadRequestTvFocus();
  let focused = 0;
  const target = { focus: () => { focused += 1; } };
  const results = [];
  requestTvFocus({
    screen: 'movies',
    source: 'test',
    region: 'poster-grid',
    itemId: 'movie-1',
    reason: 'stage4n-unit',
    getTarget: () => target,
    onResult: (result) => results.push(result),
  });
  assert.equal(focused, 1);
  assert.equal(results[0]?.requested, true);
});

// 19. Invalid origin target cannot throw.
test('19. Invalid origin target cannot throw', () => {
  const requestTvFocus = loadRequestTvFocus();
  const results = [];
  assert.doesNotThrow(() => {
    requestTvFocus({
      screen: 'movies',
      source: 'test',
      region: 'poster-grid',
      reason: 'stage4n-unit',
      getTarget: () => ({ /* no focus method */ }),
      onResult: (result) => results.push(result),
    });
  });
  assert.equal(results[0]?.requested, false);
});

// 20. Startup pinned viewport tests remain passing.
test('20. Startup pinned viewport tests remain passing', () => {
  assert.match(sqlite, /pinned-generation-sql/);
  assert.match(sqlite, /movies_startup_viewport_query|MOVIES_STARTUP_VIEWPORT_LIMIT/);
});

test('Stage 4.2N marker present and forbidden legacy-close log wired', () => {
  assert.match(helpers, /MOVIES_FOCUS_STAGE4N_MARKER = 'stage4n-movies-detail-popup-v2'/);
  assert.match(screen, /movie_detail_popup_v2_active/);
  assert.match(screen, /logMovieDetailLegacyClosePathViolation/);
  assert.match(screen, /if \(detailPopupOpenRef\.current\) \{/);
  assert.match(
    screen,
    /logMovieDetailLegacyClosePathViolation\(\{ source, from: 'beginDetailFocusClose' \}\)/,
  );
});

// 21. Origin focus request is deferred by at least one frame after close.
test('21. Origin focus request is deferred via requestAnimationFrame', () => {
  const rafIndex = closeBlock.indexOf('requestAnimationFrame(');
  const focusIndex = closeBlock.indexOf('requestTvFocus({');
  assert.ok(rafIndex > -1, 'expected requestAnimationFrame in close block');
  assert.ok(focusIndex > -1, 'expected requestTvFocus in close block');
  assert.ok(
    rafIndex < focusIndex,
    'requestTvFocus must be nested inside a requestAnimationFrame deferral',
  );
});

// 22. Origin poster is force-focusable in the same synchronous transition as
// close, so it does not depend on `postersFocusable` settling before the
// deferred requestTvFocus/.focus() call runs (Stage 4.2N Search-steal fix).
test('22. Origin poster force-focusable set synchronously on close', () => {
  const setTargetIndex = closeBlock.indexOf('setV2CloseFocusTargetId(originItemId)');
  const rafIndex = closeBlock.indexOf('requestAnimationFrame(');
  assert.ok(setTargetIndex > -1, 'expected setV2CloseFocusTargetId(originItemId) in close block');
  assert.ok(
    setTargetIndex < rafIndex,
    'v2CloseFocusTargetId must be set synchronously, before the deferred focus request',
  );
  assert.match(screen, /const \[v2CloseFocusTargetId, setV2CloseFocusTargetId\]/);
  assert.match(
    screen,
    /const effectiveClosingFocusMovieId = activeClosingFocusMovieId \?\? v2CloseFocusTargetId;/,
  );
  assert.match(screen, /closingFocusMovieId=\{effectiveClosingFocusMovieId\}/);
});

test('Series was not modified for Stage 4.2N', () => {
  assert.doesNotMatch(seriesScreen, /MovieDetailPopupV2/);
  assert.doesNotMatch(seriesOverlay, /MovieDetailPopupV2/);
  assert.doesNotMatch(seriesScreen, /stage4n/);
});
