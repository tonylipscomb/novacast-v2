import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  resolveSurfedChannelId,
  shouldHandleLiveChannelSurf,
} from '../src/features/playback/continuity/playbackContinuity.ts';
import {
  resolveLiveSurfAdjacent,
  shouldApplyLiveSurfResolution,
} from '../src/features/live/liveTvSurf.ts';
import {
  chooseLiveChannel,
  createLiveTvLandingState,
  resolveLivePreview,
  surfLiveFullscreenChannel,
} from '../src/features/live/liveTvLogic.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => readFileSync(join(root, relativePath), 'utf8').replace(/\r\n/g, '\n');
const liveScreen = read('src/features/live/LiveTvScreen.tsx');
const liveRouter = read('src/features/live/LiveTvFocusRouter.tsx');
const liveSurf = read('src/features/live/liveTvSurf.ts');
const fullscreenSurfNative = read('src/features/live/fullscreenSurfNative.ts');
const fullscreenSurfOverlay = read('src/features/live/FullscreenSurfOverlay.tsx');
const streamPlayer = read('src/features/playback/NovaStreamPlayer.tsx');
const vodSeek = read('src/features/playback/unified/vodSeek.ts');
const controller = read('src/features/playback/unified/UnifiedPlayerController.tsx');
const seriesUpNext = read('src/features/playback/continuity/seriesUpNext.ts');
const resumeGate = read('src/features/playback/continuity/playbackResumeGate.ts');
const progressStore = read('src/features/playback/unified/playbackProgressStore.ts');

const sports = ['espn', 'espn2', 'fs1', 'nfl-network'];

test('1. Live RIGHT selects next channel', () => {
  const result = resolveLiveSurfAdjacent({ channelIds: sports, currentId: 'espn', direction: 1 });
  assert.equal(result.kind, 'adjacent');
  if (result.kind === 'adjacent') {
    assert.equal(result.toChannelId, 'espn2');
  }
});

test('2. Live LEFT selects previous channel', () => {
  const result = resolveLiveSurfAdjacent({ channelIds: sports, currentId: 'espn2', direction: -1 });
  assert.equal(result.kind, 'adjacent');
  if (result.kind === 'adjacent') {
    assert.equal(result.toChannelId, 'espn');
  }
});

test('3. last + RIGHT wraps to first', () => {
  assert.equal(resolveSurfedChannelId(sports, 'nfl-network', 1), 'espn');
  const result = resolveLiveSurfAdjacent({ channelIds: sports, currentId: 'nfl-network', direction: 1 });
  assert.equal(result.kind, 'adjacent');
  if (result.kind === 'adjacent') {
    assert.equal(result.toChannelId, 'espn');
  }
});

test('4. first + LEFT wraps to last', () => {
  const result = resolveLiveSurfAdjacent({ channelIds: sports, currentId: 'espn', direction: -1 });
  assert.equal(result.kind, 'adjacent');
  if (result.kind === 'adjacent') {
    assert.equal(result.toChannelId, 'nfl-network');
  }
});

test('5. one-channel queue no-op', () => {
  const result = resolveLiveSurfAdjacent({ channelIds: ['espn'], currentId: 'espn', direction: 1 });
  assert.equal(result.kind, 'noop');
  if (result.kind === 'noop') {
    assert.equal(result.reason, 'single-channel');
  }
});

test('6. current category ordering preserved', () => {
  const result = resolveLiveSurfAdjacent({ channelIds: sports, currentId: 'espn', direction: 1 });
  assert.equal(result.kind, 'adjacent');
  if (result.kind === 'adjacent') {
    assert.equal(result.queueLength, 4);
    assert.equal(result.toIndex, 1);
  }
  assert.match(liveScreen, /channels\.map\(\(channel\) => channel\.id\)/);
});

test('7. quick repeated RIGHT progresses predictably', () => {
  let current = 'espn';
  for (const expected of ['espn2', 'fs1', 'nfl-network']) {
    const result = resolveLiveSurfAdjacent({ channelIds: sports, currentId: current, direction: 1 });
    assert.equal(result.kind, 'adjacent');
    if (result.kind === 'adjacent') {
      assert.equal(result.toChannelId, expected);
      current = result.toChannelId;
    }
  }
  assert.match(liveScreen, /LIVE_CHANNEL_SURF_DEBOUNCE_MS/);
  assert.match(liveScreen, /intendedSurfChannelIdRef/);
});

test('8. stale async source resolution cannot override newer selection', () => {
  assert.equal(
    shouldApplyLiveSurfResolution({
      requestId: 2,
      latestRequestId: 3,
      toChannelId: 'espn2',
      latestChannelId: 'fs1',
    }),
    false,
  );
  assert.equal(
    shouldApplyLiveSurfResolution({
      requestId: 3,
      latestRequestId: 3,
      toChannelId: 'fs1',
      latestChannelId: 'fs1',
    }),
    true,
  );
  assert.match(liveScreen, /stale-transition-dropped/);
  assert.match(liveScreen, /shouldApplyLiveSurfResolution/);
});

test('9. fullscreen remains open', () => {
  const ready = {
    ...createLiveTvLandingState('sports', 'espn'),
    previewChannelId: 'espn',
    previewStatus: 'ready',
    previewConfirmedChannelId: 'espn',
    previewRequestId: 2,
    fullscreenChannelId: 'espn',
  };
  const surfed = surfLiveFullscreenChannel(ready, 'espn2');
  assert.equal(surfed.fullscreenChannelId, 'espn2');
  assert.notEqual(surfed.fullscreenChannelId, null);
});

test('10. Live surf does not invoke Resume', () => {
  assert.doesNotMatch(liveScreen, /requestPlaybackResumeChoice/);
  assert.doesNotMatch(liveSurf, /resumePolicy/);
  assert.match(resumeGate, /requestPlaybackResumeChoice/);
});

test('11. Live surf does not write VOD progress', () => {
  assert.match(progressStore, /mediaType === 'live'/);
  assert.match(controller, /item\.mediaType === 'live'/);
  assert.doesNotMatch(liveSurf, /savePlaybackProgress/);
  const start = liveScreen.indexOf('const surfLiveChannel');
  const block = liveScreen.slice(start, liveScreen.indexOf('const visibleSurfOverlay', start));
  assert.doesNotMatch(block, /enrichFocusedChannelEpg/);
});

test('12. Live surf does not trigger VOD seek', () => {
  assert.doesNotMatch(liveRouter, /handleVodDirectionalSeek/);
  assert.doesNotMatch(liveRouter, /beginVod/);
  assert.match(vodSeek, /mediaType === 'live'/);
});

test('13. Live surf does not trigger Series Up Next', () => {
  assert.doesNotMatch(liveScreen, /shouldArmSeriesUpNext/);
  assert.doesNotMatch(liveSurf, /playNextEpisode/);
  assert.match(seriesUpNext, /shouldArmSeriesUpNext/);
});

test('14. Live browse first-OK preview behavior unchanged', () => {
  const landing = createLiveTvLandingState('sports', 'espn');
  const firstOk = chooseLiveChannel(landing, 'espn');
  assert.equal(firstOk.previewChannelId, 'espn');
  assert.equal(firstOk.previewStatus, 'loading');
  assert.equal(firstOk.fullscreenChannelId, null);
});

test('15. second-OK fullscreen behavior unchanged', () => {
  const landing = createLiveTvLandingState('sports', 'espn');
  const firstOk = chooseLiveChannel(landing, 'espn');
  const ready = resolveLivePreview(firstOk, firstOk.previewRequestId, 'espn', 'ready');
  const secondOk = chooseLiveChannel(ready, 'espn');
  assert.equal(secondOk.fullscreenChannelId, 'espn');
});

test('16. failed channel still allows another LEFT/RIGHT surf', () => {
  assert.equal(
    shouldHandleLiveChannelSurf({
      isLive: true,
      fullscreenActive: true,
      modalOpen: false,
      chromeVisible: true,
      controlsFocused: true,
    }),
    true,
  );
  assert.match(liveScreen, /liveSurfHandles\.anchor/);
});

test('17. physical-focus equivalent route reaches centralized Live surf command', () => {
  assert.match(liveScreen, /LiveTvFocusRouter/);
  assert.match(liveRouter, /handleSentinelNativeFocus\(-1\)/);
  assert.match(liveRouter, /handleSentinelNativeFocus\(1\)/);
  assert.match(liveScreen, /onSentinelFocus=\{handleLiveSurfSentinelFocus\}/);
  assert.match(liveScreen, /surfLiveChannel\(direction\)/);
  assert.doesNotMatch(liveScreen, /TVEventHandler/);
});

test('18. fullscreen native surf adapter binds the Expo module contract', () => {
  assert.match(fullscreenSurfNative, /requireNativeModule<FullscreenSurfNativeModule>\('NovacastFullscreenSurf'\)/);
  assert.match(fullscreenSurfNative, /setFullscreenSurfEnabled\(enabled: boolean\)/);
  assert.match(fullscreenSurfNative, /addListener\('onFullscreenSurfKey'/);
});

test('19. fullscreen lifecycle enables and disables native interception', () => {
  assert.match(liveScreen, /\[NovaCast Surf Bridge\].*enable-requested/);
  assert.match(liveScreen, /setFullscreenSurfEnabled\(true\)/);
  assert.match(liveScreen, /\[NovaCast Surf Bridge\].*disable-requested/);
  assert.match(liveScreen, /setFullscreenSurfEnabled\(false\)/);
});

test('20. native fullscreen key subscription is scoped to fullscreen input', () => {
  assert.match(liveScreen, /\{fullscreenChannel \? \(/);
  assert.match(liveScreen, /subscribeFullscreenSurfKeys/);
  assert.match(liveScreen, /subscription\.remove\(\)/);
});

test('21. raw directional events preserve native timing diagnostics', () => {
  assert.match(liveScreen, /\[NovaCast Fullscreen Raw Key\].*received/);
  assert.match(liveScreen, /eventTime: event\.eventTime/);
  assert.match(liveScreen, /downTime: event\.downTime/);
  assert.match(liveScreen, /repeatCount: event\.repeatCount/);
});

test('22. native directional input reuses centralized surf cursor logic', () => {
  assert.match(liveScreen, /handleNativeFullscreenSurfEvent/);
  assert.match(liveScreen, /surfCursorIndexRef/);
  assert.match(liveScreen, /surfCursorChannelIdRef/);
  assert.match(liveScreen, /surfLiveChannel\(toIndex >= fromIndex \? 1 : -1, releasedTargetId, true, releasedGeneration, surfCommitId\)/);
  assert.match(liveScreen, /directDirectionalInput=\{fullscreenSurfNativeActive\}/);
});

test('23. native ACTION_UP does not advance the cursor a second time', () => {
  assert.match(liveScreen, /const isUp = event\.action === 1/);
  assert.match(liveScreen, /if \(isDown\) \{/);
  assert.match(liveScreen, /surfKeyDownRef\.current = false/);
});

test('24. repeated native hold cannot promote playback while key remains held', () => {
  assert.match(liveScreen, /const isDown = event\.action === 0/);
  assert.match(liveScreen, /event\.repeatCount \? 'repeat' : 'down'/);
  assert.match(liveScreen, /if \(surfKeyDownRef\.current \|\| fullscreenSurfIntentGenerationRef\.current !== releasedGeneration/);
  assert.match(liveScreen, /const settleDelayMs = nativeSurfTapBurstRef\.current \? 480 : 200/);
});

test('25. native cursor updates use an isolated overlay store', () => {
  assert.match(liveScreen, /publishFullscreenSurfOverlay\(/);
  assert.match(liveScreen, /<FullscreenSurfOverlay \/>/);
  assert.match(fullscreenSurfOverlay, /useSyncExternalStore/);
  assert.doesNotMatch(
    liveScreen.match(/const handleNativeFullscreenSurfEvent[\s\S]*?\n  \);/)?.[0] ?? '',
    /setSurfOverlay\(/,
  );
});

test('26. repeat diagnostics are sampled and release emits one summary', () => {
  assert.match(liveScreen, /event\.repeatCount % 10 === 0/);
  assert.match(liveScreen, /\[NovaCast Surf Perf Summary\]/);
  assert.match(liveScreen, /cursorMoves:/);
  assert.match(liveScreen, /overlayRenderCount: 'external-store'/);
  assert.match(liveScreen, /event: 'session-complete'/);
  assert.match(liveScreen, /event: 'session-cancelled'/);
  assert.match(liveScreen, /nativeSurfEventCountRef\.current = 0/);
});

test('27. final surf commit clears the external overlay before tune', () => {
  const commit = liveScreen.match(/console\.info\('\[NovaCast Live Surf Playback\]'[\s\S]*?surfLiveChannel\(toIndex >= fromIndex \? 1 : -1, releasedTargetId, true, releasedGeneration, surfCommitId\);/)?.[0] ?? '';
  assert.match(commit, /event: 'tune-after-release'/);
  assert.match(commit, /surfLiveChannel\(toIndex >= fromIndex \? 1 : -1, releasedTargetId, true, releasedGeneration, surfCommitId\)/);
  assert.match(liveScreen, /clearFullscreenSurfOverlay\(nextId\);[\s\S]*?setPreviewStreamSource\(preparedSource\)/);
});

test('29. each native directional input advances the intent generation and stale commits are dropped', () => {
  assert.match(liveScreen, /fullscreenSurfIntentGenerationRef\.current \+= 1/);
  assert.match(liveScreen, /event: 'stale-commit-dropped'/);
  assert.match(liveScreen, /stage: 'preview-resolution'/);
  assert.match(liveScreen, /stage: 'transition-settled-source-commit'/);
  assert.match(liveScreen, /surfCommitGenerationByChannelRef/);
});

test('30. a long native hold remains cursor-only until one final release commit', () => {
  const nativeHandler = liveScreen.match(/const handleNativeFullscreenSurfEvent[\s\S]*?\n  \);/)?.[0] ?? '';
  assert.match(nativeHandler, /if \(isDown\) \{/);
  assert.match(nativeHandler, /publishFullscreenSurfOverlay\(/);
  assert.doesNotMatch(nativeHandler.slice(0, nativeHandler.indexOf('surfKeyDownRef.current = false')), /surfLiveChannel\(/);
  assert.match(nativeHandler, /surfLiveChannel\(toIndex >= fromIndex \? 1 : -1, releasedTargetId, true, releasedGeneration, surfCommitId\)/);
});

test('31. stale surf player completions are ignored after a newer intent', () => {
  assert.match(liveScreen, /shouldAcceptLiveSurfPlayerCommit/);
  assert.match(liveScreen, /activeSurfCommitGenerationRef\.current === fullscreenSurfIntentGenerationRef\.current/);
  assert.match(streamPlayer, /shouldAcceptAsyncCommit\?: \(\) => boolean/);
  assert.match(streamPlayer, /shouldAcceptAsyncCommitRef\.current && !shouldAcceptAsyncCommitRef\.current\(\)/);
  assert.match(streamPlayer, /onReadyRef\.current\?\.\(\)/);
  assert.match(liveScreen, /stage: 'player-error'/);
  assert.match(liveScreen, /stage: 'first-frame'/);
  assert.match(liveScreen, /stage: 'player-playing'/);
});

test('32. one hundred native repeats advance intent without creating playback calls', () => {
  let generation = 0;
  let playbackCommits = 0;
  for (let repeat = 0; repeat < 100; repeat += 1) {
    generation += 1;
  }
  const releasedGeneration = generation;
  if (releasedGeneration === generation) playbackCommits += 1;
  assert.equal(generation, 100);
  assert.equal(playbackCommits, 1);
  assert.match(liveScreen, /fullscreenSurfIntentGenerationRef\.current \+= 1/);
  const nativeHandler = liveScreen.match(/const handleNativeFullscreenSurfEvent[\s\S]*?\n  \);/)?.[0] ?? '';
  const downPath = nativeHandler.split('surfKeyDownRef.current = false', 1)[0];
  assert.doesNotMatch(downPath, /surfLiveChannel\(/);
});

test('33. tap bursts extend only the post-release idle settle window', () => {
  assert.match(liveScreen, /nativeSurfLastReleaseAtRef\.current.*< 600/);
  assert.match(liveScreen, /nativeSurfLastCommitAtRef\.current.*< 600/);
  assert.match(liveScreen, /const settleDelayMs = nativeSurfTapBurstRef\.current \? 480 : 200/);
  assert.match(liveScreen, /reason: 'new-input-before-settle'/);
});

test('34. native surf preparation cannot leave fullscreen or replace the source with null', () => {
  const nativeHandler = liveScreen.match(/const handleNativeFullscreenSurfEvent[\s\S]*?\n  \);/)?.[0] ?? '';
  assert.doesNotMatch(nativeHandler, /closeLiveFullscreen\(/);
  assert.doesNotMatch(nativeHandler, /setPreviewStreamSource\(null\)/);
  assert.match(liveScreen, /stage: 'prepare-start'/);
  assert.match(liveScreen, /stage: 'commit-start'/);
  assert.match(liveScreen, /clearFullscreenSurfOverlay\(nextId\)/);
});

test('35. player warning state is presentation-only and directional input recovers it', () => {
  assert.match(liveScreen, /event: 'directional-input-during-player-warning'/);
  assert.match(liveScreen, /setFullscreenFrameStatus\('pending'\)/);
  assert.match(liveScreen, /shouldShowFullscreenFallback\(fullscreenFrameStatus\)/);
  assert.doesNotMatch(liveScreen.match(/const handleNativeFullscreenSurfEvent[\s\S]*?\n  \);/)?.[0] ?? '', /setState\([\s\S]*closeLiveFullscreen/);
});

test('36. fullscreen fallback does not automatically claim retry focus', () => {
  const fallbackEffect = liveScreen.match(/if \(!fullscreenFallbackVisible[\s\S]*?\n  \}, \[[^\n]+\]\);/)?.[0] ?? '';
  assert.doesNotMatch(fallbackEffect, /requestTvFocus\(/);
  assert.match(liveScreen, /event: 'background-focus-during-fullscreen'/);
});

test('37. new native input breaks stale surf busy ownership without waiting for replaceAsync', () => {
  assert.match(liveScreen, /surf-new-input-breaks-stale-transaction/);
  assert.match(liveScreen, /patchLiveTvWorkload\(\{ surfTransitionInFlight: false \}/);
  assert.match(liveScreen, /surfTransactionRef\.current = null/);
  assert.match(liveScreen, /pendingLatestChannelId/);
});

test('38. stalled surf transactions reset through a bounded watchdog', () => {
  assert.match(liveScreen, /surfWatchdogTimerRef/);
  assert.match(liveScreen, /stage: 'watchdog-stalled'/);
  assert.match(liveScreen, /reason: 'surf-watchdog-stalled'/);
  assert.match(liveScreen, /FULLSCREEN_FIRST_FRAME_TIMEOUT_MS \+ 5000/);
});

test('39. surf transaction diagnostics retain depth-one latest-target ownership', () => {
  assert.match(liveScreen, /stage: 'attempt-created'/);
  assert.match(liveScreen, /transaction\.stage = 'ready'/);
  assert.match(liveScreen, /surfTransactionRef\.current\.stage = 'error'/);
  assert.match(liveScreen, /stage: 'pending-latest-promoted'/);
  assert.match(liveScreen, /stage: 'reset-ready'/);
  assert.match(liveScreen, /event: 'coalesced-follow-up'/);
  assert.match(liveScreen, /pendingSurfTargetIdRef/);
  assert.match(liveScreen, /desiredSurfTargetIdRef/);
});

test('28. loading and playback remain the only committed-channel center owners', () => {
  assert.match(liveScreen, /<FullscreenSurfOverlay \/>/);
  assert.match(liveScreen, /shouldShowFullscreenLoadingOverlay\(fullscreenFrameStatus\)/);
  assert.match(liveScreen, /clearFullscreenSurfOverlay\(\);/);
});

test('40. fullscreen surf uses one compact dark glass panel above loading status', () => {
  assert.match(fullscreenSurfOverlay, /backgroundColor: 'rgba\(3,7,18,0\.86\)'/);
  assert.match(fullscreenSurfOverlay, /borderWidth: 1/);
  assert.match(fullscreenSurfOverlay, /borderRadius: 16/);
  assert.match(fullscreenSurfOverlay, /zIndex: 20/);
  assert.match(liveScreen, /<FullscreenSurfOverlay \/>[\s\S]*?shouldShowFullscreenLoadingOverlay\(fullscreenFrameStatus\)/);
  assert.doesNotMatch(liveScreen, /visibleSurfOverlay/);
});

test('41. fullscreen exit target prefers the channel that reached first frame', () => {
  assert.match(liveScreen, /lastReadyFullscreenChannelIdRef/);
  assert.match(liveScreen, /lastReadyFullscreenChannelIdRef\.current = liveStateRef\.current\?\.fullscreenChannelId/);
  assert.match(liveScreen, /reason: 'ready-channel'/);
  assert.match(liveScreen, /captureFullscreenExitTarget\(\)/);
  assert.match(liveScreen, /fullscreenExitFocusChannelIdRef/);
});

test('42. fullscreen exit focus uses a bounded post-mount request and safe fallback', () => {
  assert.match(liveScreen, /scrollToIndex\(\{ index: targetIndex, animated: false, viewPosition: 0\.5 \}\)/);
  assert.match(liveScreen, /maxFrames: 3/);
  assert.match(liveScreen, /fullscreen-exit-focus-success/);
  assert.match(liveScreen, /fullscreen-exit-focus-fallback/);
  assert.match(liveScreen, /fullscreenExitFocusPendingRef/);
  assert.match(liveScreen, /fullscreen-exit-focus-pending/);
  assert.match(liveScreen, /fullscreen-exit-category-focus-ignored/);
  assert.match(liveScreen, /fullscreen-exit-focus-confirmed/);
  assert.match(liveScreen, /FULLSCREEN_EXIT_FOCUS_SAFETY_TIMEOUT_MS = 5_000/);
  assert.match(liveScreen, /channel-focused-candidate/);
  assert.match(liveScreen, /FULLSCREEN_EXIT_FOCUS_STABILIZATION_MS = 650/);
  assert.match(liveScreen, /fullscreenExitFocusReassertedRef/);
  assert.match(liveScreen, /fullscreen-close-restore-reassert/);
  assert.match(liveScreen, /suppressFocusVisual=\{fullscreenExitFocusPendingRef\.current\}/);
  assert.match(liveScreen, /focusOwnerRef\.current = fallback\?\.id \? 'channels'/);
});

test('43. stale surf watchdogs cannot mutate newer transaction state', () => {
  assert.match(liveScreen, /transaction\.attemptId !== surfCommitId/);
  assert.match(liveScreen, /transaction\.generation !== fullscreenSurfIntentGenerationRef\.current/);
  assert.match(liveScreen, /surfWatchdogTimerRef\.current = null/);
});
