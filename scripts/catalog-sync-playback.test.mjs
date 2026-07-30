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

async function waitUntil(predicate, { timeoutMs = 5000, intervalMs = 20, label = 'condition' } = {}) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) {
      return;
    }
    await sleep(intervalMs);
  }
  throw new Error(`Timed out waiting for ${label}`);
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
  await waitUntil(() => mock.controls.movieFetchStarted, { label: 'movie fetch after playback end' });
  mock.controls.releaseMovies();
  mock.controls.releaseSeries();
  await task;
});

test('movie and series heavy fetches pause while playback is active', async () => {
  const mock = createMockSyncInput();
  const task = scheduleProviderCatalogSync(mock.input);

  await waitUntil(() => mock.controls.movieFetchStarted, { label: 'movie fetch start' });

  registerPlaybackActivity('movie');
  await sleep(80);
  assert.equal(isPlaybackActivityActive(), true);

  unregisterPlaybackActivity();
  await sleep(120);
  mock.controls.releaseMovies();
  mock.controls.releaseSeries();
  await task;

  assert.equal(mock.controls.seriesCategoriesResolved, true);
});

test('pending sync resumes after playback closes without duplicate in-flight jobs', async () => {
  registerPlaybackActivity('episode');
  const mock = createMockSyncInput();

  const task = scheduleProviderCatalogSync(mock.input);
  scheduleProviderCatalogSync(mock.input);

  await sleep(80);
  assert.equal(mock.controls.movieFetchStarted, false);
  assert.deepEqual(getProviderCatalogSyncTestState().inFlightProviderIds, ['demo-provider']);

  unregisterPlaybackActivity();
  await waitUntil(() => mock.controls.movieFetchStarted, { label: 'movie fetch after playback' });
  mock.controls.releaseMovies();
  mock.controls.releaseSeries();
  await task;

  await waitUntil(
    () =>
      getProviderCatalogSyncTestState().inFlightProviderIds.length === 0 &&
      getProviderCatalogSyncTestState().pendingProviderIds.length === 0,
    { label: 'sync flights drained after pending resume' },
  );
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

test('duplicate schedule for one provider shares in-flight work', async () => {
  const mock = createMockSyncInput('provider-shared');
  const taskA = scheduleProviderCatalogSync(mock.input);
  const taskB = scheduleProviderCatalogSync(mock.input);
  assert.equal(taskA, taskB);

  await waitUntil(() => mock.controls.movieFetchStarted, { label: 'shared provider movie fetch' });
  assert.deepEqual(getProviderCatalogSyncTestState().inFlightProviderIds, ['provider-shared']);

  mock.controls.releaseMovies();
  mock.controls.releaseSeries();
  await taskA;
});

test('movie and series jobs for one provider can overlap', async () => {
  const mock = createMockSyncInput('provider-overlap');
  const task = scheduleProviderCatalogSync(mock.input);

  await waitUntil(
    () => mock.controls.movieFetchStarted && mock.controls.seriesFetchStarted,
    { label: 'overlapping movie+series fetch' },
  );

  mock.controls.releaseMovies();
  mock.controls.releaseSeries();
  await task;
});

test('sync failure does not affect playback activity state', async () => {
  registerPlaybackActivity('movie');
  const mock = createMockSyncInput();
  let movieFetchAttempted = false;
  mock.input.movies.listCategoryMovies = async () => {
    movieFetchAttempted = true;
    throw new Error('simulated sync failure');
  };

  const task = scheduleProviderCatalogSync(mock.input);
  await sleep(100);

  assert.equal(isPlaybackActivityActive(), true);
  unregisterPlaybackActivity();
  await waitUntil(() => movieFetchAttempted, { label: 'failed movie fetch start' });
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

  await waitUntil(() => mock.controls.movieFetchStarted, { label: 'resume after defer cycles' });
  mock.controls.releaseMovies();
  mock.controls.releaseSeries();
  await firstTask;

  await waitUntil(
    () =>
      getProviderCatalogSyncTestState().inFlightProviderIds.length === 0 &&
      getProviderCatalogSyncTestState().pendingProviderIds.length === 0,
    { label: 'defer-cycle sync drained' },
  );
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
  await waitUntil(() => mock.controls.movieFetchStarted, { label: 'movie fetch after metadata-only phase' });
  mock.controls.releaseMovies();
  mock.controls.releaseSeries();
  await task;
});

test('category batch references are released after processing', async () => {
  const mock = createMockSyncInput();
  const task = scheduleProviderCatalogSync(mock.input);

  await waitUntil(() => mock.controls.movieFetchStarted, { label: 'movie fetch for batch release' });
  mock.controls.releaseMovies();
  await waitUntil(
    () => Boolean(getLastReleasedBatchLabelForTests()?.startsWith('movie-category:')),
    { label: 'movie-category batch released' },
  );

  mock.controls.releaseSeries();
  await task;
});
