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
  CATALOG_SYNC_IDLE_TIMEOUT_MS,
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
  markCatalogAuditCategory,
  markCatalogAuditItems,
  markCatalogAuditNotifyPhase,
  markCatalogAuditProgressWrite,
  markCatalogAuditSync,
  beginVodCategoryPhaseProfile,
  finishVodCategoryPhaseProfile,
  addVodCategoryPhaseMs,
} from '../diagnostics/novaCastCatalogAudit.ts';
import { rankUniqueItemsInBatches, VOD_REGION_RANK_BATCH_SIZE } from './vodRegionRank.ts';
import { SMART_CATEGORY_KEY_NEW_RELEASES, curateSeriesNewReleases, curateMovieNewReleases } from '../media-browser/newReleasesCuration.ts';
import {
  buildSmartSeriesCategoryContext,
  getActiveSmartSeriesCategoryDefinitions,
  querySmartSeriesCategoryOnIndex,
} from '../series/smart/smartSeriesCategoryDefinitions.ts';
import { loadAllMoviesForCatalogIndex, loadAllSeriesForCatalogIndex } from './catalogCategoryLoader.ts';
import { logSmartCategoryCatalogAudit } from './catalogSyncAudit.ts';
import { earlyBootMark, earlyBootTimed } from '../diagnostics/earlyBootAudit.ts';
import {
  buildCatalogSyncKey,
  cancelCatalogSync,
  clearCatalogSyncCoordinatorForTests,
  createCatalogProgressThrottle,
  getCatalogSyncCancelToken,
  invalidateCatalogSyncForProvider,
  processTimeBudgeted,
  scheduleCatalogSync,
  type CatalogProgressThrottle,
} from '../catalog/index.ts';
import {
  awaitSeriesCategoryGateForProvider,
  createDisabledCatalogSqliteMediaSyncHandle,
  finishCatalogSqliteMediaSync,
  mapMovieSummaryToCatalogItem,
  mapNativeRecordToCatalogItem,
  mapSeriesSummaryToCatalogItem,
  startCatalogSqliteMediaSync,
  writeCatalogItemsFromSourceBudgeted,
  writeCategoriesFromSourceBudgeted,
  recordCatalogSqliteDecoded,
  type CatalogSqliteMediaSyncHandle,
} from '../catalog/catalogSqliteSyncWriter.ts';
import {
  isCatalogSqliteWriterOnlyDiagnosticEnabled,
  isNativeCatalogDecodeAvailable,
  nativeRecordToMovieSummary,
  nativeRecordToSeriesSummary,
  streamXtreamCategoryDecode,
} from '../catalog/nativeCatalogDecode.ts';
import {
  getCatalogCategoryCounts,
  getCatalogTotalCount,
  resolveReadableCatalogGeneration,
} from '../catalog/catalogRepository.ts';
import {
  createVodCategoryProbeAccumulator,
  evaluateVodCategoryFilterCapability,
  normalizeStreamCategoryId,
  readVodCategoryFilterCapability,
  writeVodCategoryFilterCapability,
  type VodCategoryProbeSample,
} from '../catalog/vodCategoryFilterCapability.ts';
import type { MovieSummary } from '../movies/movieTypes.ts';
import type { SeriesSummary } from '../media-browser/mediaTypes.ts';

const PERF_LOG_PREFIX = '[NovaCast CatalogSync]';
const CATALOG_SYNC_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const CATALOG_SYNC_CHECKPOINT_VERSION = 14; // Stage 3C.2: SQLite Movies item sync independent of smart categories
const CATALOG_SYNC_CHECKPOINT_PREFIX = '@novacast/catalog-sync-checkpoint/';
const syncInFlight = new Map<string, Promise<void>>();

/** Shell-settle delays before automatic catalog work (ms). Zeroed in unit tests. */
let movieCatalogScheduleDelayMs = 2500;
let seriesCatalogScheduleDelayMs = 4000;
const pendingSyncInputs = new Map<string, ProviderCatalogSyncInput>();
const syncListeners = new Map<string, Set<(phase: CatalogSyncPhase) => void>>();
const movieReadyListeners = new Map<string, Set<(generation: number) => void>>();
let movieReadySubscriptionInstance = 0;
const movieCategoriesUpdatedListeners = new Map<string, Set<(payload: { generation: number; categoryCount: number }) => void>>();
const lastMovieCategoriesUpdatedSignature = new Map<string, string>();

const catalogSyncSetupCache = new Map<string, Promise<CatalogSyncSetup>>();

let syncGeneration = 0;
let lastReleasedBatchLabel: string | null = null;
let checkpointWriteChain: Promise<void> = Promise.resolve();
const mediaJobCompletion = new Map<string, { movie: boolean; series: boolean }>();

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
    (typeof process !== 'undefined' &&
      (process.env?.EXPO_PUBLIC_NOVACAST_DEBUG === 'true' ||
        process.env?.EXPO_PUBLIC_NOVACAST_CATALOG_AUDIT === '1'))
  );
}

function isSyncRunStale(runToken: number) {
  return runToken !== syncGeneration;
}

function isCatalogJobCancelled(runToken: number, coordinatorKey: string) {
  return isSyncRunStale(runToken) || getCatalogSyncCancelToken(coordinatorKey).isStale();
}

function catalogSyncSetupKey(providerId: string, runToken: number) {
  return `${providerId}::${runToken}`;
}

async function withCheckpointWriteMutex<T>(fn: () => Promise<T>) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const previous = checkpointWriteChain;
  checkpointWriteChain = previous.then(() => gate);
  await previous;
  try {
    return await fn();
  } finally {
    release();
  }
}

function releaseBatch(label: string, batch: unknown[] | null | undefined) {
  lastReleasedBatchLabel = label;
  if (Array.isArray(batch)) {
    batch.length = 0;
  }
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
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
  markCatalogAuditNotifyPhase(phase);
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

export function subscribeMovieCatalogReady(providerId: string, listener: (generation: number) => void) {
  const listeners = movieReadyListeners.get(providerId) ?? new Set();
  listeners.add(listener);
  const subscriptionInstance = ++movieReadySubscriptionInstance;
  movieReadyListeners.set(providerId, listeners);
  console.info('[NovaCast Movies] catalog_subscription_added', {
    providerId,
    subscriptionInstance,
  });
  return () => {
    listeners.delete(listener);
    console.info('[NovaCast Movies] catalog_subscription_removed', {
      providerId,
      subscriptionInstance,
    });
    if (!listeners.size) {
      movieReadyListeners.delete(providerId);
    }
  };
}

function notifyMovieCatalogReady(providerId: string, generation: number) {
  const listeners = movieReadyListeners.get(providerId);
  console.info('[Movies Catalog Publication]', {
    event: 'ready-published',
    providerId,
    generation,
    listenerCount: listeners?.size ?? 0,
  });
  listeners?.forEach((listener) => listener(generation));
}

/** Stage 3C fragment recovery publishes Movies-ready once after v2 activation. */
export function publishMovieCatalogReady(providerId: string, generation: number) {
  notifyPhase(providerId, 'ready');
  notifyMovieCatalogReady(providerId, generation);
}

export function subscribeMovieCategoriesUpdated(
  providerId: string,
  listener: (payload: { generation: number; categoryCount: number }) => void,
) {
  const listeners = movieCategoriesUpdatedListeners.get(providerId) ?? new Set();
  listeners.add(listener);
  movieCategoriesUpdatedListeners.set(providerId, listeners);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      movieCategoriesUpdatedListeners.delete(providerId);
    }
  };
}

function notifyMovieCategoriesUpdated(providerId: string, generation: number, categoryCount: number) {
  const signature = `${providerId}:${generation}:${categoryCount}`;
  if (lastMovieCategoriesUpdatedSignature.get(providerId) === signature) {
    return;
  }
  lastMovieCategoriesUpdatedSignature.set(providerId, signature);
  const listeners = movieCategoriesUpdatedListeners.get(providerId);
  console.info('[NovaCast Movies] movie-categories-updated', {
    providerId,
    generation,
    categoryCount,
    listenerCount: listeners?.size ?? 0,
  });
  listeners?.forEach((listener) => listener({ generation, categoryCount }));
}

export function publishMovieCategoriesUpdated(
  providerId: string,
  generation: number,
  categoryCount: number,
) {
  notifyMovieCategoriesUpdated(providerId, generation, categoryCount);
}

type CatalogSyncSetup = {
  input: ProviderCatalogSyncInput;
  runToken: number;
  smartCategoriesEnabled: boolean;
  movieCategories: Awaited<ReturnType<MovieDataSource['getCategories']>>;
  seriesCategories: Awaited<ReturnType<ProviderSeriesRepository['getCategories']>>;
  liveCategories: Awaited<ReturnType<ProviderLiveRepository['getCategories']>>;
  liveChannelCount: number;
  movieCategoryIds: string[];
  seriesCategoryIds: string[];
  movieHintCounts: Record<string, number>;
  seriesHintCounts: Record<string, number>;
  movieCountMap: Record<string, number>;
  seriesCountMap: Record<string, number>;
  checkpoint: CatalogSyncCheckpoint | null;
  checkpointMatches: boolean;
  resumeMovieIndex: number;
  resumeSeriesIndex: number;
  progressThrottle: CatalogProgressThrottle;
};

async function buildCatalogSyncSetup(input: ProviderCatalogSyncInput, runToken: number): Promise<CatalogSyncSetup> {
  const { providerId, movies, series, live } = input;

  await earlyBootTimed('clearLegacyCatalogBlobs', () => clearLegacyCatalogBlobs(providerId));

  const settings = await earlyBootTimed('getMoviesSettings', () => getMoviesSettings());
  const smartCategoriesEnabled = !settings.hideSmartCategories;

  const movieCategories = await earlyBootTimed(
    'movies.getCategories',
    async () => {
      const moviesWithSyncOpt = movies as MovieDataSource & {
        getCategories: (options?: { forCatalogSync?: boolean }) => Promise<
          Awaited<ReturnType<MovieDataSource['getCategories']>>
        >;
      };
      return moviesWithSyncOpt.getCategories({ forCatalogSync: true });
    },
    { mediaType: 'movie' },
  );
  // Yield a macrotask between large category list parses so Home focus can run.
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  const seriesCategories = await earlyBootTimed(
    'series.getCategories',
    async () => {
      const seriesWithSyncOpt = series as ProviderSeriesRepository & {
        getCategories: (
          signal?: AbortSignal,
          options?: { forCatalogSync?: boolean },
        ) => Promise<Awaited<ReturnType<ProviderSeriesRepository['getCategories']>>>;
      };
      return seriesWithSyncOpt.getCategories(undefined, { forCatalogSync: true });
    },
    { mediaType: 'series' },
  );
  // Live category list + US-first sort is not required to start Movies/Series sync.
  // Home/Live screens fetch their own live categories. Defer sync-time live refresh.
  const liveCategories: Awaited<ReturnType<ProviderLiveRepository['getCategories']>> = [];
  let liveChannelCount = resolveLiveChannelCount(providerId);
  earlyBootMark('catalog_setup_live_categories_deferred', {
    liveChannelCount,
    reason: 'avoid-early-boot-json-sort-stall',
  });
  await new Promise<void>((resolve) => setTimeout(resolve, 0));

  const movieHintCounts = sumProviderCategoryHints(movieCategories);
  const seriesHintCounts = sumProviderCategoryHints(seriesCategories);
  const movieCategoryIds = movieCategories.map((category) => category.id);
  const seriesCategoryIds = seriesCategories.map((category) => category.id);
  const checkpoint = await readCatalogSyncCheckpoint(providerId);
  const checkpointMatches = Boolean(
    checkpoint &&
      checkpoint.smartCategoriesEnabled === smartCategoriesEnabled &&
      categoryIdsMatch(checkpoint.movieCategoryIds, movieCategoryIds) &&
      categoryIdsMatch(checkpoint.seriesCategoryIds, seriesCategoryIds),
  );

  const canResumeCheckpoint = Boolean(checkpointMatches && checkpoint);
  const resumeMovieIndex = canResumeCheckpoint
    ? checkpoint?.stage === 'movies'
      ? checkpoint.movieIndex
      : checkpoint?.stage === 'series' || checkpoint?.stage === 'smart' || checkpoint?.stage === 'complete'
        ? movieCategories.length
        : 0
    : 0;
  const resumeSeriesIndex =
    canResumeCheckpoint && (checkpoint?.stage === 'series' || checkpoint?.stage === 'smart')
      ? checkpoint.seriesIndex
      : checkpoint?.stage === 'complete'
        ? seriesCategories.length
        : 0;

  const movieCountMap: Record<string, number> = canResumeCheckpoint ? { ...checkpoint?.movieCountMap } : {};
  const seriesCountMap: Record<string, number> = canResumeCheckpoint ? { ...checkpoint?.seriesCountMap } : {};

  const progressThrottle = createCatalogProgressThrottle({
    intervalMs: 900,
    write: async (snapshot) => {
      markCatalogAuditProgressWrite('library_summary');
      await writePartialCountIndexes(
        providerId,
        (snapshot.movieCountMap as Record<string, number>) ?? {},
        (snapshot.seriesCountMap as Record<string, number>) ?? {},
      );

      const movieCountMapSnapshot = (snapshot.movieCountMap as Record<string, number>) ?? {};
      const seriesCountMapSnapshot = (snapshot.seriesCountMap as Record<string, number>) ?? {};
      const movieTotal = sumCategoryCounts({
        providerId,
        mediaType: 'movie',
        counts: movieCountMapSnapshot,
        updatedAt: Date.now(),
      });
      const seriesTotal = sumCategoryCounts({
        providerId,
        mediaType: 'series',
        counts: seriesCountMapSnapshot,
        updatedAt: Date.now(),
      });

      const patch: Parameters<typeof writeProviderLibrarySummary>[1] = {
        movieCategoryCount: Number(snapshot.movieCategoryCount ?? movieCategories.length),
        seriesCategoryCount: Number(snapshot.seriesCategoryCount ?? seriesCategories.length),
        lastProviderSyncAt: Date.now(),
      };

      if (movieTotal > 0 || Object.keys(movieCountMapSnapshot).length > 0) {
        patch.movieCount = movieTotal;
      }
      if (seriesTotal > 0 || Object.keys(seriesCountMapSnapshot).length > 0) {
        patch.seriesCount = seriesTotal;
      }
      const liveCount = Number(snapshot.liveChannelCount ?? 0);
      if (liveCount > 0) {
        patch.liveChannelCount = liveCount;
      }

      await writeProviderLibrarySummary(providerId, patch);
    },
  });

  const setup: CatalogSyncSetup = {
    input,
    runToken,
    smartCategoriesEnabled,
    movieCategories,
    seriesCategories,
    liveCategories,
    liveChannelCount,
    movieCategoryIds,
    seriesCategoryIds,
    movieHintCounts,
    seriesHintCounts,
    movieCountMap,
    seriesCountMap,
    checkpoint,
    checkpointMatches,
    resumeMovieIndex,
    resumeSeriesIndex,
    progressThrottle,
  };

  publishCatalogProgress(setup);
  return setup;
}

async function ensureCatalogSyncSetup(input: ProviderCatalogSyncInput, runToken: number) {
  const key = catalogSyncSetupKey(input.providerId, runToken);
  let existing = catalogSyncSetupCache.get(key);
  if (!existing) {
    existing = buildCatalogSyncSetup(input, runToken);
    catalogSyncSetupCache.set(key, existing);
  }
  return existing;
}

function publishCatalogProgress(setup: CatalogSyncSetup) {
  setup.progressThrottle.publish({
    providerId: setup.input.providerId,
    movieCountMap: setup.movieCountMap,
    seriesCountMap: setup.seriesCountMap,
    liveChannelCount: setup.liveChannelCount,
    movieCategoryCount: setup.movieCategories.length,
    seriesCategoryCount: setup.seriesCategories.length,
  });
}

let lastCheckpointWriteAt = 0;
const CATALOG_CHECKPOINT_MIN_INTERVAL_MS = 900;

async function writeCatalogSyncCheckpointSafe(
  setup: CatalogSyncSetup,
  runToken: number,
  stage: CatalogSyncCheckpoint['stage'],
  movieIndexPosition: number,
  seriesIndexPosition: number,
  options?: { force?: boolean },
) {
  if (isSyncRunStale(runToken)) {
    return;
  }

  const now = Date.now();
  const force = options?.force || stage === 'complete' || stage === 'smart';
  if (!force && now - lastCheckpointWriteAt < CATALOG_CHECKPOINT_MIN_INTERVAL_MS) {
    return;
  }

  lastCheckpointWriteAt = now;
  await withCheckpointWriteMutex(async () => {
    await writeCatalogSyncCheckpoint({
      version: CATALOG_SYNC_CHECKPOINT_VERSION,
      providerId: setup.input.providerId,
      smartCategoriesEnabled: setup.smartCategoriesEnabled,
      movieCategoryIds: setup.movieCategoryIds,
      seriesCategoryIds: setup.seriesCategoryIds,
      movieIndex: movieIndexPosition,
      seriesIndex: seriesIndexPosition,
      movieCountMap: setup.movieCountMap,
      seriesCountMap: setup.seriesCountMap,
      stage,
      updatedAt: now,
    });
  });
}

function markMediaJobComplete(providerId: string, mediaType: 'movie' | 'series') {
  const state = mediaJobCompletion.get(providerId) ?? { movie: false, series: false };
  state[mediaType] = true;
  mediaJobCompletion.set(providerId, state);
  if (state.movie && state.series) {
    notifyPhase(providerId, 'ready');
    mediaJobCompletion.delete(providerId);
  }
}

async function yieldForPlaybackIfNeeded(
  providerId: string,
  checkpoint: string,
  jobType: string,
  runToken: number,
): Promise<boolean> {
  // Always give the JS event loop a chance to service Home focus/input.
  // When playback is active we fully pause; otherwise take a short idle slot
  // plus one macrotask so D-pad handlers can run between heavy category jobs.
  if (!shouldYieldCatalogSync()) {
    await waitForCatalogSyncIdleSlot(CATALOG_SYNC_IDLE_TIMEOUT_MS);
    await sleep(0);
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
    void scheduleProviderCatalogSync(pending);
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
  const isCancelled = () => isSyncRunStale(runToken);

  const snapshot = index.listAllEntries();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  logSync(providerId, 'movie-smart-snapshot', { snapshotSize: snapshot.length });

  for (const definition of getActiveSmartCategoryDefinitions()) {
    if (!(await yieldForPlaybackIfNeeded(providerId, `movie-smart:${definition.key}`, 'movies-smart', runToken))) {
      return;
    }
    if (isCancelled()) {
      return;
    }

    let items: ReturnType<typeof querySmartCategoryOnIndex>['items'] | null = null;
    const queryStarted = Date.now();
    try {
      if (definition.key === SMART_CATEGORY_KEY_NEW_RELEASES) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        const curated = curateMovieNewReleases(snapshot);
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        items = curated.slice(0, 240);
        cacheEntries[definition.key] = {
          categoryKey: definition.key,
          title: definition.name,
          count: curated.length,
          itemIds: items.map((entry) => entry.id),
        };
      } else if (definition.idOrder) {
        const orderedIds = definition.idOrder(ctx);
        const rank = new Map(orderedIds.map((id, order) => [id, order]));
        const filtered: typeof snapshot = [];
        await processTimeBudgeted(
          snapshot,
          (entry) => {
            if (definition.predicate(entry, ctx) && rank.has(entry.id)) {
              filtered.push(entry);
            }
          },
          { isCancelled, minItems: 40, maxItems: 120, kind: 'generic', targetMs: 35 },
        );
        filtered.sort(
          (left, right) =>
            (rank.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(right.id) ?? Number.MAX_SAFE_INTEGER),
        );
        const capped = definition.maxItems ? filtered.slice(0, definition.maxItems) : filtered;
        items = capped.slice(0, 240);
        cacheEntries[definition.key] = {
          categoryKey: definition.key,
          title: definition.name,
          count: capped.length,
          itemIds: items.map((entry) => entry.id),
        };
      } else {
        const maxItems = definition.maxItems ?? 240;
        const top: typeof snapshot = [];
        await processTimeBudgeted(
          snapshot,
          (entry) => {
            if (!definition.predicate(entry, ctx)) {
              return;
            }
            top.push(entry);
            if (top.length > maxItems * 4) {
              top.sort(definition.sort);
              top.length = maxItems;
            }
          },
          { isCancelled, minItems: 40, maxItems: 80, kind: 'generic', targetMs: 30 },
        );
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        top.sort(definition.sort);
        const capped = top.slice(0, maxItems);
        items = capped.slice(0, 240);
        cacheEntries[definition.key] = {
          categoryKey: definition.key,
          title: definition.name,
          count: capped.length,
          itemIds: items.map((entry) => entry.id),
        };
      }
      logSmartCategoryCatalogAudit({
        providerId,
        mediaType: 'movie',
        categoryKey: definition.key,
        candidateTotal: cacheEntries[definition.key]?.count ?? 0,
        catalogCompleteness,
      });
      logSync(providerId, 'movie-smart-query', {
        key: definition.key,
        queryMs: Date.now() - queryStarted,
        snapshotSize: snapshot.length,
        count: cacheEntries[definition.key]?.count ?? 0,
      });
    } finally {
      releaseBatch(`movie-smart:${definition.key}`, items);
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
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
  const isCancelled = () => isSyncRunStale(runToken);

  // Snapshot once, then time-budget each smart query — full sync forEach+predicate
  // over ~40k entries per definition previously stalled JS for ~60s.
  const snapshot = index.listAllEntries();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  logSync(providerId, 'series-smart-snapshot', { snapshotSize: snapshot.length });

  for (const definition of getActiveSmartSeriesCategoryDefinitions()) {
    if (!(await yieldForPlaybackIfNeeded(providerId, `series-smart:${definition.key}`, 'series-smart', runToken))) {
      return;
    }
    if (isCancelled()) {
      return;
    }

    let items: ReturnType<typeof querySmartSeriesCategoryOnIndex>['items'] | null = null;
    const queryStarted = Date.now();
    try {
      if (definition.key === SMART_CATEGORY_KEY_NEW_RELEASES) {
        // Use the already-budgeted snapshot; never re-walk the live index synchronously.
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        const curated = curateSeriesNewReleases(snapshot);
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        items = curated.slice(0, 240);
        cacheEntries[definition.key] = {
          categoryKey: definition.key,
          title: definition.name,
          count: curated.length,
          itemIds: items.map((entry) => entry.id),
        };
      } else if (definition.idOrder) {
        const orderedIds = definition.idOrder(ctx);
        const rank = new Map(orderedIds.map((id, order) => [id, order]));
        const filtered: typeof snapshot = [];
        await processTimeBudgeted(
          snapshot,
          (entry) => {
            if (definition.predicate(entry, ctx) && rank.has(entry.id)) {
              filtered.push(entry);
            }
          },
          { isCancelled, minItems: 40, maxItems: 120, kind: 'generic', targetMs: 35 },
        );
        filtered.sort(
          (left, right) =>
            (rank.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(right.id) ?? Number.MAX_SAFE_INTEGER),
        );
        const capped = definition.maxItems ? filtered.slice(0, definition.maxItems) : filtered;
        items = capped.slice(0, 240);
        cacheEntries[definition.key] = {
          categoryKey: definition.key,
          title: definition.name,
          count: capped.length,
          itemIds: items.map((entry) => entry.id),
        };
      } else {
        const maxItems = definition.maxItems ?? 240;
        // Bounded top-N during the scan — avoid sorting tens of thousands of rows on JS.
        const top: typeof snapshot = [];
        await processTimeBudgeted(
          snapshot,
          (entry) => {
            if (!definition.predicate(entry, ctx)) {
              return;
            }
            top.push(entry);
            if (top.length > maxItems * 4) {
              top.sort(definition.sort);
              top.length = maxItems;
            }
          },
          { isCancelled, minItems: 40, maxItems: 80, kind: 'generic', targetMs: 30 },
        );
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        top.sort(definition.sort);
        const capped = top.slice(0, maxItems);
        items = capped.slice(0, 240);
        cacheEntries[definition.key] = {
          categoryKey: definition.key,
          title: definition.name,
          count: capped.length,
          itemIds: items.map((entry) => entry.id),
        };
      }
      logSmartCategoryCatalogAudit({
        providerId,
        mediaType: 'series',
        categoryKey: definition.key,
        candidateTotal: cacheEntries[definition.key]?.count ?? 0,
        catalogCompleteness,
      });
      logSync(providerId, 'series-smart-query', {
        key: definition.key,
        queryMs: Date.now() - queryStarted,
        snapshotSize: snapshot.length,
        count: cacheEntries[definition.key]?.count ?? 0,
      });
    } finally {
      releaseBatch(`series-smart:${definition.key}`, items);
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
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
  // Merge into existing indexes — never replace a complete map with a partial mid-sync write.
  if (Object.keys(movieCountMap).length) {
    await mergeCategoryCountIndex(providerId, 'movie', movieCountMap);
  }

  if (Object.keys(seriesCountMap).length) {
    await mergeCategoryCountIndex(providerId, 'series', seriesCountMap);
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
  markCatalogAuditProgressWrite('library_summary');
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
  providerType?: string;
  displayName?: string;
  movies: MovieDataSource;
  series: ProviderSeriesRepository;
  live: ProviderLiveRepository;
};

async function shouldSkipMovieSync(setup: CatalogSyncSetup, runToken: number) {
  const { smartCategoriesEnabled, movieCategoryIds, seriesCategoryIds } = setup;
  const providerId = setup.input.providerId;
  const now = Date.now();

  if (
    !setup.checkpointMatches ||
    setup.checkpoint?.stage !== 'complete' ||
    !setup.checkpoint ||
    now - setup.checkpoint.updatedAt > CATALOG_SYNC_CACHE_TTL_MS ||
    !hasFreshCategoryCache(providerId, 'movie', movieCategoryIds, smartCategoriesEnabled, now) ||
    !hasFreshCategoryCache(providerId, 'series', seriesCategoryIds, smartCategoriesEnabled, now)
  ) {
    return false;
  }

  const movieIndexSize = smartCategoriesEnabled ? getMovieCatalogIndex(providerId).size : 1;
  if (smartCategoriesEnabled && movieIndexSize <= 0) {
    logSync(providerId, 'movie-sync-resumed-empty-index', { movieIndexSize });
    return false;
  }

  if (setup.liveCategories.length && !isSyncRunStale(runToken)) {
    setup.liveChannelCount = await resolveAndRefreshLiveChannelCount(
      providerId,
      setup.input.live,
      setup.liveCategories,
      runToken,
    );
  }

  publishCatalogProgress(setup);
  setup.progressThrottle.flush();
  logSync(providerId, 'movie-sync-skipped-cached', {
    movieCategories: movieCategoryIds.length,
    liveChannelCount: setup.liveChannelCount,
  });
  return true;
}

async function shouldSkipSeriesSync(setup: CatalogSyncSetup, runToken: number) {
  const { smartCategoriesEnabled, movieCategoryIds, seriesCategoryIds } = setup;
  const providerId = setup.input.providerId;
  const now = Date.now();

  if (
    !setup.checkpointMatches ||
    setup.checkpoint?.stage !== 'complete' ||
    !setup.checkpoint ||
    now - setup.checkpoint.updatedAt > CATALOG_SYNC_CACHE_TTL_MS ||
    !hasFreshCategoryCache(providerId, 'movie', movieCategoryIds, smartCategoriesEnabled, now) ||
    !hasFreshCategoryCache(providerId, 'series', seriesCategoryIds, smartCategoriesEnabled, now)
  ) {
    return false;
  }

  const seriesIndexSize = smartCategoriesEnabled ? getSeriesCatalogIndex(providerId).size : 1;
  if (smartCategoriesEnabled && seriesIndexSize <= 0) {
    logSync(providerId, 'series-sync-resumed-empty-index', { seriesIndexSize });
    return false;
  }

  publishCatalogProgress(setup);
  setup.progressThrottle.flush();
  logSync(providerId, 'series-sync-skipped-cached', {
    seriesCategories: seriesCategoryIds.length,
  });
  return true;
}

export async function runMovieCatalogSync(
  input: ProviderCatalogSyncInput,
  runToken: number,
  coordinatorKey: string,
) {
  const { providerId, movies } = input;
  const started = Date.now();
  const isCancelled = () => isCatalogJobCancelled(runToken, coordinatorKey);
  const setup = await ensureCatalogSyncSetup(input, runToken);

  notifyPhase(providerId, 'syncing');
  markCatalogAuditSync('started', { providerId, mediaType: 'movie' });
  logSync(providerId, 'movie-sync-started');

  if (isCancelled()) {
    logSync(providerId, 'movie-sync-cancelled', { reason: 'provider-reset' });
    return;
  }

  if (await shouldSkipMovieSync(setup, runToken)) {
    markMediaJobComplete(providerId, 'movie');
    markCatalogAuditSync('completed', { providerId, mediaType: 'movie', skipped: true });
    return;
  }

  if (!(await waitForHeavyCatalogWindow(providerId, runToken))) {
    publishCatalogProgress(setup);
    setup.progressThrottle.flush();
    schedulePendingHeavySync(providerId, input);
    return;
  }

  const { smartCategoriesEnabled, movieCategories } = setup;
  const movieIndex = smartCategoriesEnabled ? getMovieCatalogIndex(providerId) : null;
  const canResumeCheckpoint = setup.checkpointMatches && Boolean(setup.checkpoint);
  if (smartCategoriesEnabled && !canResumeCheckpoint) {
    movieIndex?.beginSync();
  }

  let sqliteHandle: CatalogSqliteMediaSyncHandle | null = null;
  try {
    sqliteHandle = await startCatalogSqliteMediaSync({
      providerId,
      mediaType: 'movie',
      providerType: input.providerType ?? 'unknown',
      displayName: input.displayName ?? null,
    });

    if (sqliteHandle.enabled) {
      const writtenCategories = await writeCategoriesFromSourceBudgeted(
        sqliteHandle,
        movieCategories,
        (category, index) => ({
          providerId,
          mediaType: 'movie' as const,
          categoryId: category.id,
          categoryName: category.name,
          sortOrder: index,
          syncGeneration: sqliteHandle!.generation,
        }),
        { isCancelled },
      );
      if (writtenCategories > 0) {
        publishMovieCategoriesUpdated(providerId, sqliteHandle.generation, writtenCategories);
      }
    }

    // Let Series finish category SQLite upserts before Movies begins item ingest/writes.
    // Prevents multi-second mutex/JS stalls from overlapping category + item writers.
    await awaitSeriesCategoryGateForProvider(providerId);

    await writeCatalogSyncCheckpointSafe(
      setup,
      runToken,
      setup.resumeMovieIndex < movieCategories.length ? 'movies' : 'series',
      setup.resumeMovieIndex,
      setup.resumeSeriesIndex,
    );

    // Stage 3C.2: probe category filtering, then either one full dump or per-category sync.
    // Capability detection is independent of Discover/smart toggles — SQLite assignment must be correct either way.
    // SQLite Movies reads also require item rows even when smart categories are hidden (count-only is not enough).
    const nativeAvailable = isNativeCatalogDecodeAvailable();
    const writerOnly = isCatalogSqliteWriterOnlyDiagnosticEnabled();
    const syncMovieItems = smartCategoriesEnabled || Boolean(sqliteHandle?.enabled);
    let filteringReliable = true;
    let movieSyncStrategy: 'full-dump-stream-category' | 'filtered-per-category' = 'filtered-per-category';

    logSync(providerId, 'movie-filter-capability-gate', {
      nativeAvailable,
      sqliteEnabled: Boolean(sqliteHandle?.enabled),
      smartCategoriesEnabled,
      syncMovieItems,
      movieCategoryCount: movieCategories.length,
    });

    if (nativeAvailable && sqliteHandle?.enabled) {
      const cachedCapability = await readVodCategoryFilterCapability(providerId);
      const providerCategoryIds = movieCategories
        .map((category) => category.id)
        .filter((id) => id && id !== 'all' && !String(id).startsWith('section:') && !String(id).startsWith('smart:'));
      // Probe spread-out categories (not only the first two) so last-write-wins victims are included.
      const probeCategoryIds =
        providerCategoryIds.length >= 2
          ? [
              providerCategoryIds[Math.floor(providerCategoryIds.length * 0.2)]!,
              providerCategoryIds[Math.floor(providerCategoryIds.length * 0.8)]!,
            ]
          : providerCategoryIds.slice(0, 2);

      if (cachedCapability && Date.now() - cachedCapability.probedAt < 7 * 24 * 60 * 60 * 1000) {
        filteringReliable = cachedCapability.filteringReliable;
        logSync(providerId, 'movie-filter-capability-cache-hit', {
          filteringReliable,
          reason: cachedCapability.reason,
        });
      } else if (probeCategoryIds.length >= 2) {
        const probes: VodCategoryProbeSample[] = [];
        for (const categoryId of probeCategoryIds) {
          if (isCancelled()) {
            return;
          }
          const probeUrl = movies.getCatalogListRequestUrl?.(categoryId) ?? null;
          if (!probeUrl) {
            logSync(providerId, 'movie-filter-capability-probe-skipped', {
              categoryId,
              reason: 'url-unavailable',
            });
            continue;
          }
          const accumulator = createVodCategoryProbeAccumulator(categoryId);
          const probeResult = await streamXtreamCategoryDecode({
            requestUrl: probeUrl,
            mediaType: 'movie',
            filterCategoryId: categoryId,
            providerId,
            isCancelled,
            onBatch: async (records) => {
              accumulator.onRecords(records);
            },
          });
          if (probeResult.cancelled || isCancelled()) {
            return;
          }
          probes.push(accumulator.sample);
          logSync(providerId, 'movie-filter-capability-probe', {
            requestedCategoryId: accumulator.sample.requestedCategoryId,
            returnedCount: accumulator.sample.returnedCount,
            distinctReturnedCategoryIds: accumulator.sample.distinctReturnedCategoryIds,
            matchingRequestedCategoryCount: accumulator.sample.matchingRequestedCategoryCount,
            firstContentIds: accumulator.sample.firstContentIds,
          });
        }
        if (probes.length >= 1) {
          const readableGeneration = await resolveReadableCatalogGeneration(providerId, 'movie').catch(() => 0);
          const previousTotal =
            readableGeneration > 0
              ? await getCatalogTotalCount(providerId, 'movie', { generation: readableGeneration }).catch(() => 0)
              : 0;
          const capability = evaluateVodCategoryFilterCapability({
            providerId,
            probes,
            estimatedCatalogSize: Math.max(
              previousTotal,
              ...probes.map((probe) => probe.returnedCount),
            ),
          });
          await writeVodCategoryFilterCapability(capability);
          filteringReliable = capability.filteringReliable;
        } else {
          logSync(providerId, 'movie-filter-capability-probe-failed', {
            reason: 'no-probe-samples',
            probeCategoryIds,
          });
        }
      } else {
        logSync(providerId, 'movie-filter-capability-probe-failed', {
          reason: 'insufficient-provider-categories',
          probeCategoryIds,
        });
      }
    }

    if (!filteringReliable && nativeAvailable && sqliteHandle?.enabled) {
      movieSyncStrategy = 'full-dump-stream-category';
      const fullDumpUrl = movies.getCatalogListRequestUrl?.('all') ?? null;
      if (!fullDumpUrl) {
        throw new Error('movie_full_dump_url_unavailable');
      }

      let rawStreamCount = 0;
      let decodedStreamCount = 0;
      let missingCategoryIdCount = 0;
      const distinctStreamCategoryIds = new Set<string>();
      const distinctContentIds = new Set<string>();
      const assignmentSamples: Array<{
        contentId: string;
        sourceCategoryId: string | null;
        normalizedCategoryId: string;
      }> = [];

      const fullDumpResult = await streamXtreamCategoryDecode({
        requestUrl: fullDumpUrl,
        mediaType: 'movie',
        filterCategoryId: 'all',
        providerId,
        isCancelled,
        onBatch: async (records) => {
          rawStreamCount += records.length;
          if (sqliteHandle) {
            recordCatalogSqliteDecoded(sqliteHandle, records.length);
          }

          for (const record of records) {
            const source =
              record.categoryId != null && String(record.categoryId).trim() !== ''
                ? String(record.categoryId)
                : null;
            if (!source) {
              missingCategoryIdCount += 1;
            }
            const normalized = normalizeStreamCategoryId(record.categoryId);
            distinctStreamCategoryIds.add(normalized);
            if (record.contentId) {
              distinctContentIds.add(record.contentId);
            }
            if (assignmentSamples.length < 6 && record.contentId) {
              assignmentSamples.push({
                contentId: record.contentId,
                sourceCategoryId: source,
                normalizedCategoryId: normalized,
              });
            }
          }

          decodedStreamCount += records.length;

          if (writerOnly) {
            await writeCatalogItemsFromSourceBudgeted(
              sqliteHandle!,
              records,
              (record) =>
                mapNativeRecordToCatalogItem(
                  record,
                  providerId,
                  'movie',
                  'all',
                  sqliteHandle!.generation,
                  { allowCategoryFallback: false },
                ),
              { isCancelled, mapKind: 'movieMapping' },
            );
            return;
          }

          const mapped = records.map((record) => {
            const categoryId = normalizeStreamCategoryId(record.categoryId);
            return nativeRecordToMovieSummary({ ...record, categoryId }, categoryId) as MovieSummary;
          });
          if (movieIndex && mapped.length) {
            await processTimeBudgeted(
              mapped,
              (movie) => {
                movieIndex.ingest([movie]);
              },
              { isCancelled },
            );
          }
          if (sqliteHandle?.enabled && mapped.length) {
            await writeCatalogItemsFromSourceBudgeted(
              sqliteHandle,
              mapped,
              (movie) => mapMovieSummaryToCatalogItem(movie, providerId, sqliteHandle!.generation),
              { isCancelled, mapKind: 'movieMapping' },
            );
          }
        },
      });

      if (fullDumpResult.cancelled || isCancelled()) {
        return;
      }

      markCatalogAuditItems(decodedStreamCount, 'processed');
      const counts = await getCatalogCategoryCounts(providerId, 'movie', {
        generation: sqliteHandle.generation,
      }).catch(() => []);
      // Counts may be empty until categories flush; rebuild from stream set for progress.
      for (const categoryId of distinctStreamCategoryIds) {
        setup.movieCountMap[categoryId] = setup.movieCountMap[categoryId] ?? 0;
      }
      for (const row of counts) {
        setup.movieCountMap[row.categoryId] = row.itemCount;
      }

      console.info(
        '[NovaCast Movies Full Dump Sync] ' +
          JSON.stringify({
            providerId,
            generation: sqliteHandle.generation,
            rawStreamCount: fullDumpResult.stats.rawSeen ?? rawStreamCount,
            decodedStreamCount,
            distinctContentIds: distinctContentIds.size,
            metadataCategoryCount: movieCategories.length,
            distinctStreamCategoryIds: distinctStreamCategoryIds.size,
            missingCategoryIdCount,
            filteringReliable: false,
            strategy: movieSyncStrategy,
            marker: 'stage3c2-vod-full-dump-sync-v1',
          }),
      );
      console.info(
        '[NovaCast Movies Category Assignment Sample] ' +
          JSON.stringify({
            generation: sqliteHandle.generation,
            samples: assignmentSamples,
            marker: 'stage3c2-vod-full-dump-sync-v1',
          }),
      );

      await writeCatalogSyncCheckpointSafe(
        setup,
        runToken,
        'movies',
        movieCategories.length,
        setup.resumeSeriesIndex,
      );
    } else {
      movieSyncStrategy = 'filtered-per-category';
      console.info(
        '[NovaCast Movies Full Dump Sync] ' +
          JSON.stringify({
            providerId,
            generation: sqliteHandle?.generation ?? null,
            rawStreamCount: 0,
            decodedStreamCount: 0,
            distinctContentIds: 0,
            metadataCategoryCount: movieCategories.length,
            distinctStreamCategoryIds: 0,
            missingCategoryIdCount: 0,
            filteringReliable: true,
            strategy: movieSyncStrategy,
            marker: 'stage3c2-vod-full-dump-sync-v1',
          }),
      );

      for (
        let movieCategoryIndex = setup.resumeMovieIndex;
        movieCategoryIndex < movieCategories.length;
        movieCategoryIndex += 1
      ) {
        const category = movieCategories[movieCategoryIndex];
        if (!(await yieldForPlaybackIfNeeded(providerId, `movie-category:${category.id}`, 'movies', runToken))) {
          publishCatalogProgress(setup);
          setup.progressThrottle.flush();
          schedulePendingHeavySync(providerId, input);
          return;
        }
        if (isCancelled()) {
          return;
        }

        const categoryStarted = Date.now();
        markCatalogAuditCategory('movie', 'fetch_start', { categoryId: category.id });
        beginVodCategoryPhaseProfile(category.id);
        let items: Awaited<ReturnType<NonNullable<MovieDataSource['listCategoryMovies']>>> | null = null;

        try {
          if (syncMovieItems) {
            const requestUrl = movies.getCatalogListRequestUrl?.(category.id) ?? null;
            const useNative = Boolean(requestUrl) && nativeAvailable;
            // SQLite-only (smart hidden) still needs native→DB writes; skip in-memory index ingest.
            const sqliteWriterOnly = writerOnly || (!movieIndex && Boolean(sqliteHandle?.enabled));

            if (!useNative && requestUrl) {
              logSync(providerId, 'movie-category-native-decode-skipped', {
                categoryId: category.id,
                reason: 'module-unavailable',
              });
            }

            if (useNative && requestUrl) {
              let matched = 0;
              const decodeResult = await streamXtreamCategoryDecode({
                requestUrl,
                mediaType: 'movie',
                filterCategoryId: category.id,
                providerId,
                isCancelled,
                onBatch: async (records) => {
                  try {
                    matched += records.length;
                    if (sqliteHandle) {
                      recordCatalogSqliteDecoded(sqliteHandle, records.length);
                    }
                    if (sqliteWriterOnly) {
                      if (sqliteHandle?.enabled && records.length) {
                        await writeCatalogItemsFromSourceBudgeted(
                          sqliteHandle,
                          records,
                          (record) =>
                            mapNativeRecordToCatalogItem(
                              record,
                              providerId,
                              'movie',
                              category.id,
                              sqliteHandle!.generation,
                              { allowCategoryFallback: true },
                            ),
                          { isCancelled, mapKind: 'movieMapping' },
                        );
                      }
                      return;
                    }
                    const mapped = records.map(
                      (record) => nativeRecordToMovieSummary(record, category.id) as MovieSummary,
                    );
                    if (movieIndex && mapped.length) {
                      const ingestStarted = Date.now();
                      await processTimeBudgeted(
                        mapped,
                        (movie) => {
                          movieIndex.ingest([movie]);
                        },
                        { isCancelled },
                      );
                      addVodCategoryPhaseMs('ingestMs', Date.now() - ingestStarted);
                    }
                    if (sqliteHandle?.enabled && mapped.length) {
                      await writeCatalogItemsFromSourceBudgeted(
                        sqliteHandle,
                        mapped,
                        (movie) => mapMovieSummaryToCatalogItem(movie, providerId, sqliteHandle!.generation),
                        { isCancelled, mapKind: 'movieMapping' },
                      );
                    }
                    releaseBatch(`movie-native-mapped:${category.id}`, mapped);
                  } finally {
                    releaseBatch(`movie-native-raw:${category.id}`, records);
                  }
                },
              });
              if (decodeResult.cancelled || isCancelled()) {
                return;
              }
              matched = decodeResult.matched;
              setup.movieCountMap[category.id] = matched;
              markCatalogAuditItems(matched, 'processed');
              addVodCategoryPhaseMs('jsonParseMs', Number(decodeResult.stats.downloadParseMs ?? 0));
              logSync(providerId, 'movie-category-native-decode', {
                categoryId: category.id,
                matched,
                batches: decodeResult.batches,
                maxBatchSize: decodeResult.maxBatchSize,
                rawSeen: decodeResult.stats.rawSeen,
                strategy: movieSyncStrategy,
                writerOnly: sqliteWriterOnly,
              });
            } else {
              const loaded = await loadAllMoviesForCatalogIndex(movies, category.id);
              items = loaded.items;
              if (sqliteHandle) {
                recordCatalogSqliteDecoded(sqliteHandle, items.length);
              }

              if (loaded.truncated && movieIndex) {
                movieIndex.markCategoryLoadTruncated();
              }

              if (items.length && movieIndex && !sqliteWriterOnly) {
                const ingestStarted = Date.now();
                await processTimeBudgeted(
                  items,
                  (movie) => {
                    movieIndex.ingest([movie]);
                  },
                  { isCancelled },
                );
                addVodCategoryPhaseMs('ingestMs', Date.now() - ingestStarted);
              }

              if (items.length && sqliteHandle?.enabled) {
                await writeCatalogItemsFromSourceBudgeted(
                  sqliteHandle,
                  items,
                  (movie) => mapMovieSummaryToCatalogItem(movie, providerId, sqliteHandle!.generation),
                  { isCancelled, mapKind: 'movieMapping' },
                );
              }

              setup.movieCountMap[category.id] = items.length;
              markCatalogAuditItems(items.length, 'processed');
            }
          } else if (movies.getCategoryCount) {
            setup.movieCountMap[category.id] = await movies.getCategoryCount(category.id);
          }

          const durationMs = Date.now() - categoryStarted;
          const categoryMode = syncMovieItems ? 'full' : 'count-only';
          finishVodCategoryPhaseProfile({
            mode: categoryMode,
            durationMs,
          });
          markCatalogAuditCategory('movie', 'fetch_done', {
            categoryId: category.id,
            count: setup.movieCountMap[category.id] ?? 0,
            durationMs,
          });
          logSync(providerId, 'movie-category-synced', {
            categoryId: category.id,
            count: setup.movieCountMap[category.id] ?? 0,
            durationMs,
            mode: categoryMode,
          });
        } catch (error) {
          finishVodCategoryPhaseProfile({
            failed: true,
            error: error instanceof Error ? error.message : String(error),
          });
          throw error;
        } finally {
          releaseBatch(`movie-category:${category.id}`, items);
        }

        await writeCatalogSyncCheckpointSafe(setup, runToken, 'movies', movieCategoryIndex + 1, setup.resumeSeriesIndex);
        if (movieCategoryIndex === setup.resumeMovieIndex || (movieCategoryIndex + 1) % 5 === 0) {
          publishCatalogProgress(setup);
        }
        await waitForCatalogSyncIdleSlot();
      }
    }

    if (movieIndex && smartCategoriesEnabled && !isCancelled()) {
      if (!(await yieldForPlaybackIfNeeded(providerId, 'movie-region-rank', 'movies', runToken))) {
        schedulePendingHeavySync(providerId, input);
        return;
      }
      const rankStarted = Date.now();
      const rankResult = await rankUniqueItemsInBatches(movieIndex.listAllEntries(), {
        contentType: 'movie',
        batchSize: VOD_REGION_RANK_BATCH_SIZE,
        isCancelled,
        hasRank: (id) => movieIndex.hasRegionRank(id),
        apply: (id, regionRank) => {
          movieIndex.setRegionRank(id, regionRank);
        },
      });
      logSync(providerId, 'movie-region-rank-complete', {
        ...rankResult,
        durationMs: Date.now() - rankStarted,
        batchSize: VOD_REGION_RANK_BATCH_SIZE,
      });
    }

    if (smartCategoriesEnabled) {
      notifyPhase(providerId, 'smart-building');
      await writeCatalogSyncCheckpointSafe(
        setup,
        runToken,
        'smart',
        movieCategories.length,
        setup.resumeSeriesIndex,
      );
      if (!(await yieldForPlaybackIfNeeded(providerId, 'smart-building:movies', 'movies-smart', runToken))) {
        schedulePendingHeavySync(providerId, input);
        return;
      }
      await buildMovieSmartCache(providerId, runToken);
    }

    if (isCancelled()) {
      logSync(providerId, 'movie-sync-cancelled', { reason: 'provider-reset' });
      const movieFinishOk = await finishCatalogSqliteMediaSync({
        handle: sqliteHandle ?? createDisabledCatalogSqliteMediaSyncHandle(providerId, 'movie'),
        ok: false,
        errorCode: 'cancelled',
      });
      return;
    }

    publishCatalogProgress(setup);
    setup.progressThrottle.flush();
    movieIndex?.commitSync();

    const movieFinishOk = await finishCatalogSqliteMediaSync({
      handle: sqliteHandle ?? createDisabledCatalogSqliteMediaSyncHandle(providerId, 'movie'),
      ok: true,
      processedCount: Object.values(setup.movieCountMap).reduce((sum, count) => sum + count, 0),
      nativeDone: true,
    });
    if (!movieFinishOk) {
      throw new Error('movie_completion_barrier_failed');
    }

    await writeCatalogSyncCheckpointSafe(
      setup,
      runToken,
      'complete',
      movieCategories.length,
      setup.resumeSeriesIndex,
    );

    logSync(providerId, 'movie-sync-completed', {
      durationMs: Date.now() - started,
      smartCategoriesEnabled,
      movieCatalog: movieIndex?.getCompleteness(),
    });
    markCatalogAuditSync('completed', { providerId, mediaType: 'movie', durationMs: Date.now() - started });
    notifyMovieCatalogReady(providerId, sqliteHandle?.generation ?? 0);
    markMediaJobComplete(providerId, 'movie');
  } catch (error) {
    movieIndex?.abortSync();
    if (sqliteHandle?.enabled) {
      await finishCatalogSqliteMediaSync({
        handle: sqliteHandle,
        ok: false,
        errorCode: error instanceof Error ? error.message : 'movie_sync_failed',
        nativeDone: false,
      });
    }
    throw error;
  }
}

export async function runSeriesCatalogSync(
  input: ProviderCatalogSyncInput,
  runToken: number,
  coordinatorKey: string,
) {
  const { providerId, series, live } = input;
  const started = Date.now();
  const isCancelled = () => isCatalogJobCancelled(runToken, coordinatorKey);
  const setup = await ensureCatalogSyncSetup(input, runToken);

  notifyPhase(providerId, 'syncing');
  markCatalogAuditSync('started', { providerId, mediaType: 'series' });
  logSync(providerId, 'series-sync-started');

  if (isCancelled()) {
    logSync(providerId, 'series-sync-cancelled', { reason: 'provider-reset' });
    return;
  }

  if (await shouldSkipSeriesSync(setup, runToken)) {
    markMediaJobComplete(providerId, 'series');
    markCatalogAuditSync('completed', { providerId, mediaType: 'series', skipped: true });
    return;
  }

  if (!(await waitForHeavyCatalogWindow(providerId, runToken))) {
    publishCatalogProgress(setup);
    setup.progressThrottle.flush();
    schedulePendingHeavySync(providerId, input);
    return;
  }

  const { smartCategoriesEnabled, seriesCategories, liveCategories } = setup;
  const seriesIndex = smartCategoriesEnabled ? getSeriesCatalogIndex(providerId) : null;
  const canResumeCheckpoint = setup.checkpointMatches && Boolean(setup.checkpoint);
  if (smartCategoriesEnabled && !canResumeCheckpoint) {
    seriesIndex?.beginSync();
  }

  const seriesDataSource = createProviderSeriesDataSource(series);
  let sqliteHandle: CatalogSqliteMediaSyncHandle | null = null;

  try {
    sqliteHandle = await startCatalogSqliteMediaSync({
      providerId,
      mediaType: 'series',
      providerType: input.providerType ?? 'unknown',
      displayName: input.displayName ?? null,
    });

    if (sqliteHandle.enabled) {
      await writeCategoriesFromSourceBudgeted(
        sqliteHandle,
        seriesCategories,
        (category, index) => ({
          providerId,
          mediaType: 'series' as const,
          categoryId: category.id,
          categoryName: category.name,
          sortOrder: index,
          syncGeneration: sqliteHandle!.generation,
        }),
        { isCancelled },
      );
    }

    await writeCatalogSyncCheckpointSafe(
      setup,
      runToken,
      setup.resumeMovieIndex < setup.movieCategories.length ? 'movies' : 'series',
      setup.resumeMovieIndex,
      setup.resumeSeriesIndex,
    );

    for (
      let seriesCategoryIndex = setup.resumeSeriesIndex;
      seriesCategoryIndex < seriesCategories.length;
      seriesCategoryIndex += 1
    ) {
      const category = seriesCategories[seriesCategoryIndex];
      if (!(await yieldForPlaybackIfNeeded(providerId, `series-category:${category.id}`, 'series', runToken))) {
        publishCatalogProgress(setup);
        setup.progressThrottle.flush();
        schedulePendingHeavySync(providerId, input);
        return;
      }
      if (isCancelled()) {
        return;
      }

      const categoryStarted = Date.now();
      markCatalogAuditCategory('series', 'fetch_start', { categoryId: category.id });
      let items: Awaited<ReturnType<NonNullable<typeof seriesDataSource.listCategorySeries>>> | null = null;

      try {
        if (smartCategoriesEnabled) {
          const requestUrl = seriesDataSource.getCatalogListRequestUrl?.(category.id) ?? null;
          const useNative = Boolean(requestUrl) && isNativeCatalogDecodeAvailable();
          const writerOnly = isCatalogSqliteWriterOnlyDiagnosticEnabled();

          if (!useNative && requestUrl) {
            logSync(providerId, 'series-category-native-decode-skipped', {
              categoryId: category.id,
              reason: 'module-unavailable',
            });
          }

          if (useNative && requestUrl) {
            const decodeResult = await streamXtreamCategoryDecode({
              requestUrl,
              mediaType: 'series',
              filterCategoryId: category.id,
              providerId,
              isCancelled,
              onBatch: async (records) => {
                try {
                  if (writerOnly) {
                    if (sqliteHandle) {
                      recordCatalogSqliteDecoded(sqliteHandle, records.length);
                    }
                    if (sqliteHandle?.enabled && records.length) {
                      await writeCatalogItemsFromSourceBudgeted(
                        sqliteHandle,
                        records,
                        (record, index) => ({
                          ...mapNativeRecordToCatalogItem(
                            record,
                            providerId,
                            'series',
                            category.id,
                            sqliteHandle!.generation,
                          ),
                          providerSortOrder: index,
                        }),
                        { isCancelled, mapKind: 'seriesMapping' },
                      );
                    }
                    return;
                  }
                  const mapped = records.map(
                    (record) => nativeRecordToSeriesSummary(record, category.id) as SeriesSummary,
                  );
                  if (seriesIndex && mapped.length) {
                    await processTimeBudgeted(
                      mapped,
                      (entry) => {
                        seriesIndex.ingest([entry]);
                      },
                      { isCancelled },
                    );
                    notifySeriesCatalogReady(providerId);
                  }
                  if (sqliteHandle?.enabled && mapped.length) {
                    await writeCatalogItemsFromSourceBudgeted(
                      sqliteHandle,
                      mapped,
                      (entry, index) =>
                        mapSeriesSummaryToCatalogItem(entry, providerId, sqliteHandle!.generation, index),
                      { isCancelled, mapKind: 'seriesMapping' },
                    );
                  }
                  releaseBatch(`series-native-mapped:${category.id}`, mapped);
                } finally {
                  releaseBatch(`series-native-raw:${category.id}`, records);
                }
              },
            });
            if (decodeResult.cancelled || isCancelled()) {
              return;
            }
            setup.seriesCountMap[category.id] = decodeResult.matched;
            markCatalogAuditItems(decodeResult.matched, 'processed');
            logSync(providerId, 'series-category-native-decode', {
              categoryId: category.id,
              matched: decodeResult.matched,
              batches: decodeResult.batches,
              maxBatchSize: decodeResult.maxBatchSize,
              rawSeen: decodeResult.stats.rawSeen,
              downloadParseMs: decodeResult.stats.downloadParseMs,
              writerOnly,
            });
          } else {
            const loaded = await loadAllSeriesForCatalogIndex(seriesDataSource, category.id);
            items = loaded.items;
            if (sqliteHandle) {
              recordCatalogSqliteDecoded(sqliteHandle, items.length);
            }

            if (loaded.truncated && seriesIndex) {
              seriesIndex.markCategoryLoadTruncated();
            }

            if (items.length && seriesIndex && !writerOnly) {
              await processTimeBudgeted(
                items,
                (entry) => {
                  seriesIndex.ingest([entry]);
                },
                { isCancelled },
              );
              notifySeriesCatalogReady(providerId);
            }

            if (items.length && sqliteHandle?.enabled) {
              await writeCatalogItemsFromSourceBudgeted(
                sqliteHandle,
                items,
                (entry, index) =>
                  mapSeriesSummaryToCatalogItem(entry, providerId, sqliteHandle!.generation, index),
                { isCancelled, mapKind: 'seriesMapping' },
              );
            }

            setup.seriesCountMap[category.id] = items.length;
            markCatalogAuditItems(items.length, 'processed');
          }
        } else if (seriesDataSource.getCategoryCount) {
          setup.seriesCountMap[category.id] = await seriesDataSource.getCategoryCount(category.id);
        }

        const durationMs = Date.now() - categoryStarted;
        markCatalogAuditCategory('series', 'fetch_done', {
          categoryId: category.id,
          count: setup.seriesCountMap[category.id] ?? 0,
          durationMs,
        });
        logSync(providerId, 'series-category-synced', {
          categoryId: category.id,
          count: setup.seriesCountMap[category.id] ?? 0,
          durationMs,
          mode: smartCategoriesEnabled ? 'full' : 'count-only',
        });
      } finally {
        releaseBatch(`series-category:${category.id}`, items);
      }

      await writeCatalogSyncCheckpointSafe(
        setup,
        runToken,
        'series',
        setup.movieCategories.length,
        seriesCategoryIndex + 1,
      );
      if (seriesCategoryIndex === setup.resumeSeriesIndex || (seriesCategoryIndex + 1) % 5 === 0) {
        publishCatalogProgress(setup);
      }
      await waitForCatalogSyncIdleSlot();
    }

    if (liveCategories.length && !isCancelled()) {
      setup.liveChannelCount = await resolveAndRefreshLiveChannelCount(
        providerId,
        live,
        liveCategories,
        runToken,
      );
    }

    if (smartCategoriesEnabled) {
      notifyPhase(providerId, 'smart-building');
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

    if (isCancelled()) {
      logSync(providerId, 'series-sync-cancelled', { reason: 'provider-reset' });
      await finishCatalogSqliteMediaSync({
        handle: sqliteHandle ?? createDisabledCatalogSqliteMediaSyncHandle(providerId, 'series'),
        ok: false,
        errorCode: 'cancelled',
      });
      return;
    }

    publishCatalogProgress(setup);
    setup.progressThrottle.flush();
    seriesIndex?.commitSync();

    await finishCatalogSqliteMediaSync({
      handle: sqliteHandle ?? createDisabledCatalogSqliteMediaSyncHandle(providerId, 'series'),
      ok: true,
      processedCount: Object.values(setup.seriesCountMap).reduce((sum, count) => sum + count, 0),
    });

    await writeCatalogSyncCheckpointSafe(
      setup,
      runToken,
      'complete',
      setup.movieCategories.length,
      seriesCategories.length,
    );

    logSync(providerId, 'series-sync-completed', {
      durationMs: Date.now() - started,
      smartCategoriesEnabled,
      seriesCatalog: seriesIndex?.getCompleteness(),
    });
    markCatalogAuditSync('completed', { providerId, mediaType: 'series', durationMs: Date.now() - started });
    markMediaJobComplete(providerId, 'series');
  } catch (error) {
    seriesIndex?.abortSync();
    if (sqliteHandle?.enabled) {
      await finishCatalogSqliteMediaSync({
        handle: sqliteHandle,
        ok: false,
        errorCode: error instanceof Error ? error.message : 'series_sync_failed',
      });
    }
    throw error;
  }
}

export async function runProviderCatalogSync(input: ProviderCatalogSyncInput, runToken: number) {
  const providerId = input.providerId;
  const movieKey = buildCatalogSyncKey(providerId, 'movie');
  const seriesKey = buildCatalogSyncKey(providerId, 'series');
  await Promise.all([
    runMovieCatalogSync(input, runToken, movieKey),
    runSeriesCatalogSync(input, runToken, seriesKey),
  ]);
}

function startProviderCatalogSync(input: ProviderCatalogSyncInput, runToken: number) {
  const providerId = input.providerId;
  const movieKey = buildCatalogSyncKey(providerId, 'movie');
  const seriesKey = buildCatalogSyncKey(providerId, 'series');

  const task = Promise.all([
    scheduleCatalogSync(
      movieKey,
      () => runMovieCatalogSync(input, runToken, movieKey),
      { delayMs: movieCatalogScheduleDelayMs },
    ),
    scheduleCatalogSync(
      seriesKey,
      () => runSeriesCatalogSync(input, runToken, seriesKey),
      { delayMs: seriesCatalogScheduleDelayMs },
    ),
  ])
    .then(() => {})
    .catch((error) => {
      try {
        getMovieCatalogIndex(providerId)?.abortSync();
        getSeriesCatalogIndex(providerId)?.abortSync();
      } catch {
        // Preserve browse state best-effort.
      }
      notifyPhase(providerId, 'error');
      markCatalogAuditSync('failed', {
        providerId,
        error: error instanceof Error ? error.message : String(error),
      });
      logSync(providerId, 'sync-failed', {
        error: error instanceof Error ? error.message : String(error),
        cachedDataPreserved: true,
      });
    })
    .finally(() => {
      syncInFlight.delete(providerId);
      catalogSyncSetupCache.delete(catalogSyncSetupKey(providerId, runToken));
      if (runToken !== syncGeneration) {
        return;
      }
      const pending = pendingSyncInputs.get(providerId);
      if (pending) {
        pendingSyncInputs.delete(providerId);
        scheduleProviderCatalogSync(pending);
      }
    });

  syncInFlight.set(providerId, task);
  return task;
}

export function scheduleProviderCatalogSync(input: ProviderCatalogSyncInput) {
  markCatalogAuditSync('requested', { providerId: input.providerId });
  logSync(input.providerId, 'sync-requested');

  const existing = syncInFlight.get(input.providerId);
  if (existing) {
    // Keep the latest request; resume once the in-flight job finishes.
    pendingSyncInputs.set(input.providerId, input);
    return existing;
  }

  const runToken = syncGeneration;
  return startProviderCatalogSync(input, runToken);
}

export function cancelProviderCatalogSync(providerId?: string) {
  syncGeneration += 1;
  if (providerId) {
    pendingSyncInputs.delete(providerId);
    invalidateCatalogSyncForProvider(providerId);
  } else {
    pendingSyncInputs.clear();
    cancelCatalogSync();
  }
  catalogSyncSetupCache.clear();
  mediaJobCompletion.clear();
}

export async function hydrateProviderLibraryCaches(providerId: string) {
  const { readProviderLibrarySummary } = await import('./providerLibrarySummaryStore.ts');
  const { readCategoryCountIndex } = await import('./categoryCountIndexStore.ts');
  const { readSmartCategoryCache } = await import('./smartCategoryCacheStore.ts');

  // Keep summary + counts on the first-focus path; defer large smart-cache JSON.parse.
  await earlyBootTimed('hydrate.summary_and_counts', () =>
    Promise.all([
      readProviderLibrarySummary(providerId),
      readCategoryCountIndex(providerId, 'movie'),
      readCategoryCountIndex(providerId, 'series'),
      readCategoryCountIndex(providerId, 'live'),
      Promise.resolve(getMovieCatalogIndex(providerId)),
      Promise.resolve(getSeriesCatalogIndex(providerId)),
    ]),
  );

  void earlyBootTimed('hydrate.smart_caches_deferred', () =>
    Promise.all([
      readSmartCategoryCache(providerId, 'movie'),
      readSmartCategoryCache(providerId, 'series'),
    ]),
  );
}

export function clearProviderCatalogSyncForTests() {
  syncInFlight.clear();
  pendingSyncInputs.clear();
  syncListeners.clear();
  catalogSyncSetupCache.clear();
  mediaJobCompletion.clear();
  checkpointWriteChain = Promise.resolve();
  syncGeneration = 0;
  lastReleasedBatchLabel = null;
  movieCatalogScheduleDelayMs = 0;
  seriesCatalogScheduleDelayMs = 0;
  lastCheckpointWriteAt = 0;
  clearCatalogSyncCoordinatorForTests();
}

export function setCatalogSyncShellDelaysForTests(delays: {
  movieMs?: number;
  seriesMs?: number;
}) {
  if (typeof delays.movieMs === 'number') {
    movieCatalogScheduleDelayMs = delays.movieMs;
  }
  if (typeof delays.seriesMs === 'number') {
    seriesCatalogScheduleDelayMs = delays.seriesMs;
  }
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
