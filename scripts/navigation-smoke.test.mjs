import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createTvNavigationGate,
  tryAcquireTvNavigationGate,
} from '../src/features/navigation/tvNavigation.ts';
import {
  getMoviesScreenMemory,
  rememberMoviesScreenMemory,
  resetMoviesScreenMemory,
} from '../src/features/movies/moviesScreenMemory.ts';
import {
  CONTENT_HUB_PRIMARY_ACTIONS,
  getInitialContentHubActionId,
} from '../src/features/hub/contentHubOverlayModel.ts';
import { createInitialLiveTvState, closeLiveFullscreen, chooseLiveChannel } from '../src/features/live/liveTvLogic.ts';
import {
  decideLiveTvBackAction,
  didFullscreenJustClose,
  didFullscreenJustOpen,
  isChannelPressEnteringFullscreen,
  shouldFocusPreviewActionAfterChannelOk,
} from '../src/features/live/liveTvFocusRestoration.ts';
import { TV_HOME_ROUTE } from '../src/features/navigation/tvRoutes.ts';

test('primary screen Back exits to Home, not the provider manager', () => {
  assert.equal(TV_HOME_ROUTE, '/main-menu');
  assert.notEqual(TV_HOME_ROUTE, '/content-hub');
});

test('Content Hub overlay defaults to the Home action', () => {
  assert.equal(getInitialContentHubActionId(), 'home');
});

test('Content Hub overlay exposes the expected primary actions', () => {
  assert.deepEqual(
    CONTENT_HUB_PRIMARY_ACTIONS.map((item) => item.id),
    ['home', 'settings', 'provider'],
  );
});

test('Rapid OK and Back presses are blocked by the navigation gate', () => {
  const gate = createTvNavigationGate();

  assert.equal(tryAcquireTvNavigationGate(gate, 1_000, 350), true);
  assert.equal(tryAcquireTvNavigationGate(gate, 1_100, 350), false);
  assert.equal(tryAcquireTvNavigationGate(gate, 1_351, 350), true);
});

test('Movies screen memory restores the selected category and poster', () => {
  resetMoviesScreenMemory();

  rememberMoviesScreenMemory('demo-provider', {
    selectedCategoryId: 'top',
    focusedMovieId: 'movie-42',
    selectedMovieId: 'movie-42',
  });

  assert.deepEqual(getMoviesScreenMemory('demo-provider'), {
    selectedCategoryId: 'top',
    focusedMovieId: 'movie-42',
    selectedMovieId: 'movie-42',
  });
});

test('Live TV fullscreen launch source: second OK on the ready, previewing channel row is detected as a channel-launch', () => {
  const state = createInitialLiveTvState('cat-1', 'chan-1');
  const ready = { ...state, previewStatus: 'ready', previewConfirmedChannelId: 'chan-1' };

  assert.equal(isChannelPressEnteringFullscreen(ready, 'chan-1'), true);
  assert.equal(chooseLiveChannel(ready, 'chan-1').fullscreenChannelId, 'chan-1');
});

test('Live TV first OK on an already-ready channel confirms preview without fullscreen', () => {
  const state = createInitialLiveTvState('cat-1', 'chan-1');
  const ready = { ...state, previewStatus: 'ready' };

  assert.equal(isChannelPressEnteringFullscreen(ready, 'chan-1'), false);
  const afterFirstOk = chooseLiveChannel(ready, 'chan-1');
  assert.equal(afterFirstOk.fullscreenChannelId, null);
  assert.equal(afterFirstOk.previewConfirmedChannelId, 'chan-1');
  assert.equal(afterFirstOk.previewStatus, 'ready');
});

test('Live TV accepted channel OK requests preview action focus, but second OK does not', () => {
  const state = createInitialLiveTvState('cat-1', 'chan-1');
  const ready = { ...state, previewStatus: 'ready' };
  const selected = chooseLiveChannel(ready, 'chan-1');
  const confirmed = { ...selected, previewStatus: 'ready' };
  const fullscreen = chooseLiveChannel({ ...confirmed, previewConfirmedChannelId: 'chan-1' }, 'chan-1');

  assert.equal(shouldFocusPreviewActionAfterChannelOk(ready, selected, 'chan-1'), true);
  assert.equal(shouldFocusPreviewActionAfterChannelOk(confirmed, fullscreen, 'chan-1'), false);
});

test('Live TV fullscreen launch source: pressing OK on a different or not-yet-ready channel is not a channel-launch', () => {
  const state = createInitialLiveTvState('cat-1', 'chan-1');
  const ready = { ...state, previewStatus: 'ready' };
  const loading = { ...state, previewStatus: 'loading' };

  assert.equal(isChannelPressEnteringFullscreen(ready, 'chan-2'), false);
  assert.equal(isChannelPressEnteringFullscreen(loading, 'chan-1'), false);
  assert.equal(isChannelPressEnteringFullscreen(null, 'chan-1'), false);
});

test('Live TV fullscreen launch source: already fullscreen is not re-detected as a fresh launch', () => {
  const state = createInitialLiveTvState('cat-1', 'chan-1');
  const fullscreen = { ...state, previewStatus: 'ready', fullscreenChannelId: 'chan-1' };

  assert.equal(isChannelPressEnteringFullscreen(fullscreen, 'chan-1'), false);
});

test('Live TV focus restoration only fires on the exact fullscreen-closing transition', () => {
  assert.equal(didFullscreenJustClose('chan-1', null), true);
  assert.equal(didFullscreenJustClose(null, null), false, 'never entered fullscreen: nothing to restore');
  assert.equal(didFullscreenJustClose('chan-1', 'chan-1'), false, 'still fullscreen: not a close transition');
  assert.equal(didFullscreenJustClose(null, 'chan-1'), false, 'opening, not closing');
});

test('Live TV focus restoration only fires on the exact fullscreen-opening transition', () => {
  assert.equal(didFullscreenJustOpen(null, 'chan-1'), true);
  assert.equal(didFullscreenJustOpen(null, null), false, 'still not fullscreen: nothing to focus');
  assert.equal(didFullscreenJustOpen('chan-1', 'chan-1'), false, 'still fullscreen: not an open transition');
  assert.equal(didFullscreenJustOpen('chan-1', null), false, 'closing, not opening');
});

test('Live TV Back ownership: hardware Back closes fullscreen first, never combined with leaving the screen', () => {
  const state = createInitialLiveTvState('cat-1', 'chan-1');
  const fullscreen = { ...state, previewStatus: 'ready', fullscreenChannelId: 'chan-1' };

  // Mirrors LiveTvScreen's BackHandler: fullscreenChannelId present means Back
  // must only close the player, and must never also replace the route.
  const afterBack = closeLiveFullscreen(fullscreen);
  assert.equal(afterBack.fullscreenChannelId, null);
  assert.equal(afterBack.selectedChannelId, 'chan-1', 'selection is preserved so focus has a target to restore to');
});

test('Live TV Back action: fullscreen open always closes fullscreen, regardless of restoration flag', () => {
  assert.equal(decideLiveTvBackAction('chan-1', false), 'close-fullscreen');
  assert.equal(decideLiveTvBackAction('chan-1', true), 'close-fullscreen');
});

test('Live TV Back action: a stray Back during the focus-restoration window is swallowed, not routed to Content Hub', () => {
  assert.equal(decideLiveTvBackAction(null, true), 'swallow');
});

test('Live TV Back action: once restoration has settled, Back leaves Live TV normally', () => {
  assert.equal(decideLiveTvBackAction(null, false), 'leave-screen');
});
