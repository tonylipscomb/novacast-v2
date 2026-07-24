import assert from 'node:assert/strict';
import test from 'node:test';

import { shouldAutoFocusSortControl } from '../src/features/media-browser/posterGridFocusPolicy.ts';
import {
  getPendingTvFocusRegionKeysForTests,
  getTvFocusDiagnosticsForTests,
  requestTvFocus,
  resetTvFocusDiagnosticsForTests,
} from '../src/features/navigation/tvFocusDiagnostics.ts';
import {
  shouldReclaimSearchFromClose,
  shouldRefocusSearchShellOnTextInputBlur,
} from '../src/features/search/searchOverlayFocusPolicy.ts';
import {
  isPassiveNotification,
  shouldRenderNotificationFocusableControls,
} from '../src/features/notifications/notificationFocusLogic.ts';
import {
  getNotificationsSnapshot,
  resetNotificationsForTests,
  showNotification,
} from '../src/features/notifications/notificationStore.ts';
import {
  getMoviesScreenMemory,
  rememberMoviesScreenMemory,
  resetMoviesScreenMemory,
} from '../src/features/movies/moviesScreenMemory.ts';
import {
  getSeriesScreenMemory,
  rememberSeriesScreenMemory,
  resetSeriesScreenMemory,
} from '../src/features/series/seriesScreenMemory.ts';

function installImmediateAnimationFrame() {
  const original = globalThis.requestAnimationFrame;
  const originalCancel = globalThis.cancelAnimationFrame;
  const handles = new Map();
  let nextId = 1;

  globalThis.requestAnimationFrame = (cb) => {
    const id = nextId++;
    const timer = setTimeout(() => {
      handles.delete(id);
      cb(Date.now());
    }, 0);
    handles.set(id, timer);
    return id;
  };

  globalThis.cancelAnimationFrame = (id) => {
    const timer = handles.get(id);
    if (timer) {
      clearTimeout(timer);
      handles.delete(id);
    }
  };

  return () => {
    handles.forEach((timer) => clearTimeout(timer));
    handles.clear();
    if (original) {
      globalThis.requestAnimationFrame = original;
    } else {
      delete globalThis.requestAnimationFrame;
    }
    if (originalCancel) {
      globalThis.cancelAnimationFrame = originalCancel;
    } else {
      delete globalThis.cancelAnimationFrame;
    }
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test.beforeEach(() => {
  resetTvFocusDiagnosticsForTests();
  resetNotificationsForTests();
});

test('passive toast does not render focusable controls', () => {
  assert.equal(shouldRenderNotificationFocusableControls('passive'), false);
  assert.equal(shouldRenderNotificationFocusableControls(undefined), false);
  assert.equal(shouldRenderNotificationFocusableControls('blocking'), true);
});

test('passive toast never calls the focus request utility by defaulting to passive mode', () => {
  showNotification({
    id: 'toast-1',
    type: 'error',
    title: 'Load failed',
    message: 'Try again from the screen Retry control.',
    actionLabel: 'Retry',
    onAction: () => {},
  });

  const [notification] = getNotificationsSnapshot().visible;
  assert.equal(notification.interactionMode, 'passive');
  assert.equal(isPassiveNotification(notification.interactionMode), true);
  assert.equal(shouldRenderNotificationFocusableControls(notification.interactionMode), false);
  assert.equal(getTvFocusDiagnosticsForTests().length, 0);
});

test('pagination completion does not focus Sort', () => {
  assert.equal(
    shouldAutoFocusSortControl({ sortOptionChanged: false, loadingChanged: true }),
    false,
  );
  assert.equal(
    shouldAutoFocusSortControl({ sortOptionChanged: true, loadingChanged: false }),
    true,
  );
});

test('moving from Search to Close does not reclaim Search', () => {
  assert.equal(shouldReclaimSearchFromClose(false), false);
  assert.equal(shouldReclaimSearchFromClose(true), false);
  assert.equal(shouldRefocusSearchShellOnTextInputBlur(), false);
});

test('closing Search produces only one restoration request', async () => {
  const restoreRaf = installImmediateAnimationFrame();
  try {
    const focusCalls = [];
    const target = { focus: () => focusCalls.push('poster') };

    requestTvFocus({
      screen: 'movies',
      source: 'MoviesScreen',
      region: 'poster-grid',
      itemId: 'movie-1',
      reason: 'restore-after-search-close',
      getTarget: () => target,
    });

    await sleep(10);

    const records = getTvFocusDiagnosticsForTests().filter(
      (entry) => entry.reason === 'restore-after-search-close',
    );
    assert.equal(records.length, 1);
    assert.equal(records[0].status, 'executed');
    assert.equal(focusCalls.length, 1);
  } finally {
    restoreRaf();
  }
});

test('an older pending focus request is cancelled when replaced', async () => {
  const restoreRaf = installImmediateAnimationFrame();
  try {
    const focusCalls = [];
    let ready = false;

    requestTvFocus({
      screen: 'movies',
      source: 'MoviesScreen',
      region: 'poster-grid',
      itemId: 'old',
      reason: 'older-pending',
      getTarget: () => (ready ? { focus: () => focusCalls.push('old') } : null),
      maxFrames: 5,
    });

    requestTvFocus({
      screen: 'movies',
      source: 'MoviesScreen',
      region: 'poster-grid',
      itemId: 'new',
      reason: 'replacement',
      getTarget: () => ({ focus: () => focusCalls.push('new') }),
    });

    ready = true;
    await sleep(30);

    const records = getTvFocusDiagnosticsForTests();
    const older = records.find((entry) => entry.reason === 'older-pending');
    const newer = records.find((entry) => entry.reason === 'replacement');
    assert.equal(older?.status, 'cancelled');
    assert.equal(newer?.status, 'executed');
    assert.deepEqual(focusCalls, ['new']);
    assert.equal(getPendingTvFocusRegionKeysForTests().length, 0);
  } finally {
    restoreRaf();
  }
});

test('a request from an inactive screen is ignored', async () => {
  const restoreRaf = installImmediateAnimationFrame();
  try {
    const focusCalls = [];
    requestTvFocus({
      screen: 'movies',
      source: 'MoviesScreen',
      region: 'poster-grid',
      itemId: 'movie-9',
      reason: 'inactive-screen',
      isActive: () => false,
      getTarget: () => ({ focus: () => focusCalls.push('should-not-run') }),
    });

    await sleep(10);

    const [record] = getTvFocusDiagnosticsForTests();
    assert.equal(record.status, 'ignored');
    assert.equal(focusCalls.length, 0);
  } finally {
    restoreRaf();
  }
});

test('Movies and Series focus-memory still persist selected posters', () => {
  resetMoviesScreenMemory();
  resetSeriesScreenMemory();

  rememberMoviesScreenMemory('demo-provider', {
    selectedCategoryId: 'top',
    focusedMovieId: 'movie-42',
    selectedMovieId: 'movie-42',
  });
  rememberSeriesScreenMemory('demo-provider', {
    selectedCategoryId: 'drama',
    focusedSeriesId: 'series-7',
    selectedSeriesId: 'series-7',
    selectedSeasonId: 's1',
  });

  assert.deepEqual(getMoviesScreenMemory('demo-provider'), {
    selectedCategoryId: 'top',
    focusedMovieId: 'movie-42',
    selectedMovieId: 'movie-42',
  });
  assert.deepEqual(getSeriesScreenMemory('demo-provider'), {
    selectedCategoryId: 'drama',
    focusedSeriesId: 'series-7',
    selectedSeriesId: 'series-7',
    selectedSeasonId: 's1',
  });
});
