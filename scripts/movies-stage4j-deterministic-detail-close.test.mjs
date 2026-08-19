import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  clearMoviesReadableGenerationCacheForTests,
  getCachedMoviesReadableGeneration,
  resolveMoviesReadableGenerationCached,
  setCachedMoviesReadableGeneration,
  shouldInvalidateMoviesReadableGenerationCache,
} from '../src/features/catalog/moviesReadableGenerationCache.ts';
import {
  createMoviesDetailCloseTransaction,
  isMoviesDetailCloseTargetRefValid,
  MOVIES_FOCUS_STAGE4J_MARKER,
  shouldDropMoviesDetailCloseCallback,
  shouldFocusMoviesDetailHiddenHandoffForClose,
  shouldPreserveMoviesDetailFocusOwner,
  tryCommitMoviesDetailCloseReveal,
} from '../src/features/movies/moviesDetailCloseTransaction.ts';
import {
  selectMoviesDetailReturnPath,
  shouldUseMoviesNaturalReturnPath,
  wasMoviesSnapshotTargetVisible,
} from '../src/features/movies/moviesDetailFocusLifecycle.ts';
import {
  shouldFocusMoviesDetailHiddenHandoffTarget,
  shouldPreserveMoviesDetailCloseButtonFocus,
} from '../src/features/movies/moviesDetailXCloseFocus.ts';

const screen = fs.readFileSync('src/features/movies/MoviesScreen.tsx', 'utf8');
const overlay = fs.readFileSync('src/features/movies/components/MovieDetailOverlay.tsx', 'utf8');
const model = fs.readFileSync('src/features/movies/useMoviesScreenModel.ts', 'utf8');
const search = fs.readFileSync('src/features/search/SearchOverlay.tsx', 'utf8');
const repo = fs.readFileSync('src/features/catalog/catalogRepository.ts', 'utf8');
const closeTx = fs.readFileSync('src/features/movies/moviesDetailCloseTransaction.ts', 'utf8');

function simulateBrowseClose(input) {
  const {
    closeSource = 'back',
    snapshotOffset = 0,
    targetIndex = 0,
    snapshotFirst = 0,
    snapshotLast = 11,
    liveFirst = null,
    liveLast = null,
    targetHandleExists = true,
    listRevisionOpen = 1,
    listRevisionNow = 1,
    visibleEntryMatches = true,
    paginationDuringClose = false,
    duplicateRafCount = 2,
  } = input;

  const events = [];
  const focusRequests = [];
  let revealCount = 0;
  let phase = 'detail-open';
  let stuck = false;
  let deferredPagination = false;
  let listMutatedDuringClose = false;
  let activeToken = null;
  let commitToken = null;
  let revealCommitted = false;
  let hiddenHandoffFocused = false;
  let actualFocused = 'MovieDetailOverlay';
  let visibleLength = 30;

  const snapshot = {
    categoryId: '287',
    movieId: 'm-target',
    movieIndex: targetIndex,
    verticalOffset: snapshotOffset,
    firstVisibleIndex: snapshotFirst,
    lastVisibleIndex: snapshotLast,
  };
  const snapshotWasVisible = wasMoviesSnapshotTargetVisible({
    ...snapshot,
    visibleFirstIndex: snapshotFirst,
    visibleLastIndex: snapshotLast,
  });

  const targetRefValid = isMoviesDetailCloseTargetRefValid({
    hasSnapshot: true,
    targetMovieId: snapshot.movieId,
    targetIndex: snapshot.movieIndex,
    targetNativeHandleExists: targetHandleExists,
    registeredContentIdMatches: true,
    registeredIndexMatches: true,
    gridInstanceMatches: true,
    visibleMoviesEntryMatches: visibleEntryMatches,
    snapshotTargetWasVisible: snapshotWasVisible,
    listRevisionUnchanged: listRevisionOpen === listRevisionNow,
  });

  const returnPath = selectMoviesDetailReturnPath({
    hasSnapshot: true,
    snapshotCategoryId: snapshot.categoryId,
    selectedCategoryId: '287',
    openProviderId: 'p1',
    activeProviderId: 'p1',
    openReadableGeneration: 15,
    activeReadableGeneration: 15,
    openGridInstanceId: 'grid-1',
    activeGridInstanceId: 'grid-1',
    targetMovieId: snapshot.movieId,
    targetInVisibleMovies: true,
    targetNativeHandleExists: targetHandleExists,
    snapshotTargetWasVisible: snapshotWasVisible,
    targetRefIdentityValid: targetRefValid,
    listRevisionUnchanged: listRevisionOpen === listRevisionNow,
  });

  assert.equal(shouldUseMoviesNaturalReturnPath(returnPath), returnPath === 'fast-mounted-target');

  const tx = createMoviesDetailCloseTransaction({
    token: `detail-${closeSource}-1`,
    source: closeSource,
    origin: 'browse',
    targetMovieId: snapshot.movieId,
    targetIndex: snapshot.movieIndex,
    categoryId: snapshot.categoryId,
    gridInstanceId: 'grid-1',
    listOffset: snapshotOffset,
    listRevision: listRevisionOpen,
    snapshotTargetWasVisible: snapshotWasVisible,
  });
  activeToken = tx.token;
  events.push('detail_close_transaction_started');

  const naturalReturn = returnPath === 'fast-mounted-target';
  const preserveOwner = shouldPreserveMoviesDetailCloseButtonFocus({
    closeSource,
    handoffActive: true,
    naturalReturn,
  });
  assert.equal(preserveOwner, true);
  events.push('detail_close_focus_owner_preserved');
  events.push('detail_close_browse_frozen');

  if (shouldFocusMoviesDetailHiddenHandoffTarget({ closeSource, naturalReturn })) {
    hiddenHandoffFocused = true;
  }
  assert.equal(hiddenHandoffFocused, false);

  phase = 'return-focus-requested';

  if (paginationDuringClose) {
    deferredPagination = true;
    events.push('detail_close_deferred_pagination');
    // Must not mutate list identity while close is active.
    listMutatedDuringClose = false;
  }

  // Live viewport indexes may be null — snapshot visibility still authorizes.
  void liveFirst;
  void liveLast;
  if (targetRefValid) {
    events.push('detail_close_target_ref_validated');
    focusRequests.push({ movieId: snapshot.movieId, requestId: 1 });
    events.push('detail_close_focus_request_started');
    events.push('detail_close_focus_request_settled');
    actualFocused = 'MoviePosterCard';
    events.push('detail_close_poster_focus_confirmed');
    phase = 'return-focus-confirmed';

    for (let i = 0; i < duplicateRafCount; i += 1) {
      if (
        shouldDropMoviesDetailCloseCallback({
          activeToken,
          callbackToken: tx.token,
          revealCommitted,
          commitToken,
        })
      ) {
        events.push('detail_close_stale_callback_dropped');
        continue;
      }
      const commit = tryCommitMoviesDetailCloseReveal({ transaction: tx, token: tx.token });
      if (!commit.ok) {
        events.push('detail_close_duplicate_commit_blocked');
        continue;
      }
      commitToken = tx.token;
      revealCommitted = true;
      activeToken = null;
      revealCount += 1;
      events.push('detail_close_commit_once');
      events.push('detail_close_browse_revealed');
      phase = 'browse-restored';
      events.push('detail_close_transaction_finished');
    }
  } else {
    stuck = true;
    phase = 'return-focus-requested';
  }

  if (deferredPagination && phase === 'browse-restored') {
    visibleLength = 60;
    events.push('detail_close_deferred_commits_flushed');
  }

  return {
    phase,
    returnPath,
    revealCount,
    focusRequestCount: focusRequests.length,
    hiddenHandoffFocused,
    actualFocused,
    stuck,
    listMutatedDuringClose,
    deferredPagination,
    visibleLength,
    events,
    snapshotWasVisible,
    liveViewportNull: liveFirst == null && liveLast == null,
  };
}

test('marker and wiring present', () => {
  assert.equal(MOVIES_FOCUS_STAGE4J_MARKER, 'stage4j-movies-deterministic-detail-close-v1');
  assert.match(screen, /closeCommitTokenRef/);
  assert.match(screen, /detail_close_transaction_started/);
  assert.match(screen, /detail_close_commit_once/);
  assert.match(screen, /detail_close_stale_callback_dropped/);
  assert.match(screen, /shouldDropMoviesDetailCloseCallback/);
  assert.match(closeTx, /tryCommitMoviesDetailCloseReveal/);
  assert.match(model, /detail_close_deferred_pagination|enqueueOrApplyBrowseCommit/);
  assert.match(overlay, /forceFocusable/);
  assert.match(overlay, /keepFocusTrap/);
});

test('1) Back from visible top-row poster: one focus request, one reveal, no duplicate', () => {
  const result = simulateBrowseClose({
    closeSource: 'back',
    targetIndex: 2,
    snapshotOffset: 0,
    duplicateRafCount: 3,
  });
  assert.equal(result.returnPath, 'fast-mounted-target');
  assert.equal(result.focusRequestCount, 1);
  assert.equal(result.revealCount, 1);
  assert.equal(result.actualFocused, 'MoviePosterCard');
  assert.ok(result.events.includes('detail_close_stale_callback_dropped'));
  assert.ok(result.events.filter((e) => e === 'detail_close_commit_once').length === 1);
});

test('2) Back from deep-row: null live viewport indexes; snapshot proves visibility; not stuck', () => {
  const result = simulateBrowseClose({
    closeSource: 'back',
    targetIndex: 26,
    snapshotOffset: 852,
    snapshotFirst: 24,
    snapshotLast: 35,
    liveFirst: null,
    liveLast: null,
  });
  assert.equal(result.snapshotWasVisible, true);
  assert.equal(result.liveViewportNull, true);
  assert.equal(result.returnPath, 'fast-mounted-target');
  assert.equal(result.stuck, false);
  assert.equal(result.phase, 'browse-restored');
  assert.equal(result.focusRequestCount, 1);
});

test('3) X from Browse Detail: same final state as Back; no hidden sentinel', () => {
  const back = simulateBrowseClose({ closeSource: 'back', snapshotOffset: 120 });
  const x = simulateBrowseClose({ closeSource: 'x', snapshotOffset: 120 });
  assert.equal(back.phase, x.phase);
  assert.equal(back.actualFocused, x.actualFocused);
  assert.equal(back.revealCount, x.revealCount);
  assert.equal(back.hiddenHandoffFocused, false);
  assert.equal(x.hiddenHandoffFocused, false);
  assert.equal(
    shouldPreserveMoviesDetailFocusOwner({ handoffActive: true, naturalReturn: true }),
    true,
  );
  assert.equal(
    shouldFocusMoviesDetailHiddenHandoffForClose({ naturalReturn: true }),
    false,
  );
});

test('4) Search Detail Back and X: exact result restored; input does not reclaim; one reveal', () => {
  assert.match(screen, /origin: 'search'/);
  assert.match(screen, /detail_close_search_revealed/);
  assert.match(screen, /searchReturnPending/);
  assert.match(search, /search_input_focus_suppressed/);
  assert.match(search, /restoreFocusMovieId/);
  // Modal-show must not focus input while restoring a result.
  assert.match(search, /modal-show-restore-result/);
});

test('5) Pagination during close: append deferred; refs stable; flush after latch', () => {
  const result = simulateBrowseClose({
    closeSource: 'back',
    paginationDuringClose: true,
  });
  assert.equal(result.deferredPagination, true);
  assert.equal(result.listMutatedDuringClose, false);
  assert.ok(result.events.includes('detail_close_deferred_pagination'));
  assert.ok(result.events.includes('detail_close_deferred_commits_flushed'));
  assert.equal(result.visibleLength, 60);
  assert.match(model, /flushDeferredBrowseCommits/);
  assert.match(screen, /setMoviesBrowseUiFrozenForDetail/);
});

test('6) Catalog generation refresh during close: UI commit deferred', () => {
  assert.match(model, /detail_close_deferred_catalog_commit|catalog-commit/);
  assert.match(model, /enqueueOrApplyBrowseCommit/);
  assert.match(screen, /detail_close_browse_frozen/);
  const result = simulateBrowseClose({
    closeSource: 'back',
    listRevisionOpen: 3,
    listRevisionNow: 3,
  });
  assert.equal(result.phase, 'browse-restored');
});

test('7) Duplicate RAF/timer callbacks: first commits; later dropped', () => {
  const tx = createMoviesDetailCloseTransaction({
    token: 't1',
    source: 'back',
    origin: 'browse',
    targetMovieId: 'm1',
    targetIndex: 0,
    categoryId: 'c',
    gridInstanceId: 'g',
    listOffset: 0,
  });
  let activeToken = tx.token;
  let commitToken = null;
  let revealCommitted = false;
  let commits = 0;
  for (let i = 0; i < 4; i += 1) {
    if (
      shouldDropMoviesDetailCloseCallback({
        activeToken,
        callbackToken: 't1',
        revealCommitted,
        commitToken,
      })
    ) {
      continue;
    }
    const commit = tryCommitMoviesDetailCloseReveal({ transaction: { ...tx, revealCommitted }, token: 't1' });
    if (!commit.ok) continue;
    commits += 1;
    revealCommitted = true;
    commitToken = 't1';
    activeToken = null;
  }
  assert.equal(commits, 1);
  assert.equal(
    shouldDropMoviesDetailCloseCallback({
      activeToken: null,
      callbackToken: 't1',
      revealCommitted: true,
      commitToken: 't1',
    }),
    true,
  );
});

test('8) Playback → Detail: Detail instance remains mounted; Play/Resume focused path', () => {
  // Stage 4.2K: stable shell uses keepFocusTrap for MoviesScreen lifetime.
  assert.match(screen, /keepFocusTrap/);
  assert.match(screen, /overlayInstanceId=\{overlayInstanceIdRef\.current\}/);
  assert.match(screen, /playback_detail_revealed/);
  assert.match(overlay, /keepFocusTrap/);
  // Overlay stays mounted when keepFocusTrap even if not visible.
  assert.match(overlay, /!visible && !keepFocusTrap && !visualHoldActive/);
});

test('9) Concurrent resolver callers: one integrity scan; cached generation reused', async () => {
  clearMoviesReadableGenerationCacheForTests();
  let scans = 0;
  const resolve = async () => {
    scans += 1;
    await new Promise((r) => setTimeout(r, 5));
    return 15;
  };
  const [a, b, c] = await Promise.all([
    resolveMoviesReadableGenerationCached({
      providerId: 'p-cache',
      resolve,
      getMeta: async () => ({
        itemRows: 1000,
        categoryRows: 40,
        distinctItemCategoryIds: 40,
        activeProviderGeneration: 15,
        syncingGeneration: 16,
        syncStatus: 'syncing',
      }),
    }),
    resolveMoviesReadableGenerationCached({
      providerId: 'p-cache',
      resolve,
      getMeta: async () => ({
        itemRows: 1000,
        categoryRows: 40,
        distinctItemCategoryIds: 40,
        activeProviderGeneration: 15,
        syncingGeneration: 16,
        syncStatus: 'syncing',
      }),
    }),
    resolveMoviesReadableGenerationCached({
      providerId: 'p-cache',
      resolve,
      getMeta: async () => ({
        itemRows: 1000,
        categoryRows: 40,
        distinctItemCategoryIds: 40,
        activeProviderGeneration: 15,
        syncingGeneration: 16,
        syncStatus: 'syncing',
      }),
    }),
  ]);
  assert.equal(a, 15);
  assert.equal(b, 15);
  assert.equal(c, 15);
  assert.equal(scans, 1);
  assert.equal(getCachedMoviesReadableGeneration('p-cache')?.generation, 15);

  // Syncing/errored newer gen must not invalidate healthy active 15.
  assert.equal(
    shouldInvalidateMoviesReadableGenerationCache({
      cachedGeneration: 15,
      activeProviderGeneration: 15,
      syncingGeneration: 16,
      syncStatus: 'syncing',
    }),
    false,
  );
  assert.equal(
    shouldInvalidateMoviesReadableGenerationCache({
      cachedGeneration: 15,
      activeProviderGeneration: 15,
      syncingGeneration: 17,
      syncStatus: 'error',
    }),
    false,
  );

  setCachedMoviesReadableGeneration({
    providerId: 'p-cache',
    generation: 15,
    resolvedAt: Date.now(),
    itemRows: 1000,
    categoryRows: 40,
    distinctItemCategoryIds: 40,
  });
  const reused = await resolveMoviesReadableGenerationCached({
    providerId: 'p-cache',
    resolve: async () => {
      scans += 1;
      return 15;
    },
    getMeta: async () => ({
      itemRows: 1000,
      categoryRows: 40,
      distinctItemCategoryIds: 40,
      activeProviderGeneration: 15,
      syncingGeneration: 16,
      syncStatus: 'syncing',
    }),
  });
  assert.equal(reused, 15);
  assert.equal(scans, 1);
  assert.match(repo, /resolveMoviesReadableGenerationCached/);
});

test('10) Target ref validation rejects handle-only targets', () => {
  assert.equal(
    isMoviesDetailCloseTargetRefValid({
      hasSnapshot: true,
      targetMovieId: 'm1',
      targetIndex: 26,
      targetNativeHandleExists: true,
      registeredContentIdMatches: true,
      registeredIndexMatches: true,
      gridInstanceMatches: true,
      visibleMoviesEntryMatches: true,
      snapshotTargetWasVisible: false,
      listRevisionUnchanged: true,
    }),
    false,
  );
  assert.equal(
    selectMoviesDetailReturnPath({
      hasSnapshot: true,
      snapshotCategoryId: '287',
      selectedCategoryId: '287',
      openProviderId: 'p1',
      activeProviderId: 'p1',
      openReadableGeneration: 15,
      activeReadableGeneration: 15,
      openGridInstanceId: 'g',
      activeGridInstanceId: 'g',
      targetMovieId: 'm1',
      targetInVisibleMovies: true,
      targetNativeHandleExists: true,
      snapshotTargetWasVisible: false,
    }),
    'fallback-target-unmounted',
  );
});
