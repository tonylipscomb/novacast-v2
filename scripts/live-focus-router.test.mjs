import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  shouldApplyLiveSurfResolution,
  resolveLiveSurfAdjacent,
} from '../src/features/live/liveTvSurf.ts';
import {
  applyLiveSurfAnchorFocus,
  createLiveSurfFocusRouterState,
  evaluateLiveSurfSentinelFocus,
  liveSurfFocusDestinationsReady,
  liveSurfNativeHandlesSurvivedEpochChange,
  resetLiveSurfFocusAfterTransition,
  shouldRemountLiveSurfSentinelsOnEpochChange,
  shouldRequestLiveSurfAnchorFocus,
} from '../src/features/live/liveTvSurfFocus.ts';
import {
  chooseLiveChannel,
  createLiveTvLandingState,
  resolveLivePreview,
} from '../src/features/live/liveTvLogic.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => readFileSync(join(root, relativePath), 'utf8').replace(/\r\n/g, '\n');
const liveScreen = read('src/features/live/LiveTvScreen.tsx');
const liveRouter = read('src/features/live/LiveTvFocusRouter.tsx');
const sports = ['espn', 'espn2', 'fs1', 'nfl-network'];

function parkOnAnchor(state = createLiveSurfFocusRouterState()) {
  return applyLiveSurfAnchorFocus(state).next;
}

function acceptDirection(state, direction) {
  const decision = evaluateLiveSurfSentinelFocus({
    state,
    direction,
    incomingEpoch: state.focusEpoch,
  });
  assert.equal(decision.accept, true);
  return decision.next;
}

function completeAndRearm(state) {
  const reset = resetLiveSurfFocusAfterTransition(state);
  return applyLiveSurfAnchorFocus(reset).next;
}

function intendedSurfCount(directions) {
  let state = parkOnAnchor();
  let accepts = 0;
  for (const direction of directions) {
    const decision = evaluateLiveSurfSentinelFocus({
      state,
      direction,
      incomingEpoch: state.focusEpoch,
    });
    if (!decision.accept) {
      continue;
    }
    accepts += 1;
    state = completeAndRearm(decision.next);
  }
  return accepts;
}

test('1. initial anchor RIGHT works', () => {
  const armed = parkOnAnchor();
  const accepted = evaluateLiveSurfSentinelFocus({
    state: armed,
    direction: 1,
    incomingEpoch: armed.focusEpoch,
  });
  assert.equal(accepted.accept, true);
  if (accepted.accept) {
    assert.equal(accepted.next.focusOwner, 'right-sentinel');
    assert.equal(accepted.next.previousFocusOwner, 'anchor');
    assert.equal(accepted.next.routerArmed, false);
    assert.equal(accepted.next.transitionInFlight, true);
  }
});

test('2. first transition completes once', () => {
  const inFlight = acceptDirection(parkOnAnchor(), 1);
  const stray = evaluateLiveSurfSentinelFocus({
    state: inFlight,
    direction: 1,
    incomingEpoch: inFlight.focusEpoch,
  });
  assert.equal(stray.accept, false);
  const reset = resetLiveSurfFocusAfterTransition(inFlight);
  assert.equal(reset.transitionInFlight, false);
  assert.equal(reset.routerArmed, false);
});

test('3. sentinel native mount identity remains stable across transition', () => {
  assert.equal(shouldRemountLiveSurfSentinelsOnEpochChange(), false);
  assert.doesNotMatch(liveRouter, /key=\{`live-surf-left-\$\{sentinelEpoch\}`\}/);
  assert.doesNotMatch(liveRouter, /key=\{`live-surf-right-\$\{sentinelEpoch\}`\}/);
  assert.doesNotMatch(liveRouter, /setSentinelEpoch/);
  assert.equal(
    liveSurfNativeHandlesSurvivedEpochChange({
      before: { focusEpoch: 0, anchor: 11, left: 22, right: 33 },
      after: { focusEpoch: 1, anchor: 11, left: 22, right: 33 },
    }),
    true,
  );
});

test('4. anchor native mount identity remains stable across transition', () => {
  assert.doesNotMatch(liveRouter, /key=\{fromChannelId\}/);
  assert.match(liveRouter, /const assignAnchorRef = useCallback/);
  assert.equal(
    liveSurfNativeHandlesSurvivedEpochChange({
      before: { focusEpoch: 1, anchor: 11, left: 22, right: 33 },
      after: { focusEpoch: 2, anchor: 11, left: 22, right: 33 },
    }),
    true,
  );
});

test('5. logical epoch change does not remount sentinel Views', () => {
  const reset = resetLiveSurfFocusAfterTransition(acceptDirection(parkOnAnchor(), 1));
  assert.equal(reset.focusEpoch, 1);
  assert.equal(shouldRemountLiveSurfSentinelsOnEpochChange(), false);
  assert.doesNotMatch(liveRouter, /key=\{`live-surf-/);
});

test('6. after first transition anchor re-arms', () => {
  const rearmed = completeAndRearm(acceptDirection(parkOnAnchor(), 1));
  assert.equal(rearmed.routerArmed, true);
  assert.equal(rearmed.focusOwner, 'anchor');
  assert.equal(rearmed.transitionInFlight, false);
});

test('7. SECOND RIGHT after re-arm reaches right sentinel', () => {
  const rearmed = completeAndRearm(acceptDirection(parkOnAnchor(), 1));
  const second = evaluateLiveSurfSentinelFocus({
    state: rearmed,
    direction: 1,
    incomingEpoch: rearmed.focusEpoch,
  });
  assert.equal(second.accept, true);
  if (second.accept) {
    assert.equal(second.next.focusOwner, 'right-sentinel');
  }
});

test('8. second RIGHT produces exactly one additional surf', () => {
  const rearmed = completeAndRearm(acceptDirection(parkOnAnchor(), 1));
  const second = acceptDirection(rearmed, 1);
  const third = evaluateLiveSurfSentinelFocus({
    state: second,
    direction: 1,
    incomingEpoch: second.focusEpoch,
  });
  assert.equal(third.accept, false);
});

test('9. LEFT after second transition reaches left sentinel', () => {
  const afterTwoRights = completeAndRearm(
    acceptDirection(completeAndRearm(acceptDirection(parkOnAnchor(), 1)), 1),
  );
  const left = evaluateLiveSurfSentinelFocus({
    state: afterTwoRights,
    direction: -1,
    incomingEpoch: afterTwoRights.focusEpoch,
  });
  assert.equal(left.accept, true);
  if (left.accept) {
    assert.equal(left.next.focusOwner, 'left-sentinel');
  }
});

test('10. repeated sequence RIGHT RIGHT LEFT RIGHT produces exactly four intended channel changes', () => {
  assert.equal(intendedSurfCount([1, 1, -1, 1]), 4);
});

test('11. no autonomous surf between presses', () => {
  const inFlight = acceptDirection(parkOnAnchor(), 1);
  assert.equal(
    evaluateLiveSurfSentinelFocus({
      state: inFlight,
      direction: 1,
      incomingEpoch: inFlight.focusEpoch,
    }).accept,
    false,
  );
  const reset = resetLiveSurfFocusAfterTransition(inFlight);
  assert.equal(
    evaluateLiveSurfSentinelFocus({
      state: reset,
      direction: 1,
      incomingEpoch: reset.focusEpoch,
    }).accept,
    false,
  );
});

test('12. anchor focus restore is idempotent when already focused', () => {
  const armed = parkOnAnchor();
  assert.equal(shouldRequestLiveSurfAnchorFocus(armed), false);
  assert.equal(
    shouldRequestLiveSurfAnchorFocus({
      ...armed,
      transitionInFlight: true,
      routerArmed: false,
    }),
    true,
  );
  assert.match(liveRouter, /shouldRequestLiveSurfAnchorFocus\(machineRef\.current\)/);
});

test('13. repeated player ready does not call redundant anchor restore', () => {
  const firstFrame = liveScreen.slice(
    liveScreen.indexOf('const handleFullscreenFirstFrame'),
    liveScreen.indexOf('const handleFullscreenFirstFrame') + 280,
  );
  assert.doesNotMatch(firstFrame, /notifyTransitionSettled/);
  assert.doesNotMatch(firstFrame, /restoreAnchorFocus/);
  assert.match(liveScreen, /lastSettledSurfRequestIdRef/);
});

test('14. source replacement does not remount focus router', () => {
  assert.match(liveScreen, /\{fullscreenChannel \? \(/);
  assert.doesNotMatch(liveScreen, /fullscreenChannel && hasLiveStream \?/);
  assert.match(liveScreen, /\{hasLiveStream \? \(/);
});

test('15. channel id update does not remount focus router', () => {
  assert.doesNotMatch(liveScreen, /key=\{fullscreenChannel\.id\}/);
  assert.doesNotMatch(liveRouter, /key=\{fromChannelId\}/);
});

test('16. chrome visibility does not remount focus router', () => {
  assert.match(liveRouter, /chromeVisible=\{showFullscreenChrome \|\| fullscreenFallbackVisible\}|hasTVPreferredFocus=\{!chromeVisible && anchorPreferred\}/);
  assert.doesNotMatch(liveRouter, /key=\{chromeVisible\}/);
  assert.doesNotMatch(liveRouter, /key=\{String\(chromeVisible\)\}/);
});

test('17. failed channel preserves stable anchor/sentinel handles', () => {
  assert.match(liveScreen, /transition-failed/);
  assert.match(liveScreen, /notifyTransitionSettled/);
  assert.equal(shouldRemountLiveSurfSentinelsOnEpochChange(), false);
  const rearmed = completeAndRearm(acceptDirection(parkOnAnchor(), 1));
  assert.equal(acceptDirection(rearmed, 1).transitionInFlight, true);
});

test('18. wrap still works', () => {
  const result = resolveLiveSurfAdjacent({ channelIds: sports, currentId: 'nfl-network', direction: 1 });
  assert.equal(result.kind, 'adjacent');
  if (result.kind === 'adjacent') {
    assert.equal(result.toChannelId, 'espn');
  }
});

test('19. one-channel no-op still works', () => {
  const result = resolveLiveSurfAdjacent({ channelIds: ['espn'], currentId: 'espn', direction: 1 });
  assert.equal(result.kind, 'noop');
});

test('20. first-OK preview unchanged', () => {
  const landing = createLiveTvLandingState('sports', 'espn');
  const firstOk = chooseLiveChannel(landing, 'espn');
  assert.equal(firstOk.previewChannelId, 'espn');
  assert.equal(firstOk.fullscreenChannelId, null);
});

test('21. second-OK fullscreen unchanged', () => {
  const landing = createLiveTvLandingState('sports', 'espn');
  const firstOk = chooseLiveChannel(landing, 'espn');
  const ready = resolveLivePreview(firstOk, firstOk.previewRequestId, 'espn', 'ready');
  const secondOk = chooseLiveChannel(ready, 'espn');
  assert.equal(secondOk.fullscreenChannelId, 'espn');
});

test('one-shot guard: sentinel not-from-anchor is rejected', () => {
  const fromOther = evaluateLiveSurfSentinelFocus({
    state: { ...createLiveSurfFocusRouterState(), routerArmed: true, focusOwner: 'other' },
    direction: 1,
    incomingEpoch: 0,
  });
  assert.equal(fromOther.accept, false);
  if (!fromOther.accept) {
    assert.equal(fromOther.reason, 'not-from-anchor');
  }
});

test('handle diagnostics and destination readiness exist', () => {
  assert.equal(liveSurfFocusDestinationsReady({ anchor: 1, left: 2, right: 3 }), true);
  assert.equal(liveSurfFocusDestinationsReady({ anchor: 1, left: null, right: 3 }), false);
  assert.match(liveRouter, /\[NovaCast Live Surf Handles\]|logLiveSurfHandles/);
  assert.match(liveRouter, /focus-destinations-applied/);
  assert.match(liveRouter, /appliedNextFocusLeft/);
});

test('sentinel bounce restores to the Live anchor, never Close/Retry', () => {
  assert.match(liveRouter, /const bounce = handles\.anchor/);
  assert.doesNotMatch(liveRouter, /returnHandle/);
  assert.match(liveScreen, /nextFocusLeft: liveSurfHandles\.anchor/);
});

test('latest-intent-wins remains intact', () => {
  assert.equal(
    shouldApplyLiveSurfResolution({
      requestId: 2,
      latestRequestId: 3,
      toChannelId: 'espn2',
      latestChannelId: 'fs1',
    }),
    false,
  );
  assert.match(liveScreen, /surfTokenRef/);
  assert.match(liveScreen, /shouldApplyLiveSurfResolution/);
});
