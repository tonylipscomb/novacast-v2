import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clearCatalogSyncResumeForTests,
  shouldYieldCatalogSync,
} from '../src/features/providers/catalogSyncPlayback.ts';
import {
  cancelProviderCatalogSync,
  clearProviderCatalogSyncForTests,
  getLastReleasedBatchLabelForTests,
  getProviderCatalogSyncTestState,
  scheduleProviderCatalogSync,
} from '../src/features/providers/providerCatalogSync.ts';
import {
  isPlaybackActivityActive,
  registerPlaybackActivity,
  resetPlaybackActivityForTests,
  unregisterPlaybackActivity,
} from '../src/features/playback/playbackActivityStore.ts';
import { resetMovieCatalogIndex } from '../src/features/movies/smart/movieCatalogIndex.ts';
import { resetSeriesCatalogIndex } from '../src/features/series/smart/seriesCatalogIndex.ts';
import { clearCategoryCountIndexCacheForTests } from '../src/features/providers/categoryCountIndexStore.ts';
import { clearMoviesSettingsCacheForTests } from '../src/features/movies/smart/moviesSettingsStore.ts';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createDeferred() {
  let resolve;
  const promise = new Promise((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function createMockSyncInput(providerId = 'demo-provider') {
  let movieCategoriesResolved = false;
  let seriesCategoriesResolved = false;
  let movieFetchStarted = false;
  let seriesFetchStarted = false;
  const movieGate = createDeferred();
  const seriesGate = createDeferred();

  const movies = {
    async getCategories() {
      movieCategoriesResolved = true;
      return [
        { id: 'movie-1', renderKey: 'movie-1', name: 'Action', count: 1 },
        { id: 'movie-2', renderKey: 'movie-2', name: 'Drama', count: 1 },
      ];
    },
    async listCategoryMovies(categoryId) {
      movieFetchStarted = true;
      await movieGate.promise;
      return [{ id: `${categoryId}-item`, categoryId, title: 'Movie', posterStyleKey: 'ember', genres: ['Action'] }];
    },
    async getCategoryCount() {
      return 1;
    },
  };

  const series = {
    async getCategories() {
      seriesCategoriesResolved = true;
      return [
        { id: 'series-1', renderKey: 'series-1', name: 'Drama', count: 1 },
        { id: 'series-2', renderKey: 'series-2', name: 'Comedy', count: 1 },
      ];
    },
    async getSeries(categoryId) {
      seriesFetchStarted = true;
      await seriesGate.promise;
      return [
        {
          id: `${categoryId}-series`,
          seriesId: `${categoryId}-series`,
          title: 'Series',
          year: '2024',
          rating: '8.0',
          tone: '#123456',
        },
      ];
    },
  };

  const live = {
    async getCategories() {
      return [{ id: 'live-1', renderKey: 'live-1', name: 'US', count: 2, icon: 'flag-outline' }];
    },
  };

  return {
    input: { providerId, movies, series, live },
    controls: {
      get movieCategoriesResolved() {
        return movieCategoriesResolved;
      },
      get seriesCategoriesResolved() {
        return seriesCategoriesResolved;
      },
      get movieFetchStarted() {
        return movieFetchStarted;
      },
      get seriesFetchStarted() {
        return seriesFetchStarted;
      },
      releaseMovies() {
        movieGate.resolve();
      },
      releaseSeries() {
        seriesGate.resolve();
      },
    },
  };
}

test.beforeEach(() => {
  resetPlaybackActivityForTests();
  clearProviderCatalogSyncForTests();
  clearCatalogSyncResumeForTests();
  clearCategoryCountIndexCacheForTests();
  clearMoviesSettingsCacheForTests();
  resetMovieCatalogIndex();
  resetSeriesCatalogIndex();
});

test('sync does not start heavy movie fetch while playback is active', async () => {
  registerPlaybackActivity('live-preview');
  const mock = createMockSyncInput();

  const task = scheduleProviderCatalogSync(mock.input);
  await sleep(100);

  assert.equal(isPlaybackActivityActive(), true);
  assert.equal(mock.controls.movieCategoriesResolved, true);
  assert.equal(mock.controls.movieFetchStarted, false);
  assert.deepEqual(getProviderCatalogSyncTestState().inFlightProviderIds, ['demo-provider']);

  unregisterPlaybackActivity();
  await sleep(3500);
  mock.controls.releaseMovies();
  mock.controls.releaseSeries();
  await task;
});

test('active sync yields before series fetch until playback ends', async () => {
  const mock = createMockSyncInput();
  const task = scheduleProviderCatalogSync(mock.input);

  await sleep(20);
  assert.equal(mock.controls.movieFetchStarted, true);
  mock.controls.releaseMovies();

  await sleep(20);
  registerPlaybackActivity('movie');

  await sleep(100);
  assert.equal(mock.controls.seriesFetchStarted, false);

  unregisterPlaybackActivity();
  await sleep(3500);
  mock.controls.releaseSeries();
  await task;

  assert.equal(mock.controls.seriesCategoriesResolved, true);
});

test('pending sync resumes after playback closes without duplicate in-flight jobs', async () => {
  registerPlaybackActivity('episode');
  const mock = createMockSyncInput();

  scheduleProviderCatalogSync(mock.input);
  scheduleProviderCatalogSync(mock.input);

  await sleep(100);
  assert.equal(mock.controls.movieFetchStarted, false);
  assert.deepEqual(getProviderCatalogSyncTestState().inFlightProviderIds, ['demo-provider']);

  unregisterPlaybackActivity();
  await sleep(3500);
  mock.controls.releaseMovies();
  mock.controls.releaseSeries();

  await sleep(300);
  assert.equal(getProviderCatalogSyncTestState().pendingProviderIds.length, 0);
});

test('shouldYieldCatalogSync reflects playback activity state', () => {
  assert.equal(shouldYieldCatalogSync(), false);
  registerPlaybackActivity('live-fullscreen');
  assert.equal(shouldYieldCatalogSync(), true);
  unregisterPlaybackActivity();
  assert.equal(shouldYieldCatalogSync(), false);
});

test('legacy catalog persistence remains disabled', async () => {
  const movieIndexSource = await import('../src/features/movies/smart/movieCatalogIndex.ts');
  const index = movieIndexSource.getMovieCatalogIndex('legacy-check');
  index.ingest([
    {
      id: '1',
      categoryId: 'cat',
      title: 'Title',
      posterStyleKey: 'ember',
      genres: ['Action'],
    },
  ]);

  const counts = index.buildCategoryCounts();
  assert.equal(counts.cat, 1);
  assert.equal(index.listAllEntries().length, 1);

  const seriesIndexSource = await import('../src/features/series/smart/seriesCatalogIndex.ts');
  const seriesIndex = seriesIndexSource.getSeriesCatalogIndex('legacy-check');
  seriesIndex.ingest([
    {
      id: '2',
      categoryId: 'cat',
      seriesId: '2',
      title: 'Series',
      year: '2024',
      rating: '8.0',
      posterStyleKey: 'ember',
      genres: ['Drama'],
    },
  ]);
  assert.equal(seriesIndex.buildCategoryCounts().cat, 1);
});

test('heavy catalog sync jobs do not run concurrently', async () => {
  const providerA = createMockSyncInput('provider-a');
  const providerB = createMockSyncInput('provider-b');
  let providerBMovieFetchDuringA = false;

  const originalListCategoryMovies = providerA.input.movies.listCategoryMovies;
  providerA.input.movies.listCategoryMovies = async (categoryId) => {
    const result = await originalListCategoryMovies(categoryId);
    if (providerB.controls.movieFetchStarted) {
      providerBMovieFetchDuringA = true;
    }
    return result;
  };

  const taskA = scheduleProviderCatalogSync(providerA.input);
  await sleep(30);
  const taskB = scheduleProviderCatalogSync(providerB.input);
  await sleep(30);

  assert.equal(providerA.controls.movieFetchStarted, true);
  assert.equal(providerB.controls.movieFetchStarted, false);

  providerA.controls.releaseMovies();
  providerA.controls.releaseSeries();
  await taskA;

  await sleep(50);
  assert.equal(providerB.controls.movieFetchStarted, true);
  assert.equal(providerBMovieFetchDuringA, false);

  providerB.controls.releaseMovies();
  providerB.controls.releaseSeries();
  await taskB;
});

test('sync failure does not affect playback activity state', async () => {
  registerPlaybackActivity('movie');
  const mock = createMockSyncInput();
  mock.input.movies.listCategoryMovies = async () => {
    throw new Error('simulated sync failure');
  };

  const task = scheduleProviderCatalogSync(mock.input);
  await sleep(100);

  assert.equal(isPlaybackActivityActive(), true);
  unregisterPlaybackActivity();
  await sleep(3500);
  mock.controls.releaseMovies();
  mock.controls.releaseSeries();
  await task.catch(() => {});
  assert.equal(isPlaybackActivityActive(), false);
});

test('repeated playback defer/resume cycles do not duplicate in-flight sync', async () => {
  const mock = createMockSyncInput();

  registerPlaybackActivity('live-preview');
  const firstTask = scheduleProviderCatalogSync(mock.input);
  await sleep(50);
  unregisterPlaybackActivity();

  registerPlaybackActivity('movie');
  scheduleProviderCatalogSync(mock.input);
  await sleep(50);
  unregisterPlaybackActivity();

  assert.equal(getProviderCatalogSyncTestState().inFlightProviderIds.length, 1);

  await sleep(3500);
  mock.controls.releaseMovies();
  mock.controls.releaseSeries();
  await firstTask;
  await sleep(200);

  assert.equal(getProviderCatalogSyncTestState().inFlightProviderIds.length, 0);
  assert.equal(getProviderCatalogSyncTestState().pendingProviderIds.length, 0);
});

test('provider reset cancels pending sync safely', async () => {
  registerPlaybackActivity('live-preview');
  const mock = createMockSyncInput();

  scheduleProviderCatalogSync(mock.input);
  await sleep(50);

  cancelProviderCatalogSync('demo-provider');
  assert.deepEqual(getProviderCatalogSyncTestState().pendingProviderIds, []);
  assert.ok(getProviderCatalogSyncTestState().syncGeneration > 0);

  unregisterPlaybackActivity();
});

test('lightweight category metadata resolves while playback is active', async () => {
  registerPlaybackActivity('live-fullscreen');
  const mock = createMockSyncInput();

  const task = scheduleProviderCatalogSync(mock.input);
  await sleep(100);

  assert.equal(mock.controls.movieCategoriesResolved, true);
  assert.equal(mock.controls.seriesCategoriesResolved, true);
  assert.equal(mock.controls.movieFetchStarted, false);

  unregisterPlaybackActivity();
  await sleep(3500);
  mock.controls.releaseMovies();
  mock.controls.releaseSeries();
  await task;
});

test('category batch references are released after processing', async () => {
  const mock = createMockSyncInput();
  const task = scheduleProviderCatalogSync(mock.input);

  await sleep(30);
  mock.controls.releaseMovies();
  await sleep(100);

  assert.ok(getLastReleasedBatchLabelForTests()?.startsWith('movie-category:'));

  mock.controls.releaseSeries();
  await task;
});
