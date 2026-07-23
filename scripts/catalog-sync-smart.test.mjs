import assert from 'node:assert/strict';
import test from 'node:test';

import { MAX_CATALOG_INDEX_ITEMS, buildCatalogCompleteness } from '../src/features/providers/catalogCompleteness.ts';
import { loadAllMoviesForCatalogIndex } from '../src/features/providers/catalogCategoryLoader.ts';
import {
  getMovieCatalogIndex,
  resetMovieCatalogIndex,
} from '../src/features/movies/smart/movieCatalogIndex.ts';
import {
  getSeriesCatalogIndex,
  resetSeriesCatalogIndex,
} from '../src/features/series/smart/seriesCatalogIndex.ts';
import {
  buildSmartCategoryContext,
  querySmartCategoryOnIndex,
  resolveSmartCategoryDefinition,
} from '../src/features/movies/smart/smartCategoryDefinitions.ts';
import {
  buildSmartSeriesCategoryContext,
  querySmartSeriesCategoryOnIndex,
  resolveSmartSeriesCategoryDefinition,
} from '../src/features/series/smart/smartSeriesCategoryDefinitions.ts';
import {
  clearSmartCategoryCacheForTests,
  readSmartCategoryCache,
  SMART_CATEGORY_CACHE_VERSION,
} from '../src/features/providers/smartCategoryCacheStore.ts';

const LARGE_CATALOG_SIZE = 12_500;
const MARKER_INDEX = 10_500;
const PROVIDER_A = 'provider-alpha';
const PROVIDER_B = 'provider-beta';
const currentYear = new Date().getFullYear();

function movieSummaryFromEntry(partial, index) {
  return {
    id: partial.id ?? `movie-${index + 1}`,
    title: partial.title ?? `Movie ${index + 1}`,
    categoryId: partial.categoryId ?? '1',
    rating: partial.rating,
    addedAt: partial.addedAt,
    releaseDate: partial.releaseDate,
    popularity: partial.popularity,
    year: partial.year,
    genres: partial.genres ?? ['Movies'],
    posterStyleKey: partial.posterStyleKey ?? 'ember',
  };
}

function buildLargeMovieSummaries() {
  return Array.from({ length: LARGE_CATALOG_SIZE }, (_, index) => {
    const isNewest = index === LARGE_CATALOG_SIZE - 1;
    const isDiscover = index === MARKER_INDEX;
    const isTopRated = index === MARKER_INDEX + 1;
    const isRecentlyAdded = index === MARKER_INDEX + 2;
    const isNewRelease = index === MARKER_INDEX + 3;

    return movieSummaryFromEntry(
      {
        id: isNewest
          ? 'movie-newest-beyond-10k'
          : isDiscover
            ? 'movie-discover-beyond-10k'
            : isTopRated
              ? 'movie-rated-beyond-10k'
              : isRecentlyAdded
                ? 'movie-added-beyond-10k'
                : isNewRelease
                  ? 'movie-newrelease-beyond-10k'
                  : undefined,
        title: isNewest
          ? 'Newest Beyond Ten K'
          : isDiscover
            ? 'Discover Beyond Ten K'
            : isTopRated
              ? 'Top Rated Beyond Ten K'
              : isRecentlyAdded
                ? 'Recently Added Beyond Ten K'
                : isNewRelease
                  ? 'New Release Beyond Ten K'
                  : undefined,
        rating: isTopRated ? '9.9' : '6.0',
        addedAt: isRecentlyAdded
          ? Date.now()
          : isNewest
            ? Date.now() - 1
            : 1_700_000_000_000 + index,
        year: isNewRelease ? currentYear : 2000,
        releaseDate: isNewRelease ? `${currentYear}-03-01` : undefined,
        popularity: isDiscover ? 999_999 : index,
      },
      index,
    );
  });
}

function buildLargeSeriesSummaries() {
  return Array.from({ length: LARGE_CATALOG_SIZE }, (_, index) => {
    const isNewest = index === LARGE_CATALOG_SIZE - 1;
    const isDiscover = index === MARKER_INDEX;
    const isNewRelease = index === MARKER_INDEX + 4;
    const seriesKey = isNewRelease ? 'unique-series-beyond-10k' : `series-${index + 1}`;

    return {
      id: isNewest
        ? 'series-newest-beyond-10k'
        : isDiscover
          ? 'series-discover-beyond-10k'
          : isNewRelease
            ? 'series-newrelease-beyond-10k'
            : `series-${index + 1}`,
      seriesId: seriesKey,
      title: isNewest
        ? 'Newest Series Beyond Ten K'
        : isDiscover
          ? 'Discover Series Beyond Ten K'
          : isNewRelease
            ? 'New Release Series Beyond Ten K'
            : `Series ${index + 1}`,
      categoryId: '1',
      rating: isDiscover ? '8.8' : '6.0',
      addedAt: isNewest ? Date.now() - 1 : 1_700_000_000_000 + index,
      latestEpisodeDate: isNewRelease ? `${currentYear}-04-01` : undefined,
      year: isNewRelease ? String(currentYear) : '2010',
      popularity: isDiscover ? 888_888 : index,
      genres: ['Series'],
      posterStyleKey: 'signal',
    };
  });
}

function ingestMovies(providerId, summaries) {
  const index = getMovieCatalogIndex(providerId);
  index.beginSync();
  index.ingest(summaries);
  return index;
}

function ingestSeries(providerId, summaries) {
  const index = getSeriesCatalogIndex(providerId);
  index.beginSync();
  index.ingest(summaries);
  return index;
}

test('catalog index ingests all 12500 unique movies with complete metadata', () => {
  resetMovieCatalogIndex(PROVIDER_A);
  const index = ingestMovies(PROVIDER_A, buildLargeMovieSummaries());
  const completeness = index.getCompleteness();

  assert.equal(index.size, LARGE_CATALOG_SIZE);
  assert.equal(completeness.knownCatalogTotal, LARGE_CATALOG_SIZE);
  assert.equal(completeness.itemsIndexed, LARGE_CATALOG_SIZE);
  assert.equal(completeness.catalogComplete, true);
});

test('catalog index ingests all 12500 unique series with complete metadata', () => {
  resetSeriesCatalogIndex(PROVIDER_A);
  const index = ingestSeries(PROVIDER_A, buildLargeSeriesSummaries());
  const completeness = index.getCompleteness();

  assert.equal(index.size, LARGE_CATALOG_SIZE);
  assert.equal(completeness.knownCatalogTotal, LARGE_CATALOG_SIZE);
  assert.equal(completeness.itemsIndexed, LARGE_CATALOG_SIZE);
  assert.equal(completeness.catalogComplete, true);
});

test('smart new releases curates large catalogs down to 50 newest titles', () => {
  resetMovieCatalogIndex(PROVIDER_A);
  const index = ingestMovies(PROVIDER_A, buildLargeMovieSummaries());
  const definition = resolveSmartCategoryDefinition('smart:new-releases');
  assert.ok(definition);

  const ctx = buildSmartCategoryContext({
    providerId: PROVIDER_A,
    favorites: [],
    watchlist: [],
    continueWatching: [],
    recentlyWatched: [],
    lastWatchedGenres: [],
  });

  const result = querySmartCategoryOnIndex(index, definition, ctx, 0, 50);
  const ids = result.filtered.map((entry) => entry.id);

  assert.equal(result.totalCount, 50);
  assert.equal(result.filtered.length, 50);
  assert.ok(ids.includes('movie-newest-beyond-10k'));
  assert.ok(ids.includes('movie-added-beyond-10k'));
});

test('smart discover selects movie marker beyond index 10000 after filter and sort', () => {
  resetMovieCatalogIndex(PROVIDER_A);
  const index = ingestMovies(PROVIDER_A, buildLargeMovieSummaries());
  const definition = resolveSmartCategoryDefinition('smart:discover');
  assert.ok(definition);

  const ctx = buildSmartCategoryContext({
    providerId: PROVIDER_A,
    favorites: [],
    watchlist: [],
    continueWatching: [],
    recentlyWatched: [],
    lastWatchedGenres: [],
  });

  const result = querySmartCategoryOnIndex(index, definition, ctx, 0, 40);
  assert.equal(result.filtered[0]?.id, 'movie-discover-beyond-10k');
});

test('rating-based smart selection can rank movie beyond index 10000', () => {
  resetMovieCatalogIndex(PROVIDER_A);
  const index = ingestMovies(PROVIDER_A, buildLargeMovieSummaries());
  const ctx = buildSmartCategoryContext({
    providerId: PROVIDER_A,
    favorites: [],
    watchlist: [],
    continueWatching: [],
    recentlyWatched: [],
    lastWatchedGenres: [],
  });

  const definition = resolveSmartCategoryDefinition('smart:discover');
  assert.ok(definition);

  const rated = querySmartCategoryOnIndex(
    index,
    {
      ...definition,
      key: 'top-rated-test',
      maxItems: 50,
      predicate: (entry) => entry.rating >= 9,
      sort: (left, right) => right.rating - left.rating || right.added - left.added,
    },
    ctx,
    0,
    50,
  );

  assert.equal(rated.filtered[0]?.id, 'movie-rated-beyond-10k');
  assert.ok(index.getEntry('movie-rated-beyond-10k'));
});

test('smart new releases keeps globally newest markers in the curated 50', () => {
  resetMovieCatalogIndex(PROVIDER_A);
  const index = ingestMovies(PROVIDER_A, buildLargeMovieSummaries());
  const ctx = buildSmartCategoryContext({
    providerId: PROVIDER_A,
    favorites: [],
    watchlist: [],
    continueWatching: [],
    recentlyWatched: [],
    lastWatchedGenres: [],
  });

  const definition = resolveSmartCategoryDefinition('smart:new-releases');
  assert.ok(definition);

  const result = querySmartCategoryOnIndex(index, definition, ctx, 0, 50);
  const ids = result.filtered.map((entry) => entry.id);
  assert.ok(ids.includes('movie-added-beyond-10k') || ids.includes('movie-newest-beyond-10k'));
});

test('series new releases curates large catalogs to 50 unique series', () => {
  resetSeriesCatalogIndex(PROVIDER_A);
  const index = ingestSeries(PROVIDER_A, buildLargeSeriesSummaries());
  const definition = resolveSmartSeriesCategoryDefinition('new-releases');
  assert.ok(definition);

  const ctx = buildSmartSeriesCategoryContext({
    providerId: PROVIDER_A,
    favorites: [],
    watchlist: [],
    continueWatching: [],
    recentlyWatched: [],
  });

  const result = querySmartSeriesCategoryOnIndex(index, definition, ctx, 0, 50);
  const ids = result.items.map((entry) => entry.id);

  assert.equal(result.totalCount, 50);
  assert.equal(new Set(result.items.map((entry) => entry.seriesId)).size, 50);
  assert.ok(ids.includes('series-newest-beyond-10k'));
});

test('series discover selects marker beyond index 10000', () => {
  resetSeriesCatalogIndex(PROVIDER_A);
  const index = ingestSeries(PROVIDER_A, buildLargeSeriesSummaries());
  const definition = resolveSmartSeriesCategoryDefinition('discover');
  assert.ok(definition);

  const ctx = buildSmartSeriesCategoryContext({
    providerId: PROVIDER_A,
    favorites: [],
    watchlist: [],
    continueWatching: [],
    recentlyWatched: [],
  });

  const result = querySmartSeriesCategoryOnIndex(index, definition, ctx, 0, 40);
  assert.equal(result.items[0]?.id, 'series-discover-beyond-10k');
});

test('catalog loader paginates beyond 10000 when listCategoryMovies is unavailable', async () => {
  const summaries = buildLargeMovieSummaries();
  let callCount = 0;

  const dataSource = {
    async getCategories() {
      return [{ id: '1', name: 'Large', count: summaries.length }];
    },
    async getMoviesPage({ offset, limit }) {
      callCount += 1;
      const items = summaries.slice(offset, offset + limit);
      return {
        items,
        totalCount: summaries.length,
        hasMore: offset + items.length < summaries.length,
      };
    },
  };

  const loaded = await loadAllMoviesForCatalogIndex(dataSource, '1');

  assert.equal(loaded.items.length, LARGE_CATALOG_SIZE);
  assert.equal(loaded.truncated, false);
  assert.ok(callCount > 10);
  assert.equal(loaded.items.at(-1)?.id, 'movie-newest-beyond-10k');
});

test('catalog completeness reports incomplete when safety limit is exceeded', () => {
  resetMovieCatalogIndex(PROVIDER_A);
  const index = getMovieCatalogIndex(PROVIDER_A);
  index.beginSync();

  const oversized = Array.from({ length: MAX_CATALOG_INDEX_ITEMS + 1 }, (_, index) =>
    movieSummaryFromEntry({ id: `overflow-${index + 1}` }, index),
  );

  index.ingest(oversized);
  const completeness = index.getCompleteness();

  assert.equal(completeness.itemsIndexed, MAX_CATALOG_INDEX_ITEMS);
  assert.equal(completeness.knownCatalogTotal, MAX_CATALOG_INDEX_ITEMS + 1);
  assert.equal(completeness.catalogComplete, false);
});

test('buildCatalogCompleteness does not claim complete without evidence', () => {
  const incomplete = buildCatalogCompleteness(12_500, 10_000, { indexTruncated: true });
  assert.equal(incomplete.catalogComplete, false);

  const truncatedLoad = buildCatalogCompleteness(12_500, 12_500, { categoryLoadTruncated: true });
  assert.equal(truncatedLoad.catalogComplete, false);
});

test('smart category cache version 1 entries are invalidated', async () => {
  clearSmartCategoryCacheForTests(PROVIDER_A);

  const storage = new Map();
  const originalGetItem = globalThis.AsyncStorage?.getItem;
  const originalSetItem = globalThis.AsyncStorage?.setItem;

  globalThis.AsyncStorage = {
    getItem: async (key) => storage.get(key) ?? null,
    setItem: async (key, value) => {
      storage.set(key, value);
    },
    removeItem: async (key) => {
      storage.delete(key);
    },
  };

  storage.set(
    '@novacast/smart-category-cache/provider-alpha/movie',
    JSON.stringify({
      providerId: PROVIDER_A,
      mediaType: 'movie',
      version: 1,
      generatedAt: Date.now(),
      entries: {
        discover: { categoryKey: 'discover', title: 'Discover', count: 40, itemIds: ['stale-1'] },
      },
    }),
  );

  const cache = await readSmartCategoryCache(PROVIDER_A, 'movie');
  assert.equal(cache.version, SMART_CATEGORY_CACHE_VERSION);
  assert.equal(Object.keys(cache.entries).length, 0);
  assert.equal(cache.catalogCompleteness, undefined);

  if (originalGetItem) {
    globalThis.AsyncStorage.getItem = originalGetItem;
    globalThis.AsyncStorage.setItem = originalSetItem;
  } else {
    delete globalThis.AsyncStorage;
  }
});

test('provider movie catalogs cannot contaminate each other', () => {
  resetMovieCatalogIndex(PROVIDER_A);
  resetMovieCatalogIndex(PROVIDER_B);

  ingestMovies(PROVIDER_A, [movieSummaryFromEntry({ id: 'alpha-only', title: 'Alpha Only' }, 0)]);
  ingestMovies(PROVIDER_B, [movieSummaryFromEntry({ id: 'beta-only', title: 'Beta Only' }, 0)]);

  const alpha = getMovieCatalogIndex(PROVIDER_A);
  const beta = getMovieCatalogIndex(PROVIDER_B);

  assert.ok(alpha.getEntry('alpha-only'));
  assert.equal(alpha.getEntry('beta-only'), undefined);
  assert.ok(beta.getEntry('beta-only'));
  assert.equal(beta.getEntry('alpha-only'), undefined);
});

test('movie and series catalog indexes remain separate', () => {
  resetMovieCatalogIndex(PROVIDER_A);
  resetSeriesCatalogIndex(PROVIDER_A);

  ingestMovies(PROVIDER_A, [movieSummaryFromEntry({ id: 'movie-only', title: 'Movie Only' }, 0)]);
  ingestSeries(PROVIDER_A, [
    {
      id: 'series-only',
      seriesId: 'series-only',
      title: 'Series Only',
      categoryId: '1',
      genres: ['Series'],
      posterStyleKey: 'signal',
    },
  ]);

  const movies = getMovieCatalogIndex(PROVIDER_A);
  const series = getSeriesCatalogIndex(PROVIDER_A);

  assert.equal(movies.size, 1);
  assert.equal(series.size, 1);
  assert.ok(movies.getEntry('movie-only'));
  assert.equal(movies.getEntry('series-only'), undefined);
  assert.ok(series.getEntry('series-only'));
  assert.equal(series.getEntry('movie-only'), undefined);
});

test('smart category cache version bumped to invalidate truncated v1 caches', () => {
  assert.ok(SMART_CATEGORY_CACHE_VERSION >= 2);
});
