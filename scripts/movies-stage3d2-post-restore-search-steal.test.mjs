import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  MOVIES_FOCUS_SUPPRESSION_RELEASE_MS,
  MOVIES_POST_RESTORE_LATCH_MS,
  areMoviesChromeNormallyFocusable,
  createMoviesPostRestoreLatch,
  isMoviesPostRestoreLatchActive,
  shouldMoviesPosterRetainPostRestorePreferredFocus,
  shouldSuppressMoviesSearchFocus,
  shouldSuppressPreferredFocusDuringPostRestore,
} from '../src/features/movies/moviesDetailFocusLifecycle.ts';

const screen = fs.readFileSync('src/features/movies/MoviesScreen.tsx', 'utf8');
const grid = fs.readFileSync('src/features/movies/components/MoviePosterGrid.tsx', 'utf8');
const toolbar = fs.readFileSync('src/features/movies/components/MovieToolbar.tsx', 'utf8');
const lifecycle = fs.readFileSync('src/features/movies/moviesDetailFocusLifecycle.ts', 'utf8');
const shell = fs.readFileSync('src/components/nova/NovaTvShell.tsx', 'utf8');
const repository = fs.readFileSync('src/features/catalog/catalogRepository.ts', 'utf8');
const sqlite = fs.readFileSync('src/features/movies/data/SqliteMovieDataSource.ts', 'utf8');

test('1. Latch helpers pin restored poster preferred ownership', () => {
  const latch = createMoviesPostRestoreLatch({ token: 't1', restoredMovieId: 'm50' });
  assert.equal(latch.postRestoreActive, true);
  assert.equal(isMoviesPostRestoreLatchActive(latch), true);
  assert.equal(shouldSuppressPreferredFocusDuringPostRestore(latch), true);
  assert.equal(
    shouldMoviesPosterRetainPostRestorePreferredFocus({ latch, movieId: 'm50' }),
    true,
  );
  assert.equal(
    shouldMoviesPosterRetainPostRestorePreferredFocus({ latch, movieId: 'm1' }),
    false,
  );
  assert.ok(MOVIES_POST_RESTORE_LATCH_MS >= 750 && MOVIES_POST_RESTORE_LATCH_MS <= 1000);
});

test('2. Search cannot receive preferred focus immediately after restore', () => {
  assert.match(toolbar, /hasTVPreferredFocus/);
  assert.match(screen, /hasTVPreferredFocus=\{false\}/);
  assert.match(screen, /postRestorePreferredMovieId/);
  assert.match(grid, /postRestorePreferredMovieId === item\.id/);
  assert.match(lifecycle, /logMoviesSearchFocusBlocked/);
  assert.match(screen, /\[NovaCast Movies Search Focus Blocked\]|logMoviesSearchFocusBlocked/);
});

test('3. Search\/navbar\/category remain focusable by D-pad after restore', () => {
  assert.equal(areMoviesChromeNormallyFocusable('browse-restored'), true);
  assert.equal(areMoviesChromeNormallyFocusable('browse'), true);
  assert.equal(areMoviesChromeNormallyFocusable('closing-focus'), false);
  assert.match(screen, /chromeFocusable/);
  assert.match(screen, /navigationFocusable=\{chromeFocusable/);
  assert.match(screen, /focusable=\{chromeFocusable && !searchBlocksBrowse\}/);
  assert.match(screen, /MovieToolbar[\s\S]*focusable=\{chromeFocusable && !searchBlocksBrowse\}/);
});

test('4. Restored poster keeps preferred ownership after overlay removal', () => {
  assert.match(screen, /activatePostRestoreLatch/);
  assert.match(screen, /pin preferred ownership/);
  assert.match(screen, /do not re-request focus/);
  assert.match(grid, /postRestorePreferredMovieId != null/);
});

test('5. Browse phase does not automatically reactivate Search preferred focus', () => {
  assert.equal(shouldSuppressMoviesSearchFocus('browse'), false);
  assert.match(screen, /searchAllowed: !latchStillActive/);
  assert.match(screen, /firstPosterAllowed: !latchStillActive/);
  assert.match(screen, /hasTVPreferredFocus=\{false\}/);
  assert.ok(MOVIES_POST_RESTORE_LATCH_MS > MOVIES_FOCUS_SUPPRESSION_RELEASE_MS);
});

test('6. Latch releases on directional input', () => {
  assert.match(screen, /releasePostRestoreLatch\('dpad-input'\)/);
  assert.match(screen, /useTVEventHandler/);
  assert.match(lifecycle, /'dpad-input'/);
});

test('7. Latch releases when focus leaves restored poster', () => {
  assert.match(screen, /releasePostRestoreLatch\('focus-left-poster'\)/);
  assert.match(lifecycle, /'focus-left-poster'/);
});

test('8. Latch releases on timeout', () => {
  assert.match(screen, /releasePostRestoreLatch\('timeout'\)/);
  assert.match(screen, /MOVIES_POST_RESTORE_LATCH_MS/);
  assert.equal(MOVIES_POST_RESTORE_LATCH_MS, 750);
});

test('9. Latch does not release merely on overlay unmount \/ browse \/ 150ms', () => {
  // Latch outlives the 150ms focusability release; release reasons exclude phase/browse alone.
  assert.ok(MOVIES_POST_RESTORE_LATCH_MS > MOVIES_FOCUS_SUPPRESSION_RELEASE_MS);
  assert.match(screen, /activatePostRestoreLatch\(token\.token, movieId\)/);
  assert.match(screen, /releaseFocusSuppressionAfterStabilize\(token\.token\)/);
  assert.match(lifecycle, /'dpad-input'| 'focus-left-poster'| 'timeout'| 'unmount'| 'screen-change'/);
  assert.doesNotMatch(lifecycle, /releaseReason: 'browse'|releaseReason: 'overlay-unmount'/);
});

test('10. No repeated poster focus request from latch', () => {
  assert.doesNotMatch(screen, /reason: 'post-restore-re-request'/);
  assert.match(screen, /do not re-request focus/);
  assert.match(screen, /pin preferred ownership/);
});

test('11. Viewport lock surface remains unchanged', () => {
  assert.match(screen, /stage3d1-movies-viewport-lock-v2/);
  assert.match(lifecycle, /logMoviesViewportLock/);
  assert.match(grid, /scrollToOffset\(\{ offset, animated: false \}\)/);
  assert.match(screen, /Never transfer poster focus until the saved offset is stable/);
});

test('12. Diagnostics emit Post Restore Focus + Search Focus Blocked', () => {
  assert.match(lifecycle, /\[NovaCast Movies Post Restore Focus\]/);
  assert.match(lifecycle, /\[NovaCast Movies Search Focus Blocked\]/);
  assert.match(screen, /logMoviesPostRestoreFocus/);
  assert.match(screen, /stage3d2-movies-post-restore-focus-v1/);
  assert.match(screen, /\[NovaCast Movies Post Restore Latch\]/);
  assert.match(lifecycle, /releaseReason/);
});

test('13. Navbar preferred remains suppressed while latch active', () => {
  assert.match(screen, /navbarPreferredSuppressed/);
  assert.match(screen, /suppressNavbarPreferredFocus=\{navbarPreferredSuppressed\}/);
  assert.match(screen, /categoryPreferredSuppressed/);
  assert.match(shell, /hasTVPreferredFocus=\{navbarPreferredFocus && active\}/);
});

test('14. No catalog\/SQL\/category files change in Stage 3D.2 surface', () => {
  assert.doesNotMatch(lifecycle, /getCatalogCategoryCounts|catalog_items_v2/);
  assert.doesNotMatch(screen, /getCatalogCategoryCounts|writeCatalogItemsBatch/);
  assert.match(repository, /getCatalogCategoryCounts/);
  assert.match(sqlite, /createSqliteMovieDataSource/);
});

test('15. Unmount and screen-change release paths exist', () => {
  assert.match(screen, /releaseReason: 'unmount'/);
  assert.match(screen, /releasePostRestoreLatch\('screen-change'\)/);
});
