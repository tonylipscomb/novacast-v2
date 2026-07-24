import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolvePosterRestorationId,
  shouldPreferNavigationFocus,
} from '../src/features/media-browser/posterGridFocusPolicy.ts';
import {
  getPendingTvFocusRegionKeysForTests,
  getTvFocusDiagnosticsForTests,
  requestTvFocus,
  resetTvFocusDiagnosticsForTests,
} from '../src/features/navigation/tvFocusDiagnostics.ts';
import { isTvPerfHudEnabled, getTvPerfSnapshot } from '../src/features/perf/tvPerfStore.ts';

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
    globalThis.requestAnimationFrame = original;
    globalThis.cancelAnimationFrame = originalCancel;
  };
}

test('navbar preferred focus cannot override poster restoration while restoring', () => {
  assert.equal(
    shouldPreferNavigationFocus({
      playbackUiActive: false,
      detailOverlayVisible: false,
      searchBlocksBrowse: false,
      restoringBrowseFocus: true,
      gridEmpty: false,
    }),
    false,
  );
});

test('poster restoration prefers focused id over selected id', () => {
  assert.equal(
    resolvePosterRestorationId({
      focusedId: 'poster-a',
      selectedId: 'poster-b',
      availableIds: ['poster-a', 'poster-b'],
    }),
    'poster-a',
  );
});

test('performance HUD is disabled without EXPO_PUBLIC_TV_PERF_HUD', () => {
  assert.equal(process.env.EXPO_PUBLIC_TV_PERF_HUD === '1', false);
  assert.equal(isTvPerfHudEnabled(), false);
  assert.equal(getTvPerfSnapshot().screen, '—');
});

test('superseded programmatic focus records cancel reason', async () => {
  const restoreRaf = installImmediateAnimationFrame();
  resetTvFocusDiagnosticsForTests();

  try {
    let firstFocused = false;
    requestTvFocus({
      screen: 'movies',
      source: 'MoviesScreen',
      region: 'poster-grid',
      itemId: 'a',
      reason: 'restore-after-detail',
      maxFrames: 4,
      getTarget: () => null,
    });

    requestTvFocus({
      screen: 'movies',
      source: 'MoviesScreen',
      region: 'poster-grid',
      itemId: 'b',
      reason: 'restore-after-playback',
      maxFrames: 1,
      getTarget: () => ({
        focus: () => {
          firstFocused = true;
        },
      }),
    });

    await new Promise((resolve) => setTimeout(resolve, 20));

    const records = getTvFocusDiagnosticsForTests();
    const cancelled = records.find((entry) => entry.itemId === 'a');
    const executed = records.find((entry) => entry.itemId === 'b');
    assert.ok(cancelled);
    assert.equal(cancelled.status, 'cancelled');
    assert.equal(cancelled.cancelReason, 'superseded');
    assert.ok(executed);
    assert.equal(executed.status, 'executed');
    assert.equal(typeof executed.generation, 'number');
    assert.equal(firstFocused, true);
    assert.deepEqual(getPendingTvFocusRegionKeysForTests(), []);
  } finally {
    resetTvFocusDiagnosticsForTests();
    restoreRaf();
  }
});

test('timeout focus requests are labeled timeout not ignored', async () => {
  const restoreRaf = installImmediateAnimationFrame();
  resetTvFocusDiagnosticsForTests();

  try {
    requestTvFocus({
      screen: 'live',
      source: 'LiveTvScreen',
      region: 'channels',
      itemId: 'missing',
      reason: 'category-to-channel',
      maxFrames: 1,
      getTarget: () => null,
    });

    await new Promise((resolve) => setTimeout(resolve, 30));
    const record = getTvFocusDiagnosticsForTests().at(-1);
    assert.ok(record);
    assert.equal(record.status, 'timeout');
    assert.equal(record.cancelReason, 'timeout');
  } finally {
    resetTvFocusDiagnosticsForTests();
    restoreRaf();
  }
});
