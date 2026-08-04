import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  isMoviesDetailReturnFastPath,
  isMoviesFastPathInitialRestoreViolation,
  isMoviesNaturalReturnPhase,
  isMoviesViewportOffsetStable,
  resolveMoviesDetailReturnMaxViewportRestores,
  selectMoviesDetailReturnPath,
  shouldHoldMoviesDetailVisual,
  shouldIssueMoviesInitialDetailRestore,
  shouldUseMoviesNaturalReturnPath,
} from '../src/features/movies/moviesDetailFocusLifecycle.ts';
import {
  createMoviesBrowsePlaybackReturnTarget,
  createMoviesDetailPlaybackReturnTarget,
  createMoviesSearchDetailPlaybackReturnTarget,
  isMoviesPlaybackReturnToDetail,
  MOVIES_FOCUS_STAGE4G_MARKER,
  shouldMoviesHostHandlePlaybackBack,
} from '../src/features/movies/moviesPlaybackReturnTarget.ts';
import { sanitizeOnnMoviesTracePayload } from '../src/features/diagnostics/onnMoviesTrace.ts';

const screen = fs.readFileSync('src/features/movies/MoviesScreen.tsx', 'utf8');
const grid = fs.readFileSync('src/features/movies/components/MoviePosterGrid.tsx', 'utf8');
const overlay = fs.readFileSync('src/features/movies/components/MovieDetailOverlay.tsx', 'utf8');
const lifecycle = fs.readFileSync('src/features/movies/moviesDetailFocusLifecycle.ts', 'utf8');
const returnTarget = fs.readFileSync('src/features/movies/moviesPlaybackReturnTarget.ts', 'utf8');

function simulateNaturalMountedReturn(input) {
  const { snapshotOffset, nativeFocusedOffset } = input;
  const returnPath = 'fast-mounted-target';
  const events = [];
  const commands = [];
  let phase = 'detail-open';
  let visualHold = false;
  let focusRequestCount = 0;
  let currentOffset = snapshotOffset;
  let reveal = null;

  assert.equal(shouldUseMoviesNaturalReturnPath(returnPath), true);
  assert.equal(shouldIssueMoviesInitialDetailRestore(returnPath), false);

  // DETAIL_OPEN → RETURN_FOCUS_REQUESTED
  phase = 'return-focus-requested';
  visualHold = true;
  events.push('detail_visual_hold_started');
  assert.equal(isMoviesNaturalReturnPhase(phase), true);
  assert.equal(shouldHoldMoviesDetailVisual(phase), true);

  // No initial restore / no closing-viewport
  if (shouldIssueMoviesInitialDetailRestore(returnPath)) {
    commands.push({ reason: 'initial-detail-restore' });
  }
  assert.equal(
    isMoviesFastPathInitialRestoreViolation({ returnPath, reason: 'initial' }),
    true,
  );

  // One focus request under cover
  focusRequestCount += 1;
  events.push('focus_request');
  currentOffset = nativeFocusedOffset;

  if (
    !isMoviesViewportOffsetStable({
      currentOffset,
      snapshotOffset,
    })
  ) {
    events.push('native_focus_drift_detected');
    const max = resolveMoviesDetailReturnMaxViewportRestores(returnPath);
    assert.equal(max, 1);
    commands.push({
      reason: 'covered_corrective_scroll',
      requestedOffset: snapshotOffset,
      currentOffset,
      delta: snapshotOffset - currentOffset,
    });
    currentOffset = snapshotOffset;
  }

  // RETURN_FOCUS_CONFIRMED → one frame → release hold → DETAIL_CLOSED
  phase = 'return-focus-confirmed';
  events.push('return_focus_confirmed');
  assert.ok(
    isMoviesViewportOffsetStable({
      currentOffset,
      snapshotOffset,
    }),
  );
  events.push('detail_visual_hold_released');
  visualHold = false;
  phase = 'browse-restored';
  reveal = {
    finalOffset: currentOffset,
    focusConfirmed: true,
    offsetConfirmed: true,
    correctionCount: commands.filter((c) => c.reason === 'covered_corrective_scroll').length,
    userVisibleMovementExpected: false,
  };
  events.push('browse_reveal');

  return {
    phase,
    visualHold,
    focusRequestCount,
    commands,
    events,
    reveal,
    usedClosingViewport: false,
  };
}

test('1) Fast mounted target: no initial-detail-restore, no closing-viewport, one focus, no scroll before focus', () => {
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
  assert.equal(isMoviesDetailReturnFastPath(path), true);

  const result = simulateNaturalMountedReturn({
    snapshotOffset: 894.5,
    nativeFocusedOffset: 894.5,
  });

  assert.equal(result.focusRequestCount, 1);
  assert.equal(result.usedClosingViewport, false);
  assert.equal(
    result.commands.some((c) => c.reason === 'initial-detail-restore'),
    false,
  );
  assert.equal(result.commands.length, 0);
  assert.match(lifecycle, /return-focus-requested/);
  assert.match(lifecycle, /return-focus-confirmed/);
  assert.match(screen, /return-focus-requested/);
  assert.match(screen, /shouldUseMoviesNaturalReturnPath/);
  assert.match(screen, /detail_visual_hold_started/);
  assert.doesNotMatch(
    screen.slice(
      screen.indexOf("if (phase === 'return-focus-requested')"),
      screen.indexOf("if (phase === 'return-focus-requested')") + 800,
    ),
    /closing-viewport/,
  );
});

test('2) Native +70.5 drift: one corrective, visual hold, reveal after offset ack', () => {
  const result = simulateNaturalMountedReturn({
    snapshotOffset: 894.5,
    nativeFocusedOffset: 965,
  });
  assert.equal(result.commands.length, 1);
  assert.equal(result.commands[0].reason, 'covered_corrective_scroll');
  assert.equal(result.commands[0].delta, -70.5);
  assert.equal(result.reveal.correctionCount, 1);
  assert.equal(result.reveal.finalOffset, 894.5);
  assert.ok(result.events.includes('detail_visual_hold_started'));
  assert.ok(result.events.indexOf('detail_visual_hold_released') < result.events.indexOf('browse_reveal'));
  assert.match(screen, /covered_corrective_scroll/);
  assert.match(screen, /detail_visual_hold_released/);
  assert.match(overlay, /visualHoldActive/);
  assert.match(overlay, /backgroundScrimVisualHold/);
});

test('3) No native drift: zero scroll commands, direct confirm, Detail closes once', () => {
  const result = simulateNaturalMountedReturn({
    snapshotOffset: 275,
    nativeFocusedOffset: 275,
  });
  assert.equal(result.commands.length, 0);
  assert.equal(result.focusRequestCount, 1);
  assert.deepEqual(result.reveal, {
    finalOffset: 275,
    focusConfirmed: true,
    offsetConfirmed: true,
    correctionCount: 0,
    userVisibleMovementExpected: false,
  });
  assert.equal(result.phase, 'browse-restored');
  assert.equal(result.visualHold, false);
});

test('4) Duplicate / fast-path initial restore causes failure signal', () => {
  assert.equal(
    isMoviesFastPathInitialRestoreViolation({
      returnPath: 'fast-mounted-target',
      reason: 'initial',
    }),
    true,
  );
  assert.equal(
    isMoviesFastPathInitialRestoreViolation({
      returnPath: 'fast-mounted-target',
      reason: 'corrective',
    }),
    false,
  );
  assert.match(screen, /fast_path_initial_restore_violation/);
  assert.match(grid, /fast_path_initial_restore_violation/);
  assert.match(grid, /allowOffscreenInitialRestore/);
  assert.match(screen, /allowOffscreenInitialRestore=\{allowOffscreenInitialRestore\}/);
});

test('5) Playback from Detail: return target movie-detail; Back closes player only', () => {
  const target = createMoviesDetailPlaybackReturnTarget({
    movieId: 'm1',
    categoryId: '287',
    detailFocusTarget: 'play',
  });
  assert.equal(target.kind, 'movie-detail');
  assert.equal(isMoviesPlaybackReturnToDetail(target), true);
  assert.match(returnTarget, /MoviesPlaybackReturnTarget/);
  assert.match(screen, /playback_return_target_saved/);
  assert.match(screen, /createMoviesDetailPlaybackReturnTarget/);
  assert.match(screen, /playback_returning_to_detail/);
  assert.match(screen, /playback_detail_revealed/);
  // Must not interpret didJustClose as browse restore / detail close.
  const didJustCloseSlice = screen.slice(
    screen.indexOf('if (!didJustClose)'),
    screen.indexOf('if (!didJustClose)') + 3500,
  );
  assert.doesNotMatch(didJustCloseSlice, /beginDetailFocusClose\('playback-close'\)/);
  assert.match(didJustCloseSlice, /isMoviesPlaybackReturnToDetail/);
  assert.equal(MOVIES_FOCUS_STAGE4G_MARKER, 'stage4g-movies-natural-back-stack-v1');
});

test('6) Second Back closes Detail to browse snapshot (contract)', () => {
  assert.match(screen, /beginDetailFocusClose\('detail-close'\)/);
  assert.match(screen, /closeDetail\('back'\)/);
  assert.match(
    lifecycle,
    /detail-open → return-focus-requested → return-focus-confirmed → browse-restored → browse/,
  );
});

test('7) Playback from Search Detail returns to Search Detail', () => {
  const target = createMoviesSearchDetailPlaybackReturnTarget({
    movieId: 'm2',
    searchQuery: 'matrix',
    detailFocusTarget: 'play',
  });
  assert.equal(target.kind, 'search-detail');
  assert.equal(isMoviesPlaybackReturnToDetail(target), true);
  assert.match(screen, /createMoviesSearchDetailPlaybackReturnTarget/);
  assert.match(screen, /playback_returning_to_detail/);
  const didJustCloseSlice = screen.slice(
    screen.indexOf('if (!didJustClose)'),
    screen.indexOf('if (!didJustClose)') + 3500,
  );
  assert.match(didJustCloseSlice, /search-detail/);
  assert.doesNotMatch(didJustCloseSlice, /beginDetailFocusClose\('playback-close'\)/);
});

test('8) Playback from Browse returns to Browse', () => {
  const target = createMoviesBrowsePlaybackReturnTarget({
    movieId: 'm3',
    categoryId: '287',
  });
  assert.equal(target.kind, 'browse');
  assert.equal(isMoviesPlaybackReturnToDetail(target), false);
  assert.match(screen, /createMoviesBrowsePlaybackReturnTarget/);
  assert.match(screen, /playback_returning_to_browse/);
});

test('9) Back ownership: player owns active playback; host does not double-close Detail', () => {
  assert.equal(
    shouldMoviesHostHandlePlaybackBack({ playbackActive: true, playbackClosing: false }),
    false,
  );
  assert.equal(
    shouldMoviesHostHandlePlaybackBack({ playbackActive: false, playbackClosing: false }),
    true,
  );
  assert.match(screen, /defer-to-player/);
  assert.match(screen, /playback_back_consumed/);
  assert.match(screen, /shouldMoviesHostHandlePlaybackBack/);
  // Active playback must not call closePlayback from MoviesScreen shell path.
  const backIdx = screen.indexOf("wrapOnnMoviesBackHandler(");
  assert.ok(backIdx >= 0);
  const backSlice = screen.slice(backIdx, backIdx + 2500);
  assert.match(backSlice, /defer-to-player/);
  assert.match(backSlice, /return false/);
  assert.doesNotMatch(backSlice, /closePlayback\(\)/);
});

test('10) Trace sanitizer keeps userVisibleMovementExpected boolean; secrets redacted', () => {
  const sanitized = sanitizeOnnMoviesTracePayload({
    userVisibleMovementExpected: false,
    password: 'hunter2',
    username: 'admin',
    streamUrl: 'http://cdn.example/movie.ts',
    accessToken: 'tok_abc',
    restorationToken: 'detail-9',
    delta: -70.5,
  });
  assert.equal(sanitized.userVisibleMovementExpected, false);
  assert.equal(typeof sanitized.userVisibleMovementExpected, 'boolean');
  assert.equal(sanitized.password, '[redacted]');
  assert.equal(sanitized.username, '[redacted]');
  assert.equal(sanitized.streamUrl, '[redacted]');
  assert.equal(sanitized.accessToken, '[redacted]');
  assert.equal(sanitized.restorationToken, 'detail-9');
  assert.equal(sanitized.delta, -70.5);
});
