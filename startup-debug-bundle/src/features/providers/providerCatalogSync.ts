import AsyncStorage from '@react-native-async-storage/async-storage';
import type { MovieDataSource } from '../movies/data/MovieDataSource.ts';
import { getMovieCatalogIndex } from '../movies/smart/movieCatalogIndex.ts';
import {
  buildSmartCategoryContext,
  getActiveSmartCategoryDefinitions,
  querySmartCategoryOnIndex,
} from '../movies/smart/smartCategoryDefinitions.ts';
import {
  getContinueWatchingIds,
  getFavoriteIds,
  getLastWatchedMovie,
  getRecentlyWatchedIds,
  getWatchlistIds,
} from '../movies/smart/movieLibraryStore.ts';
import { isPlaybackActivityActive } from '../playback/playbackActivityStore.ts';
import type { ProviderLiveRepository, ProviderSeriesRepository } from './providerRepositories.ts';
import {
  scheduleCatalogSyncResume,
  shouldYieldCatalogSync,
  waitForCatalogSyncIdleSlot,
  waitUntilPlaybackIdleForCatalogSync,
} from './catalogSyncPlayback.ts';
import {
  getCategoryCountIndexSync,
  sumCategoryCounts,
  writeCategoryCountIndex,
  type CategoryCountIndex,
} from './categoryCountIndexStore.ts';
import { writeProviderLibrarySummary } from './providerLibrarySummaryStore.ts';
import {
  SMART_CATEGORY_CACHE_VERSION,
  getSmartCategoryCacheSync,
  writeSmartCategoryCache,
  type SmartCategoryCacheEntry,
} from './smartCategoryCacheStore.ts';
import { getSeriesCatalogIndex } from '../series/smart/seriesCatalogIndex.ts';
import {
  getContinueWatchingEntries,
  getFavoriteIds as getMediaFavoriteIds,
  getRecentlyWatchedIds as getMediaRecentlyWatchedIds,
  getWatchlistIds as getMediaWatchlistIds,
} from '../media-browser/mediaLibraryStore.ts';
import { createProviderSeriesDataSource } from '../series/data/ProviderSeriesDataSource.ts';
import { getMoviesSettings } from '../movies/smart/moviesSettingsStore.ts';
import {
  buildSmartSeriesCategoryContext,
  getActiveSmartSeriesCategoryDefinitions,
  querySmartSeriesCategoryOnIndex,
} from '../series/smart/smartSeriesCategoryDefinitions.ts';

const PERF_LOG_PREFIX = '[NovaCast CatalogSync]';
const MAX_CATALOG_INDEX_ITEMS = 10_000;
const CATALOG_SYNC_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const CATALOG_SYNC_CHECKPOINT_VERSION = 1;
const CATALOG_SYNC_CHECKPOINT_PREFIX = '@novacast/catalog-sync-checkpoint/';
const syncInFlight = new Map<string, Promise<void>>();
const pendingSyncInputs = new Map<string, ProviderCatalogSyncInput>();
const syncListeners = new Map<string, Set<(phase: CatalogSyncPhase) => void>>();

let heavyCatalogChain: Promise<void> = Promise.resolve();
let syncGeneration = 0;
let lastReleasedBatchLabel: string | null = null;

export type CatalogSyncPhase = 'idle' | 'syncing' | 'smart-building' | 'ready' | 'error';

type CatalogSyncCheckpoint = {
  version: typeof CATALOG_SYNC_CHECKPOINT_VERSION;
  providerId: string;
  smartCategoriesEnabled: boolean;
  movieCategoryIds: string[];
  seriesCategoryIds: string[];
  movieIndex: number;
  seriesIndex: number;
  movieCountMap: Record<string, number>;
  seriesCountMap: Record<string, number>;
  stage: 'movies' | 'series' | 'smart' | 'complete';
  updatedAt: number;
};

declare const __DEV__: boolean | undefined;

function isCatalogSyncDebugEnabled() {
  return (
    (typeof __DEV__ !== 'undefined' && __DEV__) ||
    (typeof process !== 'undefined' && process.env?.EXPO_PUBLIC_NOVACAST_DEBUG === 'true')
  );
}

function isSyncRunStale(runToken: number) {
  return runToken !== syncGeneration;
}

function releaseBatch(label: string, batch: unknown[] | null | undefined) {
  lastReleasedBatchLabel = label;
  if (Array.isArray(batch)) {
    batch.length = 0;
  }
}

function logSync(providerId: string, message: string, payload: Record<string, unknown> = {}) {
  if (!isCatalogSyncDebugEnabled()) {
    return;
  }

  console.info(PERF_LOG_PREFIX, { providerId, message, ...payload });
}

function catalogSyncCheckpointKey(providerId: string) {
  return `${CATALOG_SYNC_CHECKPOINT_PREFIX}${providerId}`;
}

async function readCatalogSyncCheckpoint(providerId: string) {
  if (typeof AsyncStorage.getItem !== 'function') {
    return null;
  }

  try {
    const raw = await AsyncStorage.getItem(catalogSyncCheckpointKey(providerId));
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<CatalogSyncCheckpoint>;
    if (
      parsed.version !== CATALOG_SYNC_CHECKPOINT_VERSION ||
      parsed.providerId !== providerId ||
      !Array.isArray(parsed.movieCategoryIds) ||
      !Array.isArray(parsed.seriesCategoryIds) ||
      !parsed.movieCountMap ||
      !parsed.seriesCountMap ||
      !parsed.stage
    ) {
      return null;
    }

    return parsed as CatalogSyncCheckpoint;
  } catch {
    return null;
  }
}

async function writeCatalogSyncCheckpoint(checkpoint: CatalogSyncCheckpoint) {
  if (typeof AsyncStorage.setItem !== 'function') {
    return;
  }

  await AsyncStorage.setItem(catalogSyncCheckpointKey(checkpoint.providerId), JSON.stringify(checkpoint)).catch(() => {});
}

function categoryIdsMatch(checkpointIds: string[], categoryIds: string[]) {
  return checkpointIds.length === categoryIds.length && checkpointIds.every((id, index) => id === categoryIds[index]);
}

function hasFreshCategoryCache(
  providerId: string,
  mediaType: 'movie' | 'series',
  categoryIds: string[],
  smartCategoriesEnabled: boolean,
  now: number,
) {
  const countIndex = getCategoryCountIndexSync(providerId, mediaType);
  if (
    countIndex.updatedAt <= 0 ||
    now - countIndex.updatedAt > CATALOG_SYNC_CACHE_TTL_MS ||
    !categoryIds.every((categoryId) => Object.prototype.hasOwnProperty.call(countIndex.counts, categoryId))
  ) {
    return false;
  }

  if (!smartCategoriesEnabled) {
    return true;
  }

  return getSmartCategoryCacheSync(providerId, mediaType).generatedAt > 0;
}

async function clearLegacyCatalogBlobs(providerId: string) {
  if (typeof AsyncStorage.removeItem !== 'function') {
    return;
  }

  await Promise.all([
    AsyncStorage.removeItem(`@novacast/movie-catalog/${providerId}`),
    AsyncStorage.removeItem(`@novacast/series-catalog/${providerId}`),
  ]).catch(() => {});
}

function notifyPhase(providerId: string, phase: CatalogSyncPhase) {
  syncListeners.get(providerId)?.forEach((listener) => listener(phase));
}

export function subscribeCatalogSyncPhase(providerId: string, listener: (phase: CatalogSyncPhase) => void) {
  const listeners = syncListeners.get(providerId) ?? new Set();
  listeners.add(listener);
  syncListeners.set(providerId, listeners);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      syncListeners.delete(providerId);
    }
  };
}

async function withHeavyCatalogMutex<T>(fn: () => Promise<T>) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const previous = heavyCatalogChain;
  heavyCatalogChain = previous.then(() => gate);
  await previous;
  try {
    return await fn();
  } finally {
    release();
  }
}

async function yieldForPlaybackIfNeeded(
  providerId: string,
  checkpoint: string,
  jobType: string,
  runToken: number,
): Promise<boolean> {
  if (!shouldYieldCatalogSync()) {
    return !isSyncRunStale(runToken);
  }

  logSync(providerId, 'sync-yielded-for-playback', { checkpoint, jobType });
  await waitUntilPlaybackIdleForCatalogSync();

  if (isSyncRunStale(runToken)) {
    logSync(providerId, 'sync-cancelled', { checkpoint, reason: 'provider-reset' });
    return false;
  }

  logSync(providerId, 'sync-resumed', { checkpoint, jobType });
  return true;
}

async function waitForHeavyCatalogWindow(providerId: string, runToken: number) {
  if (!isPlaybackActivityActive()) {
    return !isSyncRunStale(runToken);
  }

  logSync(providerId, 'sync-deferred-playback-active', { phase: 'heavy' });
  await waitUntilPlaybackIdleForCatalogSync();

  if (isSyncRunStale(runToken)) {
    logSync(providerId, 'sync-cancelled', { reason: 'provider-reset' });
    return false;
  }

  logSync(providerId, 'sync-resumed', { checkpoint: 'heavy-start' });
  return true;
}

function schedulePendingHeavySync(providerId: string, input: ProviderCatalogSyncInput) {
  if (pendingSyncInputs.has(providerId) || syncInFlight.has(providerId)) {
    pendingSyncInputs.set(providerId, input);
    return;
  }

  pendingSyncInputs.set(providerId, input);
  logSync(providerId, 'sync-resume-scheduled', { reason: 'playback-active' });
  scheduleCatalogSyncResume(() => {
    if (isPlaybackActivityActive()) {
      return;
    }
    const pending = pendingSyncInputs.get(providerId);
    if (!pending || syncInFlight.has(providerId)) {
      return;
    }
    pendingSyncInputs.delete(providerId);
    logSync(providerId, 'sync-resumed', { checkpoint: 'deferred-request' });
    void startProviderCatalogSync(pending);
  });
}

async function buildMovieLibraryContext(providerId: string) {
  const [favorites, watchlist, continueWatching, recentlyWatched, lastWatched] = await Promise.all([
    getFavoriteIds(providerId),
    getWatchlistIds(providerId),
    getContinueWatchingIds(providerId),
    getRecentlyWatchedIds(providerId),
    getLastWatchedMovie(providerId),
  ]);

  const index = getMovieCatalogIndex(providerId);
  const lastEntry = lastWatched ? index.getEntry(lastWatched.movieId) : undefined;

  return buildSmartCategoryContext({
    providerId,
    favorites,
    watchlist,
    continueWatching,
    recentlyWatched,
    lastWatchedGenres: lastEntry?.genreTags ?? [],
  });
}

async function buildSeriesLibraryContext(providerId: string) {
  const [favorites, watchlist, continueWatchingEntries, recentlyWatched] = await Promise.all([
    getMediaFavoriteIds(providerId),
    getMediaWatchlistIds(providerId),
    getContinueWatchingEntries(providerId, 'episode'),
    getMediaRecentlyWatchedIds(providerId),
  ]);

  return buildSmartSeriesCategoryContext({
    providerId,
    favorites,
    watchlist,
    continueWatching: continueWatchingEntries.map((entry) => entry.seriesId ?? entry.mediaId),
    recentlyWatched,
  });
}

async function buildMovieSmartCache(providerId: string, runToken: number) {
  const index = getMovieCatalogIndex(providerId);
  if (!index.size) {
    return;
  }

  const started = Date.now();
  const ctx = await buildMovieLibraryContext(providerId);
  const cacheEntries: Record<string, SmartCategoryCacheEntry> = {};

  for (const definition of getActiveSmartCategoryDefinitions()) {
    if (!(await yieldForPlaybackIfNeeded(providerId, `movie-smart:${definition.key}`, 'movies-smart', runToken))) {
      return;
    }

    let items: ReturnType<typeof querySmartCategoryOnIndex>['items'] | null = null;
    try {
      const result = querySmartCategoryOnIndex(index, definition, ctx, 0, 240);
      items = result.items;
      cacheEntries[definition.key] = {
        categoryKey: definition.key,
        title: definition.name,
        count: result.totalCount,
        itemIds: result.items.map((entry) => entry.id),
      };
    } finally {
      releaseBatch(`movie-smart:${definition.key}`, items);
    }
  }

  await writeSmartCategoryCache({
    providerId,
    mediaType: 'movie',
    version: SMART_CATEGORY_CACHE_VERSION,
    generatedAt: Date.now(),
    entries: cacheEntries,
  });

  logSync(providerId, 'movie-smart-cache-built', {
    durationMs: Date.now() - started,
    entryCount: index.size,
    smartCategories: Object.keys(cacheEntries).length,
  });
}

async function buildSeriesSmartCache(providerId: string, runToken: number) {
  const index = getSeriesCatalogIndex(providerId);
  if (!index.size) {
    return;
  }

  const started = Date.now();
  const ctx = await buildSeriesLibraryContext(providerId);
  const cacheEntries: Record<string, SmartCategoryCacheEntry> = {};

  for (const definition of getActiveSmartSeriesCategoryDefinitions()) {
    if (!(await yieldForPlaybackIfNeeded(providerId, `series-smart:${definition.key}`, 'series-smart', runToken))) {
      return;
    }

    let items: ReturnType<typeof querySmartSeriesCategoryOnIndex>['items'] | null = null;
    try {
      const result = querySmartSeriesCategoryOnIndex(index, definition, ctx, 0, 240);
      items = result.items;
      cacheEntries[definition.key] = {
        categoryKey: definition.key,
        title: definition.name,
        count: result.totalCount,
        itemIds: result.items.map((entry) => entry.id),
      };
    } finally {
      releaseBatch(`series-smart:${definition.key}`, items);
    }
  }

  await writeSmartCategoryCache({
    providerId,
    mediaType: 'series',
    version: SMART_CATEGORY_CACHE_VERSION,
    generatedAt: Date.now(),
    entries: cacheEntries,
  });

  logSync(providerId, 'series-smart-cache-built', {
    durationMs: Date.now() - started,
    entryCount: index.size,
    smartCategories: Object.keys(cacheEntries).length,
  });
}

async function writePartialCountIndexes(
  providerId: string,
  movieCountMap: Record<string, number>,
  seriesCountMap: Record<string, number>,
) {
  const movieCountIndex: CategoryCountIndex = {
    providerId,
    mediaType: 'movie',
    counts: { ...movieCountMap },
    updatedAt: Date.now(),
  };
  const seriesCountIndex: CategoryCountIndex = {
    providerId,
    mediaType: 'series',
    counts: { ...seriesCountMap },
    updatedAt: Date.now(),
  };

  await writeCategoryCountIndex(movieCountIndex);
  await writeCategoryCountIndex(seriesCountIndex);
}

export type ProviderCatalogSyncInput = {
  providerId: string;
  movies: MovieDataSource;
  series: ProviderSeriesRepository;
  live: ProviderLiveRepository;
};

export async function runProviderCatalogSync(input: ProviderCatalogSyncInput, runToken: number) {
  return withHeavyCatalogMutex(async () => {
    const { providerId, movies, series, live } = input;
    const started = Date.now();

    notifyPhase(providerId, 'syncing');
    logSync(providerId, 'sync-started');

    await clearLegacyCatalogBlobs(providerId);

    const settings = await getMoviesSettings();
    const smartCategoriesEnabled = !settings.hideSmartCategories;

    const movieCategories = await movies.getCategories();
    const seriesCategories = await series.getCategories();
    const liveCategories = await live.getCategories().catch(() => []);

    if (isSyncRunStale(runToken)) {
      logSync(providerId, 'sync-cancelled', { reason: 'provider-reset' });
      return;
    }

    const movieCategoryIds = movieCategories.map((category) => category.id);
    const seriesCategoryIds = seriesCategories.map((category) => category.id);
    const checkpoint = await readCatalogSyncCheckpoint(providerId);
    const checkpointMatches = Boolean(
      checkpoint &&
        checkpoint.smartCategoriesEnabled === smartCategoriesEnabled &&
        categoryIdsMatch(checkpoint.movieCategoryIds, movieCategoryIds) &&
        categoryIdsMatch(checkpoint.seriesCategoryIds, seriesCategoryIds),
    );

    if (
      checkpointMatches &&
      checkpoint?.stage === 'complete' &&
      Date.now() - checkpoint.updatedAt <= CATALOG_SYNC_CACHE_TTL_MS &&
      hasFreshCategoryCache(providerId, 'movie', movieCategoryIds, smartCategoriesEnabled, Date.now()) &&
      hasFreshCategoryCache(providerId, 'series', seriesCategoryIds, smartCategoriesEnabled, Date.now())
    ) {
      logSync(providerId, 'sync-skipped-cached', {
        movieCategories: movieCategoryIds.length,
        seriesCategories: seriesCategoryIds.length,
      });
      notifyPhase(providerId, 'ready');
      return;
    }

    if (!(await waitForHeavyCatalogWindow(providerId, runToken))) {
      return;
    }

    const movieIndex = smartCategoriesEnabled ? getMovieCatalogIndex(providerId) : null;
    const seriesIndex = smartCategoriesEnabled ? getSeriesCatalogIndex(providerId) : null;
    const canResumeCheckpoint = Boolean(checkpointMatches && checkpoint);
    const resumeMovieIndex = canResumeCheckpoint
      ? checkpoint?.stage === 'movies'
        ? checkpoint.movieIndex
        : checkpoint?.stage === 'series'
          ? movieCategories.length
          : 0
      : 0;
    const resumeSeriesIndex = canResumeCheckpoint && checkpoint?.stage === 'series' ? checkpoint.seriesIndex : 0;
    const movieCountMap: Record<string, number> = canResumeCheckpoint ? { ...checkpoint?.movieCountMap } : {};
    const seriesCountMap: Record<string, number> = canResumeCheckpoint ? { ...checkpoint?.seriesCountMap } : {};
    let liveChannelCount = 0;

    const writeCheckpoint = (
      stage: CatalogSyncCheckpoint['stage'],
      movieIndexPosition: number,
      seriesIndexPosition: number,
    ) => {
      if (isSyncRunStale(runToken)) {
        return Promise.resolve();
      }

      return writeCatalogSyncCheckpoint({
        version: CATALOG_SYNC_CHECKPOINT_VERSION,
        providerId,
        smartCategoriesEnabled,
        movieCategoryIds,
        seriesCategoryIds,
        movieIndex: movieIndexPosition,
        seriesIndex: seriesIndexPosition,
        movieCountMap,
        seriesCountMap,
        stage,
        updatedAt: Date.now(),
      });
    };

    await writeCheckpoint(
      resumeMovieIndex < movieCategories.length ? 'movies' : 'series',
      resumeMovieIndex,
      resumeSeriesIndex,
    );

    for (let movieCategoryIndex = resumeMovieIndex; movieCategoryIndex < movieCategories.length; movieCategoryIndex += 1) {
      const category = movieCategories[movieCategoryIndex];
      if (!(await yieldForPlaybackIfNeeded(providerId, `movie-category:${category.id}`, 'movies', runToken))) {
        schedulePendingHeavySync(providerId, input);
        return;
      }

      const categoryStarted = Date.now();
      let items: Awaited<ReturnType<NonNullable<MovieDataSource['listCategoryMovies']>>> | null = null;

      try {
        if (smartCategoriesEnabled) {
          items = movies.listCategoryMovies
            ? await movies.listCategoryMovies(category.id)
            : (await movies.getMoviesPage({ categoryId: category.id, offset: 0, limit: MAX_CATALOG_INDEX_ITEMS })).items;

          if (items.length && movieIndex) {
            movieIndex.ingest(items);
          }

          movieCountMap[category.id] = items.length;
        } else if (movies.getCategoryCount) {
          movieCountMap[category.id] = await movies.getCategoryCount(category.id);
        }

        logSync(providerId, 'movie-category-synced', {
          categoryId: category.id,
          count: movieCountMap[category.id] ?? 0,
          durationMs: Date.now() - categoryStarted,
          mode: smartCategoriesEnabled ? 'full' : 'count-only',
        });
      } finally {
        releaseBatch(`movie-category:${category.id}`, items);
      }

      await writeCheckpoint('movies', movieCategoryIndex + 1, 0);
      await waitForCatalogSyncIdleSlot();
    }

    const seriesDataSource = createProviderSeriesDataSource(series);
    await writeCheckpoint('series', movieCategories.length, resumeSeriesIndex);

    for (let seriesCategoryIndex = resumeSeriesIndex; seriesCategoryIndex < seriesCategories.length; seriesCategoryIndex += 1) {
      const category = seriesCategories[seriesCategoryIndex];
      if (!(await yieldForPlaybackIfNeeded(providerId, `series-category:${category.id}`, 'series', runToken))) {
        schedulePendingHeavySync(providerId, input);
        return;
      }

      const categoryStarted = Date.now();
      let items: Awaited<ReturnType<NonNullable<typeof seriesDataSource.listCategorySeries>>> | null = null;

      try {
        if (smartCategoriesEnabled) {
          items = seriesDataSource.listCategorySeries
            ? await seriesDataSource.listCategorySeries(category.id)
            : (await seriesDataSource.getSeriesPage({ categoryId: category.id, offset: 0, limit: MAX_CATALOG_INDEX_ITEMS }))
                .items;

          if (items.length && seriesIndex) {
            seriesIndex.ingest(items);
          }

          seriesCountMap[category.id] = items.length;
        } else if (seriesDataSource.getCategoryCount) {
          seriesCountMap[category.id] = await seriesDataSource.getCategoryCount(category.id);
        }

        logSync(providerId, 'series-category-synced', {
          categoryId: category.id,
          count: seriesCountMap[category.id] ?? 0,
          durationMs: Date.now() - categoryStarted,
          mode: smartCategoriesEnabled ? 'full' : 'count-only',
        });
      } finally {
        releaseBatch(`series-category:${category.id}`, items);
      }

      await writeCheckpoint('series', movieCategories.length, seriesCategoryIndex + 1);
      await waitForCatalogSyncIdleSlot();
    }

    if (!(await yieldForPlaybackIfNeeded(providerId, 'post-category-sync', 'catalog-summary', runToken))) {
      schedulePendingHeavySync(providerId, input);
      return;
    }

    if (liveCategories.length) {
      liveChannelCount = liveCategories.reduce((total, category) => total + (category.count ?? 0), 0);
    }

    await writePartialCountIndexes(providerId, movieCountMap, seriesCountMap);

    await writeProviderLibrarySummary(providerId, {
      movieCount: sumCategoryCounts({
        providerId,
        mediaType: 'movie',
        counts: movieCountMap,
        updatedAt: Date.now(),
      }),
      seriesCount: sumCategoryCounts({
        providerId,
        mediaType: 'series',
        counts: seriesCountMap,
        updatedAt: Date.now(),
      }),
      liveChannelCount,
      movieCategoryCount: movieCategories.length,
      seriesCategoryCount: seriesCategories.length,
      lastProviderSyncAt: Date.now(),
    });

    if (smartCategoriesEnabled) {
      notifyPhase(providerId, 'smart-building');
      await writeCheckpoint('smart', movieCategories.length, seriesCategories.length);
      if (!(await yieldForPlaybackIfNeeded(providerId, 'smart-building:movies', 'movies-smart', runToken))) {
        schedulePendingHeavySync(providerId, input);
        return;
      }
      await buildMovieSmartCache(providerId, runToken);
      if (isSyncRunStale(runToken)) {
        logSync(providerId, 'sync-cancelled', { reason: 'provider-reset' });
        return;
      }
      if (!(await yieldForPlaybackIfNeeded(providerId, 'smart-building:series', 'series-smart', runToken))) {
        schedulePendingHeavySync(providerId, input);
        return;
      }
      await buildSeriesSmartCache(providerId, runToken);

      await writeProviderLibrarySummary(providerId, {
        lastSmartCategoryBuildAt: Date.now(),
      });
    }

    if (isSyncRunStale(runToken)) {
      logSync(providerId, 'sync-cancelled', { reason: 'provider-reset' });
      return;
    }

    logSync(providerId, 'sync-completed', {
      durationMs: Date.now() - started,
      smartCategoriesEnabled,
    });
    await writeCheckpoint('complete', movieCategories.length, seriesCategories.length);
    notifyPhase(providerId, 'ready');
  });
}

function startProviderCatalogSync(input: ProviderCatalogSyncInput) {
  const runToken = syncGeneration;
  const task = runProviderCatalogSync(input, runToken)
    .catch((error) => {
      notifyPhase(input.providerId, 'error');
      logSync(input.providerId, 'sync-failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    })
    .finally(() => {
      syncInFlight.delete(input.providerId);
      if (runToken !== syncGeneration) {
        return;
      }
      const pending = pendingSyncInputs.get(input.providerId);
      if (pending) {
        pendingSyncInputs.delete(input.providerId);
        scheduleProviderCatalogSync(pending);
      }
    });

  syncInFlight.set(input.providerId, task);
  return task;
}

export function scheduleProviderCatalogSync(input: ProviderCatalogSyncInput) {
  logSync(input.providerId, 'sync-requested');

  const existing = syncInFlight.get(input.providerId);
  if (existing) {
    pendingSyncInputs.set(input.providerId, input);
    return existing;
  }

  if (pendingSyncInputs.has(input.providerId)) {
    pendingSyncInputs.set(input.providerId, input);
    return Promise.resolve();
  }

  return startProviderCatalogSync(input);
}

export function cancelProviderCatalogSync(providerId?: string) {
  syncGeneration += 1;
  if (providerId) {
    pendingSyncInputs.delete(providerId);
  } else {
    pendingSyncInputs.clear();
  }
}

export async function hydrateProviderLibraryCaches(providerId: string) {
  const { readProviderLibrarySummary } = await import('./providerLibrarySummaryStore.ts');
  const { readCategoryCountIndex } = await import('./categoryCountIndexStore.ts');
  const { readSmartCategoryCache } = await import('./smartCategoryCacheStore.ts');

  await Promise.all([
    readProviderLibrarySummary(providerId),
    readCategoryCountIndex(providerId, 'movie'),
    readCategoryCountIndex(providerId, 'series'),
    readSmartCategoryCache(providerId, 'movie'),
    readSmartCategoryCache(providerId, 'series'),
    Promise.resolve(getMovieCatalogIndex(providerId)),
    Promise.resolve(getSeriesCatalogIndex(providerId)),
  ]);
}

export function clearProviderCatalogSyncForTests() {
  syncInFlight.clear();
  pendingSyncInputs.clear();
  syncListeners.clear();
  heavyCatalogChain = Promise.resolve();
  syncGeneration = 0;
  lastReleasedBatchLabel = null;
}

export function getProviderCatalogSyncTestState() {
  return {
    inFlightProviderIds: [...syncInFlight.keys()],
    pendingProviderIds: [...pendingSyncInputs.keys()],
    syncGeneration,
  };
}

export function getLastReleasedBatchLabelForTests() {
  return lastReleasedBatchLabel;
}
