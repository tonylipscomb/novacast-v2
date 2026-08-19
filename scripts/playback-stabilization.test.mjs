import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FULLSCREEN_FIRST_FRAME_TIMEOUT_MS,
  shouldKeepPreviewAlive,
  shouldShowFullscreenFallback,
  shouldShowFullscreenLoadingOverlay,
} from '../src/features/live/liveTvPlaybackReadiness.ts';
import {
  isPreviewRequestCurrent,
  nextFocusId,
  PREVIEW_FOCUS_DEBOUNCE_MS,
  shouldApplyDebouncedPreviewTune,
  shouldClearPreviewStreamUrl,
  shouldScrollListToFocusIndex,
} from '../src/features/live/liveTvPreviewScheduling.ts';
import {
  resolveMoviesDetailNotification,
  resolveMoviesNotificationForStatus,
  resolvePlaybackMovieId,
  resolveSelectedMovie,
  shouldCommitMovieSelection,
} from '../src/features/movies/moviesScreenLogic.ts';
import {
  decideMoviesBackAction,
  didMoviesPlaybackJustClose,
} from '../src/features/movies/moviesPlaybackLogic.ts';
import {
  shouldAcceptLiveTvOkPress,
  LIVE_TV_OK_DEDUP_MS,
} from '../src/features/live/liveTvOkDedup.ts';
import { chooseLiveChannel, createInitialLiveTvState } from '../src/features/live/liveTvLogic.ts';
import {
  FULLSCREEN_CHROME_AUTO_HIDE_MS,
  shouldAutoHideFullscreenChrome,
  shouldRenderFullscreenChrome,
} from '../src/features/live/liveTvFullscreenChrome.ts';
import {
  STARTUP_BUNDLE_INIT_ATTEMPTS,
  startupBundleInitDelayMs,
} from '../src/features/providers/providerInitRetry.ts';

const MOVIES = [
  { id: 'movie-a', title: 'Movie A' },
  { id: 'movie-b', title: 'Movie B' },
  { id: 'movie-c', title: 'Movie C' },
];

test('Live TV preview stream URL is not cleared when re-tuning the same channel', () => {
  assert.equal(shouldClearPreviewStreamUrl('chan-1', 'chan-1'), false);
  assert.equal(shouldClearPreviewStreamUrl('chan-1', 'chan-2'), true);
  assert.equal(shouldClearPreviewStreamUrl(null, 'chan-1'), true);
});

test('Live TV stale debounced preview requests are ignored after focus moves again', () => {
  assert.equal(isPreviewRequestCurrent(2, 'chan-2', 2, 'chan-2'), true);
  assert.equal(isPreviewRequestCurrent(2, 'chan-2', 3, 'chan-2'), false);
  assert.equal(isPreviewRequestCurrent(2, 'chan-2', 2, 'chan-3'), false);
});

test('Live TV keeps the preview player alive until fullscreen renders a first frame', () => {
  assert.equal(shouldKeepPreviewAlive('chan-1', 'pending'), true);
  assert.equal(shouldKeepPreviewAlive('chan-1', 'timeout'), true);
  assert.equal(shouldKeepPreviewAlive('chan-1', 'ready'), false);
  assert.equal(shouldKeepPreviewAlive(null, 'pending'), true);
});

test('Live TV fullscreen loading and fallback overlays follow frame readiness, not PLAYING alone', () => {
  assert.equal(shouldShowFullscreenLoadingOverlay('pending'), true);
  assert.equal(shouldShowFullscreenLoadingOverlay('ready'), false);
  assert.equal(shouldShowFullscreenFallback('timeout'), true);
  assert.equal(shouldShowFullscreenFallback('error'), true);
  assert.equal(shouldShowFullscreenFallback('ready'), false);
  assert.equal(FULLSCREEN_FIRST_FRAME_TIMEOUT_MS, 7000);
});

test('Movies selectedMovie stays locked while detail controls receive focus', () => {
  assert.equal(resolveSelectedMovie('movie-a', MOVIES)?.id, 'movie-a');
  assert.equal(resolveSelectedMovie('movie-a', MOVIES)?.title, 'Movie A');
  assert.equal(resolveSelectedMovie('missing', MOVIES), null);
});

test('Movies Play uses selectedMovie, not the last focused poster', () => {
  assert.equal(resolvePlaybackMovieId('movie-a', 'movie-b'), 'movie-a');
  assert.equal(resolvePlaybackMovieId('movie-a', 'movie-c'), 'movie-a');
  assert.equal(resolvePlaybackMovieId(null, 'movie-b'), null);
});

test('Movies OK commits selection while focus-only movement does not', () => {
  assert.equal(shouldCommitMovieSelection('movie-a', 'movie-b'), true);
  assert.equal(shouldCommitMovieSelection(null, 'movie-a'), true);
});

test('startup provider init retries use bounded backoff before surfacing an error', () => {
  assert.equal(STARTUP_BUNDLE_INIT_ATTEMPTS, 6);
  assert.equal(startupBundleInitDelayMs(0), 0);
  assert.equal(startupBundleInitDelayMs(1), 2000);
  assert.equal(startupBundleInitDelayMs(2), 4000);
});

test('Live TV debounced preview only applies to the still-focused channel', () => {
  assert.equal(shouldApplyDebouncedPreviewTune('chan-2', 'chan-2'), true);
  assert.equal(shouldApplyDebouncedPreviewTune('chan-2', 'chan-3'), false);
  assert.equal(PREVIEW_FOCUS_DEBOUNCE_MS, 300);
  assert.equal(shouldScrollListToFocusIndex(4, 4), false);
  assert.equal(shouldScrollListToFocusIndex(4, 5), true);
});

test('Live TV fullscreen chrome auto-hides only after the first frame is ready', () => {
  assert.equal(shouldAutoHideFullscreenChrome('pending'), false);
  assert.equal(shouldAutoHideFullscreenChrome('ready'), true);
  assert.equal(shouldRenderFullscreenChrome(false, 'ready'), false);
  assert.equal(shouldRenderFullscreenChrome(true, 'ready'), true);
  assert.equal(shouldRenderFullscreenChrome(false, 'pending'), true);
  assert.equal(FULLSCREEN_CHROME_AUTO_HIDE_MS, 4000);
});

test('Movies and Live TV fullscreen overlays use root-level absolute bounds', () => {
  const overlayStyle = {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 100,
    backgroundColor: '#000000',
  };

  assert.equal(overlayStyle.position, 'absolute');
  assert.equal(overlayStyle.top, 0);
  assert.equal(overlayStyle.left, 0);
  assert.equal(overlayStyle.right, 0);
  assert.equal(overlayStyle.bottom, 0);
  assert.equal(overlayStyle.zIndex, 100);
});

test('Movies categories must reach MovieCategoryRail with stable render keys', () => {
  const categories = [
    { id: 'cat-1', renderKey: 'cat-1', name: 'Action', count: 12 },
    { id: 'cat-2', renderKey: 'cat-2', name: 'Drama', count: 8 },
  ];

  assert.equal(categories.length, 2);
  assert.equal(categories[0]?.renderKey, 'cat-1');
  assert.equal(categories[1]?.count, 8);
});

test('Live TV nextFocusId skips redundant focus state updates', () => {
  assert.equal(nextFocusId('chan-1', 'chan-1'), 'chan-1');
  assert.equal(nextFocusId('chan-1', 'chan-2'), 'chan-2');
});

test('Movies playback Back closes exactly one overlay', () => {
  assert.equal(decideMoviesBackAction(true, false), 'close-playback');
  assert.equal(didMoviesPlaybackJustClose(true, false), true);
  assert.equal(didMoviesPlaybackJustClose(false, false), false);
});

test('Movies Back does not route to Content Hub while playback is active', () => {
  assert.equal(decideMoviesBackAction(true, false), 'close-playback');
  assert.notEqual(decideMoviesBackAction(true, false), 'leave-screen');
});

test('Movies Back is swallowed while playback focus is restoring', () => {
  assert.equal(decideMoviesBackAction(false, true), 'swallow');
});

test('Movies Back leaves the screen only after playback is closed and focus restored', () => {
  assert.equal(decideMoviesBackAction(false, false), 'leave-screen');
});

test('Movies detail Back is deferred while playback UI owns the screen', async () => {
  const { shouldHandleMoviesDetailBack } = await import('../src/features/movies/moviesPlaybackLogic.ts');
  assert.equal(shouldHandleMoviesDetailBack({ playbackUiActive: true, detailOpen: true }), false);
  assert.equal(shouldHandleMoviesDetailBack({ playbackUiActive: false, detailOpen: true }), true);
  assert.equal(shouldHandleMoviesDetailBack({ playbackUiActive: false, detailOpen: false }), false);
});

test('duplicate unified playback close signals are ignored', async () => {
  const {
    shouldAcceptUnifiedPlaybackClose,
    UNIFIED_PLAYBACK_CLOSE_DEDUPE_MS,
  } = await import('../src/features/playback/unified/unifiedPlayerLogic.ts');

  assert.equal(
    shouldAcceptUnifiedPlaybackClose({ machineState: 'playing', lastCloseAtMs: 0, nowMs: 1000 }),
    true,
  );
  assert.equal(
    shouldAcceptUnifiedPlaybackClose({
      machineState: 'playing',
      lastCloseAtMs: 1000,
      nowMs: 1000 + UNIFIED_PLAYBACK_CLOSE_DEDUPE_MS - 1,
    }),
    false,
  );
  assert.equal(
    shouldAcceptUnifiedPlaybackClose({ machineState: 'closing', lastCloseAtMs: 0, nowMs: 5000 }),
    false,
  );
  assert.equal(
    shouldAcceptUnifiedPlaybackClose({ machineState: 'idle', lastCloseAtMs: 0, nowMs: 5000 }),
    false,
  );
});

test('Live TV duplicate OK on the same channel within the dedup window is ignored', () => {
  assert.equal(shouldAcceptLiveTvOkPress('chan-1', null, 1_000), true);
  assert.equal(shouldAcceptLiveTvOkPress('chan-1', { channelId: 'chan-1', at: 1_000 }, 1_200), false);
  assert.equal(shouldAcceptLiveTvOkPress('chan-1', { channelId: 'chan-1', at: 1_000 }, 1_000 + LIVE_TV_OK_DEDUP_MS), true);
});

test('Live TV second deliberate OK opens fullscreen only after preview confirmation', () => {
  const state = createInitialLiveTvState('cat-1', 'chan-1');
  // Auto-preview arrives confirmed; first OK on a ready confirmed channel enters fullscreen.
  const readyConfirmed = { ...state, previewStatus: 'ready' };
  const fullscreenFromConfirmed = chooseLiveChannel(readyConfirmed, 'chan-1');
  assert.equal(fullscreenFromConfirmed.fullscreenChannelId, 'chan-1');

  // After focusing away and back without confirmation, OK must confirm before fullscreen.
  const unconfirmed = {
    ...state,
    previewStatus: 'ready',
    previewConfirmedChannelId: null,
    fullscreenChannelId: null,
  };
  const confirmed = chooseLiveChannel(unconfirmed, 'chan-1');
  assert.equal(confirmed.fullscreenChannelId, null);
  assert.equal(confirmed.previewConfirmedChannelId, 'chan-1');
  const fullscreen = chooseLiveChannel(confirmed, 'chan-1');
  assert.equal(fullscreen.fullscreenChannelId, 'chan-1');
});

test('Movies load notifications only surface recoverable errors', () => {
  assert.equal(resolveMoviesNotificationForStatus('ready', false), null);
  assert.equal(resolveMoviesNotificationForStatus('empty', false), null);
  assert.equal(resolveMoviesNotificationForStatus('loading', false), null);

  const error = resolveMoviesNotificationForStatus('error', false);
  assert.equal(error?.title, 'Movies unavailable');
  assert.match(error?.message ?? '', /could not load movies/i);
  assert.equal(resolveMoviesNotificationForStatus('error', true)?.persistent, true);
});

test('Movies detail notifications carry retry persistence and custom copy', () => {
  const detail = resolveMoviesDetailNotification(false);
  assert.equal(detail.title, 'Movie details unavailable');
  assert.match(detail.message, /could not be loaded/i);

  const custom = resolveMoviesDetailNotification(true, 'Metadata timed out.');
  assert.equal(custom.message, 'Metadata timed out.');
  assert.equal(custom.persistent, true);
});

test('unified playback control refs are stable and do not clear Android focus handles on null', async () => {
  const fs = await import('node:fs');
  const controls = fs.readFileSync(
    new URL('../src/features/playback/unified/UnifiedPlayerControls.tsx', import.meta.url),
    'utf8',
  );

  assert.match(controls, /Stable ref callbacks are required on Android/);
  assert.match(controls, /Ignore transient null/);
  assert.doesNotMatch(controls, /const assignBackRef = registerControlRef\('back'\)/);
  assert.match(controls, /const assignBackRef = useCallback/);
});

test('unified VOD overlay uses TextureView; Live TV keeps SurfaceView default', async () => {
  const fs = await import('node:fs');
  const overlay = fs.readFileSync(
    new URL('../src/features/playback/unified/UnifiedPlayerOverlay.tsx', import.meta.url),
    'utf8',
  );
  const interaction = fs.readFileSync(
    new URL('../src/features/playback/unified/UnifiedPlayerInteractionLayer.tsx', import.meta.url),
    'utf8',
  );
  const host = fs.readFileSync(
    new URL('../src/features/playback/unified/UnifiedPlayerHost.tsx', import.meta.url),
    'utf8',
  );
  const live = fs.readFileSync(new URL('../src/features/live/LiveTvScreen.tsx', import.meta.url), 'utf8');
  const surface = fs.readFileSync(
    new URL('../src/features/playback/NovaStreamPlayer.tsx', import.meta.url),
    'utf8',
  );

  assert.match(overlay, /function resolveUnifiedPlayerSurfaceType/);
  assert.match(overlay, /mediaType !== 'live'/);
  assert.match(overlay, /return 'textureView'/);
  assert.match(overlay, /surfaceType=\{effectiveSurfaceType\}/);
  assert.match(overlay, /requestedSurfaceType/);
  assert.match(overlay, /effectiveSurfaceType/);
  assert.match(overlay, /rc-firetv-vod-textureview/);
  assert.doesNotMatch(overlay, /surfaceType="surfaceView"/);
  assert.match(overlay, /backgroundColor: 'transparent'/);
  assert.match(overlay, /collapsable=\{false\}/);
  assert.doesNotMatch(overlay, /UnifiedPlayerInteractionLayer/);
  assert.match(interaction, /return null/);
  assert.doesNotMatch(interaction, /StyleSheet\.absoluteFill/);
  assert.match(host, /<Modal/);
  assert.match(host, /presentationStyle="overFullScreen"/);
  assert.match(surface, /surfaceType = 'surfaceView'/);
  assert.doesNotMatch(live, /surfaceType=/);
  assert.doesNotMatch(live, /textureView/);
});
