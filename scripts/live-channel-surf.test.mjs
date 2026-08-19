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
