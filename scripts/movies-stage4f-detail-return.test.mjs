import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  MOVIES_FAST_PATH_MAX_VIEWPORT_RESTORES,
  MOVIES_FOCUS_STAGE4F_MARKER,
  MOVIES_MAX_VIEWPORT_RESTORES,
  MOVIES_VIEWPORT_OFFSET_TOLERANCE_PX,
  createMoviesBrowseFocusSnapshot,
  isMoviesDetailReturnFastPath,
  isMoviesViewportOffsetStable,
  resolveMoviesDetailReturnMaxViewportRestores,
  selectMoviesDetailReturnPath,
  shouldIssueMoviesInitialDetailRestore,
  shouldSkipZeroDeltaInitialRestore,
  wasMoviesSnapshotTargetVisible,
} from '../src/features/movies/moviesDetailFocusLifecycle.ts';

const screen = fs.readFileSync('src/features/movies/MoviesScreen.tsx', 'utf8');
const grid = fs.readFileSync('src/features/movies/components/MoviePosterGrid.tsx', 'utf8');
const overlay = fs.readFileSync('src/features/movies/components/MovieDetailOverlay.tsx', 'utf8');
const lifecycle = fs.readFileSync('src/features/movies/moviesDetailFocusLifecycle.ts', 'utf8');

function simulateCoveredReturn(input) {
  const {
    snapshotOffset,
    nativeFocusedOffset,
    returnPath = 'fast-mounted-target',
  } = input;
  const commands = [];
  let reveal = null;

  if (shouldIssueMoviesInitialDetailRestore(returnPath)) {
    if (
      !shouldSkipZeroDeltaInitialRestore({
        reason: 'initial',
        requestedOffset: snapshotOffset,
        currentOffset: snapshotOffset,
      })
    ) {
      commands.push({ reason: 'initial-detail-restore', offset: snapshotOffset });
    }
  }

  // Focus request always occurs for mounted target.
  const focusRequested = true;
  let currentOffset = snapshotOffset;
  // Simulate Android TV native +72 (or custom) drift after poster onFocus.
  currentOffset = nativeFocusedOffset;

  if (
    !isMoviesViewportOffsetStable({
      currentOffset,
      snapshotOffset,
    })
  ) {
    const max = resolveMoviesDetailReturnMaxViewportRestores(returnPath);
    assert.ok(max >= 1);
    commands.push({
      reason: 'covered_corrective_scroll',
      requestedOffset: snapshotOffset,
      currentOffset,
      delta: snapshotOffset - currentOffset,
    });
    currentOffset = snapshotOffset;
  }

  if (
    isMoviesViewportOffsetStable({
      currentOffset,
      snapshotOffset,
    })
  ) {
    reveal = {
      finalOffset: currentOffset,
      focusConfirmed: focusRequested,
      correctionCount: commands.filter((c) => c.reason === 'covered_corrective_scroll').length,
      userVisibleMovementExpected: false,
    };
  }

  return { commands, reveal, focusRequested };
}

test('1) Mounted poster offset 275: no initial scroll, focus, covered +72 corrective, then reveal', () => {
  const path = selectMoviesDetailReturnPath({
    hasSnapshot: true,
    snapshotCategoryId: '287',
    selectedCategoryId: '287',
    openProviderId: 'p1',
    activeProviderId: 'p1',
    openReadableGeneration: 6,
    activeReadableGeneration: 6,
    openGridInstanceId: 'grid-1',
    activeGridInstanceId: 'grid-1',
    targetMovieId: 'm1',
    targetInVisibleMovies: true,
    targetNativeHandleExists: true,
  });
  assert.equal(path, 'fast-mounted-target');
  assert.equal(shouldIssueMoviesInitialDetailRestore(path), false);

  const result = simulateCoveredReturn({
    snapshotOffset: 275,
    nativeFocusedOffset: 347,
    returnPath: path,
  });

  assert.equal(result.focusRequested, true);
  assert.equal(
    result.commands.some((c) => c.reason === 'initial-detail-restore'),
    false,
  );
  assert.equal(result.commands.length, 1);
  assert.equal(result.commands[0].reason, 'covered_corrective_scroll');
  assert.equal(result.commands[0].requestedOffset, 275);
  assert.equal(result.commands[0].currentOffset, 347);
  assert.equal(result.commands[0].delta, -72);
  assert.ok(result.reveal);
  assert.equal(result.reveal.finalOffset, 275);
  assert.equal(result.reveal.correctionCount, 1);
  assert.equal(result.reveal.userVisibleMovementExpected, false);
  assert.match(screen, /browse_reveal/);
  assert.match(screen, /covered_corrective_scroll/);
});

test('2) Mounted poster offset 0: no initial, no corrective, focus + reveal', () => {
  const result = simulateCoveredReturn({
    snapshotOffset: 0,
    nativeFocusedOffset: 0,
    returnPath: 'fast-mounted-target',
  });
  assert.equal(result.commands.length, 0);
  assert.equal(result.focusRequested, true);
  assert.deepEqual(result.reveal, {
    finalOffset: 0,
    focusConfirmed: true,
    correctionCount: 0,
    userVisibleMovementExpected: false,
  });
});

test('3) Native +72 drift corrected once and remains bounded', () => {
  assert.equal(MOVIES_FAST_PATH_MAX_VIEWPORT_RESTORES, 1);
  assert.equal(resolveMoviesDetailReturnMaxViewportRestores('fast-mounted-target'), 1);
  assert.equal(resolveMoviesDetailReturnMaxViewportRestores('fallback-target-unmounted'), MOVIES_MAX_VIEWPORT_RESTORES);

  const drifts = [275, 660, 2008, 3164, 4127].map((offset) =>
    simulateCoveredReturn({
      snapshotOffset: offset,
      nativeFocusedOffset: offset + 72,
    }),
  );
  for (const result of drifts) {
    assert.equal(result.commands.length, 1);
    assert.equal(result.commands[0].delta, -72);
    assert.equal(result.reveal.correctionCount, 1);
  }
  assert.equal(MOVIES_VIEWPORT_OFFSET_TOLERANCE_PX, 12);
  assert.match(lifecycle, /MOVIES_FAST_PATH_MAX_VIEWPORT_RESTORES/);
});

test('4) Target ref missing selects fallback and allows one initial restore', () => {
  const path = selectMoviesDetailReturnPath({
    hasSnapshot: true,
    snapshotCategoryId: '287',
    selectedCategoryId: '287',
    openProviderId: 'p1',
    activeProviderId: 'p1',
    openReadableGeneration: 6,
    activeReadableGeneration: 6,
    openGridInstanceId: 'grid-1',
    activeGridInstanceId: 'grid-1',
    targetMovieId: 'm1',
    targetInVisibleMovies: true,
    targetNativeHandleExists: false,
  });
  assert.equal(path, 'fallback-target-unmounted');
  assert.equal(isMoviesDetailReturnFastPath(path), false);
  assert.equal(shouldIssueMoviesInitialDetailRestore(path), true);
  assert.equal(resolveMoviesDetailReturnMaxViewportRestores(path), MOVIES_MAX_VIEWPORT_RESTORES);

  // Fallback may issue an initial restore when the list is not already on the snapshot.
  assert.equal(
    shouldSkipZeroDeltaInitialRestore({
      reason: 'initial',
      requestedOffset: 275,
      currentOffset: 0,
    }),
    false,
  );
  assert.match(screen, /Fallback: restore saved offset once before focus/);
});

test('5) Generation changed selects fallback and does not use stale fast path', () => {
  const path = selectMoviesDetailReturnPath({
    hasSnapshot: true,
    snapshotCategoryId: '287',
    selectedCategoryId: '287',
    openProviderId: 'p1',
    activeProviderId: 'p1',
    openReadableGeneration: 6,
    activeReadableGeneration: 8,
    openGridInstanceId: 'grid-1',
    activeGridInstanceId: 'grid-1',
    targetMovieId: 'm1',
    targetInVisibleMovies: true,
    targetNativeHandleExists: true,
  });
  assert.equal(path, 'fallback-generation-changed');
  assert.equal(shouldIssueMoviesInitialDetailRestore(path), true);
  assert.match(screen, /fallback-generation-changed|detail_return_path_selected/);
});

test('6) Back and X share identical return lifecycle shape', () => {
  assert.match(screen, /closeDetail\('back'\)/);
  assert.match(screen, /closeDetail\('x'\)/);
  assert.match(screen, /closeSource: detailCloseSourceRef\.current/);
  assert.match(screen, /detail_return_path_selected/);
  assert.match(screen, /beginDetailFocusClose\('detail-close'\)/);
});

test('7) Grid remains mounted throughout normal close (no gate flip on close)', () => {
  assert.match(screen, /Keep overlay mounted \(detailOpen stays true\) until exact poster confirm/);
  assert.doesNotMatch(
    screen.slice(screen.indexOf('const closeDetail'), screen.indexOf('const closeDetail') + 2500),
    /setCategories\(\[\]\)/,
  );
  assert.match(grid, /movie_grid_mount/);
  assert.match(screen, /fast-mounted-target|isMoviesDetailReturnFastPath/);
});

test('8) Detail close does not reload or clear catalog/category state', () => {
  const closeSlice = screen.slice(
    screen.indexOf('const closeDetail = useCallback'),
    screen.indexOf('const closeDetail = useCallback') + 1800,
  );
  assert.doesNotMatch(closeSlice, /loadCategories|setCategories\(\[\]\)|reload\(/);
  assert.match(screen, /selectMoviesDetailReturnPath/);
  assert.match(lifecycle, /MOVIES_FOCUS_STAGE4F_MARKER/);
  assert.equal(MOVIES_FOCUS_STAGE4F_MARKER, 'stage4f-movies-detail-return-v1');
});

test('duplicate zero-delta initial restore is prevented', () => {
  assert.equal(
    shouldSkipZeroDeltaInitialRestore({
      reason: 'initial',
      requestedOffset: 275,
      currentOffset: 275,
    }),
    true,
  );
  assert.equal(
    shouldSkipZeroDeltaInitialRestore({
      reason: 'corrective',
      requestedOffset: 275,
      currentOffset: 347,
    }),
    false,
  );
  assert.match(screen, /duplicate_initial_restore_prevented/);
  assert.match(grid, /duplicate_initial_restore_prevented/);
});

test('handoff scrim covers browse during corrective scroll', () => {
  assert.match(overlay, /backgroundScrimHandoff/);
  assert.match(overlay, /holdCoverActive && styles\.backgroundScrimHandoff/);
});

test('snapshot visibility helper still supports mounted-window targets', () => {
  const snapshot = createMoviesBrowseFocusSnapshot({
    categoryId: '287',
    movieId: 'm1',
    movieIndex: 40,
    verticalOffset: 275,
    visibleFirstIndex: 30,
    visibleLastIndex: 50,
    columns: 5,
  });
  assert.equal(wasMoviesSnapshotTargetVisible(snapshot), true);
});
