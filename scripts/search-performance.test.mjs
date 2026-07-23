import assert from 'node:assert/strict';
import test from 'node:test';

import { resetMovieCatalogIndex, getMovieCatalogIndex } from '../src/features/movies/smart/movieCatalogIndex.ts';
import { resetSeriesCatalogIndex, getSeriesCatalogIndex } from '../src/features/series/smart/seriesCatalogIndex.ts';
import { searchMovies } from '../src/features/search/repositories/movieSearchRepository.ts';
import { searchSeries } from '../src/features/search/repositories/seriesSearchRepository.ts';
import {
  createEmptyGroupedResults,
  searchGlobalGroupedIncremental,
} from '../src/features/search/repositories/globalSearchRepository.ts';
import { scanCatalogForSearch } from '../src/features/search/searchCatalogScan.ts';
import { SEARCH_PROVIDER_FALLBACK_TIMEOUT_MS } from '../src/features/search/searchConstants.ts';
import { getSearchIndexReadiness } from '../src/features/search/searchIndexReadiness.ts';
import { withSearchTimeout } from '../src/features/search/searchTiming.ts';
import { resetLiveChannelIndex } from '../src/features/search/liveChannelIndex.ts';

const sampleMovie = {
  id: 'movie-1',
  categoryId: 'horror',
  title: 'Comedy Night',
  year: 2020,
  genres: ['Comedy'],
  description: 'A light comedy.',
  posterStyleKey: 'default',
};

const sampleSeries = {
  id: 'series-1',
  categoryId: 'drama',
  title: 'Family Tales',
  year: '2019',
  genres: ['Drama'],
  description: 'A family drama.',
  posterStyleKey: 'default',
  seriesId: 'series-root-1',
};

test('populated movie index with zero hits skips slow provider fallback', async () => {
  resetMovieCatalogIndex('perf-provider');
  getMovieCatalogIndex('perf-provider').ingest([sampleMovie]);

  let providerCalled = false;
  const startedAt = Date.now();
  const result = await searchMovies('perf-provider', {
    async searchMovies() {
      providerCalled = true;
      await new Promise((resolve) => setTimeout(resolve, 5_000));
      return { items: [], totalCount: 0, hasMore: false };
    },
  }, {
    providerId: 'perf-provider',
    query: 'Scary',
    offset: 0,
    limit: 50,
  });

  assert.equal(providerCalled, false);
  assert.equal(result.totalCount, 0);
  assert.ok(Date.now() - startedAt < 500);
  resetMovieCatalogIndex('perf-provider');
});

test('populated series index with zero hits skips slow provider fallback', async () => {
  resetSeriesCatalogIndex('perf-provider');
  getSeriesCatalogIndex('perf-provider').ingest([sampleSeries]);

  let providerCalled = false;
  const startedAt = Date.now();
  const result = await searchSeries('perf-provider', {
    async searchSeries() {
      providerCalled = true;
      await new Promise((resolve) => setTimeout(resolve, 5_000));
      return { items: [], totalCount: 0, hasMore: false };
    },
  }, {
    providerId: 'perf-provider',
    query: 'Scary',
    offset: 0,
    limit: 50,
  });

  assert.equal(providerCalled, false);
  assert.equal(result.totalCount, 0);
  assert.ok(Date.now() - startedAt < 500);
  resetSeriesCatalogIndex('perf-provider');
});

test('scanCatalogForSearch returns ranked limited page from in-memory entries', () => {
  const entries = [
    { id: '1', title: 'Scary Movie', meta: 'horror' },
    { id: '2', title: 'Scary Stories', meta: 'horror' },
    { id: '3', title: 'Action Hero', meta: 'action' },
  ];

  const page = scanCatalogForSearch({
    query: 'scary',
    offset: 0,
    limit: 1,
    forEachEntry: (visit) => entries.forEach(visit),
    toCandidate: (entry) => ({ title: entry.title, metadata: entry.meta }),
    toResult: (entry) => entry,
  });

  assert.equal(page.totalCount, 2);
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0]?.title, 'Scary Movie');
  assert.equal(page.hasMore, true);
});

test('withSearchTimeout rejects long-running provider fallback', async () => {
  await assert.rejects(
    () =>
      withSearchTimeout(
        new Promise((resolve) => setTimeout(resolve, SEARCH_PROVIDER_FALLBACK_TIMEOUT_MS + 250)),
        100,
        'Search timed out while indexing.',
      ),
    /timed out/i,
  );
});

test('search index readiness reflects populated catalogs', () => {
  resetMovieCatalogIndex('ready-provider');
  resetSeriesCatalogIndex('ready-provider');

  getMovieCatalogIndex('ready-provider').ingest([sampleMovie]);
  const readiness = getSearchIndexReadiness('ready-provider');
  assert.equal(readiness.moviesReady, true);
  assert.equal(readiness.seriesReady, false);
  assert.equal(readiness.anyReady, true);

  resetMovieCatalogIndex('ready-provider');
  resetSeriesCatalogIndex('ready-provider');
});

test('global grouped search emits partial scope results incrementally', async () => {
  resetMovieCatalogIndex('group-provider');
  resetSeriesCatalogIndex('group-provider');
  resetLiveChannelIndex('group-provider');
  getMovieCatalogIndex('group-provider').ingest([
    { ...sampleMovie, id: 'movie-scary', title: 'Scary Movie' },
  ]);

  const partialSnapshots = [];
  const grouped = await searchGlobalGroupedIncremental(
    {
      providerId: 'group-provider',
      movies: null,
      seriesDataSource: null,
    },
    'scary',
    undefined,
    (partial) => {
      partialSnapshots.push({
        movieCount: partial.movie.items.length,
        seriesCount: partial.series.items.length,
      });
    },
  );

  assert.ok(partialSnapshots.length >= 1);
  assert.equal(grouped.movie.items.length, 1);
  assert.equal(grouped.movie.items[0]?.title, 'Scary Movie');
  assert.deepEqual(createEmptyGroupedResults(), {
    live: { items: [], totalCount: 0, hasMore: false },
    movie: { items: [], totalCount: 0, hasMore: false },
    series: { items: [], totalCount: 0, hasMore: false },
    guide: { items: [], totalCount: 0, hasMore: false },
  });
  resetMovieCatalogIndex('group-provider');
  resetSeriesCatalogIndex('group-provider');
  resetLiveChannelIndex('group-provider');
});
