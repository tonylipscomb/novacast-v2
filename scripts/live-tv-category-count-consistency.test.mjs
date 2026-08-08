import assert from 'node:assert/strict';
import test from 'node:test';

import { fallbackProviderCategoryId } from '../src/features/providers/categoryNormalization.ts';
import {
  computeLiveCategoryCounts,
  filterStreamsForLiveCategory,
} from '../src/features/live/liveCategoryMembership.ts';
import {
  createXtreamProviderRepositories,
  XTREAM_MAX_ITEMS_PER_CATEGORY,
} from '../src/features/providers/providerRepositories.ts';

const LIVE_FALLBACK_ID = fallbackProviderCategoryId('live');

// ---------------------------------------------------------------------------
// Pure membership module — the single source of truth for browse + count.
// ---------------------------------------------------------------------------

// A category-id resolver mirroring resolveProviderStreamCategoryId: a known id
// passes through, everything else (missing / malformed / unknown) falls back.
function makeResolver(knownIds) {
  const known = new Set(knownIds);
  return (value) => {
    const id = value == null ? '' : String(value).trim();
    return id && known.has(id) ? id : 'fallback';
  };
}

test('membership count tally equals per-category filter length for every category', () => {
  const resolve = makeResolver(['801', '802', '900']);
  const streams = [
    { stream_id: 1, category_id: '801' },
    { stream_id: 2, category_id: '801' },
    { stream_id: 3, category_id: '802' },
    { stream_id: 4, category_id: null }, // malformed -> fallback
    { stream_id: 5, category_id: 'ghost' }, // unknown -> fallback
    { stream_id: 6, category_id: '801' },
  ];

  const counts = computeLiveCategoryCounts(streams, ['801', '802', '900'], resolve);

  for (const categoryId of ['801', '802', '900', 'fallback']) {
    const filtered = filterStreamsForLiveCategory(streams, categoryId, resolve);
    assert.equal(counts[categoryId] ?? 0, filtered.length, `count mismatch for ${categoryId}`);
  }

  assert.equal(counts['801'], 3);
  assert.equal(counts['802'], 1);
  assert.equal(counts['900'], 0); // empty category is a real 0, not omitted
  assert.equal(counts['fallback'], 2); // malformed + unknown collapse to fallback
});

test('resolved override replaces the derived tally with the browsed membership', () => {
  const resolve = makeResolver(['801']);
  const streams = [
    { stream_id: 1, category_id: '801' },
    { stream_id: 2, category_id: '801' },
  ];
  const resolvedOverrides = new Map([['801', new Array(11).fill(0)]]);

  const counts = computeLiveCategoryCounts(streams, ['801'], resolve, resolvedOverrides);

  // Override wins so the badge equals exactly what browse resolved (11), not the
  // derived-from-all tally (2).
  assert.equal(counts['801'], 11);
});

// ---------------------------------------------------------------------------
// Repository integration — badge counts must match browseable channels.
// ---------------------------------------------------------------------------

// Provider quirk under test: category "801" *declares* 18 channels, and a
// server-side per-category fetch echoes 18 rows, but only 11 actually resolve to
// 801 (7 are cross-listed under 802 / malformed). The full "all" dump only lists
// each stream once under its primary category.
function makeCountFakeClient(overrides = {}) {
  const calls = { getLiveStreams: [], getLiveCategories: 0 };
  let categories = overrides.categories ?? [
    { category_id: '801', category_name: 'News', channel_count: 18 },
    { category_id: '802', category_name: 'Sports', channel_count: 5 },
    { category_id: '900', category_name: 'Empty', channel_count: 3 },
  ];

  const bigCategoryMembers = overrides.bigCategoryMembers ?? 0;

  function buildAllDump() {
    const dump = [];
    for (let i = 0; i < 11; i += 1) {
      dump.push({ stream_id: `801-${i}`, name: `News ${i}`, category_id: '801' });
    }
    for (let i = 0; i < 5; i += 1) {
      dump.push({ stream_id: `802-${i}`, name: `Sports ${i}`, category_id: '802' });
    }
    // Two malformed rows that collapse to the live fallback bucket.
    dump.push({ stream_id: 'bad-1', name: 'Orphan A', category_id: null });
    dump.push({ stream_id: 'bad-2', name: 'Orphan B', category_id: 'ghost' });
    for (let i = 0; i < bigCategoryMembers; i += 1) {
      dump.push({ stream_id: `big-${i}`, name: `Big ${i}`, category_id: '999' });
    }
    return dump;
  }

  const client = {
    async getLiveCategories() {
      calls.getLiveCategories += 1;
      return categories;
    },
    async getLiveStreams(categoryId) {
      calls.getLiveStreams.push(categoryId);
      if (categoryId === undefined) {
        return buildAllDump();
      }
      if (categoryId === '801') {
        // Server inflates the per-category response: 11 real + 7 cross-listed.
        const inflated = [];
        for (let i = 0; i < 11; i += 1) {
          inflated.push({ stream_id: `801-${i}`, name: `News ${i}`, category_id: '801' });
        }
        for (let i = 0; i < 7; i += 1) {
          inflated.push({ stream_id: `802-x-${i}`, name: `Cross ${i}`, category_id: '802' });
        }
        return inflated;
      }
      return buildAllDump().filter((stream) => stream.category_id === categoryId);
    },
    async getShortEpg() {
      return { epg_listings: [] };
    },
    // Unused-but-required surface for the repository factory.
    async getVodCategories() {
      return [];
    },
    async getVodStreams() {
      return [];
    },
    async getSeriesCategories() {
      return [];
    },
    async getSeries() {
      return [];
    },
    async getSeriesInfo() {
      return { info: {}, seasons: [], episodes: {} };
    },
    setCategories(next) {
      categories = next;
    },
  };

  return { client, calls };
}

test('getCategories never surfaces the provider self-reported channel_count', async () => {
  const { client } = makeCountFakeClient();
  const repositories = createXtreamProviderRepositories(client);

  const liveCategories = await repositories.live.getCategories();
  const news = liveCategories.find((category) => category.id === '801');

  // The unreliable declared 18 must not leak into the badge; membership counts
  // arrive via getCategoryCounts instead.
  assert.notEqual(news?.count, 18);
  assert.equal(news?.count, null);
});

test('category count equals resolved browseable channel length (18 declared -> 11)', async () => {
  const { client } = makeCountFakeClient();
  const repositories = createXtreamProviderRepositories(client);

  await repositories.live.getCategories();
  const counts = await repositories.live.getCategoryCounts();
  const channels = await repositories.live.getChannels('801');

  assert.equal(counts['801'], 11); // not the declared 18
  assert.equal(channels.length, 11);
  assert.equal(counts['801'], channels.length);
});

test('empty category resolves to a real 0 count', async () => {
  const { client } = makeCountFakeClient();
  const repositories = createXtreamProviderRepositories(client);

  await repositories.live.getCategories();
  const counts = await repositories.live.getCategoryCounts();
  const channels = await repositories.live.getChannels('900');

  assert.equal(counts['900'], 0);
  assert.equal(channels.length, 0);
});

test('malformed provider category ids count the same as the browse resolver', async () => {
  const { client } = makeCountFakeClient();
  const repositories = createXtreamProviderRepositories(client);

  await repositories.live.getCategories();
  const counts = await repositories.live.getCategoryCounts();
  const fallbackChannels = await repositories.live.getChannels(LIVE_FALLBACK_ID);

  assert.equal(counts[LIVE_FALLBACK_ID], 2);
  assert.equal(fallbackChannels.length, 2);
});

test('repeated count reads reuse the cached "all" list (no extra Xtream calls)', async () => {
  const { client, calls } = makeCountFakeClient();
  const repositories = createXtreamProviderRepositories(client);

  await repositories.live.getCategories();
  const before = calls.getLiveStreams.length;
  await repositories.live.getCategoryCounts();
  await repositories.live.getCategoryCounts();
  await repositories.live.getCategoryCounts();

  const allFetches = calls.getLiveStreams.slice(before).filter((categoryId) => categoryId === undefined);
  assert.equal(allFetches.length, 1);
});

test('counts derive from cached "all" without a per-category network fetch', async () => {
  const { client, calls } = makeCountFakeClient();
  const repositories = createXtreamProviderRepositories(client);

  await repositories.live.getCategories();
  await repositories.live.getCategoryCounts(); // populates cached "all"
  const channels = await repositories.live.getChannels('801');

  // Browse derived from cached "all" -> the inflated per-category endpoint is never hit.
  assert.equal(calls.getLiveStreams.includes('801'), false);
  assert.equal(channels.length, 11);
});

test('a category browsed before counts overrides with its exact browsed length', async () => {
  const { client } = makeCountFakeClient();
  const repositories = createXtreamProviderRepositories(client);

  await repositories.live.getCategories();
  // Browse first (no cached "all" yet) -> resolves via the per-category endpoint.
  const channels = await repositories.live.getChannels('801');
  const counts = await repositories.live.getCategoryCounts();

  assert.equal(counts['801'], channels.length);
  assert.equal(counts['801'], 11);
});

test('badge count reflects total membership, not the capped loaded page', async () => {
  const bigCategoryMembers = XTREAM_MAX_ITEMS_PER_CATEGORY + 25;
  const { client } = makeCountFakeClient({
    categories: [
      { category_id: '999', category_name: 'Mega', channel_count: 3 },
    ],
    bigCategoryMembers,
  });
  const repositories = createXtreamProviderRepositories(client);

  await repositories.live.getCategories();
  const channels = await repositories.live.getChannels('999');
  const counts = await repositories.live.getCategoryCounts();

  // getChannels caps the loaded page; the badge must still show the true total.
  assert.equal(channels.length, XTREAM_MAX_ITEMS_PER_CATEGORY);
  assert.equal(counts['999'], bigCategoryMembers);
  assert.ok(counts['999'] > channels.length);
});

test('provider category-set change invalidates the resolved category cache', async () => {
  const { client, calls } = makeCountFakeClient();
  const repositories = createXtreamProviderRepositories(client);

  await repositories.live.getCategories();
  await repositories.live.getChannels('801'); // caches resolved 801

  // Provider switch: different category set -> resolved cache must be dropped.
  client.setCategories([
    { category_id: '700', category_name: 'Movies', channel_count: 9 },
  ]);
  await repositories.live.getCategories();
  const before = calls.getLiveStreams.length;
  await repositories.live.getChannels('801');

  // 801 is no longer a known category; it must re-resolve (a fresh network read),
  // proving the stale resolved entry was cleared.
  assert.ok(calls.getLiveStreams.length > before);
});

test('getCategoryCounts never emits a synthetic favorites bucket', async () => {
  const { client } = makeCountFakeClient();
  const repositories = createXtreamProviderRepositories(client);

  await repositories.live.getCategories();
  const counts = await repositories.live.getCategoryCounts();

  assert.equal(Object.prototype.hasOwnProperty.call(counts, 'favorites'), false);
});

test('the "all" pseudo-category resolves the full browseable membership', async () => {
  const { client } = makeCountFakeClient();
  const repositories = createXtreamProviderRepositories(client);

  await repositories.live.getCategories();
  const allChannels = await repositories.live.getChannels('all');
  const counts = await repositories.live.getCategoryCounts();

  const membershipTotal = Object.values(counts).reduce((sum, value) => sum + value, 0);
  // Every "all" channel belongs to exactly one counted bucket, so the sum of the
  // per-category counts equals the full browseable list length.
  assert.equal(allChannels.length, membershipTotal);
});
