import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  decideLiveSearchOverlayBack,
  resetLiveSearchBackDiagnostics,
} from '../src/features/live/liveTvSearchSession.ts';
import {
  LIVE_EPG_FOCUS_DEBOUNCE_MS,
  LIVE_EPG_WINDOW_RADIUS,
  selectVisibleEpgWindow,
  shouldIssueFocusedEpgRequest,
} from '../src/features/live/liveTvChannelEpg.ts';
import {
  getLiveTvWorkload,
  patchLiveTvWorkload,
  resetLiveTvWorkloadForTests,
  shouldDeferBackgroundLiveWork,
  shouldPauseLiveSearchIndexing,
  shouldSuspendLiveListEpg,
} from '../src/features/live/liveTvWorkload.ts';
import {
  LIVE_SEARCH_BUILD_CONCURRENCY,
  liveSearchIndexPendingCategories,
  shouldStartInteractiveLiveSearchCrawl,
  waitWhileLiveSearchIndexPaused,
} from '../src/features/search/liveSearchCatalogPolicy.ts';
import {
  createSearchInputActivationGate,
  shouldAcceptSearchInputActivation,
} from '../src/features/search/searchInputActivation.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => readFileSync(join(root, relativePath), 'utf8').replace(/\r\n/g, '\n');

const catalog = read('src/features/search/liveSearchSqliteCatalog.ts');
const searchRepo = read('src/features/search/repositories/liveSearchRepository.ts');
const liveModel = read('src/features/live/useLiveTvScreenModel.ts');
const liveScreen = read('src/features/live/LiveTvScreen.tsx');
const searchInput = read('src/features/search/SearchInput.tsx');
const overlay = read('src/features/search/SearchOverlay.tsx');
const player = read('src/features/playback/NovaStreamPlayer.tsx');

function channels(count, prefix = 'ch') {
  return Array.from({ length: count }, (_, index) => ({ id: `${prefix}-${index}` }));
}

test('search index concurrency stays at 1 on low-end devices', () => {
  assert.equal(LIVE_SEARCH_BUILD_CONCURRENCY, 1);
  assert.equal(shouldStartInteractiveLiveSearchCrawl(), false);
  assert.match(catalog, /LIVE_SEARCH_BUILD_CONCURRENCY/);
  assert.doesNotMatch(catalog, /Promise\.all\(\s*batch\.map/);
  assert.match(searchRepo, /scheduleLiveSearchCatalogIdleBuild/);
  assert.doesNotMatch(searchRepo, /void ensureLiveSearchSqliteCatalog/);
});

test('search index build can pause, resume, and cancel', async () => {
  let paused = true;
  let cancelled = false;
  const events = [];

  const waiter = waitWhileLiveSearchIndexPaused({
    isPaused: () => paused,
    isCancelled: () => cancelled,
    sleep: async () => {
      paused = false;
    },
    onPaused: () => events.push('paused'),
    onResumed: () => events.push('resumed'),
  });

  assert.equal(await waiter, 'ready');
  assert.deepEqual(events, ['paused', 'resumed']);

  cancelled = true;
  const cancelledState = await waitWhileLiveSearchIndexPaused({
    isPaused: () => true,
    isCancelled: () => true,
    sleep: async () => {},
  });
  assert.equal(cancelledState, 'cancelled');
  assert.equal(liveSearchIndexPendingCategories(12, 908), 896);
  assert.match(catalog, /build-paused/);
  assert.match(catalog, /build-resumed/);
  assert.match(catalog, /build-cancelled/);
  assert.match(catalog, /logLiveSearchCatalog\('batch'/);
  assert.match(catalog, /logLiveSearchCatalog\('completed'/);
  assert.match(catalog, /cancelLiveSearchCatalogBuild/);
});

test('search overlay, IME, surf, and fullscreen pause indexing', () => {
  resetLiveTvWorkloadForTests();
  patchLiveTvWorkload({ activeScreen: 'live' });
  assert.equal(shouldPauseLiveSearchIndexing(), false);

  patchLiveTvWorkload({ searchOverlayVisible: true });
  assert.equal(shouldPauseLiveSearchIndexing(), true);

  resetLiveTvWorkloadForTests();
  patchLiveTvWorkload({ activeScreen: 'live', searchImeActive: true });
  assert.equal(shouldPauseLiveSearchIndexing(), true);

  resetLiveTvWorkloadForTests();
  patchLiveTvWorkload({ activeScreen: 'live', fullscreenActive: true });
  assert.equal(shouldPauseLiveSearchIndexing(), true);

  resetLiveTvWorkloadForTests();
  patchLiveTvWorkload({ activeScreen: 'live', surfTransitionInFlight: true });
  assert.equal(shouldPauseLiveSearchIndexing(), true);
  assert.equal(shouldDeferBackgroundLiveWork(), true);
  resetLiveTvWorkloadForTests();
});

test('EPG prefetch is a visible window, not the whole category', () => {
  const list = channels(125);
  const window = selectVisibleEpgWindow(list, 'ch-10', LIVE_EPG_WINDOW_RADIUS);
  assert.equal(window.length, 7);
  assert.equal(window[0].id, 'ch-7');
  assert.equal(window[6].id, 'ch-13');
  assert.ok(window.length < list.length);
  assert.match(liveModel, /visible-window-current-program/);
  assert.match(liveModel, /selectVisibleEpgWindow/);
  assert.doesNotMatch(liveModel, /clearLiveTvEpgCache\(\)/);
});

test('focused EPG is debounced, deduped, and cache-aware', () => {
  assert.equal(LIVE_EPG_FOCUS_DEBOUNCE_MS >= 200, true);
  assert.equal(
    shouldIssueFocusedEpgRequest({
      channelId: 'espn',
      nowMs: 1000,
      inFlight: false,
      cached: false,
      suspended: false,
    }),
    'issue',
  );
  assert.equal(
    shouldIssueFocusedEpgRequest({
      channelId: 'espn',
      lastIssuedChannelId: 'espn',
      lastIssuedAtMs: 900,
      nowMs: 1000,
      inFlight: false,
      cached: false,
      suspended: false,
    }),
    'debounce',
  );
  assert.equal(
    shouldIssueFocusedEpgRequest({
      channelId: 'espn',
      nowMs: 2000,
      inFlight: true,
      cached: false,
      suspended: false,
    }),
    'deduped',
  );
  assert.equal(
    shouldIssueFocusedEpgRequest({
      channelId: 'espn',
      nowMs: 2000,
      inFlight: false,
      cached: true,
      suspended: false,
    }),
    'cache-hit',
  );
  assert.equal(
    shouldIssueFocusedEpgRequest({
      channelId: 'espn',
      nowMs: 2000,
      inFlight: false,
      cached: false,
      suspended: true,
    }),
    'suspended',
  );
  assert.match(liveModel, /LIVE_EPG_FOCUS_DEBOUNCE_MS/);
  assert.match(liveModel, /shouldIssueFocusedEpgRequest/);
});

test('search overlay and fullscreen surf suspend list-wide EPG', () => {
  resetLiveTvWorkloadForTests();
  patchLiveTvWorkload({ searchOverlayVisible: true });
  assert.equal(shouldSuspendLiveListEpg(), true);

  resetLiveTvWorkloadForTests();
  patchLiveTvWorkload({ fullscreenActive: true, surfTransitionInFlight: true });
  assert.equal(shouldSuspendLiveListEpg(), true);
  assert.match(liveScreen, /cancelLiveTvEpgWork\('surf-priority'\)/);
  assert.match(liveScreen, /surfTransitionInFlight: true/);
  resetLiveTvWorkloadForTests();
});

test('Search input activation is deduped for one DPAD\/Enter press', () => {
  const gate = createSearchInputActivationGate(400);
  assert.equal(gate.tryArm(1000), 'armed');
  assert.equal(gate.tryArm(1010), 'duplicate-suppressed');
  assert.equal(gate.tryArm(1410), 'armed');
  assert.equal(shouldAcceptSearchInputActivation(1000, 1100), false);
  assert.match(searchInput, /search_input_activate_duplicate_suppressed/);
  assert.match(overlay, /search_input_ime_armed_duplicate_suppressed/);
});

test('Live Search BACK is deterministic: IME then overlay then toolbar once', () => {
  resetLiveSearchBackDiagnostics();
  assert.equal(
    decideLiveSearchOverlayBack({
      keyboardActive: true,
      overlayVisible: true,
      nowMs: 1000,
      lastConsumedAtMs: null,
      suppressOverlayCloseUntilMs: null,
    }).action,
    'dismiss-ime',
  );
  assert.equal(
    decideLiveSearchOverlayBack({
      keyboardActive: false,
      overlayVisible: true,
      nowMs: 1400,
      lastConsumedAtMs: 1000,
      suppressOverlayCloseUntilMs: null,
    }).action,
    'close-overlay',
  );
  assert.match(liveScreen, /if \(!searchOpenRef\.current\)/);
  assert.match(liveScreen, /reason: 'restore-after-search-close'/);
  assert.match(overlay, /preferSearchFocusRef\.current && !focusConfirmedRef\.current/);
});

test('surf transition has priority over indexing and EPG', () => {
  resetLiveTvWorkloadForTests();
  const snapshot = patchLiveTvWorkload({
    activeScreen: 'live',
    fullscreenActive: true,
    surfTransitionInFlight: true,
  });
  assert.equal(shouldPauseLiveSearchIndexing(snapshot), true);
  assert.equal(shouldSuspendLiveListEpg(snapshot), true);
  assert.equal(shouldDeferBackgroundLiveWork(snapshot), true);
  assert.match(liveScreen, /reason: 'surf-start'/);
  assert.match(liveScreen, /reason: 'surf-complete'/);
  resetLiveTvWorkloadForTests();
});

test('player instance logs distinguish remounts from source-effect callbacks', () => {
  assert.match(player, /reason: isNewGeneration \? 'new-generation' : 'source-effect'/);
  assert.match(player, /event: 'player instance'/);
  assert.match(player, /event: 'player status'/);
});

test('workload diagnostics expose the required Fire TV fields', () => {
  resetLiveTvWorkloadForTests();
  const snapshot = getLiveTvWorkload();
  for (const key of [
    'activeScreen',
    'fullscreenActive',
    'searchOverlayVisible',
    'searchIndexBuildActive',
    'searchIndexPendingCategories',
    'epgRequestsInFlight',
    'epgRequestsCancelled',
    'surfTransitionInFlight',
  ]) {
    assert.ok(key in snapshot);
  }
  assert.match(liveScreen, /\[NovaCast Live Workload\]|logLiveTvWorkload|patchLiveTvWorkload/);
  assert.match(catalog, /retainedJsItemCount/);
  resetLiveTvWorkloadForTests();
});
