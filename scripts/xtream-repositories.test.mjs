import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createXtreamProviderRepositories,
  XTREAM_GUIDE_CHANNEL_PAGE_SIZE,
  XTREAM_MAX_ITEMS_PER_CATEGORY,
} from '../src/features/providers/providerRepositories.ts';
import { fallbackProviderCategoryId } from '../src/features/providers/categoryNormalization.ts';

function makeFakeClient() {
  return {
    async getVodCategories() {
      return [{ category_id: '1', category_name: 'Action' }];
    },
    async getVodStreams(categoryId) {
      const all = [
        { stream_id: '101', name: 'Action Movie', category_id: '1', rating: '8.2' },
        { stream_id: '102', name: 'Second Action', category_id: '1', rating: '7.4' },
      ];

      if (categoryId === undefined) {
        return all;
      }

      return all.filter((stream) => stream.category_id === categoryId);
    },
    async getLiveCategories() {
      return [{ category_id: '10', category_name: 'News' }];
    },
    async getLiveStreams(categoryId) {
      if (categoryId === '10') {
        return [{ stream_id: '201', name: 'News Live', category_id: '10', epg_channel_id: 'news-live' }];
      }

      return [{ stream_id: '201', name: 'News Live', category_id: '10', epg_channel_id: 'news-live' }];
    },
    async getShortEpg() {
      return {
        epg_listings: [
          {
            id: 'a',
            title: 'Morning News',
            start: '08:00',
            end: '08:30',
            description: Buffer.from('Start of the day.').toString('base64'),
          },
          { id: 'b', title: 'World Update', start: '08:30', end: '09:00', description: 'Updates around the globe.' },
        ],
      };
    },
    async getSeriesCategories() {
      return [{ category_id: '20', category_name: 'Drama' }];
    },
    async getSeries(categoryId) {
      const all = [{ series_id: '301', name: 'Drama Series', category_id: '20', releasedate: '2024-01-15', rating: '8.1' }];

      if (categoryId === undefined) {
        return all;
      }

      return all.filter((series) => series.category_id === categoryId);
    },
    async getSeriesInfo(seriesId) {
      return {
        info: { series_id: seriesId, name: 'Drama Series' },
        seasons: [],
        episodes: {},
      };
    },
  };
}

test('Xtream repositories map provider content from the active client', async () => {
  const repositories = createXtreamProviderRepositories(makeFakeClient());

  const movieCategories = await repositories.movies.getCategories();
  const firstMoviePage = await repositories.movies.getMoviesPage({ categoryId: '1', offset: 0, limit: 10 });
  const movieCategoriesAfterLoad = await repositories.movies.getCategories();
  const categoryOneCount = await repositories.movies.getCategoryCount('1');
  const prefetchedCounts = new Map();
  await repositories.movies.prefetchAllCategoryCounts(['1', '2'], (categoryId, count) => {
    prefetchedCounts.set(categoryId, count);
  });
  const movieCategoriesAfterCount = await repositories.movies.getCategories();
  const liveCategories = await repositories.live.getCategories();
  const liveCategoryCounts = await repositories.live.getCategoryCounts?.();
  const liveChannelTotal = await repositories.live.getTotalChannelCount?.();
  const liveChannels = await repositories.live.getChannels('10');
  const liveEpg = await repositories.live.getShortEpg('201');
  const seriesCategories = await repositories.series.getCategories();
  const seriesItems = await repositories.series.getSeries('20');
  const searchHits = await repositories.search.search('Action');

  assert.equal(movieCategories[0]?.name, 'Action');
  assert.equal(firstMoviePage.items[0]?.title, 'Action Movie');
  assert.equal(liveCategories[0]?.name, 'News');
  assert.deepEqual(liveCategoryCounts, { '10': 1 });
  assert.equal(liveChannelTotal, 1);
  assert.equal(liveChannels[0]?.current, 'News Live');
  assert.equal(liveChannels[0]?.description, 'No program information available.');
  assert.equal(liveEpg[0]?.title, 'Morning News');
  assert.equal(liveEpg[0]?.description, 'Start of the day.');
  assert.equal(seriesCategories[0]?.name, 'Drama');
  assert.equal(seriesItems[0]?.title, 'Drama Series');
  assert.equal(searchHits.some((hit) => hit.kind === 'movie'), true);
  assert.equal(typeof repositories.streamUrlBuilder.buildLiveStreamUrl('201'), 'string');

  // Movie counts populate lazily after a category fetch to avoid loading the full VOD catalog.
  assert.equal(movieCategories[0]?.count, 0);
  assert.equal(movieCategoriesAfterLoad.find((category) => category.id === '1')?.count, 2);
  assert.equal(categoryOneCount, 2);
  assert.equal(prefetchedCounts.get('1'), 2);
  assert.equal(movieCategoriesAfterCount.find((category) => category.id === '1')?.count, 2);
  // Series counts are intentionally lazy; the repository exposes zero until a
  // category is fetched or a background count sync populates the index.
  assert.equal(seriesCategories[0]?.count, 0);
});

test('Guide loads channel pages with bounded EPG concurrency and preserves the requested window', async () => {
  const streams = Array.from({ length: 85 }, (_, index) => ({
    stream_id: String(500 + index),
    name: `Channel ${index + 1}`,
    category_id: '10',
  }));
  let activeEpgRequests = 0;
  let maxActiveEpgRequests = 0;
  const requestedLimits = [];

  const repositories = createXtreamProviderRepositories({
    async getLiveStreams() {
      return streams;
    },
    async getShortEpg(_streamId, limit) {
      requestedLimits.push(limit);
      activeEpgRequests += 1;
      maxActiveEpgRequests = Math.max(maxActiveEpgRequests, activeEpgRequests);
      await new Promise((resolve) => setTimeout(resolve, 1));
      activeEpgRequests -= 1;
      return { epg_listings: [] };
    },
  });

  const firstPage = await repositories.guide.getRows(undefined, {
    channelOffset: 0,
    channelLimit: XTREAM_GUIDE_CHANNEL_PAGE_SIZE,
    epgLimit: 24,
  });
  const secondPage = await repositories.guide.getRows(undefined, {
    channelOffset: XTREAM_GUIDE_CHANNEL_PAGE_SIZE,
    channelLimit: XTREAM_GUIDE_CHANNEL_PAGE_SIZE,
    epgLimit: 24,
  });

  assert.equal(firstPage.length, XTREAM_GUIDE_CHANNEL_PAGE_SIZE);
  assert.equal(secondPage.length, XTREAM_GUIDE_CHANNEL_PAGE_SIZE);
  assert.equal(secondPage[0]?.channel.name, 'Channel 41');
  assert.equal(maxActiveEpgRequests <= 6, true);
  assert.equal(requestedLimits.every((limit) => limit === 24), true);
});

test('live channel total dedupes duplicate stream ids and ignores inflated duplicate category metadata', async () => {
  const repositories = createXtreamProviderRepositories({
    async getLiveCategories() {
      return [
        { category_id: '5', category_name: 'Sports', channel_count: 2500 },
        { category_id: '5', category_name: 'Sports (duplicate)', channel_count: 2500 },
        { category_id: '6', category_name: 'News', channel_count: 120 },
      ];
    },
    async getLiveStreams() {
      return [
        { stream_id: '1', name: 'Sports One', category_id: '5' },
        { stream_id: '2', name: 'Sports Two', category_id: '5' },
        { stream_id: '2', name: 'Sports Two Duplicate', category_id: '5' },
        { stream_id: '3', name: 'News One', category_id: '6' },
      ];
    },
  });

  const categories = await repositories.live.getCategories();
  const inflatedProviderMetadataTotal = categories.reduce((total, category) => total + (category.count ?? 0), 0);
  const categoryCounts = await repositories.live.getCategoryCounts?.();
  const totalChannels = await repositories.live.getTotalChannelCount?.();

  assert.equal(inflatedProviderMetadataTotal, 5120);
  assert.deepEqual(categoryCounts, { '5': 2, '6': 1 });
  assert.equal(totalChannels, 3);
});

test('live channel totals recount per category when the uncategorized dump hits the 10k ceiling', async () => {
  const { XTREAM_MAX_ITEMS_PER_RESPONSE } = await import('../src/features/providers/xtreamClient.ts');

  const truncatedDump = Array.from({ length: XTREAM_MAX_ITEMS_PER_RESPONSE }, (_, index) => ({
    stream_id: `dump-${index}`,
    name: `Dump ${index}`,
    category_id: '1',
  }));

  const repositories = createXtreamProviderRepositories({
    async getLiveCategories() {
      return [
        { category_id: '1', category_name: 'One' },
        { category_id: '2', category_name: 'Two' },
      ];
    },
    async getLiveStreams(categoryId) {
      if (categoryId === undefined) {
        return truncatedDump;
      }
      if (categoryId === '1') {
        return Array.from({ length: 3 }, (_, index) => ({
          stream_id: `one-${index}`,
          name: `One ${index}`,
          category_id: '1',
        }));
      }
      return Array.from({ length: 4 }, (_, index) => ({
        stream_id: `two-${index}`,
        name: `Two ${index}`,
        category_id: '2',
      }));
    },
  });

  await repositories.live.getCategories();
  const approximate = await repositories.live.getApproximateTotalChannelCount?.();
  const accurate = await repositories.live.getTotalChannelCount?.();
  const counts = await repositories.live.getCategoryCounts?.();

  assert.equal(approximate, XTREAM_MAX_ITEMS_PER_RESPONSE);
  assert.equal(accurate, 7);
  assert.deepEqual(counts, { '1': 3, '2': 4 });
});

test('duplicate live category IDs are deduplicated into stable render keys without dropping categories or mutating query ids', async () => {
  const client = {
    async getLiveCategories() {
      return [
        { category_id: '0', category_name: 'Uncategorized A' },
        { category_id: '0', category_name: 'Uncategorized B' },
        { category_id: '5', category_name: 'Sports' },
        { category_id: '5', category_name: 'Sports (duplicate)' },
        { category_id: '5', category_name: '  Sports  ' },
      ];
    },
    async getLiveStreams() {
      return [];
    },
  };

  const repositories = createXtreamProviderRepositories(client);
  const categories = await repositories.live.getCategories();

  // No category is silently dropped.
  assert.equal(categories.length, 4);

  // Provider category names are preserved even when ids collide.
  assert.deepEqual(
    categories.map((category) => category.name),
    ['Sports', 'Sports (duplicate)', 'Uncategorized A', 'Uncategorized B'],
  );

  // The real provider category id is preserved for repository/API queries...
  assert.deepEqual(categories.map((category) => category.id), ['5', '5', '0', '0']);

  // ...while renderKey is guaranteed unique for list rendering.
  const renderKeys = categories.map((category) => category.renderKey);
  assert.equal(new Set(renderKeys).size, renderKeys.length);
  renderKeys.forEach((key) => assert.equal(typeof key, 'string'));
});

test('unmapped movie streams use one provider fallback category without losing content', async () => {
  const repositories = createXtreamProviderRepositories({
    async getVodCategories() {
      return [{ category_id: '1', category_name: 'Action' }];
    },
    async getVodStreams(categoryId) {
      const streams = [
        { stream_id: '1', name: 'Known', category_id: '1' },
        { stream_id: '2', name: 'Missing Mapping', category_id: undefined },
        { stream_id: '3', name: 'Unknown Mapping', category_id: '999' },
      ];
      return categoryId === undefined ? streams : streams.filter((stream) => stream.category_id === categoryId);
    },
  });

  await repositories.movies.getCategories();
  const fallbackId = 'uncategorized:movie';
  const fallbackCount = await repositories.movies.getCategoryCount(fallbackId);
  const fallbackPage = await repositories.movies.getMoviesPage({ categoryId: fallbackId, offset: 0, limit: 10 });

  assert.equal(fallbackCount, 2);
  assert.deepEqual(fallbackPage.items.map((item) => item.categoryId), [fallbackId, fallbackId]);
  assert.deepEqual(fallbackPage.items.map((item) => item.title), ['Missing Mapping', 'Unknown Mapping']);
});

test('category title/count normalization preserves legitimate zero counts and does not fabricate totals', async () => {
  const client = {
    async getVodCategories() {
      return [
        { category_id: '1', category_name: 'Action' },
        { category_id: '2', category_name: 'Empty Bucket' },
      ];
    },
    async getVodStreams(categoryId) {
      if (categoryId === '2') {
        return [];
      }

      return [{ stream_id: '101', name: 'Action Movie', category_id: '1' }];
    },
  };

  const repositories = createXtreamProviderRepositories(client);
  const categories = await repositories.movies.getCategories();
  await repositories.movies.getMoviesPage({ categoryId: '1', offset: 0, limit: 10 });
  assert.equal(await repositories.movies.getCategoryCount('2'), 0);
  const categoriesAfterLoad = await repositories.movies.getCategories();

  const action = categoriesAfterLoad.find((category) => category.id === '1');
  const empty = categoriesAfterLoad.find((category) => category.id === '2');

  assert.equal(categories.find((category) => category.id === '1')?.count, 0);
  assert.equal(categories.find((category) => category.id === '1')?.countKnown, false);
  assert.equal(action?.count, 1);
  // A category with genuinely zero matching streams still reports 0 (not hidden or invented).
  assert.equal(empty?.count, 0);
});

test('Xtream repository retains full oversized provider categories for global sorting', async () => {
  const oversizedMovies = Array.from({ length: 12_500 }, (_, index) => ({
    stream_id: String(index + 1),
    name: `Movie ${index + 1}`,
    category_id: '1',
  }));
  const oversizedSeries = Array.from({ length: 12_500 }, (_, index) => ({
    series_id: String(index + 1),
    name: `Series ${index + 1}`,
    category_id: '20',
  }));
  let liveStreamRequests = 0;

  const repositories = createXtreamProviderRepositories({
    async getVodCategories() {
      return [{ category_id: '1', category_name: 'Movies' }];
    },
    async getVodStreams() {
      return oversizedMovies;
    },
    async getLiveCategories() {
      return [{ category_id: '10', category_name: 'News' }];
    },
    async getLiveStreams() {
      liveStreamRequests += 1;
      return [];
    },
    async getSeriesCategories() {
      return [{ category_id: '20', category_name: 'Drama' }];
    },
    async getSeries() {
      return oversizedSeries;
    },
  });

  const moviePage = await repositories.movies.getMoviesPage({
    categoryId: '1',
    offset: 0,
    limit: 50,
    sort: 'title-asc',
  });
  const series = await repositories.series.getSeries('20');
  await repositories.live.getCategories();

  assert.equal(moviePage.items.length, 50);
  assert.equal(moviePage.totalCount, 12_500);
  assert.equal(moviePage.itemsConsideredForSort, 12_500);
  assert.equal(moviePage.sortComplete, true);
  assert.equal(await repositories.movies.getCategoryCount('1'), 12_500);
  assert.equal(series.length, 12_500);
  assert.equal(liveStreamRequests, 0);
});

test('Guide 40-channel page is a page size, not a cap: three pages within one category yield 120 unique channels', async () => {
  const channels = Array.from({ length: 120 }, (_, index) => ({
    stream_id: String(1000 + index),
    name: `News ${index + 1}`,
    category_id: '10',
  }));

  const repositories = createXtreamProviderRepositories({
    async getLiveCategories() {
      return [{ category_id: '10', category_name: 'News' }];
    },
    async getLiveStreams(categoryId) {
      return categoryId === undefined ? channels : channels.filter((stream) => stream.category_id === categoryId);
    },
    async getShortEpg() {
      return { epg_listings: [] };
    },
  });

  await repositories.live.getCategories();

  const seenChannelIds = new Map();
  for (const offset of [0, 40, 80]) {
    const page = await repositories.guide.getRows(undefined, {
      categoryId: '10',
      channelOffset: offset,
      channelLimit: XTREAM_GUIDE_CHANNEL_PAGE_SIZE,
    });
    assert.equal(page.length, XTREAM_GUIDE_CHANNEL_PAGE_SIZE);
    page.forEach((row) => seenChannelIds.set(row.channel.id, row));
  }

  // 40 channels is a page size: three pages of a 120-channel category yield 120 unique channels, not 40.
  assert.equal(seenChannelIds.size, 120);
  assert.equal(await repositories.guide.getChannelCount('10'), 120);
});

test('Guide EPG resolves through epg_channel_id when only the mapped EPG id has matching data', async () => {
  const epgCalls = [];
  const repositories = createXtreamProviderRepositories({
    async getLiveCategories() {
      return [{ category_id: '10', category_name: 'News' }];
    },
    async getLiveStreams() {
      return [{ stream_id: '501', name: 'Mapped Channel', category_id: '10', epg_channel_id: 'epg-501-alt' }];
    },
    async getShortEpg(id) {
      epgCalls.push(id);
      if (id === 'epg-501-alt') {
        return { epg_listings: [{ id: 'p1', title: 'Alt Match', start: '10:00', end: '11:00' }] };
      }
      return { epg_listings: [] };
    },
  });

  const rows = await repositories.guide.getRows(undefined, { categoryId: '10', channelOffset: 0, channelLimit: 10 });

  // The primary lookup (epg_channel_id) succeeded, so the raw stream id was never queried.
  assert.equal(rows[0]?.programs[0]?.title, 'Alt Match');
  assert.deepEqual(epgCalls, ['epg-501-alt']);
});

test('Guide EPG falls back to the raw stream id when epg_channel_id has no matching data', async () => {
  const epgCalls = [];
  const repositories = createXtreamProviderRepositories({
    async getLiveStreams() {
      return [{ stream_id: '502', name: 'Fallback Channel', category_id: '10', epg_channel_id: 'epg-502-missing' }];
    },
    async getShortEpg(id) {
      epgCalls.push(id);
      if (id === '502') {
        return { epg_listings: [{ id: 'p2', title: 'Stream Id Match', start: '10:00', end: '11:00' }] };
      }
      return { epg_listings: [] };
    },
  });

  const rows = await repositories.guide.getRows(undefined, { categoryId: '10', channelOffset: 0, channelLimit: 10 });

  assert.equal(rows[0]?.programs[0]?.title, 'Stream Id Match');
  // Primary (epg_channel_id) attempt fails first, then falls back to the raw stream id.
  assert.deepEqual(epgCalls, ['epg-502-missing', '502']);
});

test('Guide channel categories match Live TV categories exactly, preserving short provider-mapped names', async () => {
  const repositories = createXtreamProviderRepositories({
    async getLiveCategories() {
      return [
        { category_id: '1', category_name: 'HD' },
        { category_id: '2', category_name: '6' },
      ];
    },
    async getLiveStreams(categoryId) {
      const all = [
        { stream_id: '1', name: 'HD Channel', category_id: '1' },
        { stream_id: '2', name: 'Six Channel', category_id: '2' },
      ];
      return categoryId === undefined ? all : all.filter((stream) => stream.category_id === categoryId);
    },
    async getShortEpg() {
      return { epg_listings: [] };
    },
  });

  const liveCategories = await repositories.live.getCategories();
  // Guide reuses live.getCategories() verbatim; short names like 'HD' and '6' are not truncated or re-derived.
  assert.deepEqual(liveCategories.map((category) => category.name), ['6', 'HD']);
  assert.deepEqual(liveCategories.map((category) => category.id), ['2', '1']);

  const hdRows = await repositories.guide.getRows(undefined, { categoryId: '1', channelOffset: 0, channelLimit: 10 });
  const sixRows = await repositories.guide.getRows(undefined, { categoryId: '2', channelOffset: 0, channelLimit: 10 });

  assert.equal(hdRows[0]?.channel.categoryId, '1');
  assert.equal(sixRows[0]?.channel.categoryId, '2');
});

test('Guide channels missing a category id route to the Uncategorized fallback bucket used by Live TV', async () => {
  const repositories = createXtreamProviderRepositories({
    async getLiveCategories() {
      return [{ category_id: '1', category_name: 'News' }];
    },
    async getLiveStreams() {
      return [{ stream_id: '9', name: 'Orphan Channel', category_id: undefined }];
    },
    async getShortEpg() {
      return { epg_listings: [] };
    },
  });

  await repositories.live.getCategories();
  const fallbackId = fallbackProviderCategoryId('live');
  const rows = await repositories.guide.getRows(undefined, { categoryId: fallbackId, channelOffset: 0, channelLimit: 10 });

  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.channel.categoryId, fallbackId);
});

test('Guide favorites-style channel lookup shares the exact live.getChannel mapping (no parallel channel source)', async () => {
  const repositories = createXtreamProviderRepositories({
    async getLiveCategories() {
      return [{ category_id: '10', category_name: 'News' }];
    },
    async getLiveStreams() {
      return [
        { stream_id: '701', name: 'Favorite One', category_id: '10' },
        { stream_id: '702', name: 'Not Favorited', category_id: '10' },
      ];
    },
  });

  const favoriteChannel = await repositories.live.getChannel('701');
  assert.equal(favoriteChannel?.name, 'Favorite One');
  const missingChannel = await repositories.live.getChannel('999');
  assert.equal(missingChannel, null);
});
