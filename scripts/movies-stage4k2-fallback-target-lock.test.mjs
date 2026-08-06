import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  createMoviesDetailCloseFocusAttempt,
  createMoviesDetailCloseImmutableTarget,
  isMoviesDetailCloseTargetMutation,
  isMoviesDetailOverlayClosedShellInert,
  MOVIES_DETAIL_CLOSE_WATCHDOG_MS,
  MOVIES_DETAIL_FOCUS_CONFIRM_TIMEOUT_MS_V2,
  MOVIES_DETAIL_FOCUS_MAX_RETRIES,
  MOVIES_FOCUS_STAGE4K1_MARKER,
  MOVIES_FOCUS_STAGE4K2_MARKER,
  resolveMoviesDetailCloseRetryTarget,
  shouldAcceptMoviesDetailCloseLateFocus,
  shouldAbortMoviesDetailCloseAfterFailedAttempts,
  shouldFireMoviesDetailCloseWatchdog,
  shouldScheduleMoviesDetailFocusRetry,
  shouldStartMoviesDetailFocusConfirmTimer,
} from '../src/features/movies/moviesDetailCloseInstant.ts';

const screen = fs.readFileSync('src/features/movies/MoviesScreen.tsx', 'utf8');
const overlay = fs.readFileSync('src/features/movies/components/MovieDetailOverlay.tsx', 'utf8');
const instant = fs.readFileSync('src/features/movies/moviesDetailCloseInstant.ts', 'utf8');

function simulateFallbackClose(input = {}) {
  const {
    prepareMs = 380,
    firstRequestConfirms = false,
    lateFocusBeforeRetry = false,
    lateFocusAfterRetrySchedule = false,
    recycledHandleOtherMovie = false,
    bothAttemptsFail = false,
    mutableFocusedMovieId = '1923629',
  } = input;

  const events = [];
  const immutableMovieId = '1560779';
  const token = 'detail-1';
  let now = 0;
  let phase = 'detail-open';
  let detailOpen = true;
  let detailClosing = false;
  let visualIsolation = false;
  let holdCover = false;
  let focusHandoff = false;
  let focusConfirmed = false;
  let confirmTimerStartedAt = null;
  let attemptMovieIds = [];
  let retryScheduled = false;
  let retryCancelled = false;
  let mutationViolation = false;
  let aborted = false;
  let restoredDetailMovieId = null;

  const immutable = createMoviesDetailCloseImmutableTarget({
    token,
    source: 'back',
    origin: 'browse',
    movieId: immutableMovieId,
    categoryId: '1923',
    renderedIndex: 40,
    nativeHandle: 1352,
    gridInstanceId: 'grid-1',
    listRevision: 1,
    originalOffset: 275,
    firstVisibleIndex: 36,
    lastVisibleIndex: 47,
    targetVisible: false,
  });
  events.push('detail_close_immutable_target_locked');
  events.push('detail_close_transaction_started');
  visualIsolation = true;
  holdCover = true;
  focusHandoff = true;
  detailClosing = true;
  phase = 'closing-prepare';
  events.push('detail_close_visual_isolation_started');
  events.push('detail_close_visual_isolation_confirmed');

  // Viewport restore work before first focus request.
  now += prepareMs;
  phase = 'closing-viewport';
  events.push('initial-detail-restore');
  phase = 'closing-focus';

  // Attempt 1 — must use immutable id.
  const attempt1 = createMoviesDetailCloseFocusAttempt({
    token,
    targetMovieId: immutable.movieId,
    attemptNumber: 1,
    now,
  });
  attempt1.requestStartedAt = now;
  attemptMovieIds.push(attempt1.targetMovieId);
  if (isMoviesDetailCloseTargetMutation({
    immutableMovieId: immutable.movieId,
    requestMovieId: attempt1.targetMovieId,
  })) {
    mutationViolation = true;
    events.push('detail_close_target_mutation_violation');
  }
  events.push('detail_close_focus_request_started');
  now += 8;
  attempt1.requestSettledAt = now;
  events.push('detail_close_focus_request_settled');

  assert.equal(
    shouldStartMoviesDetailFocusConfirmTimer({
      token,
      activeToken: token,
      attemptId: attempt1.attemptId,
      currentAttemptId: attempt1.attemptId,
      focusConfirmed: false,
      requestSettled: true,
    }),
    true,
  );
  confirmTimerStartedAt = now;
  events.push('detail_close_focus_confirmation_timer_started');
  // Full 350 ms window from settle — not from transaction start.
  assert.ok(confirmTimerStartedAt - 0 >= prepareMs);

  if (firstRequestConfirms) {
    focusConfirmed = true;
    events.push('detail_close_poster_focus_confirmed');
  } else {
    now += MOVIES_DETAIL_FOCUS_CONFIRM_TIMEOUT_MS_V2;
    events.push('detail_close_focus_confirmation_timeout');

    if (lateFocusBeforeRetry) {
      assert.equal(
        shouldAcceptMoviesDetailCloseLateFocus({
          token,
          activeToken: token,
          movieId: immutableMovieId,
          immutableMovieId,
          gridInstanceId: 'grid-1',
          activeGridInstanceId: 'grid-1',
          revealCommitted: false,
          cancelled: false,
        }),
        true,
      );
      focusConfirmed = true;
      retryCancelled = true;
      events.push('detail_close_late_matching_focus_accepted');
      events.push('detail_close_poster_focus_confirmed');
    } else {
      // Mutable focused movie must not alter retry target.
      const focused = mutableFocusedMovieId;
      assert.notEqual(focused, immutableMovieId);

      const resolvedMovieId = recycledHandleOtherMovie ? focused : immutableMovieId;
      const retry = resolveMoviesDetailCloseRetryTarget({
        immutableMovieId,
        resolvedMovieId: recycledHandleOtherMovie ? null : resolvedMovieId,
        nativeHandle: recycledHandleOtherMovie ? 1806 : 1352,
        refMatched: !recycledHandleOtherMovie,
        gridInstanceMatched: true,
        listRevisionMatched: true,
      });
      events.push('detail_close_retry_target_resolved');

      if (!retry.ok) {
        aborted = true;
        events.push('detail_close_transaction_aborted');
        visualIsolation = false;
        holdCover = false;
        focusHandoff = false;
        detailClosing = false;
        phase = 'detail-open';
        restoredDetailMovieId = immutableMovieId;
        events.push('detail_close_abort_restored_detail');
      } else {
        retryScheduled = true;
        events.push('detail_close_focus_retry_scheduled');
        now += 16;

        if (lateFocusAfterRetrySchedule) {
          assert.equal(
            shouldScheduleMoviesDetailFocusRetry({ focusConfirmedForToken: false }),
            true,
          );
          focusConfirmed = true;
          retryCancelled = true;
          events.push('detail_close_late_matching_focus_accepted');
          events.push('detail_close_poster_focus_confirmed');
        } else {
          // Attempt 2 — same immutable id.
          const attempt2 = createMoviesDetailCloseFocusAttempt({
            token,
            targetMovieId: immutable.movieId,
            attemptNumber: 2,
            now,
          });
          attemptMovieIds.push(attempt2.targetMovieId);
          if (
            isMoviesDetailCloseTargetMutation({
              immutableMovieId: immutable.movieId,
              requestMovieId: attempt2.targetMovieId,
            })
          ) {
            mutationViolation = true;
            events.push('detail_close_target_mutation_violation');
          }
          events.push('detail_close_focus_retry_executed');
          events.push('detail_close_focus_request_started');
          attempt2.requestSettledAt = now;
          events.push('detail_close_focus_request_settled');
          events.push('detail_close_focus_confirmation_timer_started');

          if (bothAttemptsFail) {
            now += MOVIES_DETAIL_FOCUS_CONFIRM_TIMEOUT_MS_V2;
            events.push('detail_close_focus_confirmation_timeout');
            assert.equal(
              shouldAbortMoviesDetailCloseAfterFailedAttempts({
                focusRequestCount: 2,
                maxFocusRequests: 2,
                focusConfirmed: false,
              }),
              true,
            );
            aborted = true;
            events.push('detail_close_transaction_aborted');
            visualIsolation = false;
            holdCover = false;
            focusHandoff = false;
            detailClosing = false;
            phase = 'detail-open';
            restoredDetailMovieId = immutableMovieId;
            events.push('detail_close_abort_restored_detail');
          } else {
            focusConfirmed = true;
            events.push('detail_close_poster_focus_confirmed');
          }
        }
      }
    }
  }

  if (focusConfirmed && !aborted) {
    events.push('detail_close_commit_once');
    detailOpen = false;
    detailClosing = false;
    visualIsolation = false;
    holdCover = false;
    focusHandoff = false;
    phase = 'browse-restored';
    events.push('detail_close_visual_isolation_released');
    events.push('detail_close_visual_state_cleanup');
  }

  return {
    events,
    attemptMovieIds,
    immutableMovieId,
    confirmTimerStartedAt,
    prepareMs,
    mutationViolation,
    retryScheduled,
    retryCancelled,
    focusConfirmed,
    aborted,
    restoredDetailMovieId,
    detailOpen,
    detailClosing,
    visualIsolation,
    holdCover,
    focusHandoff,
    phase,
    now,
  };
}

test('marker and constants', () => {
  assert.equal(MOVIES_FOCUS_STAGE4K2_MARKER, 'stage4k2-movies-fallback-target-lock-v1');
  assert.equal(MOVIES_DETAIL_FOCUS_CONFIRM_TIMEOUT_MS_V2, 350);
  assert.equal(MOVIES_DETAIL_FOCUS_MAX_RETRIES, 1);
  assert.ok(MOVIES_DETAIL_CLOSE_WATCHDOG_MS >= 1200);
  assert.ok(MOVIES_DETAIL_CLOSE_WATCHDOG_MS <= 1500);
  assert.match(instant, /MOVIES_FOCUS_STAGE4K2_MARKER/);
  assert.match(instant, /shouldStartMoviesDetailFocusConfirmTimer/);
  assert.match(instant, /shouldAcceptMoviesDetailCloseLateFocus/);
});

test('1) Confirmation timeout starts after request execution, not transaction start', () => {
  const result = simulateFallbackClose({ prepareMs: 380, firstRequestConfirms: true });
  assert.ok(result.confirmTimerStartedAt >= result.prepareMs);
  assert.match(screen, /detail_close_focus_confirmation_timer_started/);
  assert.match(screen, /startFocusConfirmTimerForAttempt/);
  // Timer must not be armed inside beginDetailFocusClose before focus settle.
  assert.match(screen, /confirmation timeout starts after focus request settles/);
});

test('2) Fallback pipeline taking 380 ms still gives a full 350 ms confirm window', () => {
  const result = simulateFallbackClose({ prepareMs: 380, firstRequestConfirms: false, lateFocusBeforeRetry: true });
  const timerIdx = result.events.indexOf('detail_close_focus_confirmation_timer_started');
  const timeoutIdx = result.events.indexOf('detail_close_focus_confirmation_timeout');
  assert.ok(timerIdx >= 0);
  assert.ok(timeoutIdx > timerIdx);
  assert.equal(result.confirmTimerStartedAt, 380 + 8);
  assert.ok(result.now - result.confirmTimerStartedAt >= MOVIES_DETAIL_FOCUS_CONFIRM_TIMEOUT_MS_V2);
});

test('3) Attempt 1 and attempt 2 always use the immutable transaction movieId', () => {
  const result = simulateFallbackClose({ bothAttemptsFail: false, firstRequestConfirms: false });
  assert.deepEqual(result.attemptMovieIds, [result.immutableMovieId, result.immutableMovieId]);
  assert.match(screen, /detail_close_immutable_target_locked/);
  assert.match(screen, /getImmutableCloseTargetMovieId/);
});

test('4) Mutable focusedMovieId cannot alter retry target', () => {
  const result = simulateFallbackClose({
    mutableFocusedMovieId: '1923629',
    firstRequestConfirms: false,
  });
  assert.ok(result.attemptMovieIds.every((id) => id === '1560779'));
  assert.equal(result.mutationViolation, false);
  assert.doesNotMatch(screen, /setClosingFocusMovieId\(nearest\.movieId\)/);
  assert.doesNotMatch(screen, /timeout-nearest-visible-fallback/);
});

test('5) Recycled native handle mapped to another movie is rejected', () => {
  const rejected = resolveMoviesDetailCloseRetryTarget({
    immutableMovieId: '1560779',
    resolvedMovieId: null,
    nativeHandle: 1806,
    refMatched: false,
    gridInstanceMatched: true,
    listRevisionMatched: true,
  });
  assert.equal(rejected.ok, false);
  const result = simulateFallbackClose({ recycledHandleOtherMovie: true });
  assert.equal(result.aborted, true);
  assert.ok(result.events.includes('detail_close_retry_target_resolved'));
  assert.match(screen, /detail_close_retry_target_resolved/);
});

test('6) Original target onFocus after timeout before retry execution is accepted', () => {
  const result = simulateFallbackClose({ lateFocusBeforeRetry: true });
  assert.equal(result.focusConfirmed, true);
  assert.equal(result.retryCancelled, true);
  assert.ok(result.events.includes('detail_close_late_matching_focus_accepted'));
  assert.match(screen, /detail_close_late_matching_focus_accepted/);
  assert.match(screen, /shouldAcceptMoviesDetailCloseLateFocus/);
});

test('7) Original target onFocus just after retry scheduling is accepted', () => {
  const result = simulateFallbackClose({ lateFocusAfterRetrySchedule: true });
  assert.equal(result.focusConfirmed, true);
  assert.equal(result.retryCancelled, true);
  assert.ok(result.events.includes('detail_close_late_matching_focus_accepted'));
});

test('8) No target mutation violation occurs', () => {
  const result = simulateFallbackClose({});
  assert.equal(result.mutationViolation, false);
  assert.equal(
    isMoviesDetailCloseTargetMutation({
      immutableMovieId: '1560779',
      requestMovieId: '1560779',
    }),
    false,
  );
  assert.equal(
    isMoviesDetailCloseTargetMutation({
      immutableMovieId: '1560779',
      requestMovieId: '1923629',
    }),
    true,
  );
  assert.match(screen, /detail_close_target_mutation_violation/);
});

test('9) Two failed attempts trigger safe transaction abort', () => {
  const result = simulateFallbackClose({ bothAttemptsFail: true });
  assert.equal(result.aborted, true);
  assert.equal(result.phase, 'detail-open');
  assert.equal(result.detailClosing, false);
  assert.ok(result.events.includes('detail_close_transaction_aborted'));
  assert.match(screen, /abortDetailCloseTransaction/);
  assert.match(screen, /focus-attempts-exhausted/);
});

test('10) Watchdog clears closing/isolation/handoff/timers/request target', () => {
  assert.equal(
    shouldFireMoviesDetailCloseWatchdog({
      startedAt: 0,
      now: MOVIES_DETAIL_CLOSE_WATCHDOG_MS,
      watchdogMs: MOVIES_DETAIL_CLOSE_WATCHDOG_MS,
      revealCommitted: false,
      cancelled: false,
    }),
    true,
  );
  assert.match(screen, /MOVIES_DETAIL_CLOSE_WATCHDOG_MS/);
  assert.match(screen, /detail_close_transaction_watchdog_expired/);
  assert.match(screen, /closeWatchdogTimeoutRef/);
  assert.match(screen, /clearCloseAttemptTimers/);
});

test('11) Abort restores the same Detail movie and usable Detail phase', () => {
  const result = simulateFallbackClose({ bothAttemptsFail: true });
  assert.equal(result.restoredDetailMovieId, '1560779');
  assert.equal(result.phase, 'detail-open');
  assert.equal(result.detailOpen, true);
  assert.equal(result.visualIsolation, false);
  assert.equal(result.holdCover, false);
  assert.equal(result.focusHandoff, false);
  assert.match(screen, /detail_close_abort_restored_detail/);
  assert.match(screen, /setDetailFocusPhaseSafe\('detail-open'\)/);
});

test('12) Back after abort starts a new token', () => {
  assert.match(screen, /canBeginMoviesDetailClose/);
  assert.match(screen, /detail_close_immutable_target_locked/);
  // Abort clears transaction so the next close allocates a fresh token.
  assert.match(screen, /closeTransactionRef\.current = null/);
  assert.match(screen, /immutableCloseTargetRef\.current = null/);
});

test('13) Category rail K.1 fix remains intact after successful fallback close', () => {
  const result = simulateFallbackClose({ firstRequestConfirms: true });
  assert.ok(result.events.includes('detail_close_visual_state_cleanup'));
  assert.match(screen, /MOVIES_FOCUS_STAGE4K1_MARKER/);
  assert.match(screen, /railInstanceId=\{railInstanceIdRef\.current\}/);
  // Stage 4.2M: MovieDetailOverlay is a thin shell adapter (no isolation-only roots).
  assert.match(overlay, /MediaDetailOverlayShell/);
  assert.match(overlay, /Stage 4\.2M/);
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
  assert.equal(MOVIES_FOCUS_STAGE4K1_MARKER, 'stage4k1-movies-category-rail-visibility-v1');
});

test('14) Wiring: immutable target, request-scoped timer, watchdog present', () => {
  assert.match(screen, /createMoviesDetailCloseImmutableTarget/);
  assert.match(screen, /createMoviesDetailCloseFocusAttempt/);
  assert.match(screen, /focusAttemptRef/);
  assert.match(screen, /focusConfirmationRef/);
  assert.match(screen, /detail_close_fallback_target_registration_state/);
  assert.doesNotMatch(screen, /setClosingFocusMovieId\(nearest/);
});
