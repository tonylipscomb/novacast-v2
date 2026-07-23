import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildProgressKey,
  computeProgressPercent,
  computeResumePositionMs,
  PROGRESS_SAVE_INTERVAL_MS,
  shouldMarkComplete,
  shouldSaveProgress,
  WATCHED_THRESHOLD_PERCENT,
} from '../src/features/playback/unified/playbackProgressStore.ts';
import {
  derivePlaybackActivityType,
  didUnifiedPlaybackJustClose,
  isUnifiedPlaybackActive,
  resolveFocusLaunchSource,
  resolveUnifiedPlaybackNotification,
  sanitizePlaybackErrorMessage,
  resolveUnifiedSeekPosition,
  resolveUnifiedSeekDelta,
  shouldAssignUnifiedPlayerInitialFocus,
  shouldHandleUnifiedSeekRemoteEvent,
  shouldRevealUnifiedControlsFromKeyEvent,
  resolveUnifiedControlFocusMove,
  isUnifiedControlActivateKey,
} from '../src/features/playback/unified/unifiedPlayerLogic.ts';
import {
  finishUnifiedPlaybackClose,
  launchUnifiedPlayback,
  resetUnifiedPlayerForTests,
} from '../src/features/playback/unified/unifiedPlayerStore.ts';
import {
  registerPlaybackActivity,
  resetPlaybackActivityForTests,
  unregisterPlaybackActivity,
} from '../src/features/playback/playbackActivityStore.ts';
import {
  clearProviderCatalogSyncForTests,
  getProviderCatalogSyncTestState,
  scheduleProviderCatalogSync,
} from '../src/features/providers/providerCatalogSync.ts';
import {
  clearCatalogSyncResumeForTests,
  shouldYieldCatalogSync,
} from '../src/features/providers/catalogSyncPlayback.ts';
import { clearMovieLibraryCacheForTests, recordWatch } from '../src/features/movies/smart/movieLibraryStore.ts';
import { decideMoviesBackAction } from '../src/features/movies/moviesPlaybackLogic.ts';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createDeferred() {
  let resolve;
  const promise = new Promise((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function createMockSyncInput(providerId = 'demo-provider') {
  let movieFetchStarted = false;
  const movieGate = createDeferred();

  const movies = {
    async getCategories() {
      return [{ id: 'movie-1', renderKey: 'movie-1', name: 'Action', count: 1 }];
    },
    async listCategoryMovies(categoryId) {
      movieFetchStarted = true;
      await movieGate.promise;
      return [{ id: `${categoryId}-item`, categoryId, title: 'Movie', posterStyleKey: 'ember', genres: ['Action'] }];
    },
    async getCategoryCount() {
      return 1;
    },
  };

  const series = {
    async getCategories() {
      return [{ id: 'series-1', renderKey: 'series-1', name: 'Drama', count: 1 }];
    },
    async getSeries() {
      return [];
    },
  };

  const live = {
    async getCategories() {
      return [{ id: 'live-1', renderKey: 'live-1', name: 'US', count: 2, icon: 'flag-outline' }];
    },
  };

  return {
    input: { providerId, movies, series, live },
    controls: {
      get movieFetchStarted() {
        return movieFetchStarted;
      },
      releaseMovies() {
        movieGate.resolve();
      },
    },
  };
}

test.beforeEach(() => {
  resetPlaybackActivityForTests();
  resetUnifiedPlayerForTests();
  clearProviderCatalogSyncForTests();
  clearCatalogSyncResumeForTests();
  clearMovieLibraryCacheForTests();
});

test('movie playback uses shared player exports', () => {
  assert.equal(typeof launchUnifiedPlayback, 'function');
  assert.equal(typeof derivePlaybackActivityType, 'function');
  assert.equal(typeof isUnifiedPlaybackActive, 'function');
  assert.equal(typeof buildProgressKey, 'function');
});

test('progress saves and resumes for movie keys', async () => {
  const providerId = 'provider-a';
  const itemId = 'movie-42';
  const key = buildProgressKey(providerId, 'movie', itemId);

  await recordWatch(providerId, {
    movieId: itemId,
    title: 'Test Movie',
    progressPercent: 42,
    durationMs: 100_000,
  });

  const resumeMs = computeResumePositionMs(42, 100_000);
  assert.equal(resumeMs, 42_000);

  assert.equal(shouldMarkComplete(89_000, 100_000), false);
  assert.equal(shouldMarkComplete(90_000, 100_000), true);
  assert.equal(computeProgressPercent(45_000, 100_000), 45);
  assert.equal(WATCHED_THRESHOLD_PERCENT, 90);
  assert.deepEqual(key, { providerId, mediaType: 'movie', itemId });
});

test('progress save interval is periodic, not per-frame', () => {
  assert.equal(PROGRESS_SAVE_INTERVAL_MS, 5000);
  assert.equal(shouldSaveProgress(0, 1000), false);
  assert.equal(shouldSaveProgress(0, 5000), true);
  assert.equal(shouldSaveProgress(4000, 8999), false);
  assert.equal(shouldSaveProgress(4000, 9000), true);
});

test('movie playback activity pauses heavy catalog sync', async () => {
  launchUnifiedPlayback({
    id: 'movie-1',
    mediaType: 'movie',
    title: 'Movie',
    streamUrl: 'https://example.test/movie.mp4',
    isLive: false,
    providerId: 'demo-provider',
  });

  assert.equal(isUnifiedPlaybackActive('loading', {
    id: 'movie-1',
    mediaType: 'movie',
    title: 'Movie',
    streamUrl: 'https://example.test/movie.mp4',
    isLive: false,
  }), true);
  assert.equal(derivePlaybackActivityType({
    id: 'movie-1',
    mediaType: 'movie',
    title: 'Movie',
    streamUrl: 'https://example.test/movie.mp4',
    isLive: false,
  }), 'movie');

  registerPlaybackActivity('movie');
  assert.equal(shouldYieldCatalogSync(), true);

  const mock = createMockSyncInput();
  const task = scheduleProviderCatalogSync(mock.input);
  await sleep(100);
  assert.equal(mock.controls.movieFetchStarted, false);
  assert.deepEqual(getProviderCatalogSyncTestState().inFlightProviderIds, ['demo-provider']);

  unregisterPlaybackActivity();
  await sleep(3500);
  mock.controls.releaseMovies();
  await task;
});

test('back and focus launch source tracking stays unit-testable', () => {
  launchUnifiedPlayback(
    {
      id: 'movie-1',
      mediaType: 'movie',
      title: 'Movie',
      streamUrl: 'https://example.test/movie.mp4',
      isLive: false,
    },
    { launchSource: 'play' },
  );

  assert.equal(resolveFocusLaunchSource('play'), 'play');
  assert.equal(resolveFocusLaunchSource('poster'), 'poster');
  assert.equal(resolveFocusLaunchSource('episode'), null);

  assert.equal(didUnifiedPlaybackJustClose(true, false), true);
  assert.equal(decideMoviesBackAction(true, false), 'close-playback');
  assert.equal(decideMoviesBackAction(false, true), 'swallow');

  finishUnifiedPlaybackClose();
});

test('d-pad and select keys reveal hidden unified player controls', () => {
  assert.equal(shouldRevealUnifiedControlsFromKeyEvent('ArrowLeft'), true);
  assert.equal(shouldRevealUnifiedControlsFromKeyEvent('ArrowRight'), true);
  assert.equal(shouldRevealUnifiedControlsFromKeyEvent('ArrowUp'), true);
  assert.equal(shouldRevealUnifiedControlsFromKeyEvent('ArrowDown'), true);
  assert.equal(shouldRevealUnifiedControlsFromKeyEvent('Enter'), true);
  assert.equal(shouldRevealUnifiedControlsFromKeyEvent('', 22), true);
  assert.equal(shouldRevealUnifiedControlsFromKeyEvent('', 19), true);
  assert.equal(shouldRevealUnifiedControlsFromKeyEvent('', 20), true);
  assert.equal(shouldRevealUnifiedControlsFromKeyEvent('', 23), true);
  assert.equal(shouldRevealUnifiedControlsFromKeyEvent('Backspace'), false);
});

test('hidden overlay select toggles playback and d-pad reveals controls', async () => {
  const { resolveUnifiedOverlayKeyAction } = await import(
    '../src/features/playback/unified/unifiedPlayerLogic.ts'
  );

  assert.equal(resolveUnifiedOverlayKeyAction(false, false, 'Enter'), 'toggle-play');
  assert.equal(resolveUnifiedOverlayKeyAction(false, false, 'Select'), 'toggle-play');
  assert.equal(resolveUnifiedOverlayKeyAction(false, false, '', 23), 'toggle-play');
  assert.equal(resolveUnifiedOverlayKeyAction(false, false, '', 85), 'toggle-play');
  assert.equal(resolveUnifiedOverlayKeyAction(false, false, '', 22), 'reveal');
  assert.equal(resolveUnifiedOverlayKeyAction(true, false, 'Enter'), null);
  assert.equal(resolveUnifiedOverlayKeyAction(false, true, 'Enter'), null);
});

test('unified player controls move focus and activate with keyboard', () => {
  assert.equal(resolveUnifiedControlFocusMove('back', { key: 'ArrowDown' }), 'seek');
  assert.equal(resolveUnifiedControlFocusMove('seek', { key: 'ArrowDown' }), 'rewind');
  assert.equal(resolveUnifiedControlFocusMove('play', { key: 'ArrowLeft' }), 'rewind');
  assert.equal(resolveUnifiedControlFocusMove('play', { key: 'ArrowRight' }), 'forward');
  assert.equal(resolveUnifiedControlFocusMove('play', { key: 'ArrowUp' }), 'seek');
  assert.equal(resolveUnifiedControlFocusMove('play', { key: 'ArrowDown' }), 'seek');
  assert.equal(resolveUnifiedControlFocusMove('seek', { key: 'ArrowUp' }), 'play');
  assert.equal(resolveUnifiedControlFocusMove('seek', { key: 'ArrowLeft' }), null);
  assert.equal(resolveUnifiedControlFocusMove('seek', { key: 'ArrowRight' }), null);
  assert.equal(resolveUnifiedControlFocusMove('seek', { code: 'ArrowUp' }), 'play');
  assert.equal(resolveUnifiedControlFocusMove('back', { key: 'ArrowDown' }), 'seek');
  assert.equal(isUnifiedControlActivateKey('Enter'), true);
  assert.equal(isUnifiedControlActivateKey('', 66), true);
  assert.equal(isUnifiedControlActivateKey('', 23), true);
  assert.equal(isUnifiedControlActivateKey('', 85), true);
});

test('seek remote event helper only accepts visible focused seek input', () => {
  assert.equal(
    shouldHandleUnifiedSeekRemoteEvent({
      visible: true,
      focusedControl: 'seek',
      durationMs: 120_000,
      eventType: 'ArrowLeft',
      eventKeyAction: 0,
    }),
    true,
  );
  assert.equal(resolveUnifiedSeekDelta('ArrowLeft'), -10_000);
  assert.equal(resolveUnifiedSeekDelta('ArrowRight'), 10_000);
  assert.equal(resolveUnifiedSeekDelta('left'), -10_000);
  assert.equal(resolveUnifiedSeekDelta('right'), 10_000);
  assert.equal(resolveUnifiedSeekDelta('DPAD_LEFT'), -10_000);
  assert.equal(resolveUnifiedSeekDelta('DPAD_RIGHT'), 10_000);
  assert.equal(
    shouldHandleUnifiedSeekRemoteEvent({
      visible: true,
      focusedControl: 'seek',
      durationMs: 120_000,
      eventType: 'right',
      eventKeyAction: 2,
    }),
    true,
  );
  assert.equal(
    shouldHandleUnifiedSeekRemoteEvent({
      visible: true,
      focusedControl: 'seek',
      durationMs: 120_000,
      eventType: 'ArrowLeft',
      eventKeyAction: 1,
    }),
    false,
  );
  assert.equal(
    shouldHandleUnifiedSeekRemoteEvent({
      visible: true,
      focusedControl: 'play',
      durationMs: 120_000,
      eventType: 'ArrowLeft',
      eventKeyAction: 0,
    }),
    false,
  );
  assert.equal(
    shouldHandleUnifiedSeekRemoteEvent({
      visible: false,
      focusedControl: 'seek',
      durationMs: 120_000,
      eventType: 'ArrowLeft',
      eventKeyAction: 0,
    }),
    false,
  );
});

test('initial player focus is assigned once per opening', () => {
  assert.equal(
    shouldAssignUnifiedPlayerInitialFocus({
      visible: true,
      initialFocusAssigned: false,
      focusedControl: null,
    }),
    true,
  );
  assert.equal(
    shouldAssignUnifiedPlayerInitialFocus({
      visible: true,
      initialFocusAssigned: true,
      focusedControl: null,
    }),
    false,
  );
  assert.equal(
    shouldAssignUnifiedPlayerInitialFocus({
      visible: true,
      initialFocusAssigned: false,
      focusedControl: 'seek',
    }),
    false,
  );
  assert.equal(
    shouldAssignUnifiedPlayerInitialFocus({
      visible: false,
      initialFocusAssigned: false,
      focusedControl: null,
    }),
    false,
  );
});

test('seek position helper clamps and rejects invalid durations', () => {
  assert.equal(resolveUnifiedSeekPosition(30_000, 120_000, -10_000), 20_000);
  assert.equal(resolveUnifiedSeekPosition(115_000, 120_000, 10_000), 120_000);
  assert.equal(resolveUnifiedSeekPosition(5_000, 120_000, -10_000), 0);
  assert.equal(resolveUnifiedSeekPosition(5_000, 0, -10_000), null);
  assert.equal(resolveUnifiedSeekPosition(5_000, Number.NaN, -10_000), null);
});

test('unified remote debug flags multi-path duplicate events', async () => {
  const { logUnifiedRemoteEvent, resetUnifiedRemoteDebugForTests, UNIFIED_REMOTE_DEBUG_PREFIX } = await import(
    '../src/features/playback/unified/unifiedRemoteDebug.ts'
  );
  const captured = [];
  const originalInfo = console.info;
  console.info = (prefix, payload) => {
    if (prefix === UNIFIED_REMOTE_DEBUG_PREFIX) {
      captured.push(payload);
    }
    originalInfo(prefix, payload);
  };

  try {
    globalThis.__DEV__ = true;
    resetUnifiedRemoteDebugForTests();
    logUnifiedRemoteEvent({
      source: 'controls-onPress',
      eventType: 'press',
      keyAction: 'down',
      key: 'Enter',
      disposition: 'accepted',
      actionTaken: 'activate-play',
      controlId: 'play',
    });
    logUnifiedRemoteEvent({
      source: 'useTVEventHandler',
      eventType: 'press',
      keyAction: 'down',
      key: 'Enter',
      disposition: 'accepted',
      actionTaken: 'observed-use-tv-event-handler-callback',
      controlId: 'play',
    });
    assert.equal(captured.length, 2);
    assert.equal(captured[1].multiPathDetected, true);
    assert.deepEqual(captured[1].priorSources, ['controls-onPress']);
  } finally {
    console.info = originalInfo;
    resetUnifiedRemoteDebugForTests();
  }
});

test('playback errors are sanitized', () => {
  assert.equal(
    sanitizePlaybackErrorMessage('http://user:pass@provider/stream.m3u8 failed'),
    'Playback unavailable',
  );
});

test('playback notifications only surface player error states', () => {
  assert.equal(resolveUnifiedPlaybackNotification('loading', false), null);
  assert.equal(resolveUnifiedPlaybackNotification('playing', false), null);

  const error = resolveUnifiedPlaybackNotification('error', false);
  assert.equal(error?.title, 'Playback unavailable');
  assert.match(error?.message ?? '', /could not be played/i);
  assert.equal(error?.persistent, false);
  assert.equal(resolveUnifiedPlaybackNotification('error', true)?.persistent, true);
});
