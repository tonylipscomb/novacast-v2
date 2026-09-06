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
  favoriteSurfQueueIds,
  hydrateFavoriteLiveChannels,
  liveChannelFromFavoriteRecord,
} from '../src/features/live/liveFavoriteHydration.ts';
import { getLiveTvMemory, rememberLiveTvMemory, resetLiveTvMemory } from '../src/features/live/liveTvMemory.ts';
import { resolveLiveSearchSurfQueue } from '../src/features/live/liveTvSearchSession.ts';
import { resolveLiveSurfAdjacent } from '../src/features/live/liveTvSurf.ts';
import {
  isRealProviderLiveCategoryId,
  isSyntheticLiveFavoritesCategoryId,
  LIVE_FAVORITES_PSEUDO_CATEGORY_ID,
  providerLiveCategoriesOnly,
  resolveInitialLiveBrowseCategoryId,
  sanitizePersistedLiveCategoryId,
} from '../src/features/providers/liveCategoryIdSafety.ts';
import { ingestLiveChannels, resetLiveChannelIndex } from '../src/features/search/liveChannelIndex.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => readFileSync(join(root, relativePath), 'utf8').replace(/\r\n/g, '\n');

const liveModel = read('src/features/live/useLiveTvScreenModel.ts');
const liveScreen = read('src/features/live/LiveTvScreen.tsx');
const liveRouter = read('src/features/live/LiveTvFocusRouter.tsx');
const liveMemory = read('src/features/live/liveTvMemory.ts');
const repositories = read('src/features/providers/providerRepositories.ts');
const moviesScreen = read('src/features/movies/MoviesScreen.tsx');
const seriesScreen = read('src/features/series/SeriesScreen.tsx');

function channel(id, name, extra = {}) {
  return {
    id,
    categoryId: extra.categoryId ?? 'news',
    number: extra.number ?? 0,
    name,
    shortName: name.slice(0, 2),
    current: extra.current ?? '',
    next: '',
    following: '',
    description: '',
    resolution: '',
    audio: '',
    remaining: '',
    progress: 0,
    tone: '#173B67',
    currentStart: '',
    currentEnd: '',
    logoUrl: extra.logoUrl,
    containerExtension: extra.containerExtension ?? 'ts',
  };
}

function favoriteRecord(id, title, extra = {}) {
  return {
    providerId: 'p1',
    mediaType: 'live',
    contentId: id,
    title,
    artworkUrl: extra.artworkUrl,
    categoryId: extra.categoryId ?? 'news',
    streamId: id,
    extension: extra.extension ?? 'ts',
    createdAt: 1,
  };
}

test('1. Live category rail contains provider categories only', () => {
  const rail = providerLiveCategoriesOnly([
    { id: 'favorites', name: 'Favorites' },
    { id: '10', name: 'News' },
    { id: '20', name: 'Sports' },
    { id: 'all', name: 'All' },
  ]);
  assert.deepEqual(
    rail.map((item) => item.id),
    ['10', '20'],
  );
  assert.match(liveModel, /providerLiveCategoriesOnly\(baseCategories\)/);
  assert.doesNotMatch(liveModel, /id: 'favorites'/);
  assert.doesNotMatch(liveModel, /name: 'Favorites'/);
});

test('2. legacy Favorites pseudo-category is absent from Live model and screen rail', () => {
  assert.equal(LIVE_FAVORITES_PSEUDO_CATEGORY_ID, 'favorites');
  assert.equal(isSyntheticLiveFavoritesCategoryId('favorites'), true);
  assert.equal(isSyntheticLiveFavoritesCategoryId('favorite'), true);
  assert.equal(isSyntheticLiveFavoritesCategoryId('__favorites__'), true);
  assert.equal(isSyntheticLiveFavoritesCategoryId('my-favorites'), true);
  assert.equal(isSyntheticLiveFavoritesCategoryId('10'), false);
  assert.doesNotMatch(liveModel, /categoriesWithFavorites/);
  assert.doesNotMatch(liveScreen, /id: 'favorites'/);
});

test('3. saved legacy favorites selectedCategoryId falls back safely', () => {
  resetLiveTvMemory('p-fav');
  rememberLiveTvMemory('p-fav', { selectedCategoryId: 'favorites', selectedChannelId: 'cnn' });
  assert.equal(getLiveTvMemory('p-fav').selectedCategoryId, '');
  assert.equal(sanitizePersistedLiveCategoryId('favorites'), '');
  assert.equal(sanitizePersistedLiveCategoryId('10'), '10');
  assert.equal(
    resolveInitialLiveBrowseCategoryId('favorites', [
      { id: '10', name: 'News' },
      { id: '20', name: 'Sports' },
    ]),
    '10',
  );
  assert.equal(
    resolveInitialLiveBrowseCategoryId('20', [
      { id: '10', name: 'News' },
      { id: '20', name: 'Sports' },
    ]),
    '20',
  );
  assert.match(liveMemory, /sanitizeLiveTvMemory/);
  assert.match(liveScreen, /sanitizePersistedLiveCategoryId\(routeCategoryId/);
  resetLiveTvMemory('p-fav');
});

test('4. synthetic favorites id never reaches provider category repository', () => {
  assert.equal(isRealProviderLiveCategoryId('favorites'), false);
  assert.match(liveModel, /if \(!isRealProviderLiveCategoryId\(categoryId\)\)/);
  assert.match(repositories, /if \(isSyntheticLiveCategoryId\(categoryId\)\)/);
  assert.match(repositories, /reason: 'provider-repository-guard'/);
  assert.match(liveModel, /getPublishedLiveChannels\(bundle\.providerId, categoryId,/);
  assert.match(liveModel, /bundle\.live\.getChannels\(categoryId, signal\)/);
  assert.doesNotMatch(liveModel, /bundle\.live\.getChannel\(/);
});

test('5. synthetic favorites id never reaches category EPG\/Guide probing', () => {
  assert.match(repositories, /isSyntheticLiveCategoryId\(categoryId\)/);
  assert.match(repositories, /typeof __DEV__ === 'undefined' \|\| !__DEV__/);
  assert.match(liveModel, /prefetchChannelEpg\(requestId, nextChannels, resolvedCategoryId\)/);
  assert.match(liveModel, /caller: 'useLiveTvScreenModel.prefetchChannelEpg'/);
  assert.doesNotMatch(liveModel, /startGuideEpgProbe/);
  assert.doesNotMatch(liveScreen, /startGuideEpgProbe/);
});

test('6. Favorite Channels hydration is bounded to favorite IDs', () => {
  resetLiveChannelIndex('p1');
  const loaded = [channel('cnn', 'CNN'), channel('fox', 'FOX')];
  const scanned = [];
  const hydrated = hydrateFavoriteLiveChannels({
    favoriteIds: ['espn', 'cnn', 'hbo'],
    loadedChannels: loaded,
    getIndexEntry: (id) => {
      scanned.push(id);
      return undefined;
    },
    favoriteRecords: [favoriteRecord('espn', 'ESPN'), favoriteRecord('hbo', 'HBO')],
  });
  assert.deepEqual(
    hydrated.channels.map((item) => item.id),
    ['espn', 'cnn', 'hbo'],
  );
  assert.deepEqual(scanned, ['espn', 'hbo']);
  assert.equal(hydrated.scannedLoadedCount, 2);
  assert.equal(hydrated.unresolvedIds.length, 0);
  resetLiveChannelIndex('p1');
});

test('7. Favorite Channels does not require full Live network fetch', () => {
  assert.match(liveScreen, /hydrateFavoriteLiveChannels\(/);
  assert.match(liveScreen, /getLiveChannelIndexEntry\(activeProviderId, id\)/);
  assert.doesNotMatch(liveScreen, /getLiveStreams\(/);
  assert.doesNotMatch(liveScreen, /getCategoryCounts\(/);
});

test('8. Discover Zone open does not mutate selectedCategoryId', () => {
  assert.match(liveScreen, /setDiscoverZoneOpen\(true\)/);
  assert.doesNotMatch(liveScreen, /selectCategory\('favorites'\)/);
  assert.doesNotMatch(liveScreen, /loadCategoryChannels\('favorites'\)/);
  assert.doesNotMatch(liveScreen, /setSelectedCategoryId\('favorites'\)/);
});

test('9. Discover Zone close preserves original provider category', () => {
  assert.match(liveScreen, /onClose=\{closeDiscoverZone\}/);
  assert.match(liveScreen, /if \(!liveStateRef\.current\?\.fullscreenChannelId && discoverLivePlaybackContextRef\.current\)/);
  assert.match(liveScreen, /setDiscoverRestoreItemId\(null\)/);
  const landing = createLiveTvLandingState('10', 'cnn');
  const afterFavorite = chooseLiveChannel(landing, 'cnn', { origin: 'search' });
  assert.equal(afterFavorite.selectedCategoryId, '10');
  assert.equal(afterFavorite.fullscreenChannelId, 'cnn');
});

test('10. Favorite launch creates exact temporary surf queue', () => {
  const favoriteIds = ['espn', 'cnn', 'hbo'];
  const resolved = [channel('espn', 'ESPN'), channel('cnn', 'CNN'), channel('hbo', 'HBO')];
  assert.deepEqual(favoriteSurfQueueIds(favoriteIds, resolved), favoriteIds);
  assert.deepEqual(resolveLiveSearchSurfQueue(favoriteIds, ['cnn', 'fox', 'espn', 'nbc', 'hbo']), favoriteIds);
  assert.match(liveScreen, /liveSearchSurfQueueRef\.current = canonicalQueue\.map\(\(candidate\) => candidate\.id\)/);
});

test('11. favorite surf remains circular', () => {
  const queue = ['espn', 'cnn', 'hbo'];
  const left = resolveLiveSurfAdjacent({ channelIds: queue, currentId: 'cnn', direction: -1 });
  const right = resolveLiveSurfAdjacent({ channelIds: queue, currentId: 'cnn', direction: 1 });
  assert.equal(left.kind, 'adjacent');
  assert.equal(right.kind, 'adjacent');
  if (left.kind === 'adjacent') {
    assert.equal(left.toChannelId, 'espn');
  }
  if (right.kind === 'adjacent') {
    assert.equal(right.toChannelId, 'hbo');
  }
  const wrap = resolveLiveSurfAdjacent({ channelIds: queue, currentId: 'hbo', direction: 1 });
  assert.equal(wrap.kind, 'adjacent');
  if (wrap.kind === 'adjacent') {
    assert.equal(wrap.toChannelId, 'espn');
  }
});

test('12. normal category surf unchanged', () => {
  const sports = ['espn', 'espn2', 'fs1'];
  const next = resolveLiveSurfAdjacent({ channelIds: sports, currentId: 'espn', direction: 1 });
  assert.equal(next.kind, 'adjacent');
  if (next.kind === 'adjacent') {
    assert.equal(next.toChannelId, 'espn2');
    assert.equal(next.queueLength, 3);
  }
  assert.deepEqual(resolveLiveSearchSurfQueue(null, sports), sports);
});

test('13. Live Search surf unchanged', () => {
  const searchIds = ['cnn', 'fox', 'msnbc'];
  assert.deepEqual(resolveLiveSearchSurfQueue(searchIds, ['espn', 'cnn']), searchIds);
  assert.match(liveScreen, /liveSearchSurfQueueRef\.current = liveSearchResultIdsRef\.current\.slice\(\)/);
  assert.match(liveScreen, /origin: 'search'/);
});

test('14. first OK preview \/ second OK fullscreen unchanged', () => {
  const landing = createLiveTvLandingState('sports', 'espn');
  const firstOk = chooseLiveChannel(landing, 'espn');
  assert.equal(firstOk.fullscreenChannelId, null);
  assert.equal(firstOk.previewChannelId, 'espn');
  const ready = resolveLivePreview(firstOk, firstOk.previewRequestId, 'espn', 'ready');
  const secondOk = chooseLiveChannel(ready, 'espn');
  assert.equal(secondOk.fullscreenChannelId, 'espn');
});

test('15. empty favorites renders safely', () => {
  const hydrated = hydrateFavoriteLiveChannels({ favoriteIds: [] });
  assert.deepEqual(hydrated.channels, []);
  assert.deepEqual(hydrated.unresolvedIds, []);
  assert.equal(hydrated.savedFavoriteCount, 0);
  assert.deepEqual(favoriteSurfQueueIds([], []), []);
});

test('16. missing\/stale favorite ID is omitted safely', () => {
  const hydrated = hydrateFavoriteLiveChannels({
    favoriteIds: ['cnn', 'gone', 'espn'],
    loadedChannels: [channel('cnn', 'CNN')],
    favoriteRecords: [favoriteRecord('espn', 'ESPN')],
  });
  assert.deepEqual(
    hydrated.channels.map((item) => item.id),
    ['cnn', 'espn'],
  );
  assert.deepEqual(hydrated.unresolvedIds, ['gone']);
  assert.deepEqual(favoriteSurfQueueIds(['cnn', 'gone', 'espn'], hydrated.channels), ['cnn', 'espn']);
  assert.equal(liveChannelFromFavoriteRecord(favoriteRecord('1490592', '1490592'))?.name, 'Favorite channel');
});

test('17. Live initial browse does not wait on EPG', () => {
  const readyIndex = liveModel.indexOf("setStatus('ready')");
  const epgIndex = liveModel.indexOf('prefetchChannelEpg(requestId, nextChannels, resolvedCategoryId)');
  assert.ok(readyIndex > 0 && epgIndex > readyIndex);
  assert.match(liveModel, /mapChannelsWithoutEpg\(nextChannels\)/);
  assert.doesNotMatch(liveModel, /await enrichChannelsWithPrefetchedEpg/);
});

test('18. Live initial browse does not wait on Discover Zone hydration', () => {
  assert.doesNotMatch(liveModel, /loadDiscoverZoneSnapshot/);
  assert.doesNotMatch(liveModel, /getLiveFavoriteEntries/);
  assert.doesNotMatch(liveModel, /getCategoryCounts/);
  // Reactive personalization state (My Channels / Recents) is read synchronously
  // from the store hook — initial provider browse never awaits it.
  assert.doesNotMatch(liveModel, /await[^\n]*usePersonalizationStore/);
});

test('Live FocusRouter and Movies\/Series Discover Zone stay closed', () => {
  assert.doesNotMatch(liveRouter, /hydrateFavoriteLiveChannels|liveCategoryIdSafety|Discover Zone/);
  assert.match(moviesScreen, /scope="movies"/);
  assert.match(seriesScreen, /scope="series"/);
});

test('index lookup hydrates a favorite without scanning a catalog array', () => {
  resetLiveChannelIndex('p-index');
  ingestLiveChannels('p-index', [channel('hbo', 'HBO', { categoryId: 'ent' })]);
  let catalogScans = 0;
  const hydrated = hydrateFavoriteLiveChannels({
    favoriteIds: ['hbo'],
    loadedChannels: [],
    getIndexEntry: (id) => {
      catalogScans += 1;
      return {
        id,
        providerId: 'p-index',
        categoryId: 'ent',
        name: 'HBO',
        number: 501,
        normalizedName: 'hbo',
        normalizedCurrent: '',
        normalizedCategory: 'ent',
        numberText: '501',
        nameTokens: ['hbo'],
        currentTokens: [],
      };
    },
  });
  assert.equal(catalogScans, 1);
  assert.equal(hydrated.channels[0]?.name, 'HBO');
  assert.equal(hydrated.scannedLoadedCount, 0);
  resetLiveChannelIndex('p-index');
});
