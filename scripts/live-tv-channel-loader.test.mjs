import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  LIVE_TV_CHANNEL_LIST_REVEAL_MS,
  LIVE_TV_CHANNEL_LIST_REVEAL_START_OPACITY,
  resolveLiveChannelPanelLoaderKind,
  shouldShowLiveChannelPanelLoader,
} from '../src/features/live/liveTvChannelPanelLoader.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => readFileSync(join(root, relativePath), 'utf8').replace(/\r\n/g, '\n');

const liveScreen = read('src/features/live/LiveTvScreen.tsx');
const liveModel = read('src/features/live/useLiveTvScreenModel.ts');
const loader = read('src/features/live/LiveTvPlanetLoader.tsx');
const epg = read('src/features/live/liveTvChannelEpg.ts');
const workload = read('src/features/live/liveTvWorkload.ts');
const surf = read('src/features/live/liveTvSurf.ts');

test('initial pending channel list shows the loader', () => {
  assert.equal(
    shouldShowLiveChannelPanelLoader({
      channelListPending: true,
      loadStatus: 'loading',
      channelCount: 0,
      searchOverlayVisible: false,
      fullscreenActive: false,
    }),
    true,
  );
  assert.equal(resolveLiveChannelPanelLoaderKind({ channelListPending: true, channelCount: 0, hadReadyChannelList: false }), 'initial');
});

test('category switch pending shows the loader even if previous channels remain in memory', () => {
  assert.equal(
    shouldShowLiveChannelPanelLoader({
      channelListPending: true,
      loadStatus: 'ready',
      channelCount: 125,
      searchOverlayVisible: false,
      fullscreenActive: false,
    }),
    true,
  );
  assert.equal(resolveLiveChannelPanelLoaderKind({ channelListPending: true, channelCount: 125, hadReadyChannelList: true }), 'category');
});

test('empty category does not keep the loader', () => {
  assert.equal(
    shouldShowLiveChannelPanelLoader({
      channelListPending: false,
      loadStatus: 'empty',
      channelCount: 0,
      searchOverlayVisible: false,
      fullscreenActive: false,
    }),
    false,
  );
  assert.equal(
    shouldShowLiveChannelPanelLoader({
      channelListPending: true,
      loadStatus: 'empty',
      channelCount: 0,
      searchOverlayVisible: false,
      fullscreenActive: false,
    }),
    false,
  );
});

test('EPG-only updates do not keep the loader', () => {
  assert.equal(
    shouldShowLiveChannelPanelLoader({
      channelListPending: false,
      loadStatus: 'ready',
      channelCount: 125,
      searchOverlayVisible: false,
      fullscreenActive: false,
    }),
    false,
  );
});

test('Search overlay and fullscreen hide the channel loader', () => {
  assert.equal(
    shouldShowLiveChannelPanelLoader({
      channelListPending: true,
      loadStatus: 'loading',
      channelCount: 0,
      searchOverlayVisible: true,
      fullscreenActive: false,
    }),
    false,
  );
  assert.equal(
    shouldShowLiveChannelPanelLoader({
      channelListPending: true,
      loadStatus: 'ready',
      channelCount: 40,
      searchOverlayVisible: false,
      fullscreenActive: true,
    }),
    false,
  );
});

test('Live TV screen uses the planet loader only in the channel panel', () => {
  assert.match(liveScreen, /showChannelPanelLoader/);
  assert.match(liveScreen, /<LiveTvPlanetLoader label="Loading channels…" \/>/);
  assert.match(liveScreen, /LiveTvChannelListReveal/);
  assert.match(liveModel, /channelListPending/);
  assert.match(liveModel, /setChannelListPending\(true\)/);
  assert.match(liveModel, /setChannelListPending\(false\)/);
});

test('channel list uses a 120ms native fade from 0.35 when replacing the loader', () => {
  assert.equal(LIVE_TV_CHANNEL_LIST_REVEAL_MS, 120);
  assert.equal(LIVE_TV_CHANNEL_LIST_REVEAL_START_OPACITY, 0.35);
  assert.match(loader, /useNativeDriver: true/);
  assert.match(liveScreen, /LiveTvChannelListReveal revealKey=/);
  assert.doesNotMatch(loader, /setInterval/);
});

test('animation is native-driver only and has no JS interval', () => {
  assert.match(loader, /useNativeDriver: true/);
  assert.doesNotMatch(loader, /setInterval/);
  assert.doesNotMatch(loader, /requestAnimationFrame/);
  assert.doesNotMatch(loader, /reanimated/);
  assert.match(loader, /getThemeMarkSource/);
  assert.match(loader, /focusable=\{false\}/);
  assert.match(loader, /pointerEvents="none"/);
});

test('loader polish does not change EPG, workload, or surf architecture', () => {
  assert.match(epg, /selectVisibleEpgWindow/);
  assert.match(workload, /shouldPauseLiveSearchIndexing/);
  assert.match(surf, /resolveLiveSurfAdjacent/);
  assert.doesNotMatch(epg, /LiveTvPlanetLoader/);
  assert.doesNotMatch(workload, /LiveTvPlanetLoader/);
  assert.doesNotMatch(surf, /LiveTvPlanetLoader/);
});
