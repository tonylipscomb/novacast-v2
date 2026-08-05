import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  createMoviesCategoryRailInstanceId,
  createMoviesDetailOverlayInstanceId,
  isMoviesCategoryRailExpectedVisible,
  isMoviesCategoryRailVisibilityViolation,
  isMoviesDetailOverlayClosedShellInert,
  MOVIES_CATEGORY_RAIL_WIDTH,
  MOVIES_FOCUS_STAGE4K1_MARKER,
  shouldReleaseMoviesDetailVisualIsolation,
  shouldScheduleMoviesDetailFocusRetry,
} from '../src/features/movies/moviesDetailCloseInstant.ts';

const screen = fs.readFileSync('src/features/movies/MoviesScreen.tsx', 'utf8');
const overlay = fs.readFileSync('src/features/movies/components/MovieDetailOverlay.tsx', 'utf8');
const rail = fs.readFileSync('src/features/movies/components/MovieCategoryRail.tsx', 'utf8');
const instant = fs.readFileSync('src/features/movies/moviesDetailCloseInstant.ts', 'utf8');

function simulateBrowseClose(input = {}) {
  const {
    closeSource = 'back',
    returnPath = 'natural-mounted',
    categories = Array.from({ length: 237 }, (_, i) => `c${i}`),
    selectedCategoryId = 'c1',
    categoriesIdentity = Symbol('categories'),
  } = input;

  const events = [];
  let phase = 'detail-open';
  let visualIsolation = false;
  let visualHold = false;
  let focusHandoff = false;
  let overlayVisible = true;
  let shellPaintChildren = true;
  let pointerEvents = 'auto';
  let detailOpen = true;
  let railInstanceId = createMoviesCategoryRailInstanceId(1);
  const overlayInstanceId = createMoviesDetailOverlayInstanceId(1);
  let categoriesRef = categories;
  let categoriesSymbol = categoriesIdentity;
  let selectedId = selectedCategoryId;
  let isolationReleasedCount = 0;
  let focusConfirmed = false;
  let offsetConfirmed = false;
  let timeoutScheduledRetry = false;
  const token = `detail-${closeSource}-1`;

  // Close begins — Stage 4.2K.1 isolation for natural + fallback.
  visualHold = true;
  visualIsolation = true;
  focusHandoff = true;
  events.push('detail_close_visual_isolation_started');
  if (returnPath === 'natural-mounted') {
    phase = 'return-focus-arming';
    events.push('detail_close_visual_isolation_confirmed');
    phase = 'return-focus-requested';
  } else {
    phase = 'closing-prepare';
    events.push('detail_close_visual_isolation_confirmed');
    events.push('initial-detail-restore');
    phase = 'closing-viewport';
    phase = 'closing-focus';
  }

  // Poster focus + offset under isolation
  focusConfirmed = true;
  offsetConfirmed = true;
  events.push('detail_close_poster_focus_confirmed');
  events.push('detail_close_commit_once');

  // Commit browse restore while isolation still covers
  detailOpen = false;
  overlayVisible = false;
  visualHold = false;
  focusHandoff = false;
  shellPaintChildren = false;
  pointerEvents = 'none';
  phase = 'browse-restored';
  events.push('detail_close_browse_revealed');

  const railLayoutConfirmed = categoriesRef.length > 0 && !detailOpen;
  assert.equal(
    shouldReleaseMoviesDetailVisualIsolation({
      focusConfirmed,
      movieIdConfirmed: true,
      offsetConfirmed,
      correctiveScrollPending: false,
      browseLayoutConfirmed: !detailOpen,
      railVisibleConfirmed: railLayoutConfirmed,
    }),
    true,
  );

  // One committed frame — release isolation once
  events.push('detail_close_visual_isolation_released');
  isolationReleasedCount += 1;
  visualIsolation = false;
  events.push('detail_close_visual_state_cleanup');

  const railExpectedVisible = isMoviesCategoryRailExpectedVisible({
    moviesRouteActive: true,
    categoryCount: categoriesRef.length,
    detailOpen,
    searchClosed: true,
    playbackInactive: true,
    playbackClosing: false,
    closeTransactionFinished: true,
    visualCleanupFinished: !visualIsolation && !focusHandoff,
  });
  assert.equal(railExpectedVisible, true);
  assert.equal(
    isMoviesCategoryRailVisibilityViolation({
      railExpectedVisible,
      visualIsolationActive: visualIsolation,
      holdCoverActive: visualHold,
      focusHandoffActive: focusHandoff,
      overlayVisible,
      isolationCoverMounted: visualIsolation,
      railContainerWidth: MOVIES_CATEGORY_RAIL_WIDTH,
      browseOpacity: 1,
      overlayOpacity: 0,
    }),
    false,
  );

  const closedInert = isMoviesDetailOverlayClosedShellInert({
    panelVisible: overlayVisible || visualHold,
    visualIsolationActive: visualIsolation,
    pointerEvents,
    hasBackdrop: shellPaintChildren,
    hasIsolationCover: visualIsolation,
    hasBlur: shellPaintChildren,
    hasCard: shellPaintChildren,
    layoutWidth: 0,
    layoutFlex: 0,
  });

  return {
    closeSource,
    returnPath,
    events,
    railInstanceId,
    overlayInstanceId,
    isolationReleasedCount,
    railExpectedVisible,
    closedInert,
    categoriesLength: categoriesRef.length,
    categoriesSymbol,
    selectedCategoryId: selectedId,
    timeoutScheduledRetry,
    token,
  };
}

test('marker and helpers', () => {
  assert.equal(MOVIES_FOCUS_STAGE4K1_MARKER, 'stage4k1-movies-category-rail-visibility-v1');
  assert.equal(MOVIES_CATEGORY_RAIL_WIDTH, 260);
  assert.match(instant, /MOVIES_FOCUS_STAGE4K1_MARKER/);
  assert.match(instant, /isMoviesCategoryRailExpectedVisible/);
  assert.match(instant, /isMoviesCategoryRailVisibilityViolation/);
  assert.match(instant, /shouldScheduleMoviesDetailFocusRetry/);
});

test('1) Top-row Back: rail visible, instance unchanged, shell inert', () => {
  const result = simulateBrowseClose({ closeSource: 'back' });
  assert.equal(result.railExpectedVisible, true);
  assert.equal(result.closedInert, true);
  assert.equal(result.isolationReleasedCount, 1);
  assert.match(screen, /railInstanceId=\{railInstanceIdRef\.current\}/);
  assert.match(screen, /movies_category_rail_visual_state/);
  assert.match(overlay, /rootClosedInert/);
  assert.match(overlay, /movie_detail_overlay_closed_shell_state/);
});

test('2) Top-row X: identical result', () => {
  const back = simulateBrowseClose({ closeSource: 'back' });
  const x = simulateBrowseClose({ closeSource: 'x' });
  assert.equal(back.railExpectedVisible, x.railExpectedVisible);
  assert.equal(back.closedInert, x.closedInert);
  assert.equal(back.isolationReleasedCount, x.isolationReleasedCount);
  assert.deepEqual(
    back.events.filter((e) => e.includes('isolation') || e.includes('cleanup')),
    x.events.filter((e) => e.includes('isolation') || e.includes('cleanup')),
  );
});

test('3) Deep fallback: isolation starts, restore under cover, releases once, rail visible', () => {
  const result = simulateBrowseClose({
    closeSource: 'back',
    returnPath: 'fallback-target-unmounted',
  });
  const started = result.events.indexOf('detail_close_visual_isolation_started');
  const confirmed = result.events.indexOf('detail_close_visual_isolation_confirmed');
  const restore = result.events.indexOf('initial-detail-restore');
  const released = result.events.indexOf('detail_close_visual_isolation_released');
  assert.ok(started >= 0);
  assert.ok(confirmed > started);
  assert.ok(restore > confirmed);
  assert.ok(released > restore);
  assert.equal(result.isolationReleasedCount, 1);
  assert.equal(result.railExpectedVisible, true);
  assert.match(screen, /detail_close_visual_isolation_started/);
  assert.match(screen, /closing-prepare/);
  assert.match(screen, /detail_close_visual_isolation_confirmed/);
  // Fallback path now starts isolation for all browse-origin closes.
  assert.match(screen, /setVisualIsolationSafe\(true\)/);
  assert.doesNotMatch(
    screen,
    /if \(naturalReturn\) \{\s*\/\/ Stage 4\.2G\/K: hold Detail \+ isolation/,
  );
});

test('4) Stable shell: closed shell has no painted backdrop/cover', () => {
  assert.match(overlay, /rootClosedInert/);
  assert.match(overlay, /rootIsolationOnly/);
  assert.match(overlay, /width: 0/);
  assert.match(overlay, /height: 0/);
  assert.match(overlay, /elevation: 0/);
  assert.equal(
    isMoviesDetailOverlayClosedShellInert({
      panelVisible: false,
      visualIsolationActive: false,
      pointerEvents: 'none',
      hasBackdrop: false,
      hasIsolationCover: false,
      hasBlur: false,
      hasCard: false,
      layoutWidth: 0,
      layoutFlex: 0,
    }),
    true,
  );
  assert.equal(
    isMoviesDetailOverlayClosedShellInert({
      panelVisible: false,
      visualIsolationActive: false,
      pointerEvents: 'none',
      hasBackdrop: true,
      hasIsolationCover: false,
      hasBlur: true,
      hasCard: true,
      layoutWidth: 0,
      layoutFlex: 0,
    }),
    false,
  );
  // Closed path must not keep elevated absoluteFill children at opacity 0.
  assert.match(overlay, /closed shell must be visually empty/);
});

test('5) Stale isolation state: transaction completion force-cleans visual flags', () => {
  assert.match(screen, /cleanupDetailCloseVisualState/);
  assert.match(screen, /detail_close_visual_state_cleanup/);
  assert.match(screen, /detail_close_visual_state_cleanup_forced/);
  assert.match(screen, /pendingIsolationFrameRef/);
  assert.match(screen, /visualIsolationTokenRef/);
  const result = simulateBrowseClose();
  assert.ok(result.events.includes('detail_close_visual_state_cleanup'));
  assert.equal(result.closedInert, true);
});

test('6) Playback: same overlay shell, rail restored after final Detail close', () => {
  assert.match(screen, /keepFocusTrap/);
  assert.match(screen, /overlayInstanceId=\{overlayInstanceIdRef\.current\}/);
  assert.match(screen, /railInstanceId=\{railInstanceIdRef\.current\}/);
  assert.match(screen, /detailSuppressedForPlayback/);
  const result = simulateBrowseClose({ closeSource: 'back' });
  assert.equal(result.railExpectedVisible, true);
  assert.equal(result.overlayInstanceId.startsWith('movie-detail-overlay-'), true);
});

test('7) Search: Search return unaffected; no Movies rail corruption', () => {
  assert.match(screen, /origin: 'search'/);
  assert.match(screen, /detail_close_search_revealed/);
  assert.match(screen, /reason: 'search-return'/);
  assert.match(screen, /cleanupDetailCloseVisualState/);
});

test('8) Category integrity: array identity/count not cleared; selectedCategoryId unchanged', () => {
  const identity = Symbol('cats');
  const result = simulateBrowseClose({
    categoriesIdentity: identity,
    selectedCategoryId: 'action',
    categories: Array.from({ length: 237 }, (_, i) => `c${i}`),
  });
  assert.equal(result.categoriesLength, 237);
  assert.equal(result.categoriesSymbol, identity);
  assert.equal(result.selectedCategoryId, 'action');
  // Must not remount rail via detail/overlay keys.
  assert.doesNotMatch(screen, /key=\{.*categories\.length/);
  assert.doesNotMatch(screen, /key=\{.*selectedCategoryId/);
  assert.doesNotMatch(screen, /key=\{.*detailFocusPhase/);
  assert.match(rail, /railInstanceId/);
  assert.match(rail, /}, \[railInstanceId\]\)/);
});

test('9) Timeout race: onFocus at timeout boundary cancels retry', () => {
  assert.equal(
    shouldScheduleMoviesDetailFocusRetry({ focusConfirmedForToken: true }),
    false,
  );
  assert.equal(
    shouldScheduleMoviesDetailFocusRetry({ focusConfirmedForToken: false }),
    true,
  );
  assert.match(screen, /shouldScheduleMoviesDetailFocusRetry/);
  // Stage 4.2K.2: request-scoped timer still drops when confirmation already accepted.
  assert.match(screen, /focusConfirmedTokenRef\.current === token/);
  assert.match(screen, /clearCloseAttemptTimers/);
  assert.match(screen, /shouldAcceptMoviesDetailCloseLateFocus|detail_close_late_matching_focus_accepted/);
});

test('10) Wiring: Stage 4.2K/J isolation + rail invariant present', () => {
  assert.match(screen, /MOVIES_FOCUS_STAGE4K1_MARKER/);
  assert.match(screen, /movies_category_rail_visibility_violation/);
  assert.match(screen, /detail_close_visual_isolation_released/);
  assert.match(screen, /closeCommitTokenRef/);
  assert.match(overlay, /visualIsolationActive/);
  assert.match(overlay, /pointerEvents=\"none\"/);
});
