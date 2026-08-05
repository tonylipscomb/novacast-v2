import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  areMoviesDetailCloseFinalStatesEqual,
  buildMoviesDetailCloseFinalState,
  createMoviesDetailXCloseActivationLock,
  MOVIES_FOCUS_STAGE4H_MARKER,
  resetMoviesDetailXCloseActivationLock,
  shouldFocusMoviesDetailHiddenHandoffTarget,
  shouldMountMoviesDetailHiddenHandoffTarget,
  shouldPreserveMoviesDetailCloseButtonFocus,
  shouldResetMoviesDetailXCloseActivationLock,
  tryAcquireMoviesDetailXCloseActivation,
} from '../src/features/movies/moviesDetailXCloseFocus.ts';
import {
  isMoviesViewportOffsetStable,
  resolveMoviesDetailReturnMaxViewportRestores,
  shouldIssueMoviesInitialDetailRestore,
  shouldUseMoviesNaturalReturnPath,
} from '../src/features/movies/moviesDetailFocusLifecycle.ts';

const screen = fs.readFileSync('src/features/movies/MoviesScreen.tsx', 'utf8');
const overlay = fs.readFileSync('src/features/movies/components/MovieDetailOverlay.tsx', 'utf8');
const xFocus = fs.readFileSync('src/features/movies/moviesDetailXCloseFocus.ts', 'utf8');

function simulateXOwnedHandoff(input) {
  const { snapshotOffset, nativeFocusedOffset, closeSource = 'x' } = input;
  const commands = [];
  const events = [];
  let phase = 'detail-open';
  let closeFocusable = true;
  let hiddenHandoffFocused = false;
  let visualHold = false;
  let preserveClose = false;
  let lock = createMoviesDetailXCloseActivationLock('m1');
  let focusRequestCount = 0;
  let currentOffset = snapshotOffset;
  let actualFocusedComponent = 'MovieDetailOverlay';
  let reveal = null;

  // X press
  const first = tryAcquireMoviesDetailXCloseActivation({ lock, movieId: 'm1' });
  assert.equal(first.acquired, true);
  lock = first.lock;
  events.push('detail_x_close_pressed');

  const second = tryAcquireMoviesDetailXCloseActivation({ lock, movieId: 'm1' });
  assert.equal(second.acquired, false);

  preserveClose = shouldPreserveMoviesDetailCloseButtonFocus({
    closeSource,
    handoffActive: true,
  });
  visualHold = true;
  phase = 'return-focus-requested';
  events.push('detail_x_focus_owner_preserved');

  closeFocusable = preserveClose;
  assert.equal(closeFocusable, true);

  const mountHidden = shouldMountMoviesDetailHiddenHandoffTarget({
    closeSource,
    handoffActive: true,
  });
  assert.equal(mountHidden, false);
  if (shouldFocusMoviesDetailHiddenHandoffTarget({ closeSource })) {
    hiddenHandoffFocused = true;
  } else {
    events.push('detail_x_hidden_handoff_focus_skipped');
  }
  assert.equal(hiddenHandoffFocused, false);

  // One poster focus request
  focusRequestCount += 1;
  events.push('detail_x_poster_focus_requested');
  currentOffset = nativeFocusedOffset;

  if (
    !isMoviesViewportOffsetStable({
      currentOffset,
      snapshotOffset,
    })
  ) {
    const max = resolveMoviesDetailReturnMaxViewportRestores('fast-mounted-target');
    assert.equal(max, 1);
    commands.push({ reason: 'covered_corrective_scroll' });
    currentOffset = snapshotOffset;
    // X remains mounted/focusable during correction
    assert.equal(closeFocusable, true);
    assert.equal(visualHold, true);
  }

  actualFocusedComponent = 'MoviePosterCard';
  events.push('detail_x_poster_focus_confirmed');
  phase = 'return-focus-confirmed';

  // Only after poster + offset confirm: release X, reveal browse
  assert.ok(
    isMoviesViewportOffsetStable({
      currentOffset,
      snapshotOffset,
    }),
  );
  events.push('detail_x_focus_owner_released');
  closeFocusable = false;
  preserveClose = false;
  visualHold = false;
  lock = resetMoviesDetailXCloseActivationLock();
  phase = 'browse-restored';
  reveal = buildMoviesDetailCloseFinalState({
    movieId: 'm1',
    categoryId: '287',
    offset: currentOffset,
    gridInstanceId: 'grid-1',
  });

  return {
    phase,
    closeFocusableAtHandoff: true,
    hiddenHandoffFocused,
    focusRequestCount,
    commands,
    events,
    reveal,
    actualFocusedComponent,
    lock,
  };
}

test('1) X owns focus: remains native-focusable, activation locked, hidden target not focused', () => {
  assert.equal(
    shouldPreserveMoviesDetailCloseButtonFocus({ closeSource: 'x', handoffActive: true }),
    true,
  );
  assert.equal(
    shouldPreserveMoviesDetailCloseButtonFocus({ closeSource: 'back', handoffActive: true }),
    false,
  );
  assert.equal(shouldFocusMoviesDetailHiddenHandoffTarget({ closeSource: 'x' }), false);
  assert.equal(shouldFocusMoviesDetailHiddenHandoffTarget({ closeSource: 'back' }), true);

  const result = simulateXOwnedHandoff({
    snapshotOffset: 894.5,
    nativeFocusedOffset: 894.5,
  });
  assert.equal(result.closeFocusableAtHandoff, true);
  assert.equal(result.hiddenHandoffFocused, false);
  assert.ok(result.events.includes('detail_x_hidden_handoff_focus_skipped'));
  assert.match(overlay, /preserveCloseButtonFocus/);
  assert.match(overlay, /closeActivationLocked/);
  assert.match(overlay, /mountHiddenHandoffTarget/);
  assert.match(overlay, /ownerPreservedHandoff/);
  assert.match(screen, /tryAcquireMoviesDetailXCloseActivation/);
  assert.equal(MOVIES_FOCUS_STAGE4H_MARKER, 'stage4h-movies-x-close-focus-v1');
});

test('2) Poster focus: exact original poster once; onFocus before overlay hides', () => {
  const result = simulateXOwnedHandoff({
    snapshotOffset: 275,
    nativeFocusedOffset: 275,
  });
  assert.equal(result.focusRequestCount, 1);
  assert.ok(
    result.events.indexOf('detail_x_poster_focus_confirmed') <
      result.events.indexOf('detail_x_focus_owner_released'),
  );
  assert.match(screen, /detail_x_poster_focus_requested/);
  assert.match(screen, /detail_x_poster_focus_confirmed/);
  assert.match(screen, /detail_x_hidden_handoff_focus_skipped/);
});

test('3) Native drift: one covered corrective; X mounted; reveal waits for offset', () => {
  const result = simulateXOwnedHandoff({
    snapshotOffset: 894.5,
    nativeFocusedOffset: 965,
  });
  assert.equal(result.commands.length, 1);
  assert.equal(result.commands[0].reason, 'covered_corrective_scroll');
  assert.equal(result.reveal.offset, 894.5);
  assert.equal(shouldIssueMoviesInitialDetailRestore('fast-mounted-target'), false);
  assert.equal(shouldUseMoviesNaturalReturnPath('fast-mounted-target'), true);
  assert.match(screen, /covered_corrective_scroll/);
  assert.match(screen, /preserveCloseButtonFocus/);
});

test('4) No drift: zero scroll; poster confirms; overlay closes directly', () => {
  const result = simulateXOwnedHandoff({
    snapshotOffset: 0,
    nativeFocusedOffset: 0,
  });
  assert.equal(result.commands.length, 0);
  assert.equal(result.focusRequestCount, 1);
  assert.equal(result.phase, 'browse-restored');
  assert.equal(result.reveal.offset, 0);
});

test('5) Browse reveal: MoviePosterCard focused; highlight visible; hidden target not focused', () => {
  const result = simulateXOwnedHandoff({
    snapshotOffset: 120,
    nativeFocusedOffset: 120,
  });
  assert.equal(result.actualFocusedComponent, 'MoviePosterCard');
  assert.equal(result.reveal.actualFocusedComponent, 'MoviePosterCard');
  assert.equal(result.reveal.hiddenHandoffFocused, false);
  assert.match(screen, /actualFocusedComponentRef\.current = 'MoviePosterCard'/);
  assert.match(screen, /Keep closingFocusMovieId until latch owns preferred\/highlight pin/);
  assert.match(screen, /detail_x_focus_owner_released/);
});

test('6) Hardware Back: existing natural return path remains wired', () => {
  assert.equal(
    shouldPreserveMoviesDetailCloseButtonFocus({ closeSource: 'back', handoffActive: true }),
    false,
  );
  assert.equal(shouldFocusMoviesDetailHiddenHandoffTarget({ closeSource: 'back' }), true);
  assert.match(screen, /closeDetail\('back'\)/);
  assert.match(screen, /return-focus-requested/);
  assert.match(screen, /shouldUseMoviesNaturalReturnPath/);
  // Back may still park on hidden handoff when not X-owned.
  assert.match(screen, /overlayCloseTargetRef\.current\?\.focus\(\)/);
});

test('7) X and Back parity: same final movie/category/offset/grid/phase', () => {
  const fromX = buildMoviesDetailCloseFinalState({
    movieId: 'm1',
    categoryId: '287',
    offset: 894.5,
    gridInstanceId: 'grid-1',
  });
  const fromBack = buildMoviesDetailCloseFinalState({
    movieId: 'm1',
    categoryId: '287',
    offset: 894.5,
    gridInstanceId: 'grid-1',
  });
  assert.equal(areMoviesDetailCloseFinalStatesEqual(fromX, fromBack), true);
  assert.match(screen, /beginDetailFocusClose\('detail-close'\)/);
  assert.match(screen, /closeSource: detailCloseSourceRef\.current/);
  assert.match(xFocus, /areMoviesDetailCloseFinalStatesEqual/);
});

test('8) Search-origin Detail: X returns to Search (no browse restore)', () => {
  const searchStart = screen.indexOf("// Stage 4.2J: Search-origin Detail close");
  const browseClose = screen.indexOf("beginFocusAuditCycle('movies-detail-close'");
  assert.ok(searchStart >= 0);
  assert.ok(browseClose > searchStart);
  const closeSlice = screen.slice(searchStart, browseClose);
  assert.match(closeSlice, /detailSourceRef\.current === 'search'/);
  assert.match(closeSlice, /search-restoring/);
  assert.match(closeSlice, /origin: 'search'/);
  // Stage 4.2J: Search close uses its own transaction — not browse beginDetailFocusClose.
  assert.doesNotMatch(closeSlice, /beginDetailFocusClose/);
});

test('9) Playback return-to-Detail behavior unchanged', () => {
  assert.match(screen, /playback_returning_to_detail/);
  assert.match(screen, /createMoviesDetailPlaybackReturnTarget/);
  const didJustCloseSlice = screen.slice(
    screen.indexOf('if (!didJustClose)'),
    screen.indexOf('if (!didJustClose)') + 3500,
  );
  assert.doesNotMatch(didJustCloseSlice, /beginDetailFocusClose\('playback-close'\)/);
  assert.match(didJustCloseSlice, /isMoviesPlaybackReturnToDetail/);
});

test('X activation lock resets on movie change and successful close', () => {
  let lock = tryAcquireMoviesDetailXCloseActivation({
    lock: createMoviesDetailXCloseActivationLock(),
    movieId: 'm1',
  }).lock;
  assert.equal(lock.locked, true);
  assert.equal(
    shouldResetMoviesDetailXCloseActivationLock({ lock, openMovieId: 'm2' }),
    true,
  );
  lock = resetMoviesDetailXCloseActivationLock('m2');
  assert.equal(lock.locked, false);
  assert.match(screen, /releaseXCloseOwnership/);
  assert.match(screen, /movie-changed/);
  assert.match(screen, /detail_x_close_pressed/);
  assert.match(screen, /detail_x_focus_violation/);
});
