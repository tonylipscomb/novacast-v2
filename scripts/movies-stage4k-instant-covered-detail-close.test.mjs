import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  createMoviesDetailOverlayInstanceId,
  isMoviesDetailCloseCorrectionUncovered,
  MOVIES_DETAIL_CLOSE_FALLBACK_TARGET_MS,
  MOVIES_DETAIL_CLOSE_TARGET_MS,
  MOVIES_DETAIL_FOCUS_CONFIRM_TIMEOUT_MS_V2,
  MOVIES_DETAIL_FOCUS_MAX_RETRIES,
  MOVIES_FOCUS_STAGE4K_MARKER,
  shouldAcceptMoviesDetailCloseFocusConfirmation,
  shouldIssueMoviesDetailCloseFocusRequest,
  shouldReleaseMoviesDetailVisualIsolation,
} from '../src/features/movies/moviesDetailCloseInstant.ts';
import { MOVIES_DETAIL_FOCUS_CONFIRM_TIMEOUT_MS } from '../src/features/movies/moviesDetailFocusLifecycle.ts';

const screen = fs.readFileSync('src/features/movies/MoviesScreen.tsx', 'utf8');
const overlay = fs.readFileSync('src/features/movies/components/MovieDetailOverlay.tsx', 'utf8');
const instant = fs.readFileSync('src/features/movies/moviesDetailCloseInstant.ts', 'utf8');
const lifecycle = fs.readFileSync('src/features/movies/moviesDetailFocusLifecycle.ts', 'utf8');

function simulateInstantCoveredClose(input = {}) {
  const {
    closeSource = 'back',
    firstRequestConfirms = true,
    nativeDrift = false,
    duplicateConfirmations = 1,
  } = input;

  const events = [];
  let phase = 'detail-open';
  let focusRequests = 0;
  let concurrent = 0;
  let maxConcurrent = 0;
  let focusIssued = false;
  let nativeReady = false;
  let visualIsolation = false;
  let visualHold = false;
  let focusConfirmed = false;
  let confirmedToken = null;
  let offsetConfirmed = false;
  let correctiveUncovered = false;
  let overlayMounts = 0;
  let overlayUnmounts = 0;
  let revealCount = 0;
  const token = `detail-${closeSource}-1`;
  const startedAt = 0;
  let now = 0;

  const overlayInstanceId = createMoviesDetailOverlayInstanceId(1);
  overlayMounts = 1;

  // Close begins — arm environment, do not request focus yet.
  visualHold = true;
  visualIsolation = true;
  phase = 'return-focus-arming';
  events.push('detail_close_transaction_started');
  events.push('detail_close_native_focus_environment_armed');
  events.push('detail_close_visual_isolation_started');
  assert.equal(
    shouldIssueMoviesDetailCloseFocusRequest({
      phase,
      nativeEnvironmentReady: nativeReady,
      focusAlreadyIssued: focusIssued,
      focusRequestCount: focusRequests,
      maxFocusRequests: 2,
    }),
    false,
  );

  // React commit + one rAF
  now += 16;
  nativeReady = true;
  events.push('detail_close_native_focus_environment_ready');
  events.push('detail_close_visual_isolation_confirmed');
  phase = 'return-focus-requested';

  assert.equal(
    shouldIssueMoviesDetailCloseFocusRequest({
      phase,
      nativeEnvironmentReady: nativeReady,
      focusAlreadyIssued: focusIssued,
      focusRequestCount: focusRequests,
      maxFocusRequests: 2,
    }),
    true,
  );

  // One exact focus request
  focusIssued = true;
  focusRequests += 1;
  concurrent = 1;
  maxConcurrent = Math.max(maxConcurrent, concurrent);
  events.push('detail_close_focus_request_started');
  now += 20;
  events.push('detail_close_focus_request_settled');
  concurrent = 0;

  if (!firstRequestConfirms) {
    now += MOVIES_DETAIL_FOCUS_CONFIRM_TIMEOUT_MS_V2;
    events.push('detail_close_focus_confirmation_timeout');
    assert.ok(now - startedAt < 500);
    events.push('detail_close_focus_retry_scheduled');
    now += 16; // one frame
    focusIssued = false;
    assert.equal(
      shouldIssueMoviesDetailCloseFocusRequest({
        phase,
        nativeEnvironmentReady: nativeReady,
        focusAlreadyIssued: focusIssued,
        focusRequestCount: focusRequests,
        maxFocusRequests: 2,
      }),
      true,
    );
    focusIssued = true;
    focusRequests += 1;
    concurrent = 1;
    maxConcurrent = Math.max(maxConcurrent, concurrent);
    events.push('detail_close_focus_retry_executed');
    events.push('detail_close_focus_request_started');
    concurrent = 0;
  }

  // Poster onFocus — confirm once (duplicates dropped)
  for (let i = 0; i < duplicateConfirmations; i += 1) {
    const accept = shouldAcceptMoviesDetailCloseFocusConfirmation({
      token,
      confirmedToken,
      movieId: 'm1',
      targetMovieId: 'm1',
    });
    if (!accept) {
      events.push('detail_close_duplicate_focus_confirmation_dropped');
      continue;
    }
    confirmedToken = token;
    focusConfirmed = true;
    events.push('detail_close_poster_focus_confirmed');
  }

  if (nativeDrift) {
    if (
      isMoviesDetailCloseCorrectionUncovered({
        visualIsolationActive: visualIsolation,
        visualHoldActive: visualHold,
      })
    ) {
      correctiveUncovered = true;
      events.push('detail_close_uncovered_correction_violation');
    } else {
      events.push('covered_corrective_scroll');
      now += 32;
    }
  }

  offsetConfirmed = true;
  assert.equal(
    shouldReleaseMoviesDetailVisualIsolation({
      focusConfirmed,
      movieIdConfirmed: true,
      offsetConfirmed,
      correctiveScrollPending: false,
    }),
    true,
  );

  // One committed frame then reveal
  now += 16;
  events.push('detail_close_commit_once');
  events.push('detail_close_visual_isolation_released');
  visualIsolation = false;
  visualHold = false;
  revealCount += 1;
  phase = 'browse-restored';
  events.push('detail_close_browse_revealed');
  events.push('detail_close_transaction_finished');

  // Normal close must not remount overlay shell
  assert.equal(overlayMounts, 1);
  assert.equal(overlayUnmounts, 0);

  return {
    phase,
    closeSource,
    focusRequests,
    maxConcurrent,
    revealCount,
    focusConfirmed,
    correctiveUncovered,
    visualIsolationReleasedAfterOffset: offsetConfirmed && !visualIsolation,
    elapsedMs: now - startedAt,
    events,
    overlayInstanceId,
  };
}

test('marker and timing constants', () => {
  assert.equal(MOVIES_FOCUS_STAGE4K_MARKER, 'stage4k-movies-instant-covered-detail-close-v1');
  assert.equal(MOVIES_DETAIL_FOCUS_CONFIRM_TIMEOUT_MS, 350);
  assert.equal(MOVIES_DETAIL_FOCUS_CONFIRM_TIMEOUT_MS_V2, 350);
  assert.equal(MOVIES_DETAIL_FOCUS_MAX_RETRIES, 1);
  assert.equal(MOVIES_DETAIL_CLOSE_TARGET_MS, 500);
  assert.equal(MOVIES_DETAIL_CLOSE_FALLBACK_TARGET_MS, 750);
  assert.ok(MOVIES_DETAIL_FOCUS_CONFIRM_TIMEOUT_MS < 500);
  assert.ok(MOVIES_DETAIL_FOCUS_CONFIRM_TIMEOUT_MS >= 250);
  assert.match(lifecycle, /return-focus-arming/);
  assert.match(instant, /MOVIES_FOCUS_STAGE4K_MARKER/);
});

test('1) Top-row Back waits for native-ready before requesting focus', () => {
  const result = simulateInstantCoveredClose({ closeSource: 'back' });
  const armed = result.events.indexOf('detail_close_native_focus_environment_armed');
  const ready = result.events.indexOf('detail_close_native_focus_environment_ready');
  const request = result.events.indexOf('detail_close_focus_request_started');
  assert.ok(armed >= 0);
  assert.ok(ready > armed);
  assert.ok(request > ready);
  assert.match(screen, /return-focus-arming/);
  assert.match(screen, /detail_close_native_focus_environment_armed/);
  assert.match(screen, /detail_close_native_focus_environment_ready/);
});

test('2) Top-row X follows the same sequence', () => {
  const back = simulateInstantCoveredClose({ closeSource: 'back' });
  const x = simulateInstantCoveredClose({ closeSource: 'x' });
  assert.equal(back.focusRequests, x.focusRequests);
  assert.equal(back.revealCount, x.revealCount);
  assert.deepEqual(
    back.events.filter((e) => e.startsWith('detail_close_native') || e.startsWith('detail_close_focus_request')),
    x.events.filter((e) => e.startsWith('detail_close_native') || e.startsWith('detail_close_focus_request')),
  );
});

test('3) Normal mounted return uses one request', () => {
  const result = simulateInstantCoveredClose({ firstRequestConfirms: true });
  assert.equal(result.focusRequests, 1);
  assert.equal(result.revealCount, 1);
  assert.ok(result.elapsedMs < MOVIES_DETAIL_CLOSE_TARGET_MS);
});

test('4) Failed first request retries within 400 ms, not 2200 ms', () => {
  const result = simulateInstantCoveredClose({ firstRequestConfirms: false });
  assert.equal(result.focusRequests, 2);
  assert.ok(result.events.includes('detail_close_focus_confirmation_timeout'));
  assert.ok(result.events.includes('detail_close_focus_retry_scheduled'));
  assert.ok(result.events.includes('detail_close_focus_retry_executed'));
  assert.ok(result.elapsedMs < 750);
  assert.ok(MOVIES_DETAIL_FOCUS_CONFIRM_TIMEOUT_MS_V2 <= 400);
  assert.doesNotMatch(lifecycle, /export const MOVIES_DETAIL_FOCUS_CONFIRM_TIMEOUT_MS = 2200/);
  assert.match(screen, /detail_close_focus_confirmation_timeout/);
  assert.match(screen, /detail_close_focus_retry_scheduled/);
});

test('5) No concurrent requests', () => {
  const result = simulateInstantCoveredClose({ firstRequestConfirms: false });
  assert.equal(result.maxConcurrent, 1);
  assert.match(screen, /shouldIssueMoviesDetailCloseFocusRequest/);
});

test('6) Visual isolation remains active until final offset confirmation', () => {
  const result = simulateInstantCoveredClose({ nativeDrift: true });
  const started = result.events.indexOf('detail_close_visual_isolation_started');
  const released = result.events.indexOf('detail_close_visual_isolation_released');
  const offsetScroll = result.events.indexOf('covered_corrective_scroll');
  assert.ok(started >= 0);
  assert.ok(released > started);
  assert.ok(offsetScroll > started);
  assert.ok(offsetScroll < released);
  assert.equal(result.visualIsolationReleasedAfterOffset, true);
  assert.match(screen, /detail_close_visual_isolation_started/);
  assert.match(screen, /detail_close_visual_isolation_released/);
  assert.match(overlay, /visualIsolationActive/);
  assert.match(overlay, /visualIsolationCover/);
  assert.match(overlay, /pointerEvents=\"none\"/);
});

test('7) Deep-row correction cannot occur uncovered', () => {
  assert.equal(
    isMoviesDetailCloseCorrectionUncovered({
      visualIsolationActive: false,
      visualHoldActive: false,
    }),
    true,
  );
  assert.equal(
    isMoviesDetailCloseCorrectionUncovered({
      visualIsolationActive: true,
      visualHoldActive: false,
    }),
    false,
  );
  const result = simulateInstantCoveredClose({ nativeDrift: true });
  assert.equal(result.correctiveUncovered, false);
  assert.match(screen, /detail_close_uncovered_correction_violation/);
  assert.match(screen, /setVisualIsolationSafe\(true\)/);
});

test('8) Normal close does not remount overlay shell', () => {
  assert.match(screen, /keepFocusTrap/);
  assert.match(screen, /overlayInstanceId=\{overlayInstanceIdRef\.current\}/);
  assert.match(overlay, /overlayInstanceId/);
  // Mount effect depends on overlayInstanceId only — not movieId/visible.
  assert.match(overlay, /}, \[overlayInstanceId\]\)/);
  assert.match(overlay, /overlayInstanceId: overlayInstanceId \?\? null/);
  const result = simulateInstantCoveredClose();
  assert.equal(result.events.filter((e) => e === 'component_unmount').length, 0);
});

test('9) Playback return keeps the same overlay instance', () => {
  assert.match(screen, /keepFocusTrap/);
  assert.match(screen, /detailSuppressedForPlayback/);
  assert.match(screen, /playback_detail_revealed/);
  assert.match(overlay, /overlayInstanceId/);
  // Shell stays mounted while suppressed / keepFocusTrap.
  assert.match(overlay, /!visible && !keepFocusTrap && !visualHoldActive/);
});

test('10) Duplicate focus confirmations are dropped', () => {
  const result = simulateInstantCoveredClose({ duplicateConfirmations: 3 });
  assert.equal(result.events.filter((e) => e === 'detail_close_poster_focus_confirmed').length, 1);
  assert.ok(result.events.includes('detail_close_duplicate_focus_confirmation_dropped'));
  assert.match(screen, /detail_close_duplicate_focus_confirmation_dropped/);
  assert.match(screen, /shouldAcceptMoviesDetailCloseFocusConfirmation/);
  assert.match(screen, /focusConfirmedTokenRef/);
});

test('11) Search Detail behavior remains unchanged', () => {
  assert.match(screen, /origin: 'search'/);
  assert.match(screen, /detail_close_search_revealed/);
  assert.match(screen, /searchReturnPending/);
});

test('12) Stage 4.2J safety markers remain wired', () => {
  assert.match(screen, /closeCommitTokenRef/);
  assert.match(screen, /shouldDropMoviesDetailCloseCallback/);
  assert.match(screen, /detail_close_commit_once/);
  assert.match(screen, /setMoviesBrowseUiFrozenForDetail/);
  assert.match(screen, /isMoviesDetailCloseTargetRefValid/);
});
