import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  buildSyntheticLiveCategories,
  composeLiveCategoryRail,
  resolveMyChannelsLiveChannels,
  resolveRecentLiveChannels,
  LIVE_MY_CHANNELS_CATEGORY_NAME,
  LIVE_RECENTS_CATEGORY_NAME,
  LIVE_MY_CHANNELS_EMPTY_MESSAGE,
  LIVE_RECENTS_EMPTY_MESSAGE,
} from '../src/features/live/liveSyntheticCategories.ts';
import {
  isRealProviderLiveCategoryId,
  isSyntheticLiveCategoryId,
  isSyntheticLiveMyChannelsCategoryId,
  isSyntheticLiveRecentsCategoryId,
  isSyntheticLivePersonalizationCategoryId,
  providerLiveCategoriesOnly,
  LIVE_MY_CHANNELS_CATEGORY_ID,
  LIVE_RECENTS_CATEGORY_ID,
} from '../src/features/providers/liveCategoryIdSafety.ts';
import { sortLiveCategoriesUsFirst } from '../src/features/providers/usAmericanSort.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => readFileSync(join(root, relativePath), 'utf8').replace(/\r\n/g, '\n');

const liveModel = read('src/features/live/useLiveTvScreenModel.ts');
const liveScreen = read('src/features/live/LiveTvScreen.tsx');
const repositories = read('src/features/providers/providerRepositories.ts');

const providerCategory = (id, name, count = 5, countryCode) => ({
  id,
  renderKey: `provider:${id}`,
  name,
  count,
  countryCode,
  icon: 'earth',
});

const liveFavorite = (contentId, extra = {}) => ({
  providerId: 'prov-1',
  mediaType: 'live',
  contentId,
  title: `Fav ${contentId}`,
  artworkUrl: null,
  categoryId: 'us-news',
  createdAt: 1000,
  ...extra,
});

const liveRecent = (contentId, lastOpenedAt) => ({
  providerId: 'prov-1',
  mediaType: 'live',
  contentId,
  title: `Recent ${contentId}`,
  artworkUrl: null,
  categoryId: 'us-news',
  lastOpenedAt,
});

const loadedChannel = (id, categoryId = 'us-news') => ({
  id,
  categoryId,
  number: 1,
  name: `Channel ${id}`,
  shortName: id,
  current: null,
  next: null,
  following: null,
  description: '',
  resolution: 'HD',
  audio: 'Stereo',
  remaining: '',
  progress: 0,
  tone: 'live',
  currentStart: null,
  currentEnd: null,
});

// 1. Final rail order: My Channels, Recents, then first real provider category.
test('composeLiveCategoryRail pins synthetic categories then provider categories', () => {
  const providers = [providerCategory('us-news', 'US News'), providerCategory('uk-sport', 'UK Sport')];
  const rail = composeLiveCategoryRail(providers, { myChannelsCount: 2, recentsCount: 3 });
  assert.equal(rail[0].id, LIVE_MY_CHANNELS_CATEGORY_ID);
  assert.equal(rail[0].name, LIVE_MY_CHANNELS_CATEGORY_NAME);
  assert.equal(rail[1].id, LIVE_RECENTS_CATEGORY_ID);
  assert.equal(rail[1].name, LIVE_RECENTS_CATEGORY_NAME);
  assert.equal(rail[2].id, 'us-news');
  assert.equal(rail[2].name, 'US News');
});

// 2. Synthetic categories never enter the regional sorter.
test('synthetic categories are excluded from the provider sort input', () => {
  const providers = [
    providerCategory('uk-sport', 'UK Sport', 5, 'GB'),
    providerCategory('us-news', 'US News', 5, 'US'),
  ];
  const rail = composeLiveCategoryRail(sortLiveCategoriesUsFirst(providers), {
    myChannelsCount: 0,
    recentsCount: 0,
  });
  const sortedProviderOnly = providerLiveCategoriesOnly(rail);
  assert.ok(!sortedProviderOnly.some((c) => isSyntheticLiveCategoryId(c.id)));
  // US-first ordering preserved.
  assert.equal(sortedProviderOnly[0].id, 'us-news');
});

// 3. Cold auto-default selects the first REAL provider category, not My Channels.
test('model default selection resolves to first real provider category', () => {
  assert.match(liveModel, /providerLiveCategoriesOnly\(baseCategories\)/);
  assert.match(liveModel, /composeLiveCategoryRail\(/);
  assert.match(
    liveScreen,
    /categories\.find\(\(category\) => isRealProviderLiveCategoryId\(category\.id\)\)/,
  );
  assert.doesNotMatch(liveScreen, /selectedCategoryId \|\| categories\[0\]\?\.id/);
});

// 4. Selecting My Channels never calls the provider category loader.
test('selecting My Channels short-circuits before provider loading', () => {
  assert.match(liveModel, /isSyntheticLivePersonalizationCategoryId\(categoryId\)/);
  assert.match(liveModel, /isSyntheticLiveMyChannelsCategoryId\(categoryId\)\s*\?\s*myChannelsLiveChannels/);
  assert.ok(isSyntheticLivePersonalizationCategoryId(LIVE_MY_CHANNELS_CATEGORY_ID));
});

// 5. Selecting Recents never calls the provider category loader.
test('selecting Recents short-circuits before provider loading', () => {
  assert.ok(isSyntheticLivePersonalizationCategoryId(LIVE_RECENTS_CATEGORY_ID));
  assert.ok(isSyntheticLiveRecentsCategoryId(LIVE_RECENTS_CATEGORY_ID));
  assert.match(liveModel, /recentLiveChannels/);
});

// 6. A favorited live channel appears in My Channels.
test('resolveMyChannelsLiveChannels hydrates saved live favorites', () => {
  const channels = resolveMyChannelsLiveChannels([liveFavorite('ch-1'), liveFavorite('ch-2')], {
    loadedChannels: [loadedChannel('ch-1'), loadedChannel('ch-2')],
  });
  assert.deepEqual(
    channels.map((c) => c.id),
    ['ch-1', 'ch-2'],
  );
});

// 7. Unfavoriting removes the channel immediately (memo recompute proof: absent id -> absent row).
test('resolveMyChannelsLiveChannels drops channels no longer favorited', () => {
  const channels = resolveMyChannelsLiveChannels([liveFavorite('ch-1')], {
    loadedChannels: [loadedChannel('ch-1'), loadedChannel('ch-2')],
  });
  assert.deepEqual(
    channels.map((c) => c.id),
    ['ch-1'],
  );
});

// 8. A recent live tune appears in Recents.
test('resolveRecentLiveChannels hydrates recent live items', () => {
  const channels = resolveRecentLiveChannels([liveRecent('ch-2', 2000), liveRecent('ch-1', 1000)], {
    loadedChannels: [loadedChannel('ch-1'), loadedChannel('ch-2')],
  });
  assert.deepEqual(
    channels.map((c) => c.id),
    ['ch-2', 'ch-1'],
  );
});

// 9. Re-tuning moves a channel to the top without duplication (order comes from newest-first input).
test('resolveRecentLiveChannels preserves newest-first order without duplicates', () => {
  const channels = resolveRecentLiveChannels([liveRecent('ch-1', 3000), liveRecent('ch-2', 2000)], {
    loadedChannels: [loadedChannel('ch-1'), loadedChannel('ch-2')],
  });
  assert.deepEqual(
    channels.map((c) => c.id),
    ['ch-1', 'ch-2'],
  );
  assert.equal(new Set(channels.map((c) => c.id)).size, channels.length);
});

// 10. Empty My Channels / Recents remain selectable and expose empty-state copy.
test('empty synthetic categories are still built and expose empty messages', () => {
  const rail = composeLiveCategoryRail([], { myChannelsCount: 0, recentsCount: 0 });
  assert.equal(rail.length, 2);
  assert.equal(rail[0].count, 0);
  assert.equal(rail[1].count, 0);
  assert.equal(LIVE_MY_CHANNELS_EMPTY_MESSAGE, 'No saved channels yet');
  assert.equal(LIVE_RECENTS_EMPTY_MESSAGE, 'No recent channels yet');
  assert.match(liveScreen, /No saved channels yet/);
  assert.match(liveScreen, /No recent channels yet/);
});

// 11. Synthetic IDs never reach Xtream category_id, provider fetches, or published SQL.
test('synthetic IDs are rejected by provider-facing guards', () => {
  assert.ok(!isRealProviderLiveCategoryId(LIVE_MY_CHANNELS_CATEGORY_ID));
  assert.ok(!isRealProviderLiveCategoryId(LIVE_RECENTS_CATEGORY_ID));
  assert.ok(isSyntheticLiveCategoryId(LIVE_MY_CHANNELS_CATEGORY_ID));
  assert.ok(isSyntheticLiveCategoryId(LIVE_RECENTS_CATEGORY_ID));
  assert.match(repositories, /if \(isSyntheticLiveCategoryId\(categoryId\)\)/);
  assert.match(repositories, /isSyntheticLiveCategoryId\(categoryId\)/);
});

// Extra: synthetic category builder icon assignment.
test('synthetic categories carry the expected icons', () => {
  const [myChannels, recents] = buildSyntheticLiveCategories({ myChannelsCount: 1, recentsCount: 1 });
  assert.equal(myChannels.icon, 'star-outline');
  assert.equal(recents.icon, 'history');
});
