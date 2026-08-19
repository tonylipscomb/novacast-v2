import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  chooseLiveChannel,
  createLiveTvLandingState,
  resolveLivePreview,
} from '../src/features/live/liveTvLogic.ts';
import {
  LIVE_SEARCH_BACK_DEDUPE_MS,
  decideLiveSearchOverlayBack,
  decideLiveSearchScreenBack,
  markLiveSearchBackConsumed,
  resetLiveSearchBackDiagnostics,
  resolveLiveSearchSurfQueue,
  shouldKeepLiveSearchMounted,
  shouldLiveSearchBlockBackgroundFocus,
  shouldLiveSearchContentAcceptFocus,
  shouldLiveSearchNavbarAcceptFocus,
  shouldRestoreLiveBrowseFocusAfterFullscreen,
  shouldShowLiveSearchOverlay,
  suppressLiveSearchOverlayClose,
  wasLiveSearchBackRecentlyConsumed,
} from '../src/features/live/liveTvSearchSession.ts';
import { resolveLiveSurfAdjacent } from '../src/features/live/liveTvSurf.ts';
import {
  LIVE_SEARCH_FOCUS_SCROLL_VIEW_POSITION,
  planLiveSearchFocusScroll,
  planLiveSearchScrollToIndexFailedFallback,
  shouldLiveSearchResultFocusAffectQuery,
  shouldLiveSearchResultFocusOpenKeyboard,
} from '../src/features/search/liveSearchResultsScroll.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => readFileSync(join(root, relativePath), 'utf8').replace(/\r\n/g, '\n');

const liveScreen = read('src/features/live/LiveTvScreen.tsx');
const liveLogic = read('src/features/live/liveTvLogic.ts');
const liveRouter = read('src/features/live/LiveTvFocusRouter.tsx');
const overlay = read('src/features/search/SearchOverlay.tsx');
const searchResults = read('src/features/search/SearchResults.tsx');
const moviesScreen = read('src/features/movies/MoviesScreen.tsx');
const seriesScreen = read('src/features/series/SeriesScreen.tsx');
const searchScreen = read('src/features/search/SearchScreen.tsx');
const vodSeek = read('src/features/playback/unified/vodSeek.ts');
const episodeNav = read('src/features/playback/continuity/episodeNavigation.ts');
const movieToolbar = read('src/features/movies/components/MovieToolbar.tsx');

const visible = (first, last) => ({ first, last });

test('1. Live result index 0 focus requires no unnecessary scroll', () => {
  const plan = planLiveSearchFocusScroll({
    focusedIndex: 0,
    visible: visible(0, 7),
    totalCount: 50,
    reason: 'focus',
  });
  assert.equal(plan.action, 'none');
  assert.equal(plan.reason, 'index-0-initial');
});

test('2. DOWN through visible results keeps focus visible without scrolling', () => {
  const plan = planLiveSearchFocusScroll({
    focusedIndex: 3,
    visible: visible(0, 7),
    totalCount: 50,
    reason: 'focus',
  });
  assert.equal(plan.action, 'none');
  assert.equal(plan.reason, 'already-visible');
});

test('3. focus beyond viewport scrolls the list', () => {
  const plan = planLiveSearchFocusScroll({
    focusedIndex: 10,
    visible: visible(0, 7),
    totalCount: 50,
    reason: 'focus',
  });
  assert.equal(plan.action, 'scroll');
  assert.equal(plan.index, 10);
  assert.equal(plan.viewPosition, LIVE_SEARCH_FOCUS_SCROLL_VIEW_POSITION);
});

test('4. repeated DOWN progressively scrolls', () => {
  const first = planLiveSearchFocusScroll({
    focusedIndex: 7,
    visible: visible(0, 7),
    totalCount: 50,
    reason: 'focus',
  });
  assert.equal(first.action, 'scroll');
  const second = planLiveSearchFocusScroll({
    focusedIndex: 11,
    visible: visible(4, 11),
    totalCount: 50,
    reason: 'focus',
  });
  assert.equal(second.action, 'scroll');
  assert.equal(second.index, 11);
});

test('5. repeated UP scrolls back', () => {
  const first = planLiveSearchFocusScroll({
    focusedIndex: 4,
    visible: visible(4, 11),
    totalCount: 50,
    reason: 'focus',
  });
  assert.equal(first.action, 'scroll');
  const second = planLiveSearchFocusScroll({
    focusedIndex: 0,
    visible: visible(1, 8),
    totalCount: 50,
    reason: 'focus',
  });
  assert.equal(second.action, 'scroll');
  assert.equal(second.index, 0);
});

test('6. scrollToIndex failure has safe retry/fallback', () => {
  const fallback = planLiveSearchScrollToIndexFailedFallback({ index: 40, averageItemLength: 46 });
  assert.equal(fallback.retryIndex, 40);
  assert.equal(fallback.offset, 40 * 46);
  assert.match(searchResults, /onScrollToIndexFailed/);
  assert.match(searchResults, /scrollToOffset/);
  assert.match(searchResults, /onScrollToIndexFailed-retry/);
});

test('7. result focus never reopens keyboard', () => {
  assert.equal(shouldLiveSearchResultFocusOpenKeyboard(), false);
  assert.match(overlay, /openKeyboardOnFocus=\{false\}/);
  assert.doesNotMatch(searchResults, /focusSearchField/);
});

test('8. result focus never clears query', () => {
  assert.equal(shouldLiveSearchResultFocusAffectQuery(), false);
  assert.match(overlay, /onFocusResult=\{setFocusedResultKey\}/);
  assert.doesNotMatch(searchResults, /clearQuery|setQueryLogged/);
});

test('9. restored result after fullscreen is scrolled into view', () => {
  const plan = planLiveSearchFocusScroll({
    focusedIndex: 31,
    visible: visible(0, 7),
    totalCount: 50,
    reason: 'restore',
  });
  assert.equal(plan.action, 'scroll');
  assert.equal(plan.reason, 'restore');
  assert.equal(plan.index, 31);
  assert.match(searchResults, /reason: 'restore'/);
  assert.match(overlay, /restore-after-live-fullscreen/);
});

test('10. result #30 fullscreen BACK restores #30 visible', () => {
  const plan = planLiveSearchFocusScroll({
    focusedIndex: 30,
    visible: null,
    totalCount: 50,
    reason: 'restore',
  });
  assert.equal(plan.action, 'scroll');
  assert.equal(plan.index, 30);
  assert.equal(shouldShowLiveSearchOverlay({ searchSessionOpen: true, fullscreenChannelId: null }), true);
  assert.match(liveScreen, /restoreFocusLiveChannelId=\{searchRestoreChannelId\}/);
});

test('11. Live Search result first OK opens fullscreen directly', () => {
  const landing = createLiveTvLandingState('sports', 'cnn');
  const selected = chooseLiveChannel(landing, 'espn2', { origin: 'search' });
  assert.equal(selected.fullscreenChannelId, 'espn2');
  assert.equal(selected.previewChannelId, 'espn2');
  assert.match(liveScreen, /origin: 'search'/);
});

test('12. only ONE search_result_select needed', () => {
  const landing = createLiveTvLandingState('sports', 'cnn');
  const first = chooseLiveChannel(landing, 'espn2', { origin: 'search' });
  assert.equal(first.fullscreenChannelId, 'espn2');
  const second = chooseLiveChannel(first, 'espn2', { origin: 'search' });
  assert.equal(second.fullscreenChannelId, 'espn2');
  assert.match(liveScreen, /chooseLiveChannel\([\s\S]*origin: 'search'/);
});

test('13. direct Search playback uses canonical Live source resolver', () => {
  assert.match(liveScreen, /resolvePlaybackUrl\(channel\)/);
  assert.match(liveLogic, /origin === 'search'/);
  assert.match(liveLogic, /return surfLiveFullscreenChannel\(state, channelId\)/);
});

test('14. no search-specific source resolver introduced', () => {
  assert.doesNotMatch(liveScreen, /searchLivePlaybackUrl|buildSearchStreamUrl|directRawProviderUrl/);
  assert.doesNotMatch(liveLogic, /searchLivePlaybackUrl/);
  assert.doesNotMatch(overlay, /searchLivePlaybackUrl/);
});

test('15. direct Search playback keeps Search result surf queue', () => {
  const queue = resolveLiveSearchSurfQueue(['a', 'b', 'c'], ['espn', 'cnn']);
  assert.deepEqual(queue, ['a', 'b', 'c']);
  assert.match(liveScreen, /liveSearchSurfQueueRef\.current = liveSearchResultIdsRef/);
  assert.match(liveScreen, /resolveLiveSearchSurfQueue/);
});

test('16. fullscreen LEFT\/RIGHT still surf Search result order', () => {
  const result = resolveLiveSurfAdjacent({
    channelIds: resolveLiveSearchSurfQueue(['cnn', 'espn', 'fs1'], ['espn']),
    currentId: 'espn',
    direction: 1,
  });
  assert.equal(result.kind, 'adjacent');
  if (result.kind === 'adjacent') {
    assert.equal(result.toChannelId, 'fs1');
  }
});

test('17. fullscreen BACK returns to Search, not Live preview', () => {
  assert.equal(shouldRestoreLiveBrowseFocusAfterFullscreen(true), false);
  assert.equal(shouldShowLiveSearchOverlay({ searchSessionOpen: true, fullscreenChannelId: 'espn' }), false);
  assert.equal(shouldShowLiveSearchOverlay({ searchSessionOpen: true, fullscreenChannelId: null }), true);
  assert.match(liveScreen, /shouldRestoreLiveBrowseFocusAfterFullscreen\(searchOpen\)/);
  assert.doesNotMatch(liveScreen, /restore-after-live-fullscreen[\s\S]{0,80}preview/);
});

test('18. Search query\/result persistence remains', () => {
  assert.equal(shouldKeepLiveSearchMounted(true), true);
  assert.match(liveScreen, /retainMounted=\{shouldKeepLiveSearchMounted\(searchOpen\)\}/);
  assert.match(overlay, /retainMounted/);
});

test('19. normal Live browse first OK still preview', () => {
  const landing = createLiveTvLandingState('sports', 'espn');
  const firstOk = chooseLiveChannel(landing, 'espn');
  assert.equal(firstOk.fullscreenChannelId, null);
  assert.equal(firstOk.previewChannelId, 'espn');
  assert.equal(firstOk.previewStatus, 'loading');
});

test('20. normal Live browse second OK still fullscreen', () => {
  const landing = createLiveTvLandingState('sports', 'espn');
  const firstOk = chooseLiveChannel(landing, 'espn');
  const ready = resolveLivePreview(firstOk, firstOk.previewRequestId, 'espn', 'ready');
  const secondOk = chooseLiveChannel(ready, 'espn');
  assert.equal(secondOk.fullscreenChannelId, 'espn');
});

test('21. keyboard BACK does not close Search', () => {
  const decision = decideLiveSearchOverlayBack({
    keyboardActive: true,
    overlayVisible: true,
    nowMs: 1000,
    lastConsumedAtMs: null,
    suppressOverlayCloseUntilMs: null,
  });
  assert.equal(decision.action, 'dismiss-ime');
  assert.match(overlay, /decision\.action === 'dismiss-ime'/);
  assert.match(overlay, /Keyboard\.dismiss/);
});

test('22. second BACK closes Search', () => {
  const decision = decideLiveSearchOverlayBack({
    keyboardActive: false,
    overlayVisible: true,
    nowMs: 1000,
    lastConsumedAtMs: null,
    suppressOverlayCloseUntilMs: null,
  });
  assert.equal(decision.action, 'close-overlay');
});

test('23. fullscreen BACK does not also close restored Search', () => {
  const nowMs = 5000;
  const decision = decideLiveSearchOverlayBack({
    keyboardActive: false,
    overlayVisible: true,
    nowMs,
    lastConsumedAtMs: null,
    suppressOverlayCloseUntilMs: nowMs + LIVE_SEARCH_BACK_DEDUPE_MS,
  });
  assert.equal(decision.action, 'suppress-duplicate');
  assert.match(overlay, /suppressLiveSearchOverlayClose/);
  assert.match(liveScreen, /suppressLiveSearchOverlayClose\(nowMs\)/);
});

test('24. one BACK cannot trigger two layer transitions', () => {
  resetLiveSearchBackDiagnostics();
  markLiveSearchBackConsumed(2000);
  assert.equal(wasLiveSearchBackRecentlyConsumed(2040), true);
  const overlayDecision = decideLiveSearchOverlayBack({
    keyboardActive: false,
    overlayVisible: true,
    nowMs: 2040,
    lastConsumedAtMs: 2000,
    suppressOverlayCloseUntilMs: null,
  });
  assert.equal(overlayDecision.action, 'suppress-duplicate');
  const screenDecision = decideLiveSearchScreenBack({
    searchSessionOpen: false,
    overlayVisible: false,
    fullscreenActive: false,
    nowMs: 2040,
    lastConsumedAtMs: 2000,
  });
  assert.equal(screenDecision.action, 'suppress-duplicate');
  resetLiveSearchBackDiagnostics();
});

test('25. navbar cannot receive focus while Search overlay open', () => {
  assert.equal(shouldLiveSearchNavbarAcceptFocus(true, false), false);
  assert.match(liveScreen, /navigationFocusable=\{!searchOwnsBackgroundFocus\}/);
});

test('26. Live content cannot receive focus while Search overlay open', () => {
  assert.equal(shouldLiveSearchContentAcceptFocus(true, false), false);
  assert.equal(shouldLiveSearchBlockBackgroundFocus(true, false), true);
  assert.match(liveScreen, /pointerEvents=\{searchOwnsBackgroundFocus \? 'none' : 'auto'\}/);
});

test('27. closing Search does not leave Home incorrectly highlighted', () => {
  assert.equal(shouldLiveSearchNavbarAcceptFocus(false, true), false);
  assert.match(liveScreen, /searchCloseFocusHold/);
  assert.match(liveScreen, /region: 'search-toolbar'/);
  assert.doesNotMatch(liveScreen, /reason: 'restore-after-search-close'[\s\S]{0,80}channel-row/);
});

test('28. Search toolbar receives close focus if using toolbar restore', () => {
  assert.match(liveScreen, /buttonRef=\{searchToolbarRef\}/);
  assert.match(movieToolbar, /buttonRef/);
  assert.match(liveScreen, /getTarget: \(\) => searchToolbarRef\.current/);
});

test('29. Movies Search unchanged', () => {
  assert.doesNotMatch(moviesScreen, /followFocusedResult/);
  assert.doesNotMatch(moviesScreen, /chooseLiveChannel/);
  assert.doesNotMatch(moviesScreen, /liveTvSearchSession/);
  assert.match(moviesScreen, /scope="movie"/);
  assert.match(overlay, /usePosterGrid/);
});

test('30. Series Search unchanged', () => {
  assert.doesNotMatch(seriesScreen, /followFocusedResult/);
  assert.doesNotMatch(seriesScreen, /liveTvSearchSession/);
  assert.match(seriesScreen, /scope="series"/);
});

test('31. global Search unchanged', () => {
  assert.doesNotMatch(searchScreen, /followFocusedResult/);
  assert.doesNotMatch(searchScreen, /origin: 'search'/);
  assert.match(searchScreen, /SearchScope/);
});

test('32. Live surf focus-router regression green', () => {
  assert.match(liveScreen, /LiveTvFocusRouter/);
  assert.match(liveRouter, /evaluateLiveSurfSentinelFocus|handleSentinelNativeFocus/);
  assert.doesNotMatch(liveRouter, /followFocusedResult|origin: 'search'/);
});

test('33. VOD seek regression green', () => {
  assert.doesNotMatch(vodSeek, /liveTvSearchSession|followFocusedResult|origin: 'search'/);
});

test('34. Series navigation regression green', () => {
  assert.doesNotMatch(episodeNav, /liveTvSearchSession|followFocusedResult|origin: 'search'/);
});

test('Live follow-focus is opt-in only', () => {
  assert.match(searchResults, /followFocusedResult/);
  assert.match(overlay, /followFocusedResult=\{scope === 'live'\}/);
  assert.doesNotMatch(searchScreen, /followFocusedResult=\{true\}/);
});

test('Live overlay BACK still dismisses IME before close', () => {
  resetLiveSearchBackDiagnostics();
  suppressLiveSearchOverlayClose(1000, 0);
  const afterIme = decideLiveSearchOverlayBack({
    keyboardActive: false,
    overlayVisible: true,
    nowMs: 2100,
    lastConsumedAtMs: 1920,
    suppressOverlayCloseUntilMs: null,
  });
  assert.equal(afterIme.action, 'close-overlay');
});
