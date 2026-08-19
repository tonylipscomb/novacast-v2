import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { shouldRevealChromeFromPlaybackState } from '../src/features/playback/unified/unifiedPlayerLogic.ts';
import {
  applyVodSeekPreviewStep,
  beginVodSeekCommit,
  canCommitVodSeek,
  completeVodSeekCommit,
  consumeVodDirectionalSeek,
  createVodSeekCommitGate,
  decideVodSeekBackAction,
  resolveSeekHorizontalSentinelHandle,
  resolveVodDirectionalSeekEntry,
  resolveVodSeekStepMs,
  resetVodDirectionalSeekDedupeForTests,
  shouldActivateVodFocusRouter,
  shouldTrapVodSeekHorizontalFocus,
  VOD_SEEK_IDLE_COMMIT_MS,
} from '../src/features/playback/unified/vodSeek.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => readFileSync(join(root, relativePath), 'utf8').replace(/\r\n/g, '\n');
const controls = read('src/features/playback/unified/UnifiedPlayerControls.tsx');
const controller = read('src/features/playback/unified/UnifiedPlayerController.tsx');
const overlay = read('src/features/playback/unified/UnifiedPlayerOverlay.tsx');
const router = read('src/features/playback/unified/UnifiedPlayerHiddenChromeCapture.tsx');
const remoteHandlers = read('src/features/playback/unified/useUnifiedPlayerRemoteHandlers.tsx');
const vodSeek = read('src/features/playback/unified/vodSeek.ts');

test('1. playback-state does not reopen chrome merely because it hides', () => {
  assert.equal(
    shouldRevealChromeFromPlaybackState({
      playbackActive: true,
      previousPlaybackActive: true,
      machineState: 'playing',
      previousMachineState: 'playing',
      isPlaying: true,
      previousIsPlaying: true,
      itemId: 'movie-1',
      previousItemId: 'movie-1',
    }),
    false,
  );
  const effectStart = controller.indexOf('const previousPlaybackChromeRef');
  const revealCall = controller.indexOf('shouldRevealChromeFromPlaybackState', effectStart);
  const depsEnd = controller.indexOf('snapshot.machineState,\n  ]);', revealCall);
  const effectBlock = controller.slice(effectStart, depsEnd > revealCall ? depsEnd : effectStart + 1800);
  assert.match(effectBlock, /shouldRevealChromeFromPlaybackState/);
  assert.doesNotMatch(effectBlock, /snapshot\.controlsVisible,/);
});

test('2. stable playing state does not continuously reveal controls', () => {
  assert.equal(
    shouldRevealChromeFromPlaybackState({
      playbackActive: true,
      previousPlaybackActive: true,
      machineState: 'playing',
      previousMachineState: 'playing',
      isPlaying: true,
      previousIsPlaying: true,
    }),
    false,
  );
  assert.equal(
    shouldRevealChromeFromPlaybackState({
      playbackActive: true,
      previousPlaybackActive: false,
      machineState: 'playing',
      previousMachineState: 'idle',
      isPlaying: true,
      previousIsPlaying: false,
    }),
    true,
  );
  assert.equal(
    shouldRevealChromeFromPlaybackState({
      playbackActive: true,
      previousPlaybackActive: true,
      machineState: 'playing',
      previousMachineState: 'playing',
      isPlaying: false,
      previousIsPlaying: true,
    }),
    true,
  );
});

test('3. chrome hide requests hidden anchor focus', () => {
  assert.match(router, /hidden-anchor-focus-request/);
  assert.match(router, /if \(!enabled \|\| chromeVisible/);
  assert.match(router, /focusNativeViewWhenReady\(\(\) => anchorRef\.current/);
});

test('4. hidden anchor focus is confirmed', () => {
  assert.match(router, /hidden-anchor-focus-confirmed/);
  assert.match(router, /onFocus=\{handleAnchorFocus\}/);
  assert.match(router, /focusable=\{!chromeVisible\}/);
  assert.match(router, /hasTVPreferredFocus=\{!chromeVisible\}/);
});

test('5. left sentinel focus calls centralized LEFT seek preview', () => {
  assert.match(router, /handleSentinelNativeFocus\(-1\)/);
  assert.match(router, /left-sentinel-focus/);
  assert.match(controls, /onVodDirectionalSeek\(direction, 'hidden-focus-sentinel'\)/);
  assert.equal(
    resolveVodDirectionalSeekEntry({
      direction: -1,
      controlsVisible: true,
      mediaType: 'movie',
      durationMs: 600_000,
    }),
    'begin-preview',
  );
  assert.equal(
    resolveVodDirectionalSeekEntry({
      direction: -1,
      controlsVisible: false,
      mediaType: 'movie',
      durationMs: 600_000,
    }),
    'reveal-only',
  );
});

test('6. right sentinel focus calls centralized RIGHT seek preview', () => {
  assert.match(router, /handleSentinelNativeFocus\(1\)/);
  assert.match(router, /right-sentinel-focus/);
  assert.match(controller, /source === 'hidden-focus-sentinel'/);
});

test('7. hidden RIGHT produces +10 preview', () => {
  const result = applyVodSeekPreviewStep({
    actualPositionMs: 40_000,
    previewPositionMs: null,
    durationMs: 600_000,
    direction: 1,
    repeatCount: 0,
  });
  assert.equal(result.previewPositionMs, 50_000);
  assert.equal(result.stepMs, 10_000);
});

test('8. hidden LEFT produces -10 preview', () => {
  const result = applyVodSeekPreviewStep({
    actualPositionMs: 40_000,
    previewPositionMs: null,
    durationMs: 600_000,
    direction: -1,
    repeatCount: 0,
  });
  assert.equal(result.previewPositionMs, 30_000);
  assert.equal(result.stepMs, -10_000);
});

test('9. timeline focus after sentinel does not reset preview', () => {
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
  assert.doesNotMatch(focusBlock, /applySeekDelta/);
  assert.match(focusBlock, /timeline-focus-confirmed/);
});

test('10. timeline LEFT routes through left sentinel instead of rewind', () => {
  assert.match(controls, /nextFocusLeft: leftSentinel/);
  assert.doesNotMatch(
    controls.slice(controls.indexOf("case 'seek':"), controls.indexOf("case 'seek':") + 500),
    /nextFocusLeft: rewind/,
  );
  assert.equal(resolveSeekHorizontalSentinelHandle(-1, { left: 11, right: 22 }), 11);
});

test('11. timeline RIGHT routes through right sentinel instead of fast-forward', () => {
  assert.match(controls, /nextFocusRight: rightSentinel/);
  assert.doesNotMatch(
    controls.slice(controls.indexOf("case 'seek':"), controls.indexOf("case 'seek':") + 500),
    /nextFocusRight: forward/,
  );
  assert.equal(resolveSeekHorizontalSentinelHandle(1, { left: 11, right: 22 }), 22);
});

test('12. repeated right sentinel focus accumulates', () => {
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
  assert.match(router, /preview-step-forwarded/);
  resetVodDirectionalSeekDedupeForTests();
  assert.equal(
    consumeVodDirectionalSeek({
      direction: 1,
      nowMs: 2000,
      source: 'hidden-focus-sentinel',
    }),
    true,
  );
  assert.equal(
    consumeVodDirectionalSeek({
      direction: 1,
      nowMs: 2050,
      source: 'hidden-focus-sentinel',
    }),
    true,
  );
});

test('13. acceleration remains intact', () => {
  assert.equal(resolveVodSeekStepMs(0), 10_000);
  assert.equal(resolveVodSeekStepMs(3), 30_000);
  assert.equal(resolveVodSeekStepMs(7), 60_000);
  assert.equal(resolveVodSeekStepMs(12), 120_000);
  assert.match(controls, /resolveVodSeekRepeatCount/);
});

test('14. seek preview suspends auto-hide', () => {
  assert.match(controller, /if \(seekPreviewActiveRef\.current\) \{/);
  assert.match(controller, /if \(seekPreviewActive\) \{/);
  assert.match(controller, /clearChromeTimer\(\)/);
});

test('15. idle commit still works exactly once', () => {
  assert.equal(VOD_SEEK_IDLE_COMMIT_MS, 700);
  const gate = createVodSeekCommitGate('idle-sentinel');
  assert.equal(beginVodSeekCommit(gate, 'idle-sentinel'), true);
  assert.equal(beginVodSeekCommit(gate, 'idle-sentinel'), false);
  assert.match(controls, /commitSeekPreview\('idle'\)/);
});

test('16. OK commit still works exactly once', () => {
  const gate = createVodSeekCommitGate('ok-sentinel');
  assert.equal(canCommitVodSeek(gate, 'ok-sentinel'), true);
  assert.equal(beginVodSeekCommit(gate, 'ok-sentinel'), true);
  completeVodSeekCommit(gate);
  assert.equal(beginVodSeekCommit(gate, 'ok-sentinel'), false);
  assert.match(controls, /commitSeekPreview\('ok'\)/);
});

test('17. Back still cancels', () => {
  assert.equal(decideVodSeekBackAction(true), 'cancel-preview');
  assert.equal(decideVodSeekBackAction(false), 'player-back');
  const backStart = controller.indexOf('const handleBack');
  const backEnd = controller.indexOf('const handleRetry', backStart);
  assert.match(controller.slice(backStart, backEnd), /cancelSeekPreviewRef\.current\(\)/);
});

test('18. Live does not mount/activate VOD sentinel routing', () => {
  assert.equal(
    shouldActivateVodFocusRouter({
      mediaType: 'live',
      upNextActive: false,
      platformOs: 'android',
    }),
    false,
  );
  assert.equal(
    shouldActivateVodFocusRouter({
      mediaType: 'movie',
      upNextActive: false,
      platformOs: 'android',
    }),
    true,
  );
  assert.match(controls, /shouldActivateVodFocusRouter/);
  assert.doesNotMatch(overlay, /UnifiedPlayerVodFocusRouter/);
});

test('19. failed onKeyDown path is retired', () => {
  assert.doesNotMatch(router, /onKeyDown/);
  assert.doesNotMatch(router, /overlay-keydown/);
  assert.match(remoteHandlers, /eventConsumedBy: 'hidden-focus-sentinel'/);
  assert.equal(shouldTrapVodSeekHorizontalFocus({
    controlsVisible: true,
    timelineFocused: true,
    allowSeek: true,
  }), false);
});

test('20. chrome hide parks on hidden seek anchor', () => {
  assert.match(router, /nextFocusLeft: handles\.left/);
  assert.match(router, /nextFocusRight: handles\.right/);
  assert.match(router, /logVodFocusSeek/);
  assert.match(vodSeek, /\[NovaCast VOD Focus Seek\]/);
});
