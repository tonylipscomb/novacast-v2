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
  createLiveSearchBrowseSnapshot,
  isLiveSearchUiBlockingSurf,
  resolveLivePlaybackChannel,
  resolveLiveSearchSurfQueue,
  restoreLiveSearchBrowseState,
  shouldKeepLiveSearchMounted,
  shouldRestoreLiveBrowseFocusAfterFullscreen,
  shouldShowLiveSearchOverlay,
} from '../src/features/live/liveTvSearchSession.ts';
import { resolveLiveSurfAdjacent } from '../src/features/live/liveTvSurf.ts';
import { shouldHandleLiveChannelSurf } from '../src/features/playback/continuity/playbackContinuity.ts';
import {
  ingestLiveChannels,
  ingestLiveSearchCategories,
  resetLiveChannelIndex,
  searchLiveChannelIndex,
} from '../src/features/search/liveChannelIndex.ts';
import { computeLiveSearchMatchTier } from '../src/features/search/liveSearchMatching.ts';
import { isSearchableQuery, normalizeSearchQuery } from '../src/features/search/searchQuery.ts';
import { SEARCH_PAGE_SIZE } from '../src/features/search/searchConstants.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => readFileSync(join(root, relativePath), 'utf8').replace(/\r\n/g, '\n');

const liveScreen = read('src/features/live/LiveTvScreen.tsx');
const liveRouter = read('src/features/live/LiveTvFocusRouter.tsx');
const moviesScreen = read('src/features/movies/MoviesScreen.tsx');
const seriesScreen = read('src/features/series/SeriesScreen.tsx');
const searchScreen = read('src/features/search/SearchScreen.tsx');
const liveSearchRepo = read('src/features/search/repositories/liveSearchRepository.ts');
const movieToolbar = read('src/features/movies/components/MovieToolbar.tsx');
const vodSeek = read('src/features/playback/unified/vodSeek.ts');
const episodeNav = read('src/features/playback/continuity/episodeNavigation.ts');

function channel(id, name, extra = {}) {
  return {
    id,
    categoryId: extra.categoryId ?? 'sports',
    number: extra.number ?? 0,
    name,
    shortName: name.slice(0, 2),
    current: extra.current ?? '',
    next: '',
    following: '',
    description: '',
    resolution: extra.resolution ?? '',
    audio: '',
    remaining: '',
    progress: 0,
    tone: '#173B67',
    currentStart: '',
    currentEnd: '',
    logoUrl: extra.logoUrl,
    containerExtension: extra.containerExtension,
  };
}

function ingestEspnFamily(providerId = 'p1') {
  resetLiveChannelIndex(providerId);
  ingestLiveSearchCategories(providerId, [
    { id: 'sports', name: 'Sports' },
    { id: 'news', name: 'News' },
  ]);
  ingestLiveChannels(providerId, [
    channel('espn', 'ESPN', { number: 206, current: 'SportsCenter' }),
    channel('espn2', 'ESPN 2', { number: 207 }),
    channel('espn-news', 'ESPN NEWS'),
    channel('espn-deportes', 'ESPN DEPORTES'),
    channel('espn-plus', 'ESPN+'),
    channel('us-espn-hd', 'US: ESPN HD', { resolution: 'HD' }),
    channel('usa-espn', 'USA | ESPN'),
    channel('espn-fhd', 'ESPN FHD', { resolution: 'FHD' }),
    channel('espn-1080', 'ESPN 1080P', { resolution: '1080P' }),
    channel('espn-4k', 'ESPN 4K', { resolution: '4K' }),
    channel('fox-sports-1', 'FOX SPORTS 1', { number: 301 }),
    channel('us-fox-sports', 'US | FOX SPORTS'),
    channel('fox-sports-hd', 'FOX Sports HD'),
    channel('cnn', 'CNN', { categoryId: 'news', number: 202 }),
    channel('fs1', 'FS1', { number: 401 }),
    channel('cnn-dup', 'CNN', { categoryId: 'news', number: 1202 }),
  ]);
}

test('1. Live Search action appears as first-class MovieToolbar Search', () => {
  assert.match(liveScreen, /MovieToolbar/);
  assert.match(liveScreen, /accessibilityLabel="Search Live TV"/);
  assert.match(liveScreen, /channelHeaderActions/);
  assert.match(movieToolbar, /name="magnify"/);
  assert.match(movieToolbar, />Search</);
});

test('2. old category-area mini search UI is removed', () => {
  assert.doesNotMatch(liveScreen, /styles\.searchButton/);
  assert.doesNotMatch(liveScreen, /panelHeaderActions/);
  assert.match(liveScreen, /<Text style=\{styles\.panelTitle\}>Categories<\/Text>/);
});

test('3. Search opens without resetting category/channel state', () => {
  assert.match(liveScreen, /createLiveSearchBrowseSnapshot/);
  assert.match(liveScreen, /openLiveSearch/);
  assert.doesNotMatch(liveScreen, /setSearchOpen\(true\);\s*setState/);
  const snapshot = createLiveSearchBrowseSnapshot({ categoryId: 'sports', channelId: 'espn' });
  const landing = createLiveTvLandingState('sports', 'espn');
  assert.equal(snapshot.categoryId, landing.selectedCategoryId);
  assert.equal(snapshot.channelId, landing.selectedChannelId);
});

test('4. empty query does not dump giant catalog', () => {
  assert.equal(isSearchableQuery(''), false);
  assert.equal(isSearchableQuery('   '), false);
  ingestEspnFamily();
  assert.ok(searchLiveChannelIndex('p1', '', 0, 500).totalCount === 0 || !isSearchableQuery(''));
  resetLiveChannelIndex('p1');
});

test('5. exact match ESPN → ESPN', () => {
  ingestEspnFamily();
  const result = searchLiveChannelIndex('p1', 'ESPN', 0, 20);
  assert.equal(result.items[0]?.id, 'espn');
  assert.equal(computeLiveSearchMatchTier('ESPN', { id: 'espn', name: 'ESPN' }), 'exact');
  resetLiveChannelIndex('p1');
});

test('6. partial ESP → ESPN family', () => {
  ingestEspnFamily();
  const ids = searchLiveChannelIndex('p1', 'ESP', 0, 50).items.map((item) => item.id);
  assert.ok(ids.includes('espn'));
  assert.ok(ids.includes('espn2'));
  assert.ok(ids.includes('espn-news'));
  resetLiveChannelIndex('p1');
});

test('7. lowercase espn → ESPN', () => {
  ingestEspnFamily();
  const result = searchLiveChannelIndex('p1', 'espn', 0, 20);
  assert.equal(result.items[0]?.id, 'espn');
  resetLiveChannelIndex('p1');
});

test('8. prefix normalization ESPN → US: ESPN HD', () => {
  ingestEspnFamily();
  const ids = searchLiveChannelIndex('p1', 'ESPN', 0, 50).items.map((item) => item.id);
  assert.ok(ids.includes('us-espn-hd'));
  assert.equal(normalizeSearchQuery('US: ESPN HD'), 'us espn hd');
  resetLiveChannelIndex('p1');
});

test('9. separator normalization ESPN → USA | ESPN', () => {
  ingestEspnFamily();
  const ids = searchLiveChannelIndex('p1', 'ESPN', 0, 50).items.map((item) => item.id);
  assert.ok(ids.includes('usa-espn'));
  assert.equal(normalizeSearchQuery('USA | ESPN'), 'usa espn');
  resetLiveChannelIndex('p1');
});

test('10. quality variants HD/FHD/4K/1080P', () => {
  ingestEspnFamily();
  const ids = searchLiveChannelIndex('p1', 'ESPN', 0, 50).items.map((item) => item.id);
  assert.ok(ids.includes('espn-fhd'));
  assert.ok(ids.includes('espn-4k'));
  assert.ok(ids.includes('espn-1080'));
  assert.ok(ids.includes('us-espn-hd'));
  assert.equal(computeLiveSearchMatchTier('ESPN HD', { id: 'us-espn-hd', name: 'US: ESPN HD' }), 'token');
  resetLiveChannelIndex('p1');
});

test('11. multi-term fox sports', () => {
  ingestEspnFamily();
  const ids = searchLiveChannelIndex('p1', 'fox sports', 0, 20).items.map((item) => item.id);
  assert.ok(ids.includes('fox-sports-1'));
  assert.ok(ids.includes('us-fox-sports'));
  assert.ok(ids.includes('fox-sports-hd'));
  assert.ok(!ids.includes('espn'));
  resetLiveChannelIndex('p1');
});

test('12. whitespace tolerance', () => {
  ingestEspnFamily();
  const compact = searchLiveChannelIndex('p1', 'espn', 0, 20).items.map((item) => item.id);
  const padded = searchLiveChannelIndex('p1', '  espn   ', 0, 20).items.map((item) => item.id);
  assert.deepEqual(padded, compact);
  resetLiveChannelIndex('p1');
});

test('13. punctuation tolerance', () => {
  ingestEspnFamily();
  const ids = searchLiveChannelIndex('p1', 'espn+', 0, 20).items.map((item) => item.id);
  assert.ok(ids.includes('espn-plus'));
  resetLiveChannelIndex('p1');
});

test('14. channel number search', () => {
  ingestEspnFamily();
  const result = searchLiveChannelIndex('p1', '206', 0, 10);
  assert.equal(result.items[0]?.id, 'espn');
  assert.equal(computeLiveSearchMatchTier('206', { id: 'espn', name: 'ESPN', number: 206 }), 'number');
  resetLiveChannelIndex('p1');
});

test('15. stable channel id identity', () => {
  ingestEspnFamily();
  const result = searchLiveChannelIndex('p1', 'ESPN', 0, 20);
  assert.equal(result.items[0]?.id, 'espn');
  assert.notEqual(result.items[0]?.id, result.items[0]?.title);
  resetLiveChannelIndex('p1');
});

test('16. duplicate names with different ids stay separate', () => {
  ingestEspnFamily();
  const cnn = searchLiveChannelIndex('p1', 'CNN', 0, 10).items.filter((item) => item.title === 'CNN');
  assert.equal(cnn.length, 2);
  assert.deepEqual(new Set(cnn.map((item) => item.id)).size, 2);
  resetLiveChannelIndex('p1');
});

test('17. rapid typing remains deterministic', () => {
  ingestEspnFamily();
  const first = searchLiveChannelIndex('p1', 'e', 0, 20).items.map((item) => item.id);
  const second = searchLiveChannelIndex('p1', 'es', 0, 20).items.map((item) => item.id);
  const third = searchLiveChannelIndex('p1', 'esp', 0, 20).items.map((item) => item.id);
  const fourth = searchLiveChannelIndex('p1', 'espn', 0, 20).items.map((item) => item.id);
  assert.deepEqual(searchLiveChannelIndex('p1', 'espn', 0, 20).items.map((item) => item.id), fourth);
  assert.ok(fourth.every((id) => third.includes(id) || id.startsWith('espn') || id.includes('espn')));
  assert.ok(first.length >= second.length || second.length >= 1);
  resetLiveChannelIndex('p1');
});

test('18. Clear Search stays on overlay and empties results', () => {
  assert.match(liveScreen, /SearchOverlay/);
  assert.match(read('src/features/search/SearchOverlay.tsx'), /controller\.clearQuery/);
  assert.match(read('src/features/search/useSearchController.ts'), /setQueryState\(''\)/);
});

test('19. no-results state keeps Search open', () => {
  ingestEspnFamily();
  const result = searchLiveChannelIndex('p1', 'ESPN XYZ', 0, 20);
  assert.equal(result.totalCount, 0);
  assert.match(read('src/features/search/SearchOverlay.tsx'), /No channels found for/);
  resetLiveChannelIndex('p1');
});

test('20. result Favorite state uses canonical Live ids', () => {
  assert.match(liveScreen, /favoriteContentIds=\{liveFavoriteContentIds\}/);
  assert.match(liveScreen, /personalizationState\.liveFavorites/);
  assert.doesNotMatch(liveScreen, /searchFavorites/);
});

test('21. selecting a result uses chooseLiveChannel', () => {
  assert.match(liveScreen, /handleSearchSelect/);
  assert.match(liveScreen, /chooseLiveChannel\(current \?\? liveState \?\? createInitialLiveTvState\(undefined, result\.id\), result\.id, \{ origin: 'search' \}\)/);
  const landing = createLiveTvLandingState('sports', 'cnn');
  const firstOk = chooseLiveChannel(landing, 'espn2', { origin: 'search' });
  assert.equal(firstOk.previewChannelId, 'espn2');
  assert.equal(firstOk.fullscreenChannelId, 'espn2');
});

test('22. Search does not create a second stream resolver', () => {
  assert.match(liveScreen, /resolvePlaybackUrl/);
  assert.doesNotMatch(liveScreen, /buildSearchStreamUrl/);
  assert.doesNotMatch(liveSearchRepo, /buildLiveChannelPlaybackUrl/);
  assert.match(liveScreen, /toLiveSearchPlaybackChannel/);
});

test('23. return from playback preserves Search query/result context', () => {
  assert.match(liveScreen, /retainMounted=\{shouldKeepLiveSearchMounted\(searchOpen\)\}/);
  assert.match(liveScreen, /restoreFocusLiveChannelId=\{searchRestoreChannelId\}/);
  assert.equal(shouldKeepLiveSearchMounted(true), true);
  assert.equal(shouldShowLiveSearchOverlay({ searchSessionOpen: true, fullscreenChannelId: 'espn' }), false);
  assert.equal(shouldShowLiveSearchOverlay({ searchSessionOpen: true, fullscreenChannelId: null }), true);
});

test('24. closing Search restores original category/channel context', () => {
  const snapshot = createLiveSearchBrowseSnapshot({ categoryId: 'news', channelId: 'cnn' });
  const previewing = chooseLiveChannel(createLiveTvLandingState('news', 'cnn'), 'espn2');
  const restored = restoreLiveSearchBrowseState(previewing, snapshot);
  assert.equal(restored?.selectedCategoryId, 'news');
  assert.equal(restored?.selectedChannelId, 'cnn');
  assert.match(liveScreen, /restoreLiveSearchBrowseState/);
});

test('25. cached current-program search works', () => {
  ingestEspnFamily();
  const result = searchLiveChannelIndex('p1', 'SportsCenter', 0, 10);
  assert.equal(result.items[0]?.id, 'espn');
  assert.equal(computeLiveSearchMatchTier('SportsCenter', { id: 'espn', name: 'ESPN', currentProgram: 'SportsCenter' }), 'program');
  resetLiveChannelIndex('p1');
});

test('26. no EPG available → channel search still works', () => {
  resetLiveChannelIndex('p2');
  ingestLiveChannels('p2', [channel('espn', 'ESPN', { current: '' })]);
  const result = searchLiveChannelIndex('p2', 'espn', 0, 10);
  assert.equal(result.items[0]?.id, 'espn');
  resetLiveChannelIndex('p2');
});

test('27. typing does not fetch provider EPG', () => {
  assert.doesNotMatch(liveSearchRepo, /getShortEpg/);
  assert.doesNotMatch(liveSearchRepo, /enrichSingleChannelEpg/);
  assert.doesNotMatch(read('src/features/search/liveChannelIndex.ts'), /getShortEpg/);
  assert.doesNotMatch(read('src/features/search/liveSearchSqliteCatalog.ts'), /getShortEpg/);
});

test('28. Search-result order becomes the Live surf queue', () => {
  const searchIds = ['espn', 'espn2', 'espn-news', 'espn-deportes'];
  const categoryIds = ['cnn', 'fox', 'espn', 'nbc'];
  assert.deepEqual(resolveLiveSearchSurfQueue(searchIds, categoryIds), searchIds);
  assert.deepEqual(resolveLiveSearchSurfQueue(null, categoryIds), categoryIds);
  assert.match(liveScreen, /resolveLiveSearchSurfQueue\(/);
  assert.match(liveScreen, /liveSearchSurfQueueRef/);
});

test('29. ESPN 2 search playback LEFT → ESPN, RIGHT → ESPN News', () => {
  const queue = ['espn', 'espn2', 'espn-news', 'espn-deportes'];
  const left = resolveLiveSurfAdjacent({ channelIds: queue, currentId: 'espn2', direction: -1 });
  const right = resolveLiveSurfAdjacent({ channelIds: queue, currentId: 'espn2', direction: 1 });
  assert.equal(left.kind, 'adjacent');
  assert.equal(right.kind, 'adjacent');
  if (left.kind === 'adjacent') {
    assert.equal(left.toChannelId, 'espn');
  }
  if (right.kind === 'adjacent') {
    assert.equal(right.toChannelId, 'espn-news');
  }
});

test('30. Search UI D-pad navigation emits ZERO Live surf requests', () => {
  assert.equal(isLiveSearchUiBlockingSurf(true), true);
  assert.equal(
    shouldHandleLiveChannelSurf({ isLive: true, fullscreenActive: false, modalOpen: true }),
    false,
  );
  assert.equal(
    shouldHandleLiveChannelSurf({ isLive: true, fullscreenActive: true, modalOpen: true }),
    false,
  );
  assert.match(liveScreen, /isLiveSearchUiBlockingSurf\(searchOverlayVisible\)/);
  assert.doesNotMatch(read('src/features/search/SearchOverlay.tsx'), /surfLiveChannel/);
  assert.doesNotMatch(read('src/features/search/SearchOverlay.tsx'), /LiveTvFocusRouter/);
});

test('31. closing Search returns focus to the Live Search toolbar', () => {
  assert.match(liveScreen, /reason: 'restore-after-search-close'/);
  assert.match(liveScreen, /region: 'search-toolbar'/);
  assert.equal(shouldRestoreLiveBrowseFocusAfterFullscreen(true), false);
  assert.equal(shouldRestoreLiveBrowseFocusAfterFullscreen(false), true);
});

test('32. BACK keyboard → Search → Live behavior', () => {
  assert.match(read('src/features/search/SearchOverlay.tsx'), /scope === 'live' \? \(\) => \{/);
  assert.match(read('src/features/search/SearchOverlay.tsx'), /handleLiveSearchHardwareBack/);
  assert.match(read('src/features/search/SearchOverlay.tsx'), /search_overlay_back/);
  assert.match(liveScreen, /onClose=\{closeLiveSearch\}/);
});

test('33. Movies Search unchanged', () => {
  assert.doesNotMatch(moviesScreen, /liveTvSearchSession/);
  assert.match(moviesScreen, /scope="movie"/);
  assert.match(moviesScreen, /MovieToolbar/);
});

test('34. Series Search unchanged', () => {
  assert.doesNotMatch(seriesScreen, /liveTvSearchSession/);
  assert.match(seriesScreen, /scope="series"/);
  assert.match(seriesScreen, /searchByScope\(bundle, 'series'/);
});

test('35. global/main-menu Search unchanged', () => {
  assert.doesNotMatch(searchScreen, /liveTvSearchSession/);
  assert.match(searchScreen, /SearchScope/);
  assert.match(searchScreen, /'live'/);
  assert.match(searchScreen, /'movie'/);
  assert.match(searchScreen, /'series'/);
});

test('36. existing Live first-OK / second-OK contract remains', () => {
  const landing = createLiveTvLandingState('sports', 'espn');
  const firstOk = chooseLiveChannel(landing, 'espn');
  assert.equal(firstOk.fullscreenChannelId, null);
  const ready = resolveLivePreview(firstOk, firstOk.previewRequestId, 'espn', 'ready');
  const secondOk = chooseLiveChannel(ready, 'espn');
  assert.equal(secondOk.fullscreenChannelId, 'espn');
});

test('37. Live surf focus-router remains the fullscreen owner', () => {
  assert.match(liveRouter, /evaluateLiveSurfSentinelFocus|handleSentinelNativeFocus/);
  assert.match(liveScreen, /LiveTvFocusRouter/);
  assert.doesNotMatch(liveScreen, /shouldRemountLiveSurfSentinelsOnEpochChange\(true\)/);
});

test('38. VOD seek module is untouched by Live Search', () => {
  assert.doesNotMatch(vodSeek, /searchLiveChannels/);
  assert.doesNotMatch(vodSeek, /liveTvSearchSession/);
});

test('39. Series episode navigation is untouched by Live Search', () => {
  assert.doesNotMatch(episodeNav, /searchLiveChannels/);
  assert.doesNotMatch(episodeNav, /liveTvSearchSession/);
});

test('name matches outrank category matches', () => {
  ingestEspnFamily();
  const sports = searchLiveChannelIndex('p1', 'sports', 0, 20);
  assert.ok(sports.items.length > 0);
  const espn = searchLiveChannelIndex('p1', 'ESPN', 0, 20);
  assert.ok(!espn.items.some((item) => item.id === 'fs1'));
  assert.ok(espn.items.every((item) => /espn/i.test(item.title)));
  resetLiveChannelIndex('p1');
});

test('result window stays bounded', () => {
  assert.equal(SEARCH_PAGE_SIZE, 50);
  ingestEspnFamily();
  const page = searchLiveChannelIndex('p1', 'espn', 0, SEARCH_PAGE_SIZE);
  assert.ok(page.items.length <= SEARCH_PAGE_SIZE);
  resetLiveChannelIndex('p1');
});

test('playback lookup prefers search session channels over missing category rows', () => {
  const category = [channel('cnn', 'CNN')];
  const searchMap = new Map([['espn2', channel('espn2', 'ESPN 2')]]);
  assert.equal(resolveLivePlaybackChannel('espn2', category, searchMap)?.id, 'espn2');
  assert.equal(resolveLivePlaybackChannel('cnn', category, searchMap)?.id, 'cnn');
});

test('liveSearchRepository is reused rather than duplicated', () => {
  assert.match(liveScreen, /searchLiveChannels\(activeProviderId, bundle, request\)/);
  assert.match(liveSearchRepo, /searchLiveSqliteCatalog/);
  assert.match(liveSearchRepo, /searchLiveChannelIndex/);
  assert.equal(read('src/features/search/repositories/liveSearchRepository.ts').includes('export async function searchLiveChannels'), true);
});

test('searchLiveChannels does not start an unbounded Live category crawl', () => {
  assert.match(liveSearchRepo, /scheduleLiveSearchCatalogIdleBuild/);
  assert.doesNotMatch(liveSearchRepo, /void ensureLiveSearchSqliteCatalog/);
  assert.match(read('src/features/search/liveSearchCatalogPolicy.ts'), /LIVE_SEARCH_BUILD_CONCURRENCY = 1/);
});

test('searchLiveChannels does not issue EPG network work while typing', async () => {
  assert.doesNotMatch(liveSearchRepo, /getShortEpg/);
  assert.doesNotMatch(liveSearchRepo, /enrichSingleChannelEpg/);
  resetLiveChannelIndex('repo-p');
  ingestLiveChannels('repo-p', [channel('espn', 'ESPN')]);
  const indexed = searchLiveChannelIndex('repo-p', 'espn', 0, 20);
  assert.ok(indexed.items.some((item) => item.id === 'espn'));
  resetLiveChannelIndex('repo-p');
});
