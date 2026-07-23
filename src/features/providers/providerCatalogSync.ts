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
  mergeCategoryCountIndex,
  readCategoryCountIndex,
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
import { notifySeriesCatalogReady } from '../series/smart/SmartSeriesDataSource.ts';
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
import { loadAllMoviesForCatalogIndex, loadAllSeriesForCatalogIndex } from './catalogCategoryLoader.ts';
import { logSmartCategoryCatalogAudit } from './catalogSyncAudit.ts';

const PERF_LOG_PREFIX = '[NovaCast CatalogSync]';
const CATALOG_SYNC_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const CATALOG_SYNC_CHECKPOINT_VERSION = 2;
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
  const catalogCompleteness = index.getCompleteness();

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
      logSmartCategoryCatalogAudit({
        providerId,
        mediaType: 'movie',
        categoryKey: definition.key,
        candidateTotal: result.totalCount,
        catalogCompleteness,
      });
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
    catalogCompleteness,
  });

  logSync(providerId, 'movie-smart-cache-built', {
    durationMs: Date.now() - started,
    entryCount: index.size,
    smartCategories: Object.keys(cacheEntries).length,
    knownCatalogTotal: catalogCompleteness.knownCatalogTotal,
    itemsIndexed: catalogCompleteness.itemsIndexed,
    catalogComplete: catalogCompleteness.catalogComplete,
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
  const catalogCompleteness = index.getCompleteness();

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
      logSmartCategoryCatalogAudit({
        providerId,
        mediaType: 'series',
        categoryKey: definition.key,
        candidateTotal: result.totalCount,
        catalogCompleteness,
      });
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
    catalogCompleteness,
  });

  logSync(providerId, 'series-smart-cache-built', {
    durationMs: Date.now() - started,
    entryCount: index.size,
    smartCategories: Object.keys(cacheEntries).length,
    knownCatalogTotal: catalogCompleteness.knownCatalogTotal,
    itemsIndexed: catalogCompleteness.itemsIndexed,
    catalogComplete: catalogCompleteness.catalogComplete,
  });
}

async function writePartialCountIndexes(
  providerId: string,
  movieCountMap: Record<string, number>,
  seriesCountMap: Record<string, number>,
) {
  if (Object.keys(movieCountMap).length) {
    const movieCountIndex: CategoryCountIndex = {
      providerId,
      mediaType: 'movie',
      counts: { ...movieCountMap },
      updatedAt: Date.now(),
    };
    await writeCategoryCountIndex(movieCountIndex);
  }

  if (Object.keys(seriesCountMap).length) {
    const seriesCountIndex: CategoryCountIndex = {
      providerId,
      mediaType: 'series',
      counts: { ...seriesCountMap },
      updatedAt: Date.now(),
    };
    await writeCategoryCountIndex(seriesCountIndex);
  }
}

function resolveLiveChannelCount(providerId: string) {
  const persistedLiveCounts = getCategoryCountIndexSync(providerId, 'live');
  const persistedTotal = sumCategoryCounts(persistedLiveCounts);
  if (persistedTotal > 0) {
    return persistedTotal;
  }

  // Provider-reported per-category counts overlap; wait for stream-based refresh.
  return 0;
}

async function refreshLiveChannelSummary(providerId: string, live: ProviderLiveRepository, runToken: number) {
  if (!live.getCategoryCounts) {
    return null;
  }

  try {
    const counts = await live.getCategoryCounts();
    if (isSyncRunStale(runToken)) {
      return null;
    }

    await mergeCategoryCountIndex(providerId, 'live', counts);
    const liveChannelCount = live.getTotalChannelCount
      ? await live.getTotalChannelCount()
      : sumCategoryCounts({
          providerId,
          mediaType: 'live',
          counts,
          updatedAt: Date.now(),
        });

    if (liveChannelCount > 0) {
      await writeProviderLibrarySummary(providerId, { liveChannelCount });
      logSync(providerId, 'live-channel-count-refreshed', { liveChannelCount });
    }

    return liveChannelCount;
  } catch (error) {
    logSync(providerId, 'live-channel-count-failed', { message: String(error) });
    return null;
  }
}

async function resolveAndRefreshLiveChannelCount(
  providerId: string,
  live: ProviderLiveRepository,
  liveCategories: Awaited<ReturnType<ProviderLiveRepository['getCategories']>>,
  runToken: number,
) {
  let liveChannelCount = resolveLiveChannelCount(providerId);
  if (!liveCategories.length || isSyncRunStale(runToken)) {
    return liveChannelCount;
  }

  const refreshedLiveChannelCount = await refreshLiveChannelSummary(providerId, live, runToken);
  if (refreshedLiveChannelCount && refreshedLiveChannelCount > 0) {
    return refreshedLiveChannelCount;
  }

  return liveChannelCount;
}

async function writeCatalogProgressSummary(
  providerId: string,
  movieCountMap: Record<string, number>,
  seriesCountMap: Record<string, number>,
  liveChannelCount: number,
  movieCategoryCount: number,
  seriesCategoryCount: number,
) {
  await writePartialCountIndexes(providerId, movieCountMap, seriesCountMap);

  const movieTotal = sumCategoryCounts({
    providerId,
    mediaType: 'movie',
    counts: movieCountMap,
    updatedAt: Date.now(),
  });
  const seriesTotal = sumCategoryCounts({
    providerId,
    mediaType: 'series',
    counts: seriesCountMap,
    updatedAt: Date.now(),
  });

  const patch: Parameters<typeof writeProviderLibrarySummary>[1] = {
    movieCategoryCount,
    seriesCategoryCount,
    lastProviderSyncAt: Date.now(),
  };

  // Never clobber known totals with empty partial maps mid-sync.
  if (movieTotal > 0 || Object.keys(movieCountMap).length > 0) {
    patch.movieCount = movieTotal;
  }
  if (seriesTotal > 0 || Object.keys(seriesCountMap).length > 0) {
    patch.seriesCount = seriesTotal;
  }
  if (liveChannelCount > 0) {
    patch.liveChannelCount = liveChannelCount;
  }

  await writeProviderLibrarySummary(providerId, patch);
}

function sumProviderCategoryHints(
  categories: Array<{ id: string; count?: number | null }>,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const category of categories) {
    if (typeof category.count === 'number' && category.count > 0) {
      counts[category.id] = category.count;
    }
  }
  return counts;
}

export async function refreshProviderLiveChannelCount(providerId: string, live: ProviderLiveRepository) {
  const liveCategories = await live.getCategories().catch(() => []);
  return resolveAndRefreshLiveChannelCount(providerId, live, liveCategories, syncGeneration);
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
    let liveChannelCount = resolveLiveChannelCount(providerId);

    // Fast dump-based live total first so movie/series sync is not blocked by a
    // per-category recount when the provider has more than 10k channels.
    if (liveCategories.length && !isSyncRunStale(runToken)) {
      try {
        const approximate =
          (await live.getApproximateTotalChannelCount?.()) ??
          (await live.getTotalChannelCount?.()) ??
          0;
        if (approximate > 0) {
          liveChannelCount = approximate;
        }
      } catch {
        // Keep any persisted live total.
      }
    }

    const movieHintCounts = sumProviderCategoryHints(movieCategories);
    const seriesHintCounts = sumProviderCategoryHints(seriesCategories);
    await writeCatalogProgressSummary(
      providerId,
      movieHintCounts,
      seriesHintCounts,
      liveChannelCount,
      movieCategories.length,
      seriesCategories.length,
    );

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
      const movieIndexSize = smartCategoriesEnabled ? getMovieCatalogIndex(providerId).size : 1;
      const seriesIndexSize = smartCategoriesEnabled ? getSeriesCatalogIndex(providerId).size : 1;
      const indexesReady = !smartCategoriesEnabled || (movieIndexSize > 0 && seriesIndexSize > 0);

      if (indexesReady) {
        if (liveCategories.length && !isSyncRunStale(runToken)) {
          liveChannelCount = await resolveAndRefreshLiveChannelCount(providerId, live, liveCategories, runToken);
        }
        const movieCounts = getCategoryCountIndexSync(providerId, 'movie');
        const seriesCounts = getCategoryCountIndexSync(providerId, 'series');
        await writeCatalogProgressSummary(
          providerId,
          Object.keys(movieCounts.counts).length ? movieCounts.counts : movieHintCounts,
          Object.keys(seriesCounts.counts).length ? seriesCounts.counts : seriesHintCounts,
          liveChannelCount,
          movieCategories.length,
          seriesCategories.length,
        );
        logSync(providerId, 'sync-skipped-cached', {
          movieCategories: movieCategoryIds.length,
          seriesCategories: seriesCategoryIds.length,
          liveChannelCount,
        });
        notifyPhase(providerId, 'ready');
        return;
      }

      logSync(providerId, 'sync-resumed-empty-index', {
        movieIndexSize,
        seriesIndexSize,
      });
    }

    if (!(await waitForHeavyCatalogWindow(providerId, runToken))) {
      await writeCatalogProgressSummary(
        providerId,
        movieHintCounts,
        seriesHintCounts,
        liveChannelCount,
        movieCategories.length,
        seriesCategories.length,
      );
      schedulePendingHeavySync(providerId, input);
      return;
    }

    const movieIndex = smartCategoriesEnabled ? getMovieCatalogIndex(providerId) : null;
    const seriesIndex = smartCategoriesEnabled ? getSeriesCatalogIndex(providerId) : null;
    const canResumeCheckpoint = Boolean(checkpointMatches && checkpoint);
    if (smartCategoriesEnabled && !canResumeCheckpoint) {
      movieIndex?.beginSync();
      seriesIndex?.beginSync();
    }
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

    if (Object.keys(movieCountMap).length || Object.keys(seriesCountMap).length) {
      await writeCatalogProgressSummary(
        providerId,
        movieCountMap,
        seriesCountMap,
        liveChannelCount,
        movieCategories.length,
        seriesCategories.length,
      );
    }

    for (let movieCategoryIndex = resumeMovieIndex; movieCategoryIndex < movieCategories.length; movieCategoryIndex += 1) {
      const category = movieCategories[movieCategoryIndex];
      if (!(await yieldForPlaybackIfNeeded(providerId, `movie-category:${category.id}`, 'movies', runToken))) {
        await writeCatalogProgressSummary(
          providerId,
          movieCountMap,
          seriesCountMap,
          liveChannelCount,
          movieCategories.length,
          seriesCategories.length,
        );
        schedulePendingHeavySync(providerId, input);
        return;
      }

      const categoryStarted = Date.now();
      let items: Awaited<ReturnType<NonNullable<MovieDataSource['listCategoryMovies']>>> | null = null;

      try {
        if (smartCategoriesEnabled) {
          const loaded = await loadAllMoviesForCatalogIndex(movies, category.id);
          items = loaded.items;

          if (loaded.truncated && movieIndex) {
            movieIndex.markCategoryLoadTruncated();
          }

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
      if (movieCategoryIndex === resumeMovieIndex || (movieCategoryIndex + 1) % 5 === 0) {
        await writeCatalogProgressSummary(
          providerId,
          movieCountMap,
          seriesCountMap,
          liveChannelCount,
          movieCategories.length,
          seriesCategories.length,
        );
      }
      await waitForCatalogSyncIdleSlot();
    }

    const seriesDataSource = createProviderSeriesDataSource(series);
    await writeCheckpoint('series', movieCategories.length, resumeSeriesIndex);
    await writeCatalogProgressSummary(
      providerId,
      movieCountMap,
      seriesCountMap,
      liveChannelCount,
      movieCategories.length,
      seriesCategories.length,
    );

    for (let seriesCategoryIndex = resumeSeriesIndex; seriesCategoryIndex < seriesCategories.length; seriesCategoryIndex += 1) {
      const category = seriesCategories[seriesCategoryIndex];
      if (!(await yieldForPlaybackIfNeeded(providerId, `series-category:${category.id}`, 'series', runToken))) {
        await writeCatalogProgressSummary(
          providerId,
          movieCountMap,
          seriesCountMap,
          liveChannelCount,
          movieCategories.length,
          seriesCategories.length,
        );
        schedulePendingHeavySync(providerId, input);
        return;
      }

      const categoryStarted = Date.now();
      let items: Awaited<ReturnType<NonNullable<typeof seriesDataSource.listCategorySeries>>> | null = null;

      try {
        if (smartCategoriesEnabled) {
          const loaded = await loadAllSeriesForCatalogIndex(seriesDataSource, category.id);
          items = loaded.items;

          if (loaded.truncated && seriesIndex) {
            seriesIndex.markCategoryLoadTruncated();
          }

          if (items.length && seriesIndex) {
            seriesIndex.ingest(items);
            notifySeriesCatalogReady(providerId);
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
      if (seriesCategoryIndex === resumeSeriesIndex || (seriesCategoryIndex + 1) % 5 === 0) {
        await writeCatalogProgressSummary(
          providerId,
          movieCountMap,
          seriesCountMap,
          liveChannelCount,
          movieCategories.length,
          seriesCategories.length,
        );
      }
      await waitForCatalogSyncIdleSlot();
    }

    if (!(await yieldForPlaybackIfNeeded(providerId, 'post-category-sync', 'catalog-summary', runToken))) {
      await writeCatalogProgressSummary(
        providerId,
        movieCountMap,
        seriesCountMap,
        liveChannelCount,
        movieCategories.length,
        seriesCategories.length,
      );
      schedulePendingHeavySync(providerId, input);
      return;
    }

    if (liveCategories.length) {
      liveChannelCount = await resolveAndRefreshLiveChannelCount(providerId, live, liveCategories, runToken);
    }

    await writeCatalogProgressSummary(
      providerId,
      movieCountMap,
      seriesCountMap,
      liveChannelCount,
      movieCategories.length,
      seriesCategories.length,
    );

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
      notifySeriesCatalogReady(providerId);

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
      movieCatalog: movieIndex?.getCompleteness(),
      seriesCatalog: seriesIndex?.getCompleteness(),
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
    readCategoryCountIndex(providerId, 'live'),
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
