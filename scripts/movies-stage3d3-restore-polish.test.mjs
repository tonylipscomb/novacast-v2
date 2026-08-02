import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  MOVIES_FOCUS_SUPPRESSION_RELEASE_MS,
  MOVIES_MOUNTED_FOCUS_MAX_FRAMES,
  MOVIES_OFFSCREEN_FOCUS_MAX_FRAMES,
  MOVIES_POST_RESTORE_LATCH_MS,
  createMoviesRestoreTiming,
  isMoviesNativeFocusRowAlignmentDrift,
  shouldReRequestMoviesPosterFocusAfterCorrective,
} from '../src/features/movies/moviesDetailFocusLifecycle.ts';

const screen = fs.readFileSync('src/features/movies/MoviesScreen.tsx', 'utf8');
const grid = fs.readFileSync('src/features/movies/components/MoviePosterGrid.tsx', 'utf8');
const card = fs.readFileSync('src/features/movies/components/MoviePosterCard.tsx', 'utf8');
const toolbar = fs.readFileSync('src/features/movies/components/MovieToolbar.tsx', 'utf8');
const lifecycle = fs.readFileSync('src/features/movies/moviesDetailFocusLifecycle.ts', 'utf8');
const repository = fs.readFileSync('src/features/catalog/catalogRepository.ts', 'utf8');
const sqlite = fs.readFileSync('src/features/movies/data/SqliteMovieDataSource.ts', 'utf8');

test('1. Search cannot receive native onFocus while latch active', () => {
  assert.match(screen, /!postRestoreActive/);
  assert.match(screen, /chromeFocusable\s*=\s*\n?\s*areMoviesChromeNormallyFocusable/);
  assert.match(screen, /focusable=\{chromeFocusable && !searchBlocksBrowse\}/);
  assert.match(screen, /post-restore-latch-not-focusable|post-restore-latch-focusable-false-bypass/);
  assert.match(toolbar, /focusable=\{focusable\}/);
});

test('2. Search becomes focusable after latch release', () => {
  assert.match(screen, /releasePostRestoreLatch/);
  assert.match(screen, /searchAllowed: !latchStillActive/);
  assert.ok(MOVIES_POST_RESTORE_LATCH_MS >= 750);
  // After latch clears, chromeFocusable no longer gated by postRestoreActive.
  assert.match(screen, /!postRestoreActive/);
});

test('3. Restored poster highlight remains visible during correction', () => {
  assert.match(card, /forceFocused/);
  assert.match(card, /showFocused = isFocused \|\| forceFocused/);
  assert.match(grid, /pinnedHighlightMovieId/);
  assert.match(grid, /forceFocused=\{/);
  assert.match(screen, /pinnedHighlightMovieId=\{pinnedHighlightMovieId\}/);
});

test('4. No extra poster focus request is needed after corrective', () => {
  assert.equal(
    shouldReRequestMoviesPosterFocusAfterCorrective({ targetFocusConfirmed: true }),
    false,
  );
  assert.equal(
    shouldReRequestMoviesPosterFocusAfterCorrective({ targetFocusConfirmed: false }),
    true,
  );
  assert.match(screen, /shouldReRequestMoviesPosterFocusAfterCorrective/);
  assert.match(screen, /do not re-request poster focus/i);
});

test('5. Mounted target close uses fast focus path', () => {
  assert.equal(MOVIES_MOUNTED_FOCUS_MAX_FRAMES, 8);
  assert.equal(MOVIES_OFFSCREEN_FOCUS_MAX_FRAMES, 24);
  assert.equal(MOVIES_FOCUS_SUPPRESSION_RELEASE_MS, 32);
  assert.match(screen, /snapshotWasVisible && targetInPage/);
  assert.match(screen, /issueFocusRequest\(\)/);
  assert.match(screen, /skip InteractionManager lag/i);
  assert.match(lifecycle, /logMoviesRestoreTiming/);
  assert.match(screen, /logMoviesRestoreTiming/);
});

test('6. Offscreen fallback still works', () => {
  assert.match(screen, /MOVIES_OFFSCREEN_FOCUS_MAX_FRAMES/);
  assert.match(screen, /InteractionManager\.runAfterInteractions\(issueFocusRequest\)/);
  assert.match(grid, /detail-restoration-offscreen-saved-offset/);
  assert.match(screen, /timeout-nearest-visible-fallback/);
});

test('7. Viewport lock behavior remains unchanged', () => {
  assert.match(screen, /stage3d1-movies-viewport-lock-v2/);
  assert.match(screen, /Always re-assert the saved offset/);
  assert.match(screen, /Never transfer poster focus until the saved offset is stable/);
  assert.match(grid, /scrollToOffset\(\{ offset, animated: false \}\)/);
  assert.doesNotMatch(grid, /viewPosition\s*:/);
  assert.doesNotMatch(grid, /scrollToIndex/);
});

test('8. Native row-alignment drift is detected and scroll-locked', () => {
  assert.equal(
    isMoviesNativeFocusRowAlignmentDrift({ offsetDelta: 112 }),
    true,
  );
  assert.equal(
    isMoviesNativeFocusRowAlignmentDrift({ offsetDelta: 5 }),
    false,
  );
  assert.match(screen, /lockScrollForFocusRestore/);
  assert.match(grid, /scrollEnabled=\{!lockScrollForFocusRestore\}/);
  assert.match(lifecycle, /isMoviesNativeFocusRowAlignmentDrift/);
});

test('9. Restore Timing diagnostics are complete', () => {
  const timing = createMoviesRestoreTiming('t1', 1000);
  assert.equal(timing.token, 't1');
  assert.equal(timing.startedAt, 1000);
  assert.equal(timing.correctiveScrollUsed, false);
  assert.match(lifecycle, /\[NovaCast Movies Restore Timing\]/);
  assert.match(lifecycle, /searchFocusAttempted/);
  assert.match(lifecycle, /correctiveScrollUsed/);
  assert.match(screen, /restoreTimingRef/);
  assert.match(screen, /stage3d3-movies-restore-polish-v1/);
});

test('10. No catalog\/SQL changes in Stage 3D.3 surface', () => {
  assert.doesNotMatch(lifecycle, /getCatalogCategoryCounts|catalog_items_v2/);
  assert.doesNotMatch(screen, /getCatalogCategoryCounts|writeCatalogItemsBatch/);
  assert.match(repository, /getCatalogCategoryCounts/);
  assert.match(sqlite, /createSqliteMovieDataSource/);
});
