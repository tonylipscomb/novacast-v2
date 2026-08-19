import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  shouldArmSeriesUpNext,
  shouldResetSeriesUpNextAfterCommittedSeek,
} from '../src/features/playback/continuity/seriesUpNext.ts';
import {
  applyVodSeekPreviewStep,
  beginVodSeekCommit,
  canCommitVodSeek,
  canEnterVodSeek,
  clampVodSeekPreview,
  completeVodSeekCommit,
  createVodSeekCommitGate,
  createVodSeekSessionId,
  decideVodSeekBackAction,
  consumeVodDirectionalSeek,
  formatVodSeekClock,
  formatVodSeekDelta,
  isVodSeekMediaType,
  nativeTimelineFocusImpliesSeekDirection,
  resetVodDirectionalSeekDedupeForTests,
  resolveHiddenVodSeekRemoteAction,
  resolveVodDirectionalSeekEntry,
  resolveVodSeekDirection,
  resolveVodSeekHiddenDirection,
  resolveVodSeekRepeatCount,
  resolveVodSeekStepMs,
  shouldActivateHiddenChromeKeyCapture,
  shouldBeginHiddenVodSeek,
  shouldDedupeVodSeekRemotePress,
  shouldSkipDuplicateVodDirectionalSeek,
  shouldTrapVodSeekHorizontalFocus,
  VOD_SEEK_ACCELERATION_STEPS_MS,
  VOD_SEEK_END_GUARD_MS,
  VOD_SEEK_IDLE_COMMIT_MS,
  VOD_SEEK_STEP_MS,
} from '../src/features/playback/unified/vodSeek.ts';
import { shouldHandleUnifiedSeekRemoteEvent } from '../src/features/playback/unified/unifiedPlayerLogic.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const controls = readFileSync(join(root, 'src/features/playback/unified/UnifiedPlayerControls.tsx'), 'utf8');
const controller = readFileSync(join(root, 'src/features/playback/unified/UnifiedPlayerController.tsx'), 'utf8');
const overlay = readFileSync(join(root, 'src/features/playback/unified/UnifiedPlayerOverlay.tsx'), 'utf8');
const remoteHandlers = readFileSync(
  join(root, 'src/features/playback/unified/useUnifiedPlayerRemoteHandlers.tsx'),
  'utf8',
);
const hiddenCapture = readFileSync(
  join(root, 'src/features/playback/unified/UnifiedPlayerHiddenChromeCapture.tsx'),
  'utf8',
);

function previewFrom(actualPositionMs, direction, repeatCount = 0, durationMs = 120_000, previewPositionMs = null) {
  return applyVodSeekPreviewStep({
    actualPositionMs,
    previewPositionMs,
    durationMs,
    direction,
    repeatCount,
  });
}

test('1. Movie RIGHT starts preview +10 sec', () => {
  const result = previewFrom(40_000, 1);
  assert.equal(isVodSeekMediaType('movie'), true);
  assert.equal(result.ignored, false);
  assert.equal(result.stepMs, 10_000);
  assert.equal(result.previewPositionMs, 50_000);
  assert.equal(VOD_SEEK_STEP_MS, 10_000);
});

test('2. Movie LEFT starts preview -10 sec', () => {
  const result = previewFrom(40_000, -1);
  assert.equal(result.ignored, false);
  assert.equal(result.stepMs, -10_000);
  assert.equal(result.previewPositionMs, 30_000);
});

test('3. Episode uses same seek path', () => {
  assert.equal(isVodSeekMediaType('episode'), true);
  assert.equal(isVodSeekMediaType('movie'), true);
  assert.match(overlay, /allowSeek=\{state\.item\?\.mediaType !== 'live'\}/);
  assert.match(controls, /isVodSeekMediaType\(mediaType\)/);
  const movie = previewFrom(20_000, 1);
  const episode = previewFrom(20_000, 1);
  assert.equal(movie.previewPositionMs, episode.previewPositionMs);
});

test('4. preview does not call native seek', () => {
  const applyStart = controls.indexOf('const applySeekDelta');
  const applyEnd = controls.indexOf('const focusControl', applyStart);
  const applyBlock = controls.slice(applyStart, applyEnd);
  assert.match(applyBlock, /applyVodSeekPreviewStep/);
  assert.doesNotMatch(applyBlock, /onSeek\(/);
  assert.doesNotMatch(applyBlock, /applyNativeSeek/);
  assert.doesNotMatch(applyBlock, /player\.currentTime/);
});

test('5. multiple preview steps still produce zero native seeks', () => {
  let preview = null;
  for (let repeatCount = 0; repeatCount < 5; repeatCount += 1) {
    const result = previewFrom(40_000, 1, repeatCount, 600_000, preview);
    preview = result.previewPositionMs;
    assert.equal(result.ignored, false);
  }
  assert.equal(preview, 40_000 + 10_000 + 10_000 + 10_000 + 30_000 + 30_000);
  const applyStart = controls.indexOf('const applySeekDelta');
  const applyEnd = controls.indexOf('const focusControl', applyStart);
  assert.doesNotMatch(controls.slice(applyStart, applyEnd), /onSeekRef\.current/);
});

test('6. OK commits exactly one native seek', () => {
  const commitStart = controls.indexOf('const commitSeekPreview');
  const commitEnd = controls.indexOf('const scheduleIdleCommit', commitStart);
  const commitBlock = controls.slice(commitStart, commitEnd);
  assert.equal((commitBlock.match(/onSeekRef\.current\(nextPositionMs\)/g) ?? []).length, 1);
  assert.match(controls, /commitSeekPreview\('ok'\)/);
  assert.match(controller, /applyNativeSeek\(pendingMs, 'scrubber'\)/);
});

test('7. idle timeout commits exactly one native seek', () => {
  assert.equal(VOD_SEEK_IDLE_COMMIT_MS, 700);
  assert.match(controls, /commitSeekPreview\('idle'\)/);
  assert.match(controls, /VOD_SEEK_IDLE_COMMIT_MS/);
  const gate = createVodSeekCommitGate('idle-1');
  assert.equal(beginVodSeekCommit(gate, 'idle-1'), true);
  assert.equal(beginVodSeekCommit(gate, 'idle-1'), false);
});

test('8. OK + timeout race still commits once', () => {
  const gate = createVodSeekCommitGate('race-1');
  assert.equal(canCommitVodSeek(gate, 'race-1'), true);
  assert.equal(beginVodSeekCommit(gate, 'race-1'), true);
  assert.equal(beginVodSeekCommit(gate, 'race-1'), false);
  assert.equal(beginVodSeekCommit(gate, 'race-1'), false);
  completeVodSeekCommit(gate);
  assert.equal(beginVodSeekCommit(gate, 'race-1'), false);
  assert.match(controls, /beginVodSeekCommit\(gate, sessionId\)/);
  assert.match(controls, /seekSessionIdRef\.current !== sessionId/);
});

test('9. Back cancels preview and does not close player', () => {
  assert.equal(decideVodSeekBackAction(true), 'cancel-preview');
  assert.equal(decideVodSeekBackAction(false), 'player-back');
  const backStart = controller.indexOf('const handleBack');
  const backEnd = controller.indexOf('const handleRetry', backStart);
  const backBlock = controller.slice(backStart, backEnd);
  assert.match(backBlock, /cancelSeekPreviewRef\.current\(\)/);
  assert.ok(backBlock.indexOf('cancelSeekPreviewRef') < backBlock.indexOf('closeUnifiedPlayback'));
  assert.match(backBlock, /revealControls\('handle-back'\);\s*return;/);
});

test('10. cancelled preview does not seek', () => {
  const cancelStart = controls.indexOf('const cancelSeekPreview');
  const cancelEnd = controls.indexOf('const applySeekDelta', cancelStart);
  const cancelBlock = controls.slice(cancelStart, cancelEnd);
  assert.match(cancelBlock, /seek-cancelled/);
  assert.doesNotMatch(cancelBlock, /onSeek/);
  assert.doesNotMatch(cancelBlock, /onSeekRef/);
});

test('11. preview clamps at 0', () => {
  const result = previewFrom(4_000, -1);
  assert.equal(result.previewPositionMs, 0);
  assert.equal(result.clamped, true);
  assert.equal(result.clampReason, 'zero');
  assert.equal(clampVodSeekPreview(-20_000, 120_000).positionMs, 0);
});

test('12. preview clamps at duration/end guard', () => {
  assert.equal(VOD_SEEK_END_GUARD_MS, 1_000);
  const result = previewFrom(118_000, 1, 12, 120_000);
  assert.equal(result.previewPositionMs, 119_000);
  assert.equal(result.clamped, true);
  assert.equal(result.clampReason, 'end-guard');
  assert.equal(clampVodSeekPreview(130_000, 120_000).positionMs, 119_000);
});

test('13. unknown duration cannot scrub', () => {
  assert.equal(canEnterVodSeek(0), false);
  assert.equal(canEnterVodSeek(Number.NaN), false);
  assert.equal(previewFrom(10_000, 1, 0, 0).ignored, true);
  assert.equal(clampVodSeekPreview(10_000, 0).positionMs, null);
  assert.match(controls, /reason: 'unknown-duration'/);
});

test('14. acceleration 10s → 30s → 60s → 120s', () => {
  assert.deepEqual([...VOD_SEEK_ACCELERATION_STEPS_MS], [10_000, 30_000, 60_000, 120_000]);
  assert.equal(resolveVodSeekStepMs(0), 10_000);
  assert.equal(resolveVodSeekStepMs(2), 10_000);
  assert.equal(resolveVodSeekStepMs(3), 30_000);
  assert.equal(resolveVodSeekStepMs(6), 30_000);
  assert.equal(resolveVodSeekStepMs(7), 60_000);
  assert.equal(resolveVodSeekStepMs(11), 60_000);
  assert.equal(resolveVodSeekStepMs(12), 120_000);
  assert.equal(resolveVodSeekStepMs(20), 120_000);
});

test('15. direction change resets acceleration', () => {
  assert.equal(
    resolveVodSeekRepeatCount({ previousDirection: 1, nextDirection: -1, previousRepeatCount: 12 }),
    0,
  );
  assert.equal(resolveVodSeekStepMs(0), 10_000);
  assert.equal(
    resolveVodSeekRepeatCount({ previousDirection: 1, nextDirection: 1, previousRepeatCount: 4 }),
    5,
  );
});

test('16. commit resets acceleration', () => {
  assert.match(controls, /resetSeekAcceleration/);
  assert.match(controls, /clearSeekPreviewState/);
  const clearStart = controls.indexOf('const clearSeekPreviewState');
  const clearEnd = controls.indexOf('const handleControlFocus', clearStart);
  assert.match(controls.slice(clearStart, clearEnd), /resetSeekAcceleration\(\)/);
});

test('17. seek preserves playing state', () => {
  const applyNative = controller.slice(
    controller.indexOf('const applyNativeSeek ='),
    controller.indexOf('const persistProgress ='),
  );
  assert.doesNotMatch(applyNative, /setUnifiedPlayerPlaying/);
  const handleSeek = controller.slice(controller.indexOf('const handleSeek ='), controller.indexOf('const handleBack ='));
  assert.doesNotMatch(handleSeek, /setUnifiedPlayerPlaying/);
  assert.match(controls, /seekWasPlayingRef/);
});

test('18. seek preserves paused state', () => {
  assert.doesNotMatch(controls.slice(controls.indexOf('const applySeekDelta'), controls.indexOf('const focusControl')), /onTogglePlay/);
  assert.doesNotMatch(controller.slice(controller.indexOf('const handleSeek ='), controller.indexOf('const handleBack =')), /onTogglePlay/);
});

test('19. committed movie seek saves progress', () => {
  const flushStart = controller.indexOf('const flushSeek');
  const flushEnd = controller.indexOf('const handleSeek', flushStart);
  const flushBlock = controller.slice(flushStart, flushEnd);
  assert.match(flushBlock, /persistProgress\(pendingMs/);
  assert.match(flushBlock, /seek-progress-saved/);
  assert.match(controller, /item\.mediaType === 'live'/);
});

test('20. committed episode seek saves progress', () => {
  assert.match(controller, /savePlaybackProgress/);
  assert.match(controller, /buildProgressKey\(item\.providerId, item\.mediaType, item\.id\)/);
  const persistStart = controller.indexOf('const persistProgress');
  const persistEnd = controller.indexOf('void savePlaybackProgress', persistStart);
  const persistBlock = controller.slice(persistStart, persistEnd);
  assert.match(persistBlock, /item\.mediaType === 'live'/);
  assert.doesNotMatch(persistBlock, /item\.mediaType === 'episode'/);
});

test('21. preview does not save progress', () => {
  const applyStart = controls.indexOf('const applySeekDelta');
  const applyEnd = controls.indexOf('const focusControl', applyStart);
  const applyBlock = controls.slice(applyStart, applyEnd);
  assert.doesNotMatch(applyBlock, /persistProgress/);
  assert.doesNotMatch(applyBlock, /savePlaybackProgress/);
});

test('22. preview near end does not trigger Up Next', () => {
  assert.equal(
    shouldArmSeriesUpNext({
      mediaType: 'episode',
      remainingMs: 4_000,
      durationMs: 600_000,
      nextEpisodePresent: true,
      alreadyArmed: false,
      dismissedForSession: false,
      seekPreviewActive: true,
    }),
    false,
  );
  assert.match(controller, /seekPreviewActive: seekPreviewActiveRef\.current/);
});

test('23. committed seek near end may trigger Up Next', () => {
  assert.equal(
    shouldArmSeriesUpNext({
      mediaType: 'episode',
      remainingMs: 8_000,
      durationMs: 600_000,
      nextEpisodePresent: true,
      alreadyArmed: false,
      dismissedForSession: false,
      seekPreviewActive: false,
    }),
    true,
  );
  assert.equal(
    shouldResetSeriesUpNextAfterCommittedSeek({
      mediaType: 'episode',
      remainingMs: 8_000,
      upNextVisible: true,
      alreadyArmed: true,
    }),
    false,
  );
});

test('24. committed rewind outside Up Next threshold dismisses stale countdown', () => {
  assert.equal(
    shouldResetSeriesUpNextAfterCommittedSeek({
      mediaType: 'episode',
      remainingMs: 120_000,
      upNextVisible: true,
      alreadyArmed: true,
    }),
    true,
  );
  assert.match(controller, /shouldResetSeriesUpNextAfterCommittedSeek/);
  assert.match(controller, /upNextArmedForEpisodeIdRef\.current = null/);
});

test('25. seek does not launch a new player session', () => {
  const handleSeek = controller.slice(controller.indexOf('const handleSeek ='), controller.indexOf('const handleBack ='));
  assert.doesNotMatch(handleSeek, /launchUnifiedPlayback/);
  const applyNative = controller.slice(
    controller.indexOf('const applyNativeSeek ='),
    controller.indexOf('const persistProgress ='),
  );
  assert.doesNotMatch(applyNative, /launchUnifiedPlayback/);
  assert.match(applyNative, /player\.currentTime = nativeSeconds/);
});

test('26. seek does not show Resume/Restart', () => {
  const handleSeek = controller.slice(controller.indexOf('const handleSeek ='), controller.indexOf('const handleBack ='));
  assert.doesNotMatch(handleSeek, /requestPlaybackResumeChoice/);
  assert.doesNotMatch(handleSeek, /resolvePlaybackResumePrompt/);
  assert.doesNotMatch(handleSeek, /PlaybackResumeDialog/);
});

test('27. Live TV does not use VOD seek handler', () => {
  assert.equal(isVodSeekMediaType('live'), false);
  assert.equal(
    shouldBeginHiddenVodSeek({
      controlsVisible: false,
      mediaType: 'live',
      eventType: 'right',
    }),
    false,
  );
  assert.equal(
    shouldBeginHiddenVodSeek({
      controlsVisible: false,
      mediaType: 'movie',
      eventType: 'right',
    }),
    false,
  );
  assert.equal(resolveVodSeekHiddenDirection('left'), -1);
  assert.equal(
    shouldHandleUnifiedSeekRemoteEvent({
      visible: true,
      focusedControl: 'seek',
      durationMs: 120_000,
      eventType: 'right',
      eventKeyAction: 0,
    }),
    true,
  );
  assert.match(overlay, /allowSeek=\{state\.item\?\.mediaType !== 'live'\}/);
  assert.match(remoteHandlers, /resolveHiddenVodSeekRemoteAction/);
  assert.match(controls, /focusable=\{visible && allowSeek\}/);
});

test('28. existing Series Up Next tests remain green', () => {
  assert.match(controller, /shouldArmSeriesUpNext/);
  assert.match(controller, /upNextCommittedTransitionIdRef/);
  assert.equal(
    shouldArmSeriesUpNext({
      mediaType: 'episode',
      remainingMs: 10_000,
      durationMs: 600_000,
      nextEpisodePresent: true,
      alreadyArmed: false,
      dismissedForSession: false,
    }),
    true,
  );
});

test('29. existing Movie continuity tests remain green', () => {
  assert.match(controller, /persistProgress/);
  assert.match(controller, /mediaType === 'live'/);
});

test('30. existing Resume/Restart tests remain green', () => {
  assert.doesNotMatch(
    controller.slice(controller.indexOf('const handleSeek ='), controller.indexOf('const handleBack =')),
    /requestPlaybackResumeChoice/,
  );
  assert.equal(createVodSeekSessionId().startsWith('vod-seek-'), true);
  assert.equal(formatVodSeekClock(2_538_000, 3_600_000), '00:42:18');
  assert.equal(formatVodSeekDelta(120_000), '+2:00');
  assert.equal(formatVodSeekDelta(-30_000), '-0:30');
});

test('hidden Movie RIGHT wakes chrome without seeking', () => {
  assert.equal(
    resolveHiddenVodSeekRemoteAction({
      controlsVisible: false,
      mediaType: 'movie',
      durationMs: 600_000,
      eventType: 'right',
      eventKeyAction: 0,
      timelineFocused: false,
      seekPreviewActive: false,
    }),
    'generic-reveal',
  );
  const first = applyVodSeekPreviewStep({
    actualPositionMs: 40_000,
    previewPositionMs: null,
    durationMs: 600_000,
    direction: 1,
    repeatCount: 0,
  });
  assert.equal(first.previewPositionMs, 50_000);
  assert.match(controller, /beginVodDirectionalPreviewRef\.current\(direction\)/);
  assert.match(controller, /requestTimelineFocusRef\.current\(\)/);
});

test('hidden Movie LEFT wakes chrome without seeking', () => {
  assert.equal(
    resolveHiddenVodSeekRemoteAction({
      controlsVisible: false,
      mediaType: 'movie',
      durationMs: 600_000,
      eventType: 'left',
      timelineFocused: false,
    }),
    'generic-reveal',
  );
  assert.equal(previewFrom(40_000, -1, 0, 600_000).previewPositionMs, 30_000);
});

test('first hidden RIGHT does not require timelineFocused', () => {
  assert.equal(
    resolveHiddenVodSeekRemoteAction({
      controlsVisible: false,
      mediaType: 'episode',
      durationMs: 1_200_000,
      eventType: 'DPAD_RIGHT',
      timelineFocused: false,
    }),
    'generic-reveal',
  );
  assert.equal(
    resolveHiddenVodSeekRemoteAction({
      controlsVisible: false,
      mediaType: 'movie',
      durationMs: 600_000,
      keyCode: 22,
      timelineFocused: false,
    }),
    'generic-reveal',
  );
  const focusStart = controls.indexOf('const handleControlFocus');
  const focusEnd = controls.indexOf('const handleControlBlur', focusStart);
  assert.doesNotMatch(controls.slice(focusStart, focusEnd), /setSeekTargetMs\(positionMs\)/);
  assert.doesNotMatch(controls.slice(focusStart, focusEnd), /seekTargetMsRef\.current = positionMs/);
});

test('hidden VOD DPAD wakes chrome instead of starting seek', () => {
  const hidden = resolveHiddenVodSeekRemoteAction({
    controlsVisible: false,
    mediaType: 'movie',
    durationMs: 600_000,
    eventType: 'right',
  });
  const generic = resolveHiddenVodSeekRemoteAction({
    controlsVisible: false,
    mediaType: 'movie',
    durationMs: 600_000,
    eventType: 'up',
  });
  assert.equal(hidden, 'generic-reveal');
  assert.equal(generic, 'generic-reveal');
  assert.match(remoteHandlers, /shouldConsumePlayerChromeWake/);
  assert.doesNotMatch(remoteHandlers, /onTogglePlayRef\.current\(\)/);
});

test('focus confirmation after preview start does not reset preview position', () => {
  const first = applyVodSeekPreviewStep({
    actualPositionMs: 40_000,
    previewPositionMs: null,
    durationMs: 600_000,
    direction: 1,
    repeatCount: 0,
  });
  assert.equal(first.previewPositionMs, 50_000);
  const focusBlock = controls.slice(
    controls.indexOf('const handleControlFocus'),
    controls.indexOf('const handleControlBlur'),
  );
  assert.doesNotMatch(focusBlock, /setSeekTargetMs\(/);
  assert.match(focusBlock, /timeline-focus-confirmed/);
});

test('second RIGHT accumulates from preview, not actual', () => {
  const first = applyVodSeekPreviewStep({
    actualPositionMs: 40_000,
    previewPositionMs: null,
    durationMs: 600_000,
    direction: 1,
    repeatCount: 0,
  });
  const second = applyVodSeekPreviewStep({
    actualPositionMs: 40_000,
    previewPositionMs: first.previewPositionMs,
    durationMs: 600_000,
    direction: 1,
    repeatCount: 1,
  });
  assert.equal(second.previewPositionMs, 60_000);
  assert.match(controls, /if \(seekSessionIdRef\.current == null\)/);
});

test('controls auto-hide does not fire while seek preview active', () => {
  const schedule = controller.slice(
    controller.indexOf('const scheduleChromeHide'),
    controller.indexOf('const revealControls'),
  );
  assert.match(schedule, /if \(seekPreviewActiveRef\.current\)/);
  assert.match(controller, /if \(seekPreviewActive\) \{/);
  assert.match(controller, /clearChromeTimer\(\)/);
});

test('physical remote normalization does not double-process one press', () => {
  assert.equal(
    shouldDedupeVodSeekRemotePress({
      previousAtMs: 1000,
      nowMs: 1020,
      eventKeyAction: 0,
    }),
    true,
  );
  assert.equal(
    shouldDedupeVodSeekRemotePress({
      previousAtMs: 1000,
      nowMs: 1020,
      eventKeyAction: 1,
    }),
    true,
  );
  assert.equal(
    resolveHiddenVodSeekRemoteAction({
      controlsVisible: false,
      mediaType: 'movie',
      durationMs: 600_000,
      eventType: 'right',
      eventKeyAction: 1,
    }),
    'ignore',
  );
  assert.match(controller, /consumeVodDirectionalSeek/);
});

test('held or repeated RIGHT still accelerates', () => {
  assert.equal(
    shouldDedupeVodSeekRemotePress({
      previousAtMs: 1000,
      nowMs: 1040,
      eventKeyAction: 2,
    }),
    false,
  );
  assert.equal(resolveVodSeekStepMs(0), 10_000);
  assert.equal(resolveVodSeekStepMs(3), 30_000);
  assert.equal(resolveVodSeekDirection({ eventType: 'fastForward' }), 1);
  assert.equal(resolveVodSeekDirection({ eventType: 'rewind' }), -1);
});

test('Live LEFT/RIGHT still never enter VOD seek', () => {
  assert.equal(
    resolveHiddenVodSeekRemoteAction({
      controlsVisible: false,
      mediaType: 'live',
      durationMs: 0,
      eventType: 'right',
    }),
    'generic-reveal',
  );
  assert.equal(
    resolveHiddenVodSeekRemoteAction({
      controlsVisible: false,
      mediaType: 'live',
      durationMs: 600_000,
      eventType: 'left',
      seekPreviewActive: true,
    }),
    'generic-reveal',
  );
  assert.equal(shouldBeginHiddenVodSeek({
    controlsVisible: false,
    mediaType: 'live',
    eventType: 'right',
    durationMs: 600_000,
  }), false);
});

test('1. physical-equivalent hidden RIGHT source wakes chrome only', () => {
  assert.equal(
    resolveVodDirectionalSeekEntry({
      direction: 1,
      controlsVisible: false,
      mediaType: 'movie',
      durationMs: 600_000,
      seekPreviewActive: false,
    }),
    'reveal-only',
  );
  assert.equal(
    resolveVodDirectionalSeekEntry({
      direction: 1,
      controlsVisible: true,
      mediaType: 'movie',
      durationMs: 600_000,
      seekPreviewActive: false,
    }),
    'begin-preview',
  );
  assert.equal(previewFrom(40_000, 1, 0, 600_000).previewPositionMs, 50_000);
  assert.match(controller, /handleVodDirectionalSeek/);
  assert.match(hiddenCapture, /UnifiedPlayerVodFocusRouter/);
  assert.match(controls, /UnifiedPlayerVodFocusRouter/);
  assert.match(overlay, /onVodDirectionalSeek/);
});

test('2. hidden LEFT wakes chrome only', () => {
  assert.equal(
    resolveVodDirectionalSeekEntry({
      direction: -1,
      controlsVisible: false,
      mediaType: 'episode',
      durationMs: 600_000,
      seekPreviewActive: false,
    }),
    'reveal-only',
  );
  assert.equal(previewFrom(40_000, -1, 0, 600_000).previewPositionMs, 30_000);
});

test('3. first hidden directional input reveals chrome only', () => {
  const hiddenRight = resolveVodDirectionalSeekEntry({
    direction: 1,
    controlsVisible: false,
    mediaType: 'movie',
    durationMs: 600_000,
  });
  assert.equal(hiddenRight, 'reveal-only');
  const handleStart = controller.indexOf('const handleVodDirectionalSeek');
  const handleEnd = controller.indexOf('const handleSeekPreviewActiveChange', handleStart);
  const handleBlock = controller.slice(handleStart, handleEnd);
  assert.match(handleBlock, /entry === 'reveal-only'/);
  assert.match(handleBlock, /beginVodDirectionalPreviewRef\.current\(direction\)/);
});

test('4. chrome-reveal source forwards direction into centralized seek', () => {
  assert.equal(shouldActivateHiddenChromeKeyCapture({
    controlsVisible: false,
    mediaType: 'movie',
    upNextActive: false,
    platformOs: 'android',
  }), true);
  assert.match(hiddenCapture, /onSentinelFocusRef\.current\(direction\)/);
  assert.match(controls, /onVodDirectionalSeek\(direction, 'hidden-focus-sentinel'\)/);
  assert.match(controller, /onVodDirectionalSeek=\{handleVodDirectionalSeek\}/);
  const focusBlock = controls.slice(
    controls.indexOf('const handleControlFocus'),
    controls.indexOf('const handleControlBlur'),
  );
  assert.doesNotMatch(focusBlock, /applySeekDelta/);
  assert.doesNotMatch(focusBlock, /beginVodDirectionalPreview/);
  assert.equal(nativeTimelineFocusImpliesSeekDirection(), false);
});

test('5. timeline focus confirmation preserves active preview', () => {
  const first = applyVodSeekPreviewStep({
    actualPositionMs: 40_000,
    previewPositionMs: null,
    durationMs: 600_000,
    direction: 1,
    repeatCount: 0,
  });
  assert.equal(first.previewPositionMs, 50_000);
  const focusBlock = controls.slice(
    controls.indexOf('const handleControlFocus'),
    controls.indexOf('const handleControlBlur'),
  );
  assert.doesNotMatch(focusBlock, /setSeekTargetMs\(/);
  assert.doesNotMatch(focusBlock, /seekTargetMsRef\.current = positionMs/);
  assert.match(focusBlock, /timeline-focus-confirmed/);
  assert.match(focusBlock, /seekPreviewActive: seekSessionIdRef\.current != null/);
});

test('6. visible timeline RIGHT continues preview', () => {
  const first = applyVodSeekPreviewStep({
    actualPositionMs: 40_000,
    previewPositionMs: null,
    durationMs: 600_000,
    direction: 1,
    repeatCount: 0,
  });
  const second = applyVodSeekPreviewStep({
    actualPositionMs: 40_000,
    previewPositionMs: first.previewPositionMs,
    durationMs: 600_000,
    direction: 1,
    repeatCount: 1,
  });
  assert.equal(second.previewPositionMs, 60_000);
  assert.equal(
    resolveVodDirectionalSeekEntry({
      direction: 1,
      controlsVisible: true,
      mediaType: 'movie',
      durationMs: 600_000,
      seekPreviewActive: true,
    }),
    'preview-step',
  );
  assert.match(controls, /applySeekDelta\(direction \* VOD_SEEK_STEP_MS\)/);
});

test('7. visible timeline LEFT continues preview', () => {
  const first = applyVodSeekPreviewStep({
    actualPositionMs: 40_000,
    previewPositionMs: 50_000,
    durationMs: 600_000,
    direction: -1,
    repeatCount: 0,
  });
  assert.equal(first.previewPositionMs, 40_000);
  assert.equal(
    resolveVodDirectionalSeekEntry({
      direction: -1,
      controlsVisible: true,
      mediaType: 'episode',
      durationMs: 600_000,
      seekPreviewActive: true,
    }),
    'preview-step',
  );
});

test('8. native focus does not escape horizontally while scrub active', () => {
  assert.equal(
    shouldTrapVodSeekHorizontalFocus({
      controlsVisible: true,
      timelineFocused: true,
      allowSeek: true,
    }),
    false,
  );
  assert.match(controls, /nextFocusLeft: leftSentinel/);
  assert.match(controls, /nextFocusRight: rightSentinel/);
  assert.match(controls, /buildAndroidControlFocusProps\('seek', episodeFocusHandles, sentinelHandles\)/);
  assert.match(controls, /if \(controlId === 'seek' && direction != null\)/);
});

test('9. one physical press is not double processed', () => {
  resetVodDirectionalSeekDedupeForTests();
  assert.equal(
    consumeVodDirectionalSeek({
      direction: 1,
      nowMs: 1000,
      eventKeyAction: 0,
      source: 'overlay-keydown',
    }),
    true,
  );
  assert.equal(
    consumeVodDirectionalSeek({
      direction: 1,
      nowMs: 1020,
      eventKeyAction: 0,
      source: 'remote-handler',
    }),
    false,
  );
  assert.equal(
    shouldSkipDuplicateVodDirectionalSeek({
      direction: 1,
      nowMs: 1020,
      eventKeyAction: 0,
      source: 'TVEventHandler',
    }),
    true,
  );
  assert.match(controller, /consumeVodDirectionalSeek/);
});

test('10. repeated key-down still accelerates after ownership routing', () => {
  resetVodDirectionalSeekDedupeForTests();
  assert.equal(
    consumeVodDirectionalSeek({
      direction: 1,
      nowMs: 1000,
      eventKeyAction: 2,
      source: 'overlay-keydown',
    }),
    true,
  );
  assert.equal(
    consumeVodDirectionalSeek({
      direction: 1,
      nowMs: 1040,
      eventKeyAction: 2,
      source: 'overlay-keydown',
    }),
    true,
  );
  assert.equal(resolveVodSeekStepMs(0), 10_000);
  assert.equal(resolveVodSeekStepMs(3), 30_000);
  assert.equal(resolveVodSeekStepMs(7), 60_000);
});

test('11. Live does not enter centralized VOD seek', () => {
  assert.equal(
    resolveVodDirectionalSeekEntry({
      direction: 1,
      controlsVisible: false,
      mediaType: 'live',
      durationMs: 0,
    }),
    'reveal-only',
  );
  assert.equal(
    shouldActivateHiddenChromeKeyCapture({
      controlsVisible: false,
      mediaType: 'live',
      upNextActive: false,
      platformOs: 'android',
    }),
    false,
  );
  assert.match(controller, /mediaType === 'live' \? 'generic-dpad'/);
});

test('chrome reveal callers are uniquely sourced', () => {
  assert.match(controller, /logPlayerChrome/);
  assert.match(controller, /source: 'playback-state'/);
  assert.match(controller, /revealControls\('play-toggle'\)/);
  assert.match(controls, /onReveal\(revealSource\)/);
  assert.match(controls, /timeline-focus/);
  assert.match(controls, /controls-focus/);
  assert.match(controls, /logPlayerFocus/);
  assert.match(hiddenCapture, /logVodFocusSeek/);
  assert.match(remoteHandlers, /logTvInputRaw/);
});
