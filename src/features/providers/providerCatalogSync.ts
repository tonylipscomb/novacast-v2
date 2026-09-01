import AsyncStorage from '@react-native-async-storage/async-storage';
import type { MovieDataSource } from '../movies/data/MovieDataSource.ts';
import { getMovieCatalogIndex } from '../movies/smart/movieCatalogIndex.ts';
import {
  reevaluateProviderCatalogNetworkGateSurface,
} from './providerCatalogNetworkGate.ts';
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
import { ensureLiveSearchSqliteCatalog, publishLiveSearchCatalogFromDump } from '../search/liveSearchSqliteCatalog.ts';
import type { ProviderLiveCategory, ProviderLiveRepository, ProviderSeriesRepository } from './providerRepositories.ts';
import {
  scheduleCatalogSyncResume,
  shouldYieldCatalogSync,
  waitForCatalogSyncIdleSlot,
  waitUntilPlaybackIdleForCatalogSync,
  CATALOG_SYNC_IDLE_TIMEOUT_MS,
} from './catalogSyncPlayback.ts';
import {
  isCatalogGuidePriorityActive,
  waitUntilCatalogGuidePriorityIdle,
} from './catalogSyncGuidePriority.ts';
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
import { loadAllMoviesForCatalogIndex } from './catalogCategoryLoader.ts';
import { logSmartCategoryCatalogAudit } from './catalogSyncAudit.ts';
import { earlyBootMark, earlyBootTimed } from '../diagnostics/earlyBootAudit.ts';
import { isNovaCastCatalogTraceEnabled } from '../diagnostics/novacastLogPolicy.ts';
import {
  buildCatalogSyncKey,
  cancelCatalogSync,
  clearCatalogSyncCoordinatorForTests,
  createCatalogProgressThrottle,
  getCatalogSyncCancelToken,
  getCatalogSyncEpoch,
  invalidateCatalogSyncForProvider,
  processTimeBudgeted,
  scheduleCatalogSync,
  getCatalogUiSurface,
  subscribeCatalogUiSurface,
  type CatalogProgressThrottle,
} from '../catalog/index.ts';
import {
  createDisabledCatalogSqliteMediaSyncHandle,
  finishCatalogSqliteMediaSync,
  mapMovieSummaryToCatalogItem,
  mapNativeRecordToCatalogItem,
  mapSeriesSummaryToCatalogItem,
  startCatalogSqliteMediaSync,
  writeCatalogItemsFromSourceBudgeted,
  writeCategoriesFromSourceBudgeted,
  recordCatalogSqliteDecoded,
  recordCatalogSqliteCategoryResult,
  recordCatalogSqliteCheckpoint,
  recordCatalogSqliteCategoryContext,
  type CatalogSqliteMediaSyncHandle,
} from '../catalog/catalogSqliteSyncWriter.ts';
import {
  isCatalogSqliteWriterOnlyDiagnosticEnabled,
  isNativeCatalogDecodeAvailable,
  nativeRecordToMovieSummary,
  nativeRecordToSeriesSummary,
  streamXtreamCategoryDecode,
} from '../catalog/nativeCatalogDecode.ts';
import type { NativeCatalogRecord } from '../catalog/nativeCatalogDecode.ts';
import {
  getCatalogCategoryCounts,
  getCatalogTotalCount,
  getCatalogSyncState,
  resolveReadableCatalogGeneration,
} from '../catalog/catalogRepository.ts';
import {
  createVodCategoryProbeAccumulator,
  evaluateSparsePerCategoryCoverage,
  evaluateVodCategoryFilterCapability,
  normalizeStreamCategoryId,
  readVodCategoryFilterCapability,
  selectVodCategoryProbeIds,
  writeVodCategoryFilterCapability,
  type VodCategoryProbeSample,
} from '../catalog/vodCategoryFilterCapability.ts';
import type { MovieSummary } from '../movies/movieTypes.ts';
import type { SeriesSummary } from '../media-browser/mediaTypes.ts';
import { emitSeriesSqliteEvent } from '../series/seriesDiagnostics.ts';
import {
  classifyCatalogMediaJobResults,
  firstSettledRejection,
} from './catalogSyncJobAggregation.ts';
import { setEvictingCachedPromise } from './catalogSyncSetupCache.ts';
import { resolveCatalogCheckpointResume } from './catalogSyncCheckpointResume.ts';
import { decideMovieCatalogCompletion } from './movieCatalogCompletion.ts';
import {
  isSeriesCategoryDecodeCancelled,
  retrySeriesCategoryDecode,
} from './seriesCategoryDecodeRetry.ts';
import {
  createSeriesCompletenessTracker,
  decodeSeriesFullDumpUnique,
  evaluateSeriesCategoryFilterFromProbes,
  type SeriesCompletenessTracker,
} from './seriesCatalogCompleteness.ts';
import {
  attachSeriesDumpCancelSignal,
  beginSeriesDumpCancellationAudit,
  endSeriesDumpCancellationAudit,
  isUiLifecycleCancelSource,
  noteSeriesCancelRequested,
} from './seriesCancellationAudit.ts';
import {
  assignSeriesStreamCategoryId,
  decideSeriesCatalogCompletion,
  logSeriesCompletionProbe,
  logSeriesFullDumpSync,
  mergeSeriesMetadataWithDumpCategories,
  SERIES_UNKNOWN_CATEGORY_ID,
} from './seriesCatalogCompletion.ts';
import { enrichAndPersistSeriesCategoryNames } from '../series/seriesCategoryNameEnrichment.ts';
import { isTrustworthySeriesCategoryName } from '../series/seriesCategoryNameResolution.ts';
import { createMovieCompletenessTracker } from './movieCatalogCompleteness.ts';
import { getLastLiveCompletenessDumpStats, decodeLiveFullDumpUnique, emitLiveCompletenessFromAuthoritativeDump } from './liveCatalogCompleteness.ts';
import { resetProviderCatalogNetworkGateForTests } from './providerCatalogNetworkGate.ts';
import {
  decideLiveCatalogCompletion,
  derivedLiveCategoryName,
  LIVE_UNKNOWN_CATEGORY_ID,
  logLiveFullDumpSync,
  logLivePublicationTrace,
  mergeLiveMetadataWithDumpCategories,
} from './liveCatalogCompletion.ts';
import { normalizeLiveDumpChannelsCooperatively } from './liveCatalogNormalization.ts';
import { runProviderEntitlementAudit } from './providerEntitlementAudit.ts';
import {
  createMovieSqliteOwnershipState,
  enforceMovieSqliteTerminal,
  finishOwnedMovieSqlite,
  movieSqliteOwnershipProbeFields,
  noteMovieSqliteHandle,
  ownsOpenMovieSqliteGeneration,
  terminateMovieSqliteEarlyReturn,
  MOVIE_SYNC_CANCELLED_ERROR,
} from './movieSqliteOwnership.ts';

const PERF_LOG_PREFIX = '[NovaCast CatalogSync]';
const CATALOG_SYNC_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
// Stage 4.2D: bump invalidates stale "complete" checkpoints that skipped sparse repair.
const CATALOG_SYNC_CHECKPOINT_VERSION = 15;
const CATALOG_SYNC_CHECKPOINT_PREFIX = '@novacast/catalog-sync-checkpoint/';
const syncInFlight = new Map<string, Promise<void>>();
const syncAuditRuns = new Map<string, { requestId: string; runId: string; source: string; runToken: number; startedAt: number }>();
let syncAuditSequence = 0;
/** One-shot Movies full-dump force (sparse repair / capability invalidate). */
const forceMoviesFullDumpByProvider = new Map<string, string>();

/** Shell-settle delays before automatic catalog work (ms). Zeroed in unit tests. */
let movieCatalogScheduleDelayMs = 2500;
let seriesCatalogScheduleDelayMs = 4000;
let liveCatalogScheduleDelayMs = 1500;
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
const pendingSeriesRetryLatches = new Map<string, {
  providerId: string;
  runToken: number;
  coordinatorKey: string;
  coordinatorEpoch: number;
  input: ProviderCatalogSyncInput;
  runId?: string;
  scheduled: boolean;
  timer?: ReturnType<typeof setTimeout>;
}>();
const moviesCriticalWindowLogged = new Set<string>();
const SERIES_PREEMPTION_RETRY_DELAY_MS = 750;

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

function isCatalogSyncDebugEnabled() {
  return isNovaCastCatalogTraceEnabled();
}

function isSyncRunStale(runToken: number) {
  return runToken !== syncGeneration;
}

function seriesRetryKey(providerId: string, runToken: number, coordinatorKey: string, coordinatorEpoch: number) {
  return `${providerId}:${runToken}:${coordinatorKey}:${coordinatorEpoch}:get_series`;
}

function logSeriesRetryEvent(
  event: string,
  latch: {
    providerId: string;
    runToken: number;
    input: ProviderCatalogSyncInput;
  },
  extra: Record<string, unknown> = {},
) {
  console.info('[NovaCast Catalog Network Gate]', {
    event,
    providerId: latch.providerId,
    generation: latch.runToken,
    activeSurface: getCatalogUiSurface(),
    readableMovieGenerationPresent: extra.readableMovieGenerationPresent ?? false,
    reason: extra.reason ?? null,
    waitMs: extra.waitMs ?? null,
    ownerHeldMs: extra.ownerHeldMs ?? null,
    thresholdMs: extra.thresholdMs ?? null,
    retryDelayMs: extra.retryDelayMs ?? null,
  });
}

function discardStaleSeriesRetryLatches() {
  for (const [key, latch] of pendingSeriesRetryLatches) {
    if (
      isSyncRunStale(latch.runToken) ||
      getCatalogSyncEpoch(latch.coordinatorKey) !== latch.coordinatorEpoch
    ) {
      if (latch.timer) clearTimeout(latch.timer);
      pendingSeriesRetryLatches.delete(key);
      logSeriesRetryEvent('series-retry-stale-discarded', latch, {
        reason: isSyncRunStale(latch.runToken) ? 'provider-generation-stale' : 'series-work-item-stale',
      });
    }
  }
}

function scheduleLatchedSeriesRetry(
  latch: {
    providerId: string;
    runToken: number;
    coordinatorKey: string;
    coordinatorEpoch: number;
    input: ProviderCatalogSyncInput;
    runId?: string;
    scheduled: boolean;
    timer?: ReturnType<typeof setTimeout>;
  },
  reason: string,
) {
  if (latch.scheduled) {
    return;
  }
  if (
    isSyncRunStale(latch.runToken) ||
    getCatalogSyncEpoch(latch.coordinatorKey) !== latch.coordinatorEpoch
  ) {
    if (latch.timer) clearTimeout(latch.timer);
    pendingSeriesRetryLatches.delete(
      seriesRetryKey(latch.providerId, latch.runToken, latch.coordinatorKey, latch.coordinatorEpoch),
    );
    logSeriesRetryEvent('series-retry-stale-discarded', latch, { reason: 'provider-generation-stale' });
    return;
  }
  latch.scheduled = true;
  logSeriesRetryEvent('series-retry-release-condition', latch, { reason });
  const key = seriesRetryKey(
    latch.providerId,
    latch.runToken,
    latch.coordinatorKey,
    latch.coordinatorEpoch,
  );
  latch.timer = setTimeout(() => {
    latch.timer = undefined;
    if (
      isSyncRunStale(latch.runToken) ||
      getCatalogSyncEpoch(latch.coordinatorKey) !== latch.coordinatorEpoch
    ) {
      pendingSeriesRetryLatches.delete(key);
      logSeriesRetryEvent('series-retry-stale-discarded', latch, { reason: 'provider-generation-stale-before-run' });
      return;
    }
    pendingSeriesRetryLatches.delete(key);
    logSeriesRetryEvent('series-retry-scheduled', latch, {
      reason,
      retryDelayMs: SERIES_PREEMPTION_RETRY_DELAY_MS,
    });
    void scheduleCatalogSync(
      latch.coordinatorKey,
      () => runSeriesCatalogSync(latch.input, latch.runToken, latch.coordinatorKey, latch.runId),
    );
    }, SERIES_PREEMPTION_RETRY_DELAY_MS);
}

function latchSeriesRetry(input: {
  providerId: string;
  runToken: number;
  coordinatorKey: string;
  coordinatorEpoch: number;
  input: ProviderCatalogSyncInput;
  runId?: string;
}, ownerHeldMs: number) {
  const key = seriesRetryKey(
    input.providerId,
    input.runToken,
    input.coordinatorKey,
    input.coordinatorEpoch,
  );
  if (pendingSeriesRetryLatches.has(key)) {
    return;
  }
  const latch = { ...input, scheduled: false };
  pendingSeriesRetryLatches.set(key, latch);
  logSeriesRetryEvent('series-preemption-latched', latch, {
    reason: 'foreground-movies-first-run',
    ownerHeldMs,
  });
  logSeriesRetryEvent('series-retry-deferred', latch, {
    reason: 'movies-critical-window-active',
    ownerHeldMs,
  });
}

function releaseSeriesRetries(reason: string) {
  discardStaleSeriesRetryLatches();
  for (const latch of pendingSeriesRetryLatches.values()) {
    scheduleLatchedSeriesRetry(latch, reason);
  }
}

subscribeCatalogUiSurface((surface) => {
  reevaluateProviderCatalogNetworkGateSurface(surface);
  if (surface !== 'movies') {
    for (const latch of pendingSeriesRetryLatches.values()) {
      console.info('[NovaCast Catalog Network Gate]', {
        event: 'movies-critical-window-exit',
        providerId: latch.providerId,
        generation: latch.runToken,
        activeSurface: surface,
        readableMovieGenerationPresent: false,
        reason: 'movies-surface-exited',
      });
    }
    releaseSeriesRetries('movies-surface-exited');
  }
});

function isCatalogJobCancelled(runToken: number, coordinatorKey: string) {
  return isSyncRunStale(runToken) || getCatalogSyncCancelToken(coordinatorKey).isStale();
}

/** TEMP: always-on movie bootstrap probe. Remove after the fresh-provider movie stall is diagnosed. */
function logMovieSyncProbe(functionName: string, fields: Record<string, unknown>) {
  // TEMPORARILY DISABLED for the ONN performance candidate. Keep the call
  // sites until the bootstrap diagnosis is complete; this must not affect sync.
}

function logMoviePromiseProbe(event: string, fields: Record<string, unknown>) {
}

function logLivePromiseProbe(event: string, fields: Record<string, unknown>) {
}

function movieSyncErrorFields(error: unknown) {
  const err = error instanceof Error ? error : null;
  return {
    errorName: err?.name ?? typeof error,
    errorMessage: err?.message ?? String(error),
    errorStack: typeof err?.stack === 'string' ? err.stack : null,
  };
}

function movieSyncCheckpointSnapshot(checkpoint: CatalogSyncCheckpoint | null | undefined) {
  if (!checkpoint) {
    return { present: false };
  }
  return {
    present: true,
    version: checkpoint.version,
    stage: checkpoint.stage,
    updatedAt: checkpoint.updatedAt,
    movieIndex: checkpoint.movieIndex,
    seriesIndex: checkpoint.seriesIndex,
    movieCategoryIdCount: checkpoint.movieCategoryIds?.length ?? 0,
    seriesCategoryIdCount: checkpoint.seriesCategoryIds?.length ?? 0,
    movieCountMapKeys: Object.keys(checkpoint.movieCountMap ?? {}).length,
    seriesCountMapKeys: Object.keys(checkpoint.seriesCountMap ?? {}).length,
    smartCategoriesEnabled: checkpoint.smartCategoriesEnabled,
  };
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

function logSyncLifecycle(
  providerId: string,
  event: string,
  payload: Record<string, unknown> = {},
) {
  if (!isCatalogSyncDebugEnabled()) {
    return;
  }
  const active = syncAuditRuns.get(providerId);
  console.info('[NovaCast Catalog Sync Lifecycle Audit]', {
    providerId,
    event,
    activeRunPresent: Boolean(active),
    activeRunId: active?.runId ?? null,
    activeRequestId: active?.requestId ?? null,
    activeRunToken: active?.runToken ?? null,
    activeRunAgeMs: active ? Date.now() - active.startedAt : null,
    ...payload,
  });
}

function logMovieCategoryTiming(input: {
  generation: number | null;
  categoryId: string;
  matched: number;
  providerNativeMs: number;
  sqliteWriteMs: number;
  checkpointMs: number;
  idleYieldMs: number;
  totalMs: number;
}) {
  if (!isCatalogSyncDebugEnabled()) {
    return;
  }
  if (
    input.totalMs < 2000 &&
    input.sqliteWriteMs < 1000 &&
    input.providerNativeMs < 2000 &&
    input.checkpointMs < 250
  ) {
    return;
  }
  console.info('[NovaCast Movie Category Timing]', input);
}

function logMovieCompletionPhase(phase: string, generation: number | null, startedAt: number) {
  if (!isCatalogSyncDebugEnabled()) {
    return;
  }
  console.info('[NovaCast Movie Completion Phase]', {
    phase,
    generation,
    durationMs: Date.now() - startedAt,
  });
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
  if (isCatalogSyncDebugEnabled()) {
    console.info('[NovaCast Movies] catalog_subscription_added', {
      providerId,
      subscriptionInstance,
    });
  }
  return () => {
    listeners.delete(listener);
    if (isCatalogSyncDebugEnabled()) {
      console.info('[NovaCast Movies] catalog_subscription_removed', {
        providerId,
        subscriptionInstance,
      });
    }
    if (!listeners.size) {
      movieReadyListeners.delete(providerId);
    }
  };
}

function notifyMovieCatalogReady(providerId: string, generation: number) {
  const listeners = movieReadyListeners.get(providerId);
  if (isCatalogSyncDebugEnabled()) {
    console.info('[Movies Catalog Publication]', {
      event: 'ready-published',
      providerId,
      generation,
      listenerCount: listeners?.size ?? 0,
    });
  }
  listeners?.forEach((listener) => listener(generation));
}

/** Stage 3C fragment recovery publishes Movies-ready once after v2 activation. */
export function publishMovieCatalogReady(providerId: string, generation: number) {
  notifyPhase(providerId, 'ready');
  notifyMovieCatalogReady(providerId, generation);
  releaseSeriesRetries('movies-readable-generation');
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
  // Metadata-only: must not imply the Movies library is ready for browsing.
  // Item activation + resolveReadableCatalogGeneration still gate usable reads.
  if (isCatalogSyncDebugEnabled()) {
    console.info('[NovaCast Movies] movie-categories-updated', {
      providerId,
      generation,
      categoryCount,
      preparing: true,
      message: 'Preparing movie library',
      listenerCount: listeners?.size ?? 0,
    });
  }
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
  canResumeMovieCheckpoint: boolean;
  canResumeSeriesCheckpoint: boolean;
  readableMovieGeneration: number;
  resumeMovieIndex: number;
  resumeSeriesIndex: number;
  progressThrottle: CatalogProgressThrottle;
};

async function buildCatalogSyncSetup(input: ProviderCatalogSyncInput, runToken: number): Promise<CatalogSyncSetup> {
  const { providerId, movies, series, live } = input;
  logMovieSyncProbe('buildCatalogSyncSetup', {
    providerId,
    runToken,
    reason: 'enter',
    setupCacheKey: catalogSyncSetupKey(providerId, runToken),
  });

  try {
  await earlyBootTimed('clearLegacyCatalogBlobs', () => clearLegacyCatalogBlobs(providerId));
  logMovieSyncProbe('buildCatalogSyncSetup', {
    providerId,
    runToken,
    reason: 'after-clearLegacyCatalogBlobs',
  });

  const settings = await earlyBootTimed('getMoviesSettings', () => getMoviesSettings());
  const smartCategoriesEnabled = !settings.hideSmartCategories;
  logMovieSyncProbe('buildCatalogSyncSetup', {
    providerId,
    runToken,
    reason: 'after-getMoviesSettings',
    smartCategoriesEnabled,
  });

  logMovieSyncProbe('buildCatalogSyncSetup', {
    providerId,
    runToken,
    reason: 'before-movies.getCategories',
    moviesSourcePresent: typeof movies?.getCategories === 'function',
  });
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
  logMovieSyncProbe('buildCatalogSyncSetup', {
    providerId,
    runToken,
    reason: 'after-movies.getCategories',
    movieCategoryCount: Array.isArray(movieCategories) ? movieCategories.length : null,
    movieCategoriesIsArray: Array.isArray(movieCategories),
  });
  // Yield a macrotask between large category list parses so Home focus can run.
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  logMovieSyncProbe('buildCatalogSyncSetup', {
    providerId,
    runToken,
    reason: 'before-series.getCategories',
    seriesSourcePresent: typeof series?.getCategories === 'function',
  });
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
  logMovieSyncProbe('buildCatalogSyncSetup', {
    providerId,
    runToken,
    reason: 'after-series.getCategories',
    seriesCategoryCount: Array.isArray(seriesCategories) ? seriesCategories.length : null,
  });
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
  const readableMovieGeneration = await resolveReadableCatalogGeneration(providerId, 'movie').catch(() => 0);
  const checkpointResume = resolveCatalogCheckpointResume({
    checkpointMatches,
    stage: checkpoint?.stage ?? null,
    movieIndex: checkpoint?.movieIndex ?? 0,
    seriesIndex: checkpoint?.seriesIndex ?? 0,
    movieCategoryCount: movieCategories.length,
    seriesCategoryCount: seriesCategories.length,
    movieCountMap: checkpoint?.movieCountMap,
    seriesCountMap: checkpoint?.seriesCountMap,
    readableMovieGeneration,
  });
  const {
    canResumeMovieCheckpoint,
    canResumeSeriesCheckpoint,
    resumeMovieIndex,
    resumeSeriesIndex,
    movieCountMap,
    seriesCountMap,
  } = checkpointResume;
  if (checkpointMatches && checkpoint && !canResumeMovieCheckpoint) {
    logMovieSyncProbe('buildCatalogSyncSetup', {
      providerId,
      runToken,
      reason: 'ignored-stale-movie-checkpoint',
      readableMovieGeneration,
      checkpointStage: checkpoint.stage,
      checkpointMovieIndex: checkpoint.movieIndex,
      movieCategoryCount: movieCategories.length,
      resumeMovieIndex,
      canResumeMovieCheckpoint,
      canResumeSeriesCheckpoint,
      resumeSeriesIndex,
    });
  }

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
    canResumeMovieCheckpoint,
    canResumeSeriesCheckpoint,
    readableMovieGeneration,
    resumeMovieIndex,
    resumeSeriesIndex,
    progressThrottle,
  };

  publishCatalogProgress(setup);
  logMovieSyncProbe('buildCatalogSyncSetup', {
    providerId,
    runToken,
    reason: 'return-setup',
    movieCategoryCount: movieCategories.length,
    seriesCategoryCount: seriesCategories.length,
    checkpoint: movieSyncCheckpointSnapshot(checkpoint),
    checkpointMatches,
    canResumeMovieCheckpoint,
    resumeMovieIndex,
    readableMovieGeneration,
  });
  return setup;
  } catch (error) {
    logMovieSyncProbe('buildCatalogSyncSetup', {
      providerId,
      runToken,
      reason: 'threw',
      ...movieSyncErrorFields(error),
    });
    throw error;
  }
}

async function ensureCatalogSyncSetup(input: ProviderCatalogSyncInput, runToken: number) {
  const key = catalogSyncSetupKey(input.providerId, runToken);
  let existing = catalogSyncSetupCache.get(key);
  const cacheHit = Boolean(existing);
  logMovieSyncProbe('ensureCatalogSyncSetup', {
    providerId: input.providerId,
    runToken,
    reason: cacheHit ? 'cache-hit-awaiting-existing' : 'cache-miss-starting-build',
    setupCacheKey: key,
    setupCachePresent: cacheHit,
  });
  if (!existing) {
    existing = setEvictingCachedPromise(
      catalogSyncSetupCache,
      key,
      buildCatalogSyncSetup(input, runToken),
    );
  }
  try {
    const setup = await existing;
    logMovieSyncProbe('ensureCatalogSyncSetup', {
      providerId: input.providerId,
      runToken,
      reason: 'resolved',
      setupCacheKey: key,
      cacheHit,
      movieCategoryCount: setup.movieCategories?.length ?? null,
    });
    return setup;
  } catch (error) {
    if (catalogSyncSetupCache.get(key) === existing) {
      catalogSyncSetupCache.delete(key);
    }
    logMovieSyncProbe('ensureCatalogSyncSetup', {
      providerId: input.providerId,
      runToken,
      reason: 'rejected-cache-evicted',
      setupCacheKey: key,
      cacheHit,
      setupCachePresent: catalogSyncSetupCache.has(key),
      ...movieSyncErrorFields(error),
    });
    throw error;
  }
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
  // NOVACAST_GUIDE_V2_3D_CATALOG_PRIORITY_V1
  // Guide XMLTV owns foreground priority over background catalog work.
  // Existing Movies/Series loops already enter this gate between heavy jobs.
  if (isCatalogGuidePriorityActive()) {
    logSync(providerId, 'sync-yielded-for-guide', {
      checkpoint,
      jobType,
    });

    await waitUntilCatalogGuidePriorityIdle();

    if (isSyncRunStale(runToken)) {
      logSync(providerId, 'sync-cancelled', {
        checkpoint,
        reason: 'provider-reset',
      });

      return false;
    }

    logSync(providerId, 'sync-resumed-after-guide', {
      checkpoint,
      jobType,
    });
  }
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

function smartCacheAuditNow() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
}

async function buildMovieSmartCache(providerId: string, runToken: number, generation?: number) {
  const index = getMovieCatalogIndex(providerId);
  if (!index.size) {
    return;
  }

  const started = Date.now();
  const contextStarted = smartCacheAuditNow();
  const ctx = await buildMovieLibraryContext(providerId);
  const libraryContextMs = Math.round(smartCacheAuditNow() - contextStarted);
  const cacheEntries: Record<string, SmartCategoryCacheEntry> = {};
  const catalogCompleteness = index.getCompleteness();
  const isCancelled = () => isSyncRunStale(runToken);

  const snapshot = index.listAllEntries();
  const lookupIndexStarted = smartCacheAuditNow();
  const snapshotById = new Map<string, (typeof snapshot)[number]>();
  const snapshotOrder = new Map<string, number>();
  snapshot.forEach((entry, order) => {
    snapshotById.set(entry.id, entry);
    snapshotOrder.set(entry.id, order);
  });
  const lookupIndexBuildMs = Math.round(smartCacheAuditNow() - lookupIndexStarted);
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  logSync(providerId, 'movie-smart-snapshot', { snapshotSize: snapshot.length });

  let smartCategoryIndex = 0;
  for (const definition of getActiveSmartCategoryDefinitions()) {
    if (!(await yieldForPlaybackIfNeeded(providerId, `movie-smart:${definition.key}`, 'movies-smart', runToken))) {
      return;
    }
    if (isCancelled()) {
      return;
    }

    let items: ReturnType<typeof querySmartCategoryOnIndex>['items'] | null = null;
    const queryStarted = Date.now();
    const auditStarted = smartCacheAuditNow();
    let candidateCount = 0;
    let candidateLookupCount = 0;
    let lookupIndexBuildForCategoryMs = smartCategoryIndex === 0 ? lookupIndexBuildMs : 0;
    let candidateResolutionMs = 0;
    let filteringMs = 0;
    let sortingMs = 0;
    let mappingMs = 0;
    let dedupeMs = 0;
    let sqliteQueryMs = 0;
    let fullSnapshotPassCount = 0;
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
        candidateCount = orderedIds.length;
        const dedupeStarted = smartCacheAuditNow();
        const seenIds = new Set<string>();
        const uniqueIds = orderedIds.filter((id) => {
          if (seenIds.has(id)) {
            return false;
          }
          seenIds.add(id);
          return true;
        });
        dedupeMs = Math.round(smartCacheAuditNow() - dedupeStarted);

        const resolutionStarted = smartCacheAuditNow();
        const resolved: typeof snapshot = [];
        for (const id of uniqueIds) {
          candidateLookupCount += 1;
          const entry = snapshotById.get(id);
          if (entry) {
            resolved.push(entry);
          }
        }
        candidateResolutionMs = Math.round(smartCacheAuditNow() - resolutionStarted);

        const filteringStarted = smartCacheAuditNow();
        const filtered = resolved.filter((entry) => definition.predicate(entry, ctx));
        filteringMs = Math.round(smartCacheAuditNow() - filteringStarted);
        const capped = definition.maxItems ? filtered.slice(0, definition.maxItems) : filtered;
        items = capped.slice(0, 240);
        const mappingStarted = smartCacheAuditNow();
        cacheEntries[definition.key] = {
          categoryKey: definition.key,
          title: definition.name,
          count: capped.length,
          itemIds: items.map((entry) => entry.id),
        };
        mappingMs = Math.round(smartCacheAuditNow() - mappingStarted);
      } else if (definition.key === 'your-favorites') {
        candidateCount = ctx.favorites.size;
        const resolutionStarted = smartCacheAuditNow();
        const resolved: typeof snapshot = [];
        for (const id of ctx.favorites) {
          candidateLookupCount += 1;
          const entry = snapshotById.get(id);
          if (entry) {
            resolved.push(entry);
          }
        }
        candidateResolutionMs = Math.round(smartCacheAuditNow() - resolutionStarted);

        const filteringStarted = smartCacheAuditNow();
        const filtered = resolved.filter((entry) => definition.predicate(entry, ctx));
        filteringMs = Math.round(smartCacheAuditNow() - filteringStarted);
        const sortingStarted = smartCacheAuditNow();
        filtered.sort((left, right) => {
          const result = definition.sort(left, right);
          return result || (snapshotOrder.get(left.id) ?? 0) - (snapshotOrder.get(right.id) ?? 0);
        });
        sortingMs = Math.round(smartCacheAuditNow() - sortingStarted);
        const capped = filtered.slice(0, definition.maxItems ?? 240);
        items = capped.slice(0, 240);
        const mappingStarted = smartCacheAuditNow();
        cacheEntries[definition.key] = {
          categoryKey: definition.key,
          title: definition.name,
          count: capped.length,
          itemIds: items.map((entry) => entry.id),
        };
        mappingMs = Math.round(smartCacheAuditNow() - mappingStarted);
      } else {
        const maxItems = definition.maxItems ?? 240;
        const top: typeof snapshot = [];
        fullSnapshotPassCount = 1;
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
        const sortingStarted = smartCacheAuditNow();
        top.sort(definition.sort);
        sortingMs = Math.round(smartCacheAuditNow() - sortingStarted);
        const capped = top.slice(0, maxItems);
        items = capped.slice(0, 240);
        const mappingStarted = smartCacheAuditNow();
        cacheEntries[definition.key] = {
          categoryKey: definition.key,
          title: definition.name,
          count: capped.length,
          itemIds: items.map((entry) => entry.id),
        };
        mappingMs = Math.round(smartCacheAuditNow() - mappingStarted);
      }
      const totalMs = Math.round(smartCacheAuditNow() - auditStarted);
      const accountedMs =
        candidateResolutionMs + filteringMs + sortingMs + mappingMs + dedupeMs;
      const otherComputeMs = Math.max(0, totalMs - accountedMs);
      if (isCatalogSyncDebugEnabled()) {
        console.info('[NovaCast Movie Smart Cache Compute Audit]', {
          categoryKey: definition.key,
          snapshotSize: snapshot.length,
          candidateCount,
          libraryContextMs,
          sqliteQueryMs,
          lookupIndexBuildMs: lookupIndexBuildForCategoryMs,
          candidateResolutionMs,
          filteringMs,
          sortingMs,
          mappingMs,
          dedupeMs,
          otherComputeMs,
          totalMs,
          fullSnapshotPassCount,
          candidateLookupCount,
          resultCount: items?.length ?? 0,
          sharedLookupIndexReused: true,
          sharedSnapshotPassCount: 1,
        });
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
      logMovieCompletionPhase(`smart-cache:${definition.key}`, generation ?? null, queryStarted);
    } finally {
      releaseBatch(`movie-smart:${definition.key}`, items);
    }
    smartCategoryIndex += 1;
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

async function refreshLiveChannelSummary(
  providerId: string,
  live: ProviderLiveRepository,
  liveCategories: Awaited<ReturnType<ProviderLiveRepository['getCategories']>>,
  runToken: number,
  requestSource?: string,
) {
  try {
    logLivePublicationTrace('live-publication-skipped', {
      providerId,
      requestSource: requestSource ?? null,
      skipReason: 'portal-live-count-helper-does-not-publish',
    });
    let metadataCategories = liveCategories;
    if (!metadataCategories.length) {
      metadataCategories = await live.getCategories().catch(() => []);
    }

    const catalog = await ensureLiveSearchSqliteCatalog({
      providerId,
      live,
      categories: metadataCategories,
      isCancelled: () => isSyncRunStale(runToken),
      force: !isNativeCatalogDecodeAvailable(),
    });
    if (isSyncRunStale(runToken)) {
      return null;
    }

    let counts = catalog.counts;
    let liveChannelCount = catalog.channelCount;

    if ((!catalog.ready || liveChannelCount <= 0) && live.getCategoryCounts) {
      counts = await live.getCategoryCounts();
      if (isSyncRunStale(runToken)) {
        return null;
      }
      liveChannelCount = live.getTotalChannelCount
        ? await live.getTotalChannelCount()
        : sumCategoryCounts({
            providerId,
            mediaType: 'live',
            counts,
            updatedAt: Date.now(),
          });
    }

    if (Object.keys(counts).length) {
      await mergeCategoryCountIndex(providerId, 'live', counts);
    }

    if (liveChannelCount > 0) {
      await writeProviderLibrarySummary(providerId, { liveChannelCount });
      logSync(providerId, 'live-channel-count-refreshed', {
        liveChannelCount,
        searchCatalogReady: catalog.ready,
        searchCatalogRebuilt: catalog.rebuilt,
      });
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
  requestSource?: string,
) {
  let liveChannelCount = resolveLiveChannelCount(providerId);
  if (isSyncRunStale(runToken)) {
    logLivePublicationTrace('live-publication-skipped', {
      providerId,
      requestSource: requestSource ?? null,
      publishedCount: liveChannelCount,
      skipReason: 'stale-run-token-before-live-refresh',
    });
    return liveChannelCount;
  }

  logLivePublicationTrace('live-refresh-requested', {
    providerId,
    requestSource: requestSource ?? null,
    publishedCount: liveChannelCount,
  });
  const refreshedLiveChannelCount = await refreshLiveChannelSummary(
    providerId,
    live,
    liveCategories,
    runToken,
    requestSource,
  );
  if (refreshedLiveChannelCount && refreshedLiveChannelCount > 0) {
    return refreshedLiveChannelCount;
  }

  return liveChannelCount;
}

async function auditProviderEntitlements(input: {
  providerId: string;
  runToken: number;
  movies: MovieDataSource;
  seriesDumpUrl: string | null;
  movieDumpUrl: string | null;
  liveDumpUrl: string | null;
  apiSeriesDistinctCount: number | null;
  movieDumpCompleted: boolean;
  isCancelled: () => boolean;
}) {
  try {
    const liveStats = getLastLiveCompletenessDumpStats();
    const apiMovieDistinctCount = await getCatalogTotalCount(input.providerId, 'movie').catch(() => 0);
    const apiSeriesDistinctCount =
      input.apiSeriesDistinctCount ??
      (await getCatalogTotalCount(input.providerId, 'series').catch(() => 0));
    await runProviderEntitlementAudit({
      providerId: input.providerId,
      runToken: input.runToken,
      apiMovieDistinctCount,
      apiSeriesDistinctCount,
      apiLiveDistinctCount: liveStats.distinctLiveStreamIds,
      movieDumpCompleted: input.movieDumpCompleted || apiMovieDistinctCount > 0,
      liveDumpMayBeClientCapped: liveStats.distinctLiveStreamIds != null && !liveStats.usedNativeDump,
      movieDumpUrl: input.movieDumpUrl,
      seriesDumpUrl: input.seriesDumpUrl,
      liveDumpUrl: input.liveDumpUrl,
      nativeAvailable: isNativeCatalogDecodeAvailable(),
      getAccountSnapshot: input.movies.getAccountEntitlementSnapshot
        ? () => input.movies.getAccountEntitlementSnapshot!()
        : undefined,
      streamDecode: streamXtreamCategoryDecode,
      isCancelled: input.isCancelled,
    });
  } catch {
    // Diagnostic-only.
  }
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
  return resolveAndRefreshLiveChannelCount(
    providerId,
    live,
    liveCategories,
    syncGeneration,
    'portal-live-count-refresh',
  );
}

export type ProviderCatalogSyncInput = {
  providerId: string;
  providerType?: string;
  displayName?: string;
  requestSource?: string;
  movies: MovieDataSource;
  series: ProviderSeriesRepository;
  live: ProviderLiveRepository;
};

async function shouldSkipMovieSync(setup: CatalogSyncSetup, runToken: number) {
  const { smartCategoriesEnabled, movieCategoryIds, seriesCategoryIds } = setup;
  const providerId = setup.input.providerId;
  const now = Date.now();
  logMovieSyncProbe('shouldSkipMovieSync', {
    providerId,
    runToken,
    reason: 'enter',
    checkpoint: movieSyncCheckpointSnapshot(setup.checkpoint),
    checkpointMatches: setup.checkpointMatches,
    syncInFlight: syncInFlight.has(providerId),
    generationTokenState: isSyncRunStale(runToken) ? 'stale' : 'current',
  });

  logMovieSyncProbe('shouldSkipMovieSync', {
    providerId,
    runToken,
    reason: 'before-getCatalogSyncState',
  });
  let movieSqliteState: Awaited<ReturnType<typeof getCatalogSyncState>> | null = null;
  try {
    movieSqliteState = await getCatalogSyncState(providerId, 'movie');
    logMovieSyncProbe('shouldSkipMovieSync', {
      providerId,
      runToken,
      reason: 'after-getCatalogSyncState',
      movieSqliteStatus: movieSqliteState?.status ?? null,
      movieSqliteGeneration: movieSqliteState?.generation ?? null,
      movieSqlitePresent: Boolean(movieSqliteState),
    });
  } catch (error) {
    logMovieSyncProbe('shouldSkipMovieSync', {
      providerId,
      runToken,
      reason: 'getCatalogSyncState-threw-swallowed',
      ...movieSyncErrorFields(error),
    });
    movieSqliteState = null;
  }

  const readableMovieGeneration = await resolveReadableCatalogGeneration(providerId, 'movie').catch(() => 0);
  logMovieSyncProbe('shouldSkipMovieSync', {
    providerId,
    runToken,
    reason: 'readable-movie-generation',
    readableMovieGeneration,
    movieSqliteStatus: movieSqliteState?.status ?? null,
    movieSqliteGeneration: movieSqliteState?.generation ?? null,
  });
  if (!(Number(readableMovieGeneration) > 0)) {
    logMovieSyncProbe('shouldSkipMovieSync', {
      providerId,
      runToken,
      skip: false,
      reason: 'return-false-no-readable-movie-sqlite',
      checkpoint: movieSyncCheckpointSnapshot(setup.checkpoint),
      checkpointMatches: setup.checkpointMatches,
      movieSqliteStatus: movieSqliteState?.status ?? null,
      movieSqliteGeneration: movieSqliteState?.generation ?? null,
      readableMovieGeneration,
    });
    return false;
  }

  logMovieSyncProbe('shouldSkipMovieSync', {
    providerId,
    runToken,
    reason: 'before-shouldRequestSortMetadataUpgrade-import',
  });
  const { shouldRequestSortMetadataUpgrade } = await import('../catalog/catalogSortMetadataUpgrade.ts');
  const sortMetadataUpgradeRequested = await shouldRequestSortMetadataUpgrade(providerId, 'movie');
  logMovieSyncProbe('shouldSkipMovieSync', {
    providerId,
    runToken,
    reason: 'after-shouldRequestSortMetadataUpgrade',
    sortMetadataUpgradeRequested,
  });
  if (sortMetadataUpgradeRequested) {
    logSync(providerId, 'movie-sync-resumed-sort-metadata-upgrade', {});
    logMovieSyncProbe('shouldSkipMovieSync', {
      providerId,
      runToken,
      skip: false,
      reason: 'return-false-sort-metadata-upgrade-requested',
      checkpoint: movieSyncCheckpointSnapshot(setup.checkpoint),
      checkpointMatches: setup.checkpointMatches,
      movieSqliteStatus: movieSqliteState?.status ?? null,
      movieSqliteGeneration: movieSqliteState?.generation ?? null,
    });
    return false;
  }

  const movieCacheFresh = hasFreshCategoryCache(providerId, 'movie', movieCategoryIds, smartCategoriesEnabled, now);
  const seriesCacheFresh = hasFreshCategoryCache(providerId, 'series', seriesCategoryIds, smartCategoriesEnabled, now);
  const checkpointAgeMs = setup.checkpoint ? now - setup.checkpoint.updatedAt : null;
  logMovieSyncProbe('shouldSkipMovieSync', {
    providerId,
    runToken,
    reason: 'cache-freshness-evaluated',
    movieCacheFresh,
    seriesCacheFresh,
    checkpoint: movieSyncCheckpointSnapshot(setup.checkpoint),
    checkpointMatches: setup.checkpointMatches,
    checkpointAgeMs,
    cacheTtlMs: CATALOG_SYNC_CACHE_TTL_MS,
    checkpointExpired: checkpointAgeMs != null && checkpointAgeMs > CATALOG_SYNC_CACHE_TTL_MS,
  });
  if (
    !setup.checkpointMatches ||
    setup.checkpoint?.stage !== 'complete' ||
    !setup.checkpoint ||
    now - setup.checkpoint.updatedAt > CATALOG_SYNC_CACHE_TTL_MS ||
    !movieCacheFresh ||
    !seriesCacheFresh
  ) {
    logMovieSyncProbe('shouldSkipMovieSync', {
      providerId,
      runToken,
      skip: false,
      reason: 'return-false-checkpoint-or-cache-not-fresh',
      checkpointPresent: Boolean(setup.checkpoint),
      checkpoint: movieSyncCheckpointSnapshot(setup.checkpoint),
      checkpointMatches: setup.checkpointMatches,
      checkpointAgeMs,
      movieCacheFresh,
      seriesCacheFresh,
      movieSqliteStatus: movieSqliteState?.status ?? null,
      movieSqliteGeneration: movieSqliteState?.generation ?? null,
    });
    return false;
  }

  const movieIndexSize = smartCategoriesEnabled ? getMovieCatalogIndex(providerId).size : 1;
  if (smartCategoriesEnabled && movieIndexSize <= 0) {
    logSync(providerId, 'movie-sync-resumed-empty-index', { movieIndexSize });
    logMovieSyncProbe('shouldSkipMovieSync', {
      providerId,
      runToken,
      skip: false,
      reason: 'return-false-smart-index-empty',
      movieIndexSize,
      movieSqliteStatus: movieSqliteState?.status ?? null,
      movieSqliteGeneration: movieSqliteState?.generation ?? null,
    });
    return false;
  }

  publishCatalogProgress(setup);
  setup.progressThrottle.flush();
  logSync(providerId, 'movie-sync-skipped-cached', {
    movieCategories: movieCategoryIds.length,
    liveChannelCount: setup.liveChannelCount,
  });
  logMovieSyncProbe('shouldSkipMovieSync', {
    providerId,
    runToken,
    skip: true,
    reason: 'return-true-cached-complete-checkpoint',
    checkpoint: movieSyncCheckpointSnapshot(setup.checkpoint),
    checkpointMatches: setup.checkpointMatches,
    movieCategoryCount: movieCategoryIds.length,
    movieSqliteStatus: movieSqliteState?.status ?? null,
    movieSqliteGeneration: movieSqliteState?.generation ?? null,
    syncInFlight: syncInFlight.has(providerId),
  });
  return true;
}

async function shouldSkipSeriesSync(setup: CatalogSyncSetup, runToken: number) {
  const { smartCategoriesEnabled, movieCategoryIds, seriesCategoryIds } = setup;
  const providerId = setup.input.providerId;
  const now = Date.now();
  // A failed generation must get a real rebuild even if the provider-wide
  // checkpoint/count cache still looks fresh.
  const seriesSyncState = await getCatalogSyncState(providerId, 'series').catch(() => null);
  if (seriesSyncState?.status === 'error') {
    console.info('[NovaCast Series Generation Resume Guard]', {
      providerId,
      action: 'force-series-rebuild',
      reason: 'previous-series-sync-error',
      failedGeneration: seriesSyncState.generation,
    });
    return false;
  }

  const { shouldRequestSortMetadataUpgrade } = await import('../catalog/catalogSortMetadataUpgrade.ts');
  if (await shouldRequestSortMetadataUpgrade(providerId, 'series')) {
    logSync(providerId, 'series-sync-resumed-sort-metadata-upgrade', {});
    return false;
  }

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
  runId?: string,
) {
  const { providerId, movies } = input;
  const started = Date.now();
  const isCancelled = () => isCatalogJobCancelled(runToken, coordinatorKey);
  const coordinatorGeneration = getCatalogSyncCancelToken(coordinatorKey).generation;
  logMovieSyncProbe('runMovieCatalogSync', {
    providerId,
    coordinatorKey,
    runToken,
    runId: runId ?? null,
    reason: 'enter',
    syncInFlight: syncInFlight.has(providerId),
    generationTokenState: isSyncRunStale(runToken) ? 'stale' : 'current',
    coordinatorGeneration,
    playbackActive: isPlaybackActivityActive(),
    promiseAwaitedByCoordinator: true,
  });

  let setup: CatalogSyncSetup | undefined;
  let exitReason = 'unknown';
  let threw = false;
  let sqliteHandle: CatalogSqliteMediaSyncHandle | null = null;
  let movieFullDumpCompleted = false;
  let movieCompletionProbeReached = false;
  const movieOwnership = createMovieSqliteOwnershipState();
  const probeMoviePromise = (event: string, fields: Record<string, unknown> = {}) => {
    logMoviePromiseProbe(event, {
      providerId,
      coordinatorKey,
      runToken,
      runId: runId ?? null,
      generation: movieOwnership.sqliteGeneration || sqliteHandle?.generation || 0,
      ...movieSqliteOwnershipProbeFields(movieOwnership),
      ...fields,
    });
  };
  const movieOwnershipDeps = {
    finish: finishCatalogSqliteMediaSync,
    probe: probeMoviePromise,
  };
  const setMovieReturnReason = (reason: string) => {
    exitReason = reason;
    movieOwnership.returnReason = reason;
  };
  const markMovieEarlyReturn = (reason: string, fields: Record<string, unknown> = {}) => {
    setMovieReturnReason(reason);
    probeMoviePromise('movie-early-return', {
      reason,
      cancelled: isCancelled(),
      staleGeneration: isSyncRunStale(runToken),
      ...fields,
    });
  };
  const finishMovieSqlite = async (
    input: Parameters<typeof finishCatalogSqliteMediaSync>[0],
  ) => {
    return finishOwnedMovieSqlite(movieOwnership, movieOwnershipDeps, {
      handle: input.handle,
      ok: input.ok,
      processedCount: input.processedCount,
      errorCode: input.errorCode,
      nativeDone: input.nativeDone,
      outcome: input.ok ? 'completed' : input.errorCode === 'cancelled' ? 'cancelled' : 'failed',
    });
  };
  const rejectAfterOpenSqlite = async (
    reason: string,
    kind: 'cancelled' | 'failed' | 'playback_deferred',
    extra?: Record<string, unknown>,
  ): Promise<void> => {
    setMovieReturnReason(reason);
    await terminateMovieSqliteEarlyReturn(movieOwnership, movieOwnershipDeps, {
      reason,
      kind,
      extra,
    });
  };
  probeMoviePromise('runMovieCatalogSync-enter', {
    coordinatorGeneration,
    detachedWorker: false,
  });
  try {
    const setupCacheKey = catalogSyncSetupKey(providerId, runToken);
    logMovieSyncProbe('runMovieCatalogSync', {
      providerId,
      coordinatorKey,
      runToken,
      runId: runId ?? null,
      reason: 'before-ensureCatalogSyncSetup',
      setupCacheKey,
      setupCachePresent: catalogSyncSetupCache.has(setupCacheKey),
      syncInFlight: syncInFlight.has(providerId),
      promiseAwaitedByCoordinator: true,
    });
    setup = await ensureCatalogSyncSetup(input, runToken);
    logMovieSyncProbe('runMovieCatalogSync', {
      providerId,
      coordinatorKey,
      runToken,
      runId: runId ?? null,
      reason: 'setup-ready',
      movieCategoryCount: setup.movieCategories.length,
      seriesCategoryCount: setup.seriesCategories.length,
      checkpoint: movieSyncCheckpointSnapshot(setup.checkpoint),
      checkpointPresent: Boolean(setup.checkpoint),
      checkpointStage: setup.checkpoint?.stage ?? null,
      checkpointMatches: setup.checkpointMatches,
      canResumeMovieCheckpoint: setup.canResumeMovieCheckpoint,
      resumeMovieIndex: setup.resumeMovieIndex,
      syncInFlight: syncInFlight.has(providerId),
      cancelled: isCancelled(),
      generationTokenState: isSyncRunStale(runToken) ? 'stale' : 'current',
    });

    notifyPhase(providerId, 'syncing');
    markCatalogAuditSync('started', { providerId, mediaType: 'movie' });
    logSync(providerId, 'movie-sync-started');
    logSyncLifecycle(providerId, 'movie-worker-started', {
      runToken,
      generationTokenState: isSyncRunStale(runToken) ? 'stale' : 'current',
      movieWorkerState: 'running',
    });

    let categoryLoopStarted = false;
    let categoryLoopFinished = false;
    let categoryDataObserved = false;
    let retrySource: string | null = null;

    logMovieSyncProbe('runMovieCatalogSync', {
      providerId,
      coordinatorKey,
      runToken,
      runId: runId ?? null,
      reason: 'before-isCancelled',
      coordinatorGeneration: getCatalogSyncCancelToken(coordinatorKey).generation,
      generationTokenState: isSyncRunStale(runToken) ? 'stale' : 'current',
      coordinatorStale: getCatalogSyncCancelToken(coordinatorKey).isStale(),
    });
    const cancelledBeforeWork = isCancelled();
    logMovieSyncProbe('runMovieCatalogSync', {
      providerId,
      coordinatorKey,
      runToken,
      runId: runId ?? null,
      reason: 'after-isCancelled',
      cancelled: cancelledBeforeWork,
    });
    if (cancelledBeforeWork) {
      logSync(providerId, 'movie-sync-cancelled', { reason: 'provider-reset' });
      logSyncLifecycle(providerId, 'movie-loop-exit', { runToken, reason: 'cancelled-before-work' });
      logMovieSyncProbe('runMovieCatalogSync', {
        providerId,
        coordinatorKey,
        runToken,
        runId: runId ?? null,
        reason: 'return-cancelled-before-work',
        syncInFlight: syncInFlight.has(providerId),
        generationTokenState: isSyncRunStale(runToken) ? 'stale' : 'current',
        coordinatorStale: getCatalogSyncCancelToken(coordinatorKey).isStale(),
        willCallBeginCatalogSync: false,
      });
      exitReason = 'return-cancelled-before-work';
      markMovieEarlyReturn('return-cancelled-before-work');
      return;
    }

    logMovieSyncProbe('runMovieCatalogSync', {
      providerId,
      coordinatorKey,
      runToken,
      runId: runId ?? null,
      reason: 'before-shouldSkipMovieSync',
      checkpoint: movieSyncCheckpointSnapshot(setup.checkpoint),
      checkpointMatches: setup.checkpointMatches,
      promiseAwaitedByCoordinator: true,
    });
    const skipMovieSync = await shouldSkipMovieSync(setup, runToken);
    logMovieSyncProbe('runMovieCatalogSync', {
      providerId,
      coordinatorKey,
      runToken,
      runId: runId ?? null,
      reason: 'after-shouldSkipMovieSync',
      skipMovieSync,
      checkpoint: movieSyncCheckpointSnapshot(setup.checkpoint),
    });
    if (skipMovieSync) {
      markMediaJobComplete(providerId, 'movie');
      markCatalogAuditSync('completed', { providerId, mediaType: 'movie', skipped: true });
      logMovieSyncProbe('runMovieCatalogSync', {
        providerId,
        coordinatorKey,
        runToken,
        runId: runId ?? null,
        reason: 'return-skipped-cached',
        checkpointStage: setup.checkpoint?.stage ?? null,
        checkpointMatches: setup.checkpointMatches,
        resumeMovieIndex: setup.resumeMovieIndex,
        syncInFlight: syncInFlight.has(providerId),
        willCallBeginCatalogSync: false,
      });
      exitReason = 'return-skipped-cached';
      markMovieEarlyReturn('return-skipped-cached');
      return;
    }

    logMovieSyncProbe('runMovieCatalogSync', {
      providerId,
      coordinatorKey,
      runToken,
      runId: runId ?? null,
      reason: 'before-waitForHeavyCatalogWindow',
      playbackActive: isPlaybackActivityActive(),
      generationTokenState: isSyncRunStale(runToken) ? 'stale' : 'current',
      promiseAwaitedByCoordinator: true,
    });
    const heavyWindowOpen = await waitForHeavyCatalogWindow(providerId, runToken);
    logMovieSyncProbe('waitForHeavyCatalogWindow', {
      providerId,
      coordinatorKey,
      runToken,
      runId: runId ?? null,
      reason: heavyWindowOpen ? 'after-waitForHeavyCatalogWindow-open' : 'after-waitForHeavyCatalogWindow-closed',
      heavyWindowOpen,
      playbackActive: isPlaybackActivityActive(),
      generationTokenState: isSyncRunStale(runToken) ? 'stale' : 'current',
      syncInFlight: syncInFlight.has(providerId),
    });

    logMovieSyncProbe('runMovieCatalogSync', {
      providerId,
      coordinatorKey,
      runToken,
      runId: runId ?? null,
      reason: 'before-isCancelled-after-heavy-window',
      heavyWindowOpen,
    });
    const cancelledAfterHeavyWindow = isCancelled();
    logMovieSyncProbe('runMovieCatalogSync', {
      providerId,
      coordinatorKey,
      runToken,
      runId: runId ?? null,
      reason: 'after-isCancelled-after-heavy-window',
      cancelled: cancelledAfterHeavyWindow,
      heavyWindowOpen,
      note: 'probe-only-no-new-return',
    });

    if (!heavyWindowOpen) {
      publishCatalogProgress(setup);
      setup.progressThrottle.flush();
      schedulePendingHeavySync(providerId, input);
      logMovieSyncProbe('runMovieCatalogSync', {
        providerId,
        coordinatorKey,
        runToken,
        runId: runId ?? null,
        reason: 'return-deferred-playback-or-stale',
        pendingRequestPresent: pendingSyncInputs.has(providerId),
        syncInFlight: syncInFlight.has(providerId),
        willCallBeginCatalogSync: false,
      });
      exitReason = 'return-deferred-playback-or-stale';
      markMovieEarlyReturn('return-deferred-playback-or-stale');
      return;
    }

    const { smartCategoriesEnabled, movieCategories } = setup;
    const movieIndex = smartCategoriesEnabled ? getMovieCatalogIndex(providerId) : null;
    const canResumeCheckpoint = setup.canResumeMovieCheckpoint;
    let movieIndexWasActive = false;
    logMovieSyncProbe('runMovieCatalogSync', {
      providerId,
      coordinatorKey,
      runToken,
      runId: runId ?? null,
      reason: 'before-movieIndex-beginSync',
      smartCategoriesEnabled,
      canResumeCheckpoint,
      movieIndexPresent: Boolean(movieIndex),
    });
    if (smartCategoriesEnabled && !canResumeCheckpoint) {
      movieIndex?.beginSync();
      movieIndexWasActive = true;
    }
    logMovieSyncProbe('runMovieCatalogSync', {
      providerId,
      coordinatorKey,
      runToken,
      runId: runId ?? null,
      reason: 'after-movieIndex-beginSync',
      movieIndexWasActive,
    });

    try {
      logMovieSyncProbe('runMovieCatalogSync', {
        providerId,
        coordinatorKey,
        runToken,
        runId: runId ?? null,
        reason: 'calling-startCatalogSqliteMediaSync',
        movieCategoryCount: movieCategories.length,
        canResumeCheckpoint,
        resumeMovieIndex: setup.resumeMovieIndex,
        syncInFlight: syncInFlight.has(providerId),
        willCallBeginCatalogSync: true,
        promiseAwaitedByCoordinator: true,
      });
    sqliteHandle = await startCatalogSqliteMediaSync({
      providerId,
      mediaType: 'movie',
      providerType: input.providerType ?? 'unknown',
      displayName: input.displayName ?? null,
      runId,
    });
    noteMovieSqliteHandle(movieOwnership, sqliteHandle);
    probeMoviePromise('startCatalogSqliteMediaSync-returned', {
      generation: sqliteHandle.generation,
      sqliteEnabled: sqliteHandle.enabled,
      returnedValueKind: 'handle',
      isCompletionPromise: false,
      launchesBackgroundWork: false,
      note: 'beginCatalogSync-only-caller-must-await-finishCatalogSqliteMediaSync',
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

    const movieStartIndexBeforeGuard = setup.resumeMovieIndex;
    const checkpointGeneration: number | null = null;
    const freshMovieGeneration = sqliteHandle.enabled;
    const sameGenerationResume = !freshMovieGeneration && canResumeCheckpoint;
    let movieStartIndex = setup.resumeMovieIndex;
    if (freshMovieGeneration) {
      movieStartIndex = 0;
      for (const categoryId of Object.keys(setup.movieCountMap)) {
        delete setup.movieCountMap[categoryId];
      }
      if (smartCategoriesEnabled && canResumeCheckpoint) {
        movieIndex?.beginSync();
        movieIndexWasActive = true;
      }
      console.info('[NovaCast Movie Generation Resume Guard]', {
        providerId,
        generation: sqliteHandle.generation,
        checkpointGeneration,
        checkpointResumeMovieIndex: setup.resumeMovieIndex,
        movieCategoryCount: movieCategories.length,
        movieStartIndexBeforeGuard,
        movieStartIndexAfterGuard: movieStartIndex,
        sameGenerationResume: false,
        freshGeneration: true,
        action: 'fresh-generation-full-rewalk',
        reason: canResumeCheckpoint
          ? 'sqlite-generation-does-not-own-provider-checkpoint'
          : 'new-sqlite-generation',
      });
    } else {
      console.info('[NovaCast Movie Generation Resume Guard]', {
        providerId,
        generation: 0,
        checkpointGeneration,
        checkpointResumeMovieIndex: setup.resumeMovieIndex,
        movieCategoryCount: movieCategories.length,
        movieStartIndexBeforeGuard,
        movieStartIndexAfterGuard: movieStartIndex,
        sameGenerationResume,
        freshGeneration: false,
        action: sameGenerationResume ? 'same-generation-resume' : 'start-from-zero',
        reason: sameGenerationResume
          ? 'checkpoint-resume-preserved-for-non-sqlite-path'
          : 'checkpoint-not-resumable',
      });
    }

    await writeCatalogSyncCheckpointSafe(
      setup,
      runToken,
      movieStartIndex < movieCategories.length ? 'movies' : 'series',
      movieStartIndex,
      setup.resumeSeriesIndex,
    );

    // Stage 3C.2: probe category filtering, then either one full dump or per-category sync.
    // Capability detection is independent of Discover/smart toggles — SQLite assignment must be correct either way.
    // SQLite Movies reads also require item rows even when smart categories are hidden (count-only is not enough).
    const nativeAvailable = isNativeCatalogDecodeAvailable();
    const writerOnly = isCatalogSqliteWriterOnlyDiagnosticEnabled();
    const syncMovieItems = smartCategoriesEnabled || Boolean(sqliteHandle?.enabled);
    // A fresh generation owns its own complete category walk. Reusing a
    // completed checkpoint index here can skip every Movie category and make
    // the completion barrier correctly reject an empty generation.
    let filteringReliable = false;
    let filterStatus: 'reliable' | 'unreliable' | 'inconclusive' = 'inconclusive';
    let filterReason = 'insufficient-populated-probes';
    let movieSyncStrategy: 'full-dump-stream-category' | 'filtered-per-category' = 'full-dump-stream-category';
    let strategyFallbackUsed = false;
    let fullDumpCompleted = false;
    let fullDumpDecodedStreamCount = 0;
    let fullDumpDistinctContentIds = 0;
    let fullDumpDistinctStreamCategoryIds = 0;
    let fullDumpMissingCategoryIdCount = 0;
    let categoryAssignmentFinished = false;
    const movieCompleteness = createMovieCompletenessTracker({
      providerId,
      generation: sqliteHandle?.generation ?? null,
      metadataCategoryCount: movieCategories.length,
      metadataCategoryIds: movieCategories.map((category) => category.id),
    });
    const forcedFullDumpReason = forceMoviesFullDumpByProvider.get(providerId) ?? null;
    if (forcedFullDumpReason) {
      forceMoviesFullDumpByProvider.delete(providerId);
    }

    logSync(providerId, 'movie-filter-capability-gate', {
      nativeAvailable,
      sqliteEnabled: Boolean(sqliteHandle?.enabled),
      smartCategoriesEnabled,
      syncMovieItems,
      movieCategoryCount: movieCategories.length,
      forcedFullDumpReason,
    });

    if (nativeAvailable && sqliteHandle?.enabled && !forcedFullDumpReason) {
      const cachedCapability = await readVodCategoryFilterCapability(providerId);
      const providerCategoryIds = movieCategories.map((category) => category.id);
      const probeCategoryIds = selectVodCategoryProbeIds(providerCategoryIds, {
        countHints: setup.movieHintCounts,
        limit: 6,
      });

      if (
        cachedCapability &&
        cachedCapability.status === 'reliable' &&
        Date.now() - cachedCapability.probedAt < 7 * 24 * 60 * 60 * 1000
      ) {
        filteringReliable = true;
        filterStatus = 'reliable';
        filterReason = cachedCapability.reason;
        logSync(providerId, 'movie-filter-capability-cache-hit', {
          filteringReliable,
          status: filterStatus,
          reason: filterReason,
        });
      } else if (probeCategoryIds.length >= 1) {
        const probes: VodCategoryProbeSample[] = [];
        for (const categoryId of probeCategoryIds) {
          if (isCancelled()) {
            logSyncLifecycle(providerId, 'movie-loop-exit', { runToken, categoryIndex: null, categoryId, reason: 'cancelled-during-probe' });
            await rejectAfterOpenSqlite('return-cancelled-during-probe', 'cancelled', { categoryId });
            return;
          }
          // Stop early only after reliability is strongly proven.
          if (probes.filter((probe) => probe.returnedCount >= 50).length >= 2) {
            const early = evaluateVodCategoryFilterCapability({
              providerId,
              probes,
              metadataCategoryCount: providerCategoryIds.length,
            });
            if (early.status === 'reliable' || early.status === 'unreliable') {
              filterStatus = early.status;
              filteringReliable = early.filteringReliable;
              filterReason = early.reason;
              await writeVodCategoryFilterCapability(early);
              break;
            }
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
            runId: runId ?? null,
            catalogNetworkMediaType: 'movie',
            catalogNetworkOperation: 'get_vod_streams:filter-probe',
            onBatch: async (records) => {
              accumulator.onRecords(records);
            },
          });
          if (probeResult.cancelled || isCancelled()) {
            logSyncLifecycle(providerId, 'movie-loop-exit', { runToken, categoryIndex: null, categoryId, reason: probeResult.cancelled ? 'native-probe-cancelled' : 'cancelled-after-probe' });
            await rejectAfterOpenSqlite(
              probeResult.cancelled ? 'return-native-probe-cancelled' : 'return-cancelled-after-probe',
              'cancelled',
              { categoryId },
            );
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
        if (probes.length >= 1 && filterStatus === 'inconclusive') {
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
            metadataCategoryCount: providerCategoryIds.length,
          });
          await writeVodCategoryFilterCapability(capability);
          filteringReliable = capability.filteringReliable;
          filterStatus = capability.status;
          filterReason = capability.reason;
        } else if (probes.length < 1) {
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
    } else if (forcedFullDumpReason) {
      filteringReliable = false;
      filterStatus = 'unreliable';
      filterReason = forcedFullDumpReason;
    }

    // Inconclusive and unreliable both use the safer full-dump strategy.
    const useFullDump =
      Boolean(forcedFullDumpReason) ||
      !filteringReliable ||
      filterStatus !== 'reliable';
    movieCompleteness.noteFilterCapability({ filteringReliable, filterReason });

    if (useFullDump && nativeAvailable && sqliteHandle?.enabled) {
      movieSyncStrategy = 'full-dump-stream-category';
      categoryLoopStarted = true;
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

      logMoviePromiseProbe('movie-full-dump-decode-enter', {
        providerId,
        coordinatorKey,
        runToken,
        runId: runId ?? null,
        generation: sqliteHandle.generation,
        filterCategoryId: 'all',
        awaitedOnRunMovieCatalogSyncPromise: true,
        detachedWorker: false,
      });
      const fullDumpResult = await streamXtreamCategoryDecode({
        requestUrl: fullDumpUrl,
        mediaType: 'movie',
        filterCategoryId: 'all',
        providerId,
        isCancelled,
        runId: runId ?? null,
        catalogNetworkMediaType: 'movie',
        catalogNetworkOperation: 'get_vod_streams',
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
      logMoviePromiseProbe('movie-full-dump-decode-returned', {
        providerId,
        coordinatorKey,
        runToken,
        runId: runId ?? null,
        generation: sqliteHandle.generation,
        cancelled: Boolean(fullDumpResult.cancelled),
        rawSeen: fullDumpResult.stats?.rawSeen ?? null,
        isCancelledNow: isCancelled(),
      });

      if (fullDumpResult.cancelled || isCancelled()) {
        logSyncLifecycle(providerId, 'movie-loop-exit', { runToken, reason: fullDumpResult.cancelled ? 'native-full-dump-cancelled' : 'cancelled-after-full-dump' });
        await rejectAfterOpenSqlite(
          fullDumpResult.cancelled ? 'return-native-full-dump-cancelled' : 'return-cancelled-after-full-dump',
          'cancelled',
          { rawSeen: fullDumpResult.stats?.rawSeen ?? null },
        );
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
            filterStatus,
            filterReason,
            strategy: movieSyncStrategy,
            marker: 'stage4d-vod-ingestion-repair-v1',
          }),
      );
      console.info(
        '[NovaCast Movies Category Assignment Sample] ' +
          JSON.stringify({
            generation: sqliteHandle.generation,
            samples: assignmentSamples,
            marker: 'stage4d-vod-ingestion-repair-v1',
          }),
      );

      await writeCatalogSyncCheckpointSafe(
        setup,
        runToken,
        'movies',
        movieCategories.length,
        setup.resumeSeriesIndex,
      );
      fullDumpCompleted = true;
      movieFullDumpCompleted = true;
      fullDumpDecodedStreamCount = decodedStreamCount;
      fullDumpDistinctContentIds = distinctContentIds.size;
      fullDumpDistinctStreamCategoryIds = distinctStreamCategoryIds.size;
      fullDumpMissingCategoryIdCount = missingCategoryIdCount;
      categoryAssignmentFinished = distinctStreamCategoryIds.size > 0;
      movieCompleteness.markFullDumpStrategy();
      movieCompleteness.noteDumpStats({
        rawCount: fullDumpResult.stats.rawSeen ?? rawStreamCount,
        decodedCount: decodedStreamCount,
        missingCategoryIdCount,
        distinctIds: distinctContentIds,
        distinctCategoryIds: distinctStreamCategoryIds,
      });
    } else if (nativeAvailable && sqliteHandle?.enabled) {
      movieSyncStrategy = 'filtered-per-category';
      categoryLoopStarted = true;
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
            filteringReliable,
            filterStatus,
            filterReason,
            strategy: movieSyncStrategy,
            marker: 'stage4d-vod-ingestion-repair-v1',
          }),
      );

      let categoriesAttempted = 0;
      let categoriesReturningItems = 0;
      let categoriesReturningZero = 0;
      let decodedItemCount = 0;
      const distinctItemCategoryIds = new Set<string>();
      let abortedForSparse = false;

      const movieStartIndexBeforeEntryGuard = movieStartIndex;
      if (
        sqliteHandle.enabled &&
        movieCategories.length > 0 &&
        movieStartIndex >= movieCategories.length
      ) {
        movieStartIndex = 0;
        for (const categoryId of Object.keys(setup.movieCountMap)) {
          delete setup.movieCountMap[categoryId];
        }
        if (smartCategoriesEnabled && !movieIndexWasActive) {
          movieIndex?.beginSync();
          movieIndexWasActive = true;
        }
        console.info('[NovaCast Movie Generation Resume Guard]', {
          providerId,
          generation: sqliteHandle.generation,
          checkpointGeneration: null,
          checkpointResumeMovieIndex: setup.resumeMovieIndex,
          movieCategoryCount: movieCategories.length,
          movieStartIndexBeforeGuard: movieStartIndexBeforeEntryGuard,
          movieStartIndexAfterGuard: movieStartIndex,
          movieIndexWasActive: movieIndexWasActive,
          movieIndexActiveAfterGuard: movieIndexWasActive,
          sameGenerationResume: false,
          freshGeneration: true,
          action: 'fresh-generation-full-rewalk-corrected-before-crawl',
          reason: 'terminal-start-index-on-fresh-sqlite-generation',
        });
      }
      const willEnterMovieCategoryCrawl =
        movieCategories.length > 0 && movieStartIndex < movieCategories.length && syncMovieItems;
      console.info('[NovaCast Movie Category Crawl Entry]', {
        providerId,
        generation: sqliteHandle.generation,
        movieCategoryCount: movieCategories.length,
        startIndex: movieStartIndex,
        remainingCategoryCount: Math.max(0, movieCategories.length - movieStartIndex),
        syncMovieItems,
        filteringReliable,
        movieIndexActive: movieIndexWasActive,
        willCrawl: willEnterMovieCategoryCrawl,
        skipReason: willEnterMovieCategoryCrawl
          ? null
          : movieCategories.length <= 0
            ? 'no-movie-categories'
            : movieStartIndex >= movieCategories.length
              ? 'start-index-at-or-after-category-count'
              : !syncMovieItems
                ? 'movie-item-sync-disabled'
                : 'unknown',
      });

      for (
        let movieCategoryIndex = movieStartIndex;
        movieCategoryIndex < movieCategories.length;
        movieCategoryIndex += 1
      ) {
        const category = movieCategories[movieCategoryIndex];
        if (!(await yieldForPlaybackIfNeeded(providerId, `movie-category:${category.id}`, 'movies', runToken))) {
          publishCatalogProgress(setup);
          setup.progressThrottle.flush();
          schedulePendingHeavySync(providerId, input);
          logSyncLifecycle(providerId, 'movie-loop-exit', { runToken, categoryIndex: movieCategoryIndex, categoryId: category.id, reason: 'playback-deferral' });
          await rejectAfterOpenSqlite('return-playback-deferral-category-loop', 'playback_deferred', {
            categoryIndex: movieCategoryIndex,
            categoryId: category.id,
          });
          return;
        }
        if (isCancelled()) {
          logSyncLifecycle(providerId, 'movie-loop-exit', { runToken, categoryIndex: movieCategoryIndex, categoryId: category.id, reason: 'cancelled-before-category' });
          await rejectAfterOpenSqlite('return-cancelled-before-category', 'cancelled', {
            categoryIndex: movieCategoryIndex,
            categoryId: category.id,
          });
          return;
        }

        const categoryStarted = Date.now();
        let providerNativeMs = 0;
        let sqliteWriteMs = 0;
        let checkpointMs = 0;
        let idleYieldMs = 0;
        markCatalogAuditCategory('movie', 'fetch_start', { categoryId: category.id });
        beginVodCategoryPhaseProfile(category.id);
        let items: Awaited<ReturnType<NonNullable<MovieDataSource['listCategoryMovies']>>> | null = null;
        let categoryMatched = 0;

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
              const moviesCriticalKey = `${providerId}:${runToken}`;
              if (
                getCatalogUiSurface() === 'movies' &&
                setup.readableMovieGeneration <= 0 &&
                !moviesCriticalWindowLogged.has(moviesCriticalKey)
              ) {
                moviesCriticalWindowLogged.add(moviesCriticalKey);
                console.info('[NovaCast Catalog Network Gate]', {
                  event: 'movies-critical-window-enter',
                  providerId,
                  generation: runToken,
                  activeSurface: 'movies',
                  readableMovieGenerationPresent: false,
                  reason: 'first-run-movie-category-request',
                });
              }
              let matched = 0;
              recordCatalogSqliteCategoryContext(sqliteHandle, {
                categoryId: category.id,
                categoryIndex: movieCategoryIndex,
                categoryCount: movieCategories.length,
                requestAttempt: 1,
              });
              logSyncLifecycle(providerId, 'native-request-start', {
                mediaType: 'movie',
                runToken,
                categoryIndex: movieCategoryIndex,
                categoryId: category.id,
                generation: sqliteHandle?.generation ?? null,
                activeNativeRequest: true,
              });
              const decodeResult = await streamXtreamCategoryDecode({
                requestUrl,
                mediaType: 'movie',
                filterCategoryId: category.id,
                providerId,
                generation: sqliteHandle?.generation,
                categoryIndex: movieCategoryIndex,
                categoryPosition: movieCategoryIndex + 1,
                totalCategoryCount: movieCategories.length,
                requestAttempt: 1,
                isCancelled,
                runId: runId ?? null,
                catalogNetworkMediaType: 'movie',
                catalogNetworkOperation: 'get_vod_streams:category',
                catalogNetworkRequestSource: input.requestSource ?? null,
                catalogNetworkBackground: true,
                catalogNetworkCancellable: false,
                catalogNetworkForeground: getCatalogUiSurface() === 'movies',
                catalogNetworkActiveSurface: getCatalogUiSurface(),
                catalogNetworkReadableGenerationPresent: setup.readableMovieGeneration > 0,
                onBatch: async (records) => {
                  const sqliteCallbackStarted = Date.now();
                  try {
                    matched += records.length;
                    if (sqliteHandle) {
                      recordCatalogSqliteDecoded(sqliteHandle, records.length);
                    }
                    for (const record of records) {
                      distinctItemCategoryIds.add(normalizeStreamCategoryId(record.categoryId));
                      if (record.contentId) {
                        movieCompleteness.noteCrawlIds([record.contentId]);
                      }
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
                    sqliteWriteMs += Date.now() - sqliteCallbackStarted;
                    releaseBatch(`movie-native-raw:${category.id}`, records);
                  }
                },
              });
              logSyncLifecycle(providerId, 'native-request-settled', {
                mediaType: 'movie',
                runToken,
                categoryIndex: movieCategoryIndex,
                categoryId: category.id,
                generation: sqliteHandle?.generation ?? null,
                activeNativeRequest: false,
                cancelled: decodeResult.cancelled,
                matched: decodeResult.matched,
              });
              providerNativeMs =
                Number(decodeResult.stats.headersMs ?? 0) +
                Number(decodeResult.stats.downloadParseMs ?? 0);
              if (decodeResult.cancelled || isCancelled()) {
                logSyncLifecycle(providerId, 'movie-loop-exit', { runToken, categoryIndex: movieCategoryIndex, categoryId: category.id, reason: decodeResult.cancelled ? 'native-category-cancelled' : 'cancelled-after-category' });
                return;
              }
              matched = decodeResult.matched;
              categoryMatched = matched;
              movieCompleteness.noteCrawlRaw(
                typeof decodeResult.stats.rawSeen === 'number' ? decodeResult.stats.rawSeen : matched,
              );
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
              recordCatalogSqliteCategoryContext(sqliteHandle, {
                categoryId: category.id,
                categoryIndex: movieCategoryIndex,
                categoryCount: movieCategories.length,
                requestAttempt: 1,
              });
              const loaded = await loadAllMoviesForCatalogIndex(movies, category.id);
              items = loaded.items;
              categoryMatched = items.length;
              movieCompleteness.noteCrawlIds(items.map((movie) => movie.id));
              movieCompleteness.noteCrawlRaw(items.length);
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
            categoryMatched = setup.movieCountMap[category.id] ?? 0;
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
          if (sqliteHandle) {
            recordCatalogSqliteCategoryResult(sqliteHandle, { itemCount: categoryMatched });
          }
        } catch (error) {
          finishVodCategoryPhaseProfile({
            failed: true,
            error: error instanceof Error ? error.message : String(error),
          });
          if (sqliteHandle) {
            recordCatalogSqliteCategoryResult(sqliteHandle, { itemCount: 0, failed: true });
          }
          throw error;
        } finally {
          releaseBatch(`movie-category:${category.id}`, items);
        }

        if (syncMovieItems && category.id !== 'all' && !String(category.id).startsWith('section:') && !String(category.id).startsWith('smart:')) {
          categoriesAttempted += 1;
          decodedItemCount += categoryMatched;
          if (categoryMatched > 0) {
            categoriesReturningItems += 1;
          } else {
            categoriesReturningZero += 1;
          }

          const sparse = evaluateSparsePerCategoryCoverage({
            categoriesAttempted,
            categoriesReturningItems,
            categoriesReturningZero,
            metadataCategoryCount: movieCategories.length,
            distinctItemCategoryIds: distinctItemCategoryIds.size,
            decodedItemCount,
          });
          if (sparse.suspicious && !strategyFallbackUsed) {
            abortedForSparse = true;
            strategyFallbackUsed = true;
            logSync(providerId, 'movie-sparse-per-category-abort', {
              reason: sparse.reason,
              categoriesAttempted,
              categoriesReturningItems,
              categoriesReturningZero,
              decodedItemCount,
              distinctItemCategoryIds: distinctItemCategoryIds.size,
              metadataCategoryCount: movieCategories.length,
            });
            await writeVodCategoryFilterCapability({
              providerId,
              status: 'unreliable',
              filteringReliable: false,
              testedCategoryIds: [],
              overlapRatio: 0,
              returnedCategoryIdCounts: [],
              reason: sparse.reason ?? 'sparse-per-category-coverage',
              probedAt: Date.now(),
              storageVersion: 4,
            });
            await finishMovieSqlite({
              handle: sqliteHandle,
              ok: false,
              errorCode: 'sparse_per_category_ingestion',
              nativeDone: false,
            });
            retrySource = 'sparse_per_category_ingestion';
            logSyncLifecycle(providerId, 'movie-generation-replaced-after-failure', {
              runToken,
              failedGeneration: sqliteHandle.generation,
              retrySource,
              pendingRequestPresent: pendingSyncInputs.has(providerId),
            });
            // One automatic strategy fallback: new generation + full dump.
            sqliteHandle = await startCatalogSqliteMediaSync({
              providerId,
              mediaType: 'movie',
              providerType: input.providerType ?? 'unknown',
              displayName: input.displayName ?? null,
              runId,
            });
            noteMovieSqliteHandle(movieOwnership, sqliteHandle);
            if (sqliteHandle.enabled) {
              await writeCategoriesFromSourceBudgeted(
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
            }
            movieSyncStrategy = 'full-dump-stream-category';
            filteringReliable = false;
            filterStatus = 'unreliable';
            filterReason = sparse.reason ?? 'sparse-per-category-coverage';
            break;
          }
        }

        const checkpointStarted = Date.now();
        await writeCatalogSyncCheckpointSafe(setup, runToken, 'movies', movieCategoryIndex + 1, setup.resumeSeriesIndex);
        checkpointMs = Date.now() - checkpointStarted;
        if (sqliteHandle) {
          recordCatalogSqliteCheckpoint(sqliteHandle, movieCategoryIndex + 1);
        }
        if (movieCategoryIndex === movieStartIndex || (movieCategoryIndex + 1) % 5 === 0) {
          publishCatalogProgress(setup);
        }
        const idleStarted = Date.now();
        await waitForCatalogSyncIdleSlot();
        idleYieldMs = Date.now() - idleStarted;
        logMovieCategoryTiming({
          generation: sqliteHandle?.generation ?? null,
          categoryId: category.id,
          matched: categoryMatched,
          providerNativeMs,
          sqliteWriteMs,
          checkpointMs,
          idleYieldMs,
          totalMs: Date.now() - categoryStarted,
        });
      }

      if (abortedForSparse && sqliteHandle?.enabled && movieSyncStrategy === 'full-dump-stream-category') {
        // Fall through by re-entering full-dump via a nested path: schedule force and rethrow
        // so the outer sync can restart cleanly is fragile — run full dump inline instead.
        forceMoviesFullDumpByProvider.set(providerId, filterReason);
        const fullDumpUrl = movies.getCatalogListRequestUrl?.('all') ?? null;
        if (!fullDumpUrl) {
          throw new Error('movie_full_dump_url_unavailable');
        }
        let rawStreamCount = 0;
        let decodedStreamCount = 0;
        let missingCategoryIdCount = 0;
        const distinctStreamCategoryIds = new Set<string>();
        const distinctContentIds = new Set<string>();
        const fullDumpResult = await streamXtreamCategoryDecode({
          requestUrl: fullDumpUrl,
          mediaType: 'movie',
          filterCategoryId: 'all',
          providerId,
          isCancelled,
          runId: runId ?? null,
          catalogNetworkMediaType: 'movie',
          catalogNetworkOperation: 'get_vod_streams',
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
              distinctStreamCategoryIds.add(normalizeStreamCategoryId(record.categoryId));
              if (record.contentId) {
                distinctContentIds.add(record.contentId);
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
        logSyncLifecycle(providerId, 'movie-category-loop-exit', {
          runToken,
          generation: sqliteHandle.generation,
          categoryLoopStarted,
          categoryLoopFinished: false,
          reason: fullDumpResult.cancelled ? 'native-full-dump-cancelled' : 'cancelled-after-full-dump',
        });
        await rejectAfterOpenSqlite(
          fullDumpResult.cancelled
            ? 'return-sparse-fallback-full-dump-cancelled'
            : 'return-sparse-fallback-cancelled-after-full-dump',
          'cancelled',
        );
        return;
      }
      categoryLoopFinished = true;
      categoryDataObserved = decodedStreamCount > 0;
      logSyncLifecycle(providerId, 'movie-category-loop-finished', {
        runToken,
        generation: sqliteHandle.generation,
        strategy: movieSyncStrategy,
        decodedStreamCount,
        categoryLoopStarted,
        categoryLoopFinished,
      });
        markCatalogAuditItems(decodedStreamCount, 'processed');
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
              filterStatus,
              filterReason,
              strategy: 'full-dump-stream-category',
              fallbackFrom: 'sparse_per_category_ingestion',
              marker: 'stage4d-vod-ingestion-repair-v1',
            }),
        );
        forceMoviesFullDumpByProvider.delete(providerId);
        categoryLoopFinished = true;
        fullDumpCompleted = true;
        movieFullDumpCompleted = true;
      movieFullDumpCompleted = true;
        fullDumpDecodedStreamCount = decodedStreamCount;
        fullDumpDistinctContentIds = distinctContentIds.size;
        fullDumpDistinctStreamCategoryIds = distinctStreamCategoryIds.size;
        fullDumpMissingCategoryIdCount = missingCategoryIdCount;
        categoryAssignmentFinished = distinctStreamCategoryIds.size > 0;
        movieCompleteness.markFullDumpStrategy();
        movieCompleteness.noteDumpStats({
          rawCount: rawStreamCount,
          decodedCount: decodedStreamCount,
          missingCategoryIdCount,
          distinctIds: distinctContentIds,
          distinctCategoryIds: distinctStreamCategoryIds,
        });
        logSyncLifecycle(providerId, 'movie-category-loop-finished', {
          runToken,
          generation: sqliteHandle.generation,
          strategy: movieSyncStrategy,
          decodedStreamCount,
          categoryLoopStarted,
          categoryLoopFinished,
          retrySource,
        });
      }
      if (!abortedForSparse) {
        categoryLoopFinished = true;
        categoryDataObserved =
          (sqliteHandle?.accounting.processedCategoryCount ?? 0) > 0 ||
          (sqliteHandle?.accounting.decodedCount ?? 0) > 0;
      }
    } else {
      // Non-native / non-SQLite path: legacy per-category ingest (no capability gate).
      movieSyncStrategy = 'filtered-per-category';
      for (
        let movieCategoryIndex = movieStartIndex;
        movieCategoryIndex < movieCategories.length;
        movieCategoryIndex += 1
      ) {
        const category = movieCategories[movieCategoryIndex];
        if (!(await yieldForPlaybackIfNeeded(providerId, `movie-category:${category.id}`, 'movies', runToken))) {
          publishCatalogProgress(setup);
          setup.progressThrottle.flush();
          schedulePendingHeavySync(providerId, input);
          await rejectAfterOpenSqlite('return-playback-deferral-js-category-loop', 'playback_deferred', {
            categoryIndex: movieCategoryIndex,
            categoryId: category.id,
          });
          return;
        }
        if (isCancelled()) {
          await rejectAfterOpenSqlite('return-cancelled-js-category-loop', 'cancelled', {
            categoryIndex: movieCategoryIndex,
            categoryId: category.id,
          });
          return;
        }

        const categoryStarted = Date.now();
        markCatalogAuditCategory('movie', 'fetch_start', { categoryId: category.id });
        beginVodCategoryPhaseProfile(category.id);
        let items: Awaited<ReturnType<NonNullable<MovieDataSource['listCategoryMovies']>>> | null = null;

        try {
          if (syncMovieItems) {
            const loaded = await loadAllMoviesForCatalogIndex(movies, category.id);
            items = loaded.items;
            if (loaded.truncated && movieIndex) {
              movieIndex.markCategoryLoadTruncated();
            }
            if (items.length && movieIndex) {
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
            setup.movieCountMap[category.id] = items.length;
            markCatalogAuditItems(items.length, 'processed');
            if (sqliteHandle) {
              recordCatalogSqliteCategoryResult(sqliteHandle, { itemCount: items.length });
            }
          } else if (movies.getCategoryCount) {
            setup.movieCountMap[category.id] = await movies.getCategoryCount(category.id);
          }

          const durationMs = Date.now() - categoryStarted;
          finishVodCategoryPhaseProfile({
            mode: syncMovieItems ? 'full' : 'count-only',
            durationMs,
          });
          markCatalogAuditCategory('movie', 'fetch_done', {
            categoryId: category.id,
            count: setup.movieCountMap[category.id] ?? 0,
            durationMs,
          });
        } catch (error) {
          finishVodCategoryPhaseProfile({
            failed: true,
            error: error instanceof Error ? error.message : String(error),
          });
          if (sqliteHandle) {
            recordCatalogSqliteCategoryResult(sqliteHandle, { itemCount: 0, failed: true });
          }
          throw error;
        } finally {
          releaseBatch(`movie-category:${category.id}`, items);
        }

        await writeCatalogSyncCheckpointSafe(setup, runToken, 'movies', movieCategoryIndex + 1, setup.resumeSeriesIndex);
        if (sqliteHandle) {
          recordCatalogSqliteCheckpoint(sqliteHandle, movieCategoryIndex + 1);
        }
        if (movieCategoryIndex === movieStartIndex || (movieCategoryIndex + 1) % 5 === 0) {
          publishCatalogProgress(setup);
        }
        await waitForCatalogSyncIdleSlot();
      }
      categoryLoopFinished = true;
      categoryDataObserved = (sqliteHandle?.accounting.processedCategoryCount ?? 0) > 0;
    }

    if (movieIndex && smartCategoriesEnabled && !isCancelled()) {
      if (!(await yieldForPlaybackIfNeeded(providerId, 'movie-region-rank', 'movies', runToken))) {
        schedulePendingHeavySync(providerId, input);
        await rejectAfterOpenSqlite('return-playback-deferral-region-rank', 'playback_deferred');
        return;
      }
      const rankStarted = Date.now();
      const rankLoadStarted = Date.now();
      const rankItems = movieIndex.listAllEntries();
      const loadMs = Date.now() - rankLoadStarted;
      const rankResult = await rankUniqueItemsInBatches(rankItems, {
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
      console.info('[NovaCast Movie Region Ranking Audit]', {
        generation: sqliteHandle?.generation ?? null,
        inputItemCount: rankItems.length,
        outputItemCount: rankResult.ranked,
        regionCount: 3,
        fullCatalogPassCount: 1,
        sortCount: 0,
        filterCount: 1,
        normalizationCount: 0,
        sqliteQueryCount: 0,
        loadMs,
        indexBuildMs: 0,
        rankingMs: Date.now() - rankStarted - loadMs,
        sortMs: 0,
        serializationMs: 0,
        totalMs: Date.now() - rankStarted,
        strategy: 'single-pass-ranking-dedicated-region-budget',
        batches: rankResult.batches,
        skipped: rankResult.skipped,
      });
      console.info('[NovaCast Movie Region Ranking Scheduler Audit]', {
        generation: sqliteHandle?.generation ?? null,
        inputItemCount: rankItems.length,
        initialBatchSize: rankResult.initialBatchSize,
        minBatchSizeSeen: rankResult.minBatchSizeSeen,
        maxBatchSizeSeen: rankResult.maxBatchSizeSeen,
        averageBatchSize: rankResult.averageBatchSize,
        finalBatchSize: rankResult.finalBatchSize,
        batchCount: rankResult.batches,
        yieldCount: rankResult.yieldCount,
        pressureReductionCount: rankResult.pressureReductionCount,
        pressureIncreaseCount: rankResult.pressureIncreaseCount,
        measuredMacrotaskLagMaxMs: rankResult.measuredMacrotaskLagMaxMs,
        measuredMacrotaskLagAverageMs: rankResult.measuredMacrotaskLagAverageMs,
        totalYieldMs: rankResult.totalYieldMs,
        computeMs: rankResult.computeMs,
        computeVodRegionRankMs: rankResult.computeVodRegionRankMs,
        setRegionRankMs: rankResult.setRegionRankMs,
        averageComputeVodRegionRankUsPerItem: rankResult.averageComputeVodRegionRankUsPerItem,
        averageSetRegionRankUsPerItem: rankResult.averageSetRegionRankUsPerItem,
        totalMs: Date.now() - rankStarted,
        budgetKind: 'regionRanking',
      });
      console.info('[NovaCast Movie Region Ranking Compute Audit]', {
        generation: sqliteHandle?.generation ?? null,
        totalItems: rankResult.ranked,
        computeVodRegionRankMs: rankResult.computeVodRegionRankMs,
        setRegionRankMs: rankResult.setRegionRankMs,
        averageComputeVodRegionRankUsPerItem: rankResult.averageComputeVodRegionRankUsPerItem,
        averageSetRegionRankUsPerItem: rankResult.averageSetRegionRankUsPerItem,
        totalComputeMs: rankResult.computeMs,
      });
      logMovieCompletionPhase('movie-region-ranking', sqliteHandle?.generation ?? null, rankStarted);
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
        await rejectAfterOpenSqlite('return-playback-deferral-smart-building', 'playback_deferred');
        return;
      }
      const smartStarted = Date.now();
      await buildMovieSmartCache(providerId, runToken, sqliteHandle?.generation);
      logMovieCompletionPhase('smart-category-build', sqliteHandle?.generation ?? null, smartStarted);
    }

    if (isCancelled()) {
      logSync(providerId, 'movie-sync-cancelled', { reason: 'provider-reset' });
      const movieFinishOk = await finishMovieSqlite({
        handle: sqliteHandle ?? createDisabledCatalogSqliteMediaSyncHandle(providerId, 'movie'),
        ok: false,
        errorCode: 'cancelled',
      });
      logSyncLifecycle(providerId, 'movie-loop-exit', { runToken, reason: 'cancelled-before-completion' });
      setMovieReturnReason('return-cancelled-before-completion');
      probeMoviePromise('movie-early-return', {
        reason: 'return-cancelled-before-completion',
        movieFinishOk,
        kind: 'cancelled',
      });
      throw new Error(MOVIE_SYNC_CANCELLED_ERROR);
    }

    publishCatalogProgress(setup);
    setup.progressThrottle.flush();
    movieIndex?.commitSync();

    movieCompleteness.emit({
      strategy: movieSyncStrategy,
      filteringReliable,
      filterStatus,
      crawlOutcome: movieSyncStrategy === 'full-dump-stream-category' ? 'skipped-full-dump-strategy' : 'completed',
    });
    const completionStarted = Date.now();
    movieCompletionProbeReached = true;
    const activeSyncAudit = syncAuditRuns.get(providerId);
    const completion = decideMovieCatalogCompletion({
      strategy: movieSyncStrategy,
      filteringReliable,
      movieCategoryCount: movieCategories.length,
      categoryLoopFinished,
      categoryDataObserved,
      fullDumpCompleted,
      decodedStreamCount: fullDumpDecodedStreamCount,
      distinctContentIds: fullDumpDistinctContentIds,
      distinctStreamCategoryIds: fullDumpDistinctStreamCategoryIds,
      missingCategoryIdCount: fullDumpMissingCategoryIdCount,
      categoryAssignmentFinished,
      sqliteWriterEnabled: Boolean(sqliteHandle?.enabled),
      cancelled: isCancelled(),
      staleGeneration: isSyncRunStale(runToken),
      fatalError: false,
    });
    console.info('[NovaCast Movie Completion Entry Audit]', {
      generation: sqliteHandle?.generation ?? 0,
      runId: activeSyncAudit?.runId ?? runId ?? null,
      requestId: activeSyncAudit?.requestId ?? null,
      processedCategoryCount: sqliteHandle?.accounting.processedCategoryCount ?? 0,
      expectedCategoryCount: movieCategories.length,
      checkpointCategoryIndex: sqliteHandle?.accounting.checkpointCategoryIndex ?? 0,
      nativeDone: true,
      writerDrained: sqliteHandle?.accounting.writerDrained ?? false,
      pendingWriteCount: sqliteHandle?.accounting.pendingWriteCount ?? 0,
      categoryLoopStarted,
      categoryLoopFinished,
      categoryDataObserved,
      completionEntryReason: completion.completionReason,
      previousGeneration: null,
      previousGenerationFailure: null,
      pendingRequestPresent: pendingSyncInputs.has(providerId),
      retrySource,
      generationTokenState: isSyncRunStale(runToken) ? 'stale' : 'current',
    });
    console.info(
      '[NovaCast Movie Completion Probe]',
      JSON.stringify({
        strategy: movieSyncStrategy,
        filteringReliable,
        categoryCrawlTerminal: completion.categoryCrawlTerminal,
        categoryLoopFinished,
        categoryDataObserved,
        fullDumpCompleted,
        decodedStreamCount: fullDumpDecodedStreamCount,
        distinctContentIds: fullDumpDistinctContentIds,
        distinctStreamCategoryIds: fullDumpDistinctStreamCategoryIds,
        missingCategoryIdCount: fullDumpMissingCategoryIdCount,
        categoryAssignmentFinished,
        sqliteWriterEnabled: Boolean(sqliteHandle?.enabled),
        cancelled: isCancelled(),
        staleGeneration: isSyncRunStale(runToken),
        generation: sqliteHandle?.generation ?? 0,
        completionDecision: completion.completionDecision,
        completionReason: completion.completionReason,
      }),
    );
    if (!completion.publish) {
      if (completion.completionReason === 'cancelled-or-stale') {
        await finishMovieSqlite({
          handle: sqliteHandle ?? createDisabledCatalogSqliteMediaSyncHandle(providerId, 'movie'),
          ok: false,
          errorCode: 'cancelled',
        });
        logSyncLifecycle(providerId, 'movie-loop-exit', {
          runToken,
          reason: 'cancelled-or-stale-at-completion',
        });
        setMovieReturnReason('return-cancelled-or-stale-at-completion');
        probeMoviePromise('movie-early-return', {
          reason: 'return-cancelled-or-stale-at-completion',
          kind: 'cancelled',
        });
        throw new Error(MOVIE_SYNC_CANCELLED_ERROR);
      }
      throw new Error(
        completion.completionReason === 'category-crawl-not-terminal-or-empty'
          ? 'movie_category_crawl_not_terminal'
          : completion.completionReason === 'full-dump-empty'
            ? 'movie_full_dump_empty'
            : `movie_completion_rejected:${completion.completionReason}`,
      );
    }
    const movieFinishOk = await finishMovieSqlite({
      handle: sqliteHandle ?? createDisabledCatalogSqliteMediaSyncHandle(providerId, 'movie'),
      ok: true,
      processedCount: Object.values(setup.movieCountMap).reduce((sum, count) => sum + count, 0),
      nativeDone: true,
    });
    logMovieCompletionPhase('completion-barrier-and-promotion', sqliteHandle?.generation ?? null, completionStarted);
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
    releaseSeriesRetries('movies-readable-generation');
    markMediaJobComplete(providerId, 'movie');
    setMovieReturnReason('completed-after-sqlite');
  } catch (error) {
    logMovieSyncProbe('runMovieCatalogSync', {
      providerId,
      coordinatorKey,
      runToken,
      runId: runId ?? null,
      reason: 'throw-before-or-during-sqlite',
      errorCode: error instanceof Error ? error.message : String(error),
      generationTokenState: isSyncRunStale(runToken) ? 'stale' : 'current',
      sqliteHandleEnabled: Boolean(((sqliteHandle as unknown) as CatalogSqliteMediaSyncHandle | null)?.enabled),
      sqliteGeneration: sqliteHandle?.generation ?? null,
    });
    logSyncLifecycle(providerId, 'movie-loop-error', {
      runToken,
      error: error instanceof Error ? error.message : String(error),
      generationTokenState: isSyncRunStale(runToken) ? 'stale' : 'current',
    });
    movieIndex?.abortSync();
    if (sqliteHandle?.enabled && !movieOwnership.movieFinishCalled) {
      await finishMovieSqlite({
        handle: sqliteHandle,
        ok: false,
        errorCode: error instanceof Error ? error.message : 'movie_sync_failed',
        nativeDone: false,
      });
    }
    throw error;
  }
  } catch (error) {
    threw = true;
    if (movieOwnership.returnReason === 'unknown') {
      setMovieReturnReason('runMovieCatalogSync-threw');
    } else {
      exitReason = movieOwnership.returnReason;
    }
    logMovieSyncProbe('runMovieCatalogSync', {
      providerId,
      coordinatorKey,
      runToken,
      runId: runId ?? null,
      reason: 'runMovieCatalogSync-threw',
      ...movieSyncErrorFields(error),
      checkpoint: movieSyncCheckpointSnapshot(setup?.checkpoint),
      syncInFlight: syncInFlight.has(providerId),
      generationTokenState: isSyncRunStale(runToken) ? 'stale' : 'current',
      coordinatorGeneration: getCatalogSyncCancelToken(coordinatorKey).generation,
      sqliteHandleEnabled: Boolean(((sqliteHandle as unknown) as CatalogSqliteMediaSyncHandle | null)?.enabled),
      promiseAwaitedByCoordinator: true,
    });
    throw error;
  } finally {
    probeMoviePromise('runMovieCatalogSync-returned', {
      exitReason,
      threw,
      movieFinishCalled: movieOwnership.movieFinishCalled,
      movieFinishOutcome: movieOwnership.movieFinishOutcome,
      movieFullDumpCompleted,
      movieCompletionProbeReached,
      cancelled: isCancelled(),
      staleGeneration: isSyncRunStale(runToken),
      awaitedByCoordinator: true,
      abandonedOpenSqliteGeneration: ownsOpenMovieSqliteGeneration(movieOwnership),
    });
    try {
      await enforceMovieSqliteTerminal(movieOwnership, movieOwnershipDeps);
    } catch (error) {
      threw = true;
      setMovieReturnReason('abandoned-open-sqlite-generation');
      probeMoviePromise('movie-async-worker-completed', {
        outcome: 'rejected',
        exitReason,
        movieFinishCalled: movieOwnership.movieFinishCalled,
        movieFinishOutcome: movieOwnership.movieFinishOutcome,
      });
      throw error;
    }
    probeMoviePromise('movie-async-worker-completed', {
      outcome: threw ? 'rejected' : 'fulfilled',
      exitReason,
      movieFinishCalled: movieOwnership.movieFinishCalled,
      movieFinishOutcome: movieOwnership.movieFinishOutcome,
      movieFullDumpCompleted,
      movieCompletionProbeReached,
    });
    if (threw || exitReason.startsWith('return-') || exitReason.startsWith('completed')) {
      releaseSeriesRetries(threw ? 'movies-terminal-failure-or-cancellation' : 'movies-terminal-completion');
      const moviesCriticalKey = `${providerId}:${runToken}`;
      if (moviesCriticalWindowLogged.delete(moviesCriticalKey)) {
        console.info('[NovaCast Catalog Network Gate]', {
          event: 'movies-critical-window-exit',
          providerId,
          generation: runToken,
          activeSurface: getCatalogUiSurface(),
          readableMovieGenerationPresent: false,
          reason: threw ? 'movies-terminal-failure-or-cancellation' : 'movies-terminal-completion',
        });
      }
    }
    logMovieSyncProbe('runMovieCatalogSync', {
      providerId,
      coordinatorKey,
      runToken,
      runId: runId ?? null,
      reason: 'runMovieCatalogSync-settled',
      exitReason,
      threw,
      checkpoint: movieSyncCheckpointSnapshot(setup?.checkpoint),
      syncInFlight: syncInFlight.has(providerId),
      generationTokenState: isSyncRunStale(runToken) ? 'stale' : 'current',
      coordinatorGeneration: getCatalogSyncCancelToken(coordinatorKey).generation,
      promiseAwaitedByCoordinator: true,
      settledVia: 'runMovieCatalogSync-finally',
    });
  }
}

function readBundleGenerationSafe(): number | null {
  try {
    const loaded = require('./providerBundle.ts') as { getRepositoryBundleGeneration?: () => number };
    return typeof loaded.getRepositoryBundleGeneration === 'function'
      ? loaded.getRepositoryBundleGeneration()
      : null;
  } catch {
    return null;
  }
}

export async function runSeriesCatalogSync(
  input: ProviderCatalogSyncInput,
  runToken: number,
  coordinatorKey: string,
  runId?: string,
) {
  const { providerId, series } = input;
  const started = Date.now();
  const coordinatorToken = getCatalogSyncCancelToken(coordinatorKey);
  const workerEpoch = coordinatorToken.generation;
  const isCancelled = () => {
    const staleRun = isSyncRunStale(runToken);
    const staleCoordinator = coordinatorToken.isStale();
    if (!staleRun && !staleCoordinator) {
      return false;
    }
    const cancelSource = staleRun ? 'sync-generation-changed' : 'coordinator-replacement';
    noteSeriesCancelRequested({
      providerId,
      runId: runId ?? null,
      cancelSource,
      cancelCaller: 'runSeriesCatalogSync.isCancelled',
      abortReason: staleRun ? 'sync-run-token-stale' : 'coordinator-epoch-stale',
      catalogRequestSource: input.requestSource ?? null,
      workerEpoch,
      coordinatorEpoch: getCatalogSyncEpoch(coordinatorKey),
      bundleGeneration: readBundleGenerationSafe(),
    });
    return !isUiLifecycleCancelSource(cancelSource);
  };
  const setup = await ensureCatalogSyncSetup(input, runToken);
  let seriesPreemptionRequested = false;
  const requestSeriesPreemption = () => {
    if (seriesPreemptionRequested || isSyncRunStale(runToken)) {
      return false;
    }
    seriesPreemptionRequested = true;
    cancelCatalogSync(providerId, 'series', {
      cancelSource: 'network-gate-cancellation',
      cancelCaller: 'providerCatalogNetworkGate.foregroundMovies',
    });
    return true;
  };

  notifyPhase(providerId, 'syncing');
  markCatalogAuditSync('started', { providerId, mediaType: 'series' });
  logSync(providerId, 'series-sync-started');
  logSyncLifecycle(providerId, 'series-worker-started', {
    runToken,
    generationTokenState: isSyncRunStale(runToken) ? 'stale' : 'current',
    seriesWorkerState: 'running',
  });

  if (isCancelled()) {
    logSync(providerId, 'series-sync-cancelled', { reason: 'provider-reset' });
    logSyncLifecycle(providerId, 'series-loop-exit', { runToken, reason: 'cancelled-before-work' });
    return;
  }

  if (await shouldSkipSeriesSync(setup, runToken)) {
    await auditProviderEntitlements({
      providerId,
      runToken,
      movies: input.movies,
      seriesDumpUrl: input.series.getCatalogListRequestUrl?.('all') ?? null,
      movieDumpUrl: input.movies.getCatalogListRequestUrl?.('all') ?? null,
      liveDumpUrl: input.live.getLiveDumpRequestUrl?.() ?? null,
      apiSeriesDistinctCount: null,
      movieDumpCompleted: true,
      isCancelled,
    });
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

  const { smartCategoriesEnabled, seriesCategories } = setup;
  const seriesIndex = smartCategoriesEnabled ? getSeriesCatalogIndex(providerId) : null;
  const canResumeCheckpoint = setup.canResumeSeriesCheckpoint;
  if (smartCategoriesEnabled && !canResumeCheckpoint) {
    seriesIndex?.beginSync();
  }

  const seriesDataSource = createProviderSeriesDataSource(series);
  let sqliteHandle: CatalogSqliteMediaSyncHandle | null = null;
  let completeness: SeriesCompletenessTracker | null = null;

  try {
    sqliteHandle = await startCatalogSqliteMediaSync({
      providerId,
      mediaType: 'series',
      providerType: input.providerType ?? 'unknown',
      displayName: input.displayName ?? null,
      runId,
    });

    if (sqliteHandle.enabled) {
      emitSeriesSqliteEvent('series_sqlite_refresh_started', {
        providerId,
        generation: sqliteHandle.generation,
        categoryCount: seriesCategories.length,
      });
    }

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

    // Generation-safe tables cannot resume item progress from an older
    // generation. Every fresh SQLite Series generation must own a complete
    // category/item walk of its own.
    const seriesStartIndex = sqliteHandle?.enabled ? 0 : setup.resumeSeriesIndex;
    if (sqliteHandle?.enabled) {
      for (const categoryId of Object.keys(setup.seriesCountMap)) {
        delete setup.seriesCountMap[categoryId];
      }
      if (smartCategoriesEnabled && canResumeCheckpoint) {
        seriesIndex?.beginSync();
      }
      console.info('[NovaCast Series Generation Resume Guard]', {
        providerId,
        generation: sqliteHandle.generation,
        checkpointResumeSeriesIndex: setup.resumeSeriesIndex,
        seriesStartIndex,
        action: 'fresh-generation-full-rewalk',
      });
    }

    completeness = createSeriesCompletenessTracker({
      providerId,
      generation: sqliteHandle?.generation ?? null,
      metadataCategoryCount: seriesCategories.length,
    });

    const seriesDumpUrl = seriesDataSource.getCatalogListRequestUrl?.('all') ?? null;
    const seriesNativeAvailable = isNativeCatalogDecodeAvailable();
    let seriesFullDump: Awaited<ReturnType<typeof decodeSeriesFullDumpUnique>> | null = null;
    let seriesFullDumpCompleted = false;
    let seriesCategoryAssignmentFinished = false;
    if (seriesNativeAvailable && seriesDumpUrl) {
      try {
        const probeCategoryIds = selectVodCategoryProbeIds(
          seriesCategories.map((category) => category.id),
          { limit: 3 },
        );
        const seriesProbes: VodCategoryProbeSample[] = [];
        for (const probeCategoryId of probeCategoryIds) {
          if (isCancelled()) {
            completeness.emit({ crawlOutcome: 'cancelled-during-probe' });
            logSyncLifecycle(providerId, 'series-loop-exit', {
              runToken,
              categoryId: probeCategoryId,
              reason: 'cancelled-during-series-completeness-probe',
            });
            return;
          }
          const probeUrl = seriesDataSource.getCatalogListRequestUrl?.(probeCategoryId) ?? null;
          if (!probeUrl) {
            continue;
          }
          const accumulator = createVodCategoryProbeAccumulator(probeCategoryId);
          await retrySeriesCategoryDecode({
            providerId,
            generation: sqliteHandle?.generation ?? null,
            categoryId: probeCategoryId,
            categoryIndex: -1,
            categoryPosition: 0,
            totalCategoryCount: seriesCategories.length,
            isCancelled,
            work: async (attempt) => {
              const probeResult = await streamXtreamCategoryDecode({
                requestUrl: probeUrl,
                mediaType: 'series',
                filterCategoryId: probeCategoryId,
                providerId,
                generation: sqliteHandle?.generation,
                requestAttempt: attempt,
                isCancelled,
                runId: runId ?? null,
                catalogNetworkMediaType: 'series',
                catalogNetworkOperation: 'get_series:filter-probe',
                onBatch: async (records) => {
                  accumulator.onRecords(records);
                },
              });
              if (probeResult.cancelled || isCancelled()) {
                throw Object.assign(new Error('cancelled'), { errorReason: 'cancelled' });
              }
              return probeResult;
            },
          });
          seriesProbes.push(accumulator.sample);
        }
        if (seriesProbes.length >= 1) {
          const capability = evaluateSeriesCategoryFilterFromProbes({
            providerId,
            probes: seriesProbes,
            metadataCategoryCount: seriesCategories.length,
            estimatedCatalogSize: Math.max(...seriesProbes.map((probe) => probe.returnedCount)),
          });
          completeness.noteFilterCapability({
            filteringReliable: capability.filteringReliable,
            filterReason: capability.reason,
          });
        }

        beginSeriesDumpCancellationAudit({
          providerId,
          runId: runId ?? null,
          generation: sqliteHandle?.generation ?? null,
          catalogRequestSource: input.requestSource ?? 'unspecified',
          workerEpoch,
          bundleGeneration: readBundleGenerationSafe(),
          screen: 'background-catalog-sync',
        });
        attachSeriesDumpCancelSignal({
          signalAborted: false,
          cancelCaller: 'runSeriesCatalogSync.captured-cancel-token',
          abortReason: 'series-full-dump-background-owned',
        });
        const dump = await decodeSeriesFullDumpUnique({
          providerId,
          generation: sqliteHandle?.generation ?? null,
          requestUrl: seriesDumpUrl,
          isCancelled,
          runId: runId ?? null,
          streamDecode: streamXtreamCategoryDecode,
          catalogNetworkRequestSource: input.requestSource ?? null,
          catalogNetworkBackground: true,
          catalogNetworkCancellable: true,
          catalogNetworkForeground: false,
          catalogNetworkActiveSurface: getCatalogUiSurface(),
          catalogNetworkReadableGenerationPresent: setup.readableMovieGeneration > 0,
          catalogNetworkOnPreemptionRequested: requestSeriesPreemption,
          catalogNetworkOnPreemptionReleased: ({ ownerHeldMs }) => {
            if (seriesPreemptionRequested) {
              latchSeriesRetry({
                providerId,
                runToken,
                coordinatorKey,
                coordinatorEpoch: getCatalogSyncEpoch(coordinatorKey),
                input,
                runId,
              }, ownerHeldMs);
            }
          },
        });
        completeness.noteDumpStats({
          rawCount: dump.rawCount,
          decodedCount: dump.decodedCount,
          missingCategoryIdCount: dump.missingCategoryIdCount,
          distinctIds: dump.distinctIds,
          distinctCategoryIds: dump.distinctCategoryIds,
        });
        seriesFullDump = dump;
        seriesFullDumpCompleted = true;
      } catch (error) {
        if (isSeriesCategoryDecodeCancelled(error) || isCancelled()) {
          completeness.emit({ crawlOutcome: 'cancelled-during-dump' });
          endSeriesDumpCancellationAudit('worker-cancelled', {
            abortReason: 'cancelled-during-series-full-dump',
            cancelCaller: 'runSeriesCatalogSync.dump-catch',
          });
          logSyncLifecycle(providerId, 'series-loop-exit', {
            runToken,
            reason: 'cancelled-during-series-full-dump',
          });
          await finishCatalogSqliteMediaSync({
            handle: sqliteHandle ?? createDisabledCatalogSqliteMediaSyncHandle(providerId, 'series'),
            ok: false,
            errorCode: 'cancelled',
          });
          return;
        }
        completeness.noteDumpFailed(error instanceof Error ? error.message : String(error));
        throw error;
      }
    } else {
      completeness.noteDumpUnavailable(seriesNativeAvailable ? 'series-full-dump-url-unavailable' : 'native-unavailable');
      throw new Error('series_full_dump_unavailable');
    }

    const writerOnly = isCatalogSqliteWriterOnlyDiagnosticEnabled();
    if (!seriesFullDump) {
      throw new Error('series_full_dump_unavailable');
    }
    const mergedSeriesCategories = mergeSeriesMetadataWithDumpCategories({
      metadata: seriesCategories.map((category) => ({ id: category.id, name: category.name })),
      streamCategoryIds: seriesFullDump.distinctCategoryIds,
      missingCategoryIdCount: seriesFullDump.missingCategoryIdCount,
    });
    const seriesMetadataNames = new Map(
      seriesCategories
        .filter((category) => isTrustworthySeriesCategoryName(category.name, category.id))
        .map((category) => [category.id, category.name]),
    );
    const enrichedSeriesCategories = await enrichAndPersistSeriesCategoryNames({
      providerId,
      generation: sqliteHandle?.generation ?? null,
      categories: mergedSeriesCategories.categories,
      metadataNames: seriesMetadataNames,
      streamRowNames: seriesFullDump.streamRowNames,
      persistToGeneration: null,
      streamRowNameCount: seriesFullDump.streamRowNames.size,
      firstItemKeys: seriesFullDump.firstItemKeys,
      seriesCategoryNameFieldPresentCount: seriesFullDump.seriesCategoryNameFieldPresentCount,
    });
    if (sqliteHandle?.enabled && enrichedSeriesCategories.categories.length) {
      await writeCategoriesFromSourceBudgeted(
        sqliteHandle,
        enrichedSeriesCategories.categories,
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
    seriesCategoryAssignmentFinished = true;
    if (sqliteHandle) {
      recordCatalogSqliteDecoded(sqliteHandle, seriesFullDump.decodedCount);
    }
    if (writerOnly) {
      if (sqliteHandle?.enabled && seriesFullDump.uniqueRecords.length) {
        await writeCatalogItemsFromSourceBudgeted(
          sqliteHandle,
          seriesFullDump.uniqueRecords,
          (record, index) => ({
            ...mapNativeRecordToCatalogItem(
              record,
              providerId,
              'series',
              SERIES_UNKNOWN_CATEGORY_ID,
              sqliteHandle!.generation,
              { allowCategoryFallback: true },
            ),
            providerSortOrder: index,
          }),
          { isCancelled, mapKind: 'seriesMapping' },
        );
      }
    } else {
      const mapped = seriesFullDump.uniqueRecords.map((record) => {
        const categoryId = assignSeriesStreamCategoryId(record.categoryId);
        return nativeRecordToSeriesSummary(record, categoryId) as unknown as SeriesSummary;
      });
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
    }
    for (const categoryId of seriesFullDump.distinctCategoryIds) {
      setup.seriesCountMap[categoryId] = setup.seriesCountMap[categoryId] ?? 0;
    }
    if (sqliteHandle?.enabled) {
      const counts = await getCatalogCategoryCounts(providerId, 'series', {
        generation: sqliteHandle.generation,
      }).catch(() => []);
      for (const row of counts) {
        setup.seriesCountMap[row.categoryId] = row.itemCount;
      }
    }
    markCatalogAuditItems(seriesFullDump.decodedCount, 'processed');
    logSeriesFullDumpSync({
      providerId,
      generation: sqliteHandle?.generation ?? null,
      rawSeriesCount: seriesFullDump.rawCount,
      decodedSeriesCount: seriesFullDump.decodedCount,
      distinctSeriesIds: seriesFullDump.distinctIds.size,
      metadataCategoryCount: seriesCategories.length,
      distinctStreamCategoryIds: seriesFullDump.distinctCategoryIds.size,
      derivedCategoryCount: mergedSeriesCategories.streamCategoryIdsMissingFromMetadata.length,
      missingCategoryIdCount: seriesFullDump.missingCategoryIdCount,
      duplicateSeriesCount: seriesFullDump.duplicateSeriesCount,
      publishedSeriesCount: seriesFullDump.distinctIds.size,
      publishedCategoryCount: mergedSeriesCategories.categories.length,
      strategy: 'full-dump-stream-category',
    });
    await auditProviderEntitlements({
      providerId,
      runToken,
      movies: input.movies,
      seriesDumpUrl: seriesDumpUrl,
      movieDumpUrl: input.movies.getCatalogListRequestUrl?.('all') ?? null,
      liveDumpUrl: input.live.getLiveDumpRequestUrl?.() ?? null,
      apiSeriesDistinctCount: seriesFullDump.distinctIds.size,
      movieDumpCompleted: true,
      isCancelled,
    });
    await writeCatalogSyncCheckpointSafe(
      setup,
      runToken,
      'series',
      setup.movieCategories.length,
      seriesCategories.length,
    );
    await waitForCatalogSyncIdleSlot();

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
      logSyncLifecycle(providerId, 'series-loop-exit', { runToken, reason: 'cancelled-before-completion' });
      return;
    }

    publishCatalogProgress(setup);
    setup.progressThrottle.flush();
    seriesIndex?.commitSync();

    completeness?.emit({ crawlOutcome: 'completed' });

    const seriesCompletion = decideSeriesCatalogCompletion({
      strategy: 'full-dump-stream-category',
      fullDumpCompleted: seriesFullDumpCompleted,
      decodedSeriesCount: seriesFullDump?.decodedCount ?? 0,
      distinctSeriesIds: seriesFullDump?.distinctIds.size ?? 0,
      distinctStreamCategoryIds: seriesFullDump?.distinctCategoryIds.size ?? 0,
      categoryAssignmentFinished: seriesCategoryAssignmentFinished,
      sqliteWriterEnabled: Boolean(sqliteHandle?.enabled),
      cancelled: isCancelled(),
      staleGeneration: isSyncRunStale(runToken),
      fatalError: false,
    });
    logSeriesCompletionProbe({
      strategy: 'full-dump-stream-category',
      fullDumpCompleted: seriesFullDumpCompleted,
      decodedSeriesCount: seriesFullDump?.decodedCount ?? 0,
      distinctSeriesIds: seriesFullDump?.distinctIds.size ?? 0,
      distinctStreamCategoryIds: seriesFullDump?.distinctCategoryIds.size ?? 0,
      missingCategoryIdCount: seriesFullDump?.missingCategoryIdCount ?? 0,
      categoryAssignmentFinished: seriesCategoryAssignmentFinished,
      sqliteWriterEnabled: Boolean(sqliteHandle?.enabled),
      cancelled: isCancelled(),
      staleGeneration: isSyncRunStale(runToken),
      generation: sqliteHandle?.generation ?? 0,
      completionDecision: seriesCompletion.completionDecision,
      completionReason: seriesCompletion.completionReason,
    });
    if (!seriesCompletion.publish) {
      await finishCatalogSqliteMediaSync({
        handle: sqliteHandle ?? createDisabledCatalogSqliteMediaSyncHandle(providerId, 'series'),
        ok: false,
        errorCode: seriesCompletion.completionReason,
      });
      throw new Error(
        seriesCompletion.completionReason === 'cancelled-or-stale'
          ? 'series_sync_cancelled'
          : seriesCompletion.completionReason === 'full-dump-empty'
            ? 'series_full_dump_empty'
            : `series_completion_rejected:${seriesCompletion.completionReason}`,
      );
    }

    const seriesProcessedCount = seriesFullDump?.distinctIds.size ?? 0;
    const seriesFinishHandle = sqliteHandle ?? createDisabledCatalogSqliteMediaSyncHandle(providerId, 'series');
    const seriesFinishOk = await finishCatalogSqliteMediaSync({
      handle: seriesFinishHandle,
      ok: true,
      processedCount: seriesProcessedCount,
    });
    if (seriesFinishHandle.enabled) {
      if (seriesFinishOk) {
        emitSeriesSqliteEvent('series_sqlite_refresh_validated', {
          providerId,
          generation: seriesFinishHandle.generation,
          rowCount: seriesProcessedCount,
        });
        emitSeriesSqliteEvent('series_sqlite_generation_promoted', {
          providerId,
          generation: seriesFinishHandle.generation,
          rowCount: seriesProcessedCount,
        });
      } else {
        emitSeriesSqliteEvent('series_sqlite_refresh_failed', {
          providerId,
          generation: seriesFinishHandle.generation,
          reason: 'promotion_validation_failed',
        });
      }
    }
    if (!seriesFinishOk) {
      throw new Error('series_completion_barrier_failed');
    }

    const movieJobDone = mediaJobCompletion.get(providerId)?.movie === true;
    const readableMovieGeneration = await resolveReadableCatalogGeneration(providerId, 'movie').catch(
      () => 0,
    );
    const movieReadyForSharedCheckpoint = movieJobDone || Number(readableMovieGeneration) > 0;
    await writeCatalogSyncCheckpointSafe(
      setup,
      runToken,
      movieReadyForSharedCheckpoint ? 'complete' : 'series',
      movieReadyForSharedCheckpoint ? setup.movieCategories.length : setup.resumeMovieIndex,
      seriesCategories.length,
    );
    if (!movieReadyForSharedCheckpoint) {
      logSync(providerId, 'series-checkpoint-deferred-complete', {
        reason: 'movie-not-ready',
        movieJobDone,
        readableMovieGeneration,
      });
    }

    logSync(providerId, 'series-sync-completed', {
      durationMs: Date.now() - started,
      smartCategoriesEnabled,
      seriesCatalog: seriesIndex?.getCompleteness(),
    });
    markCatalogAuditSync('completed', { providerId, mediaType: 'series', durationMs: Date.now() - started });
    markMediaJobComplete(providerId, 'series');
    endSeriesDumpCancellationAudit('worker-completed', {
      abortReason: null,
      signalAborted: false,
    });
  } catch (error) {
    completeness?.emit({
      crawlOutcome: 'failed',
      crawlError: error instanceof Error ? error.message : String(error),
    });
    logSyncLifecycle(providerId, 'series-loop-error', {
      runToken,
      error: error instanceof Error ? error.message : String(error),
      generationTokenState: isSyncRunStale(runToken) ? 'stale' : 'current',
    });
    seriesIndex?.abortSync();
    if (sqliteHandle?.enabled) {
      const errorCode = error instanceof Error ? error.message : 'series_sync_failed';
      if (errorCode !== 'series_completion_barrier_failed') {
        emitSeriesSqliteEvent('series_sqlite_refresh_failed', {
          providerId,
          generation: sqliteHandle.generation,
          reason: errorCode,
        });
      }
      await finishCatalogSqliteMediaSync({
        handle: sqliteHandle,
        ok: false,
        errorCode,
      });
    }
    throw error;
  } finally {
    completeness?.emit({ crawlOutcome: 'settled' });
    if (isCancelled()) {
      endSeriesDumpCancellationAudit('worker-cancelled', {
        abortReason: 'series-worker-finally-cancelled',
        cancelCaller: 'runSeriesCatalogSync.finally',
      });
    } else {
      endSeriesDumpCancellationAudit('worker-completed', {
        cancelCaller: 'runSeriesCatalogSync.finally',
      });
    }
  }
}

function liveDumpCategoriesForPublish(
  merged: ReturnType<typeof mergeLiveMetadataWithDumpCategories>,
  metadata: ProviderLiveCategory[],
): ProviderLiveCategory[] {
  const byId = new Map(metadata.map((category) => [category.id, category]));
  return merged.categories.map((category, index) => {
    const existing = byId.get(category.id);
    if (existing) {
      return existing;
    }
    return {
      id: category.id,
      renderKey: `live-derived:${category.id}:${index}`,
      name: category.name,
      rawName: category.name,
      count: null,
      icon: 'flag-outline' as const,
    };
  });
}

export async function runLiveCatalogSync(
  input: ProviderCatalogSyncInput,
  runToken: number,
  coordinatorKey: string,
  runId?: string,
) {
  const { providerId, live } = input;
  const requestSource = input.requestSource ?? 'unspecified';
  const isCancelled = () => isCatalogJobCancelled(runToken, coordinatorKey);
  let returnReason = 'live-runner-entered';
  let liveStatus: 'running' | 'published' | 'skipped' | 'failed' = 'running';
  let rawLiveCount: number | null = null;
  let distinctLiveStreamIds: number | null = null;
  let publishedLiveCount: number | null = null;
  let generation: number | null = null;

  const probe = (event: string, extra: Record<string, unknown> = {}) => {
    logLivePromiseProbe(event, {
      providerId,
      runId: runId ?? null,
      requestSource,
      generation,
      rawLiveCount,
      distinctLiveStreamIds,
      publishedLiveCount,
      returnReason,
      liveStatus,
      ...extra,
    });
  };

  probe('live-runner-entered');

  try {
    if (isCancelled()) {
      returnReason = 'cancelled-before-work';
      liveStatus = 'skipped';
      return;
    }

    const dumpUrl = live.getLiveDumpRequestUrl?.() ?? null;
    const nativeAvailable = isNativeCatalogDecodeAvailable();
    if (!nativeAvailable || !dumpUrl) {
      returnReason = !nativeAvailable ? 'native-unavailable' : 'dump-url-missing';
      liveStatus = 'skipped';
      logLivePublicationTrace('live-publication-skipped', {
        providerId,
        requestSource,
        skipReason: returnReason,
      });
      return;
    }

    if (!(await waitForHeavyCatalogWindow(providerId, runToken))) {
      returnReason = 'deferred-playback-or-stale';
      liveStatus = 'skipped';
      schedulePendingHeavySync(providerId, input);
      return;
    }

    if (isCancelled()) {
      returnReason = 'cancelled-after-heavy-window';
      liveStatus = 'skipped';
      return;
    }

    const hints = (await live.getCategoryAccentHints?.().catch(() => [])) ?? [];
    const metadataCategories: ProviderLiveCategory[] = hints.reduce<ProviderLiveCategory[]>((categories, hint, index) => {
        const id = String(hint.id ?? '').trim();
        if (!id) {
          return categories;
        }
        const name = String(hint.name ?? '').trim() || derivedLiveCategoryName(id);
        categories.push({
          id,
          renderKey: `live-meta:${id}:${index}`,
          name,
          rawName: typeof hint.name === 'string' ? hint.name : undefined,
          count: null as number | null,
          icon: 'flag-outline' as const,
        });
        return categories;
      }, []);
    probe('live-full-dump-start');
    logLivePublicationTrace('live-full-dump-start', { providerId, requestSource });

    const dumpStats = await decodeLiveFullDumpUnique({
      providerId,
      requestUrl: dumpUrl,
      caller: 'live-worker',
      runId: runId ?? null,
      isCancelled,
      streamDecode: streamXtreamCategoryDecode,
    });
    rawLiveCount = dumpStats.rawCount;
    distinctLiveStreamIds = dumpStats.distinctIds.size;
    probe('live-full-dump-returned');
    logLivePublicationTrace('live-full-dump-returned', {
      providerId,
      requestSource,
      rawCount: dumpStats.rawCount,
      distinctCount: dumpStats.distinctIds.size,
    });

    const merged = mergeLiveMetadataWithDumpCategories({
      metadata: metadataCategories,
      streamCategoryIds: dumpStats.distinctCategoryIds,
      missingCategoryIdCount: dumpStats.missingCategoryIdCount,
    });
    const emitCompleteness = (publishedCount: number | null) => {
      emitLiveCompletenessFromAuthoritativeDump({
        providerId,
        rawLiveCount: dumpStats.rawCount,
        decodedLiveCount: dumpStats.decodedCount,
        distinctLiveStreamIds: dumpStats.distinctIds.size,
        duplicateLiveStreamCount: dumpStats.duplicateLiveStreamCount,
        metadataCategoryCount: metadataCategories.length,
        distinctStreamCategoryIds: dumpStats.distinctCategoryIds.size,
        missingCategoryIdCount: dumpStats.missingCategoryIdCount,
        streamCategoryIdsMissingFromMetadata: merged.streamCategoryIdsMissingFromMetadata.length,
        visibleLiveCount: resolveLiveChannelCount(providerId),
        usedNativeDump: dumpStats.usedNative,
        publishedLiveCount: publishedCount,
      });
    };

    if (isCancelled()) {
      returnReason = 'cancelled-after-dump';
      liveStatus = 'skipped';
      emitCompleteness(null);
      return;
    }

    const categoryAssignmentFinished = dumpStats.distinctIds.size > 0;
    const normalized = await normalizeLiveDumpChannelsCooperatively({
      records: dumpStats.uniqueRecords,
      metadataCategoryIds: metadataCategories.map((category) => category.id),
      isCancelled,
    });
    if (isCancelled()) {
      returnReason = 'cancelled-during-live-normalization';
      liveStatus = 'skipped';
      emitCompleteness(null);
      return;
    }
    const channels = normalized.channels;
    const publishCategories = liveDumpCategoriesForPublish(merged, metadataCategories);
    const unknownCategoryAssignedCount = normalized.unknownCategoryAssignedCount;
    const completion = decideLiveCatalogCompletion({
      strategy: 'full-dump-stream-category',
      fullDumpCompleted: true,
      decodedLiveCount: dumpStats.decodedCount,
      distinctLiveStreamIds: dumpStats.distinctIds.size,
      categoryAssignmentFinished,
      cancelled: isCancelled(),
      staleGeneration: isSyncRunStale(runToken),
      fatalError: false,
    });
    if (!completion.publish) {
      returnReason = `completion-rejected:${completion.completionReason}`;
      liveStatus = 'skipped';
      logLivePublicationTrace('live-publication-skipped', {
        providerId,
        requestSource,
        rawCount: dumpStats.rawCount,
        distinctCount: dumpStats.distinctIds.size,
        skipReason: returnReason,
      });
      emitCompleteness(null);
      return;
    }

    const publicationStartedAt = Date.now();
    probe('live-publication-start');
    logLivePublicationTrace('live-publication-start', {
      providerId,
      requestSource,
      rawCount: dumpStats.rawCount,
      distinctCount: dumpStats.distinctIds.size,
      rowCount: dumpStats.uniqueRecords.length,
      durationMs: 0,
    });
    const published = await publishLiveSearchCatalogFromDump({
      providerId,
      channels,
      categories: publishCategories,
      isCancelled,
      requestSource,
    });
    generation = published.generation || null;
    publishedLiveCount = published.channelCount;
    if (!published.rebuilt || published.channelCount <= 0) {
      returnReason = published.rebuilt ? 'published-channel-count-zero' : 'publish-not-rebuilt';
      liveStatus = 'skipped';
      logLivePublicationTrace('live-publication-skipped', {
        providerId,
        requestSource,
        rawCount: dumpStats.rawCount,
        distinctCount: dumpStats.distinctIds.size,
        publishedCount: published.channelCount,
        generation,
        skipReason: returnReason,
      });
      emitCompleteness(published.channelCount);
      return;
    }

    await mergeCategoryCountIndex(providerId, 'live', published.counts);
    await writeProviderLibrarySummary(providerId, { liveChannelCount: published.channelCount });
    logLivePublicationTrace('live-publication-complete', {
      providerId,
      requestSource,
      timestamp: Date.now(),
      rowCount: dumpStats.uniqueRecords.length,
      durationMs: Date.now() - publicationStartedAt,
      publishedCount: published.channelCount,
      generation,
    });
    logLiveFullDumpSync({
      providerId,
      rawLiveCount: dumpStats.rawCount,
      decodedLiveCount: dumpStats.decodedCount,
      distinctLiveStreamIds: dumpStats.distinctIds.size,
      duplicateLiveStreamCount: dumpStats.duplicateLiveStreamCount,
      metadataCategoryCount: metadataCategories.length,
      distinctStreamCategoryIds: dumpStats.distinctCategoryIds.size,
      streamCategoryIdsMissingFromMetadata: merged.streamCategoryIdsMissingFromMetadata.length,
      missingCategoryIdCount: dumpStats.missingCategoryIdCount,
      unknownCategoryAssignedCount,
      publishedLiveCount: published.channelCount,
      strategy: 'full-dump-stream-category',
    });
    returnReason = 'live-publication-completed';
    liveStatus = 'published';
    probe('live-publication-completed');
    logLivePublicationTrace('live-publication-activated', {
      providerId,
      requestSource,
      rawCount: dumpStats.rawCount,
      distinctCount: dumpStats.distinctIds.size,
      publishedCount: published.channelCount,
      generation,
    });
    emitCompleteness(published.channelCount);
  } catch (error) {
    liveStatus = 'failed';
    returnReason = error instanceof Error ? error.message.slice(0, 180) : 'live-sync-failed';
    logSync(providerId, 'live-full-dump-failed', {
      message: error instanceof Error ? error.message : String(error),
    });
    logLivePublicationTrace('live-publication-skipped', {
      providerId,
      requestSource,
      skipReason: `live-full-dump-failed:${returnReason}`,
    });
    throw error;
  } finally {
    probe('live-runner-returned');
  }
}

export async function runProviderCatalogSync(input: ProviderCatalogSyncInput, runToken: number) {
  const providerId = input.providerId;
  const movieKey = buildCatalogSyncKey(providerId, 'movie');
  const seriesKey = buildCatalogSyncKey(providerId, 'series');
  const liveKey = buildCatalogSyncKey(providerId, 'live');
  const [movieResult, seriesResult, liveResult] = await Promise.allSettled([
    runMovieCatalogSync(input, runToken, movieKey),
    runSeriesCatalogSync(input, runToken, seriesKey),
    runLiveCatalogSync(input, runToken, liveKey),
  ]);
  const classified = classifyCatalogMediaJobResults(movieResult, seriesResult, liveResult);
  if (classified.outcome === 'ok') {
    return;
  }
  throw firstSettledRejection([movieResult, seriesResult, liveResult]);
}

function startProviderCatalogSync(input: ProviderCatalogSyncInput, runToken: number, requestId: string) {
  const providerId = input.providerId;
  const runId = `run-${++syncAuditSequence}`;
  logSyncLifecycle(providerId, 'provider-sync-enter', {
    requestId,
    runId,
    runToken,
    coordinatorState: 'starting',
    pendingRequestPresent: pendingSyncInputs.has(providerId),
  });
  syncAuditRuns.set(providerId, { requestId, runId, source: input.requestSource ?? 'unspecified', runToken, startedAt: Date.now() });
  logSyncLifecycle(providerId, 'sync-run-created', {
    requestId,
    runId,
    runToken,
    requestSource: input.requestSource ?? 'unspecified',
    generationTokenState: 'current',
  });
  const movieKey = buildCatalogSyncKey(providerId, 'movie');
  const seriesKey = buildCatalogSyncKey(providerId, 'series');
  const liveKey = buildCatalogSyncKey(providerId, 'live');
  logLivePublicationTrace('syncCatalog-live-enter', {
    providerId,
    requestSource: input.requestSource ?? null,
  });

  const task = Promise.allSettled([
    scheduleCatalogSync(
      movieKey,
      () => {
        logSyncLifecycle(providerId, 'provider-sync-starting', {
          requestId,
          runId,
          runToken,
          mediaType: 'movie',
          coordinatorState: 'running',
          pendingRequestPresent: pendingSyncInputs.has(providerId),
        });
        logMoviePromiseProbe('movie-runner-entered', {
          providerId,
          coordinatorKey: movieKey,
          runToken,
          runId,
          requestId,
        });
        logMovieSyncProbe('startProviderCatalogSync.movieRunner', {
          providerId,
          coordinatorKey: movieKey,
          runToken,
          runId,
          requestId,
          reason: 'coordinator-awaiting-runMovieCatalogSync',
          syncInFlight: syncInFlight.has(providerId),
          promiseAwaitedByCoordinator: true,
        });
        return runMovieCatalogSync(input, runToken, movieKey, runId).finally(() => {
          logMovieSyncProbe('startProviderCatalogSync.movieRunner', {
            providerId,
            coordinatorKey: movieKey,
            runToken,
            runId,
            requestId,
            reason: 'runMovieCatalogSync-settled-wrapper-finally',
            syncInFlight: syncInFlight.has(providerId),
            promiseAwaitedByCoordinator: true,
            note: 'fires-on-fulfill-or-reject-does-not-distinguish',
          });
        });
      },
      { delayMs: movieCatalogScheduleDelayMs },
    ),
    scheduleCatalogSync(
      seriesKey,
      () => {
        logSyncLifecycle(providerId, 'provider-sync-starting', {
          requestId,
          runId,
          runToken,
          mediaType: 'series',
          coordinatorState: 'running',
          pendingRequestPresent: pendingSyncInputs.has(providerId),
        });
        return runSeriesCatalogSync(input, runToken, seriesKey, runId);
      },
      { delayMs: seriesCatalogScheduleDelayMs },
    ),
    scheduleCatalogSync(
      liveKey,
      () => {
        logSyncLifecycle(providerId, 'provider-sync-starting', {
          requestId,
          runId,
          runToken,
          mediaType: 'live',
          coordinatorState: 'running',
          pendingRequestPresent: pendingSyncInputs.has(providerId),
        });
        return runLiveCatalogSync(input, runToken, liveKey, runId);
      },
      { delayMs: liveCatalogScheduleDelayMs },
    ),
  ]).then((results) => {
    const [movieResult, seriesResult, liveResult] = results;
    const classified = classifyCatalogMediaJobResults(movieResult, seriesResult, liveResult);
    const settleFields = {
      providerId,
      runId,
      requestId,
      runToken,
      timestamp: Date.now(),
      movieStatus: classified.movieStatus,
      seriesStatus: classified.seriesStatus,
      liveStatus: classified.liveStatus,
      movieOk: classified.movieOk,
      seriesOk: classified.seriesOk,
      liveOk: classified.liveOk,
      movieError: classified.movieError,
      seriesError: classified.seriesError,
      liveError: classified.liveError,
      outcome: classified.outcome,
      bundleWillResolve: classified.outcome === 'ok',
    };
    logMoviePromiseProbe('allSettled-results', {
      ...settleFields,
      generation: null,
      sqliteEnabled: null,
      movieFinishCalled: null,
      movieFinishOutcome: null,
      returnReason: classified.movieError,
      abandonedOpenSqliteGeneration: false,
      note: 'allSettled-awaits-scheduleCatalogSync-promises-not-sqlite-finish',
    });
    logLivePromiseProbe('allSettled-results', {
      ...settleFields,
      returnReason: classified.liveError,
    });
    logSyncLifecycle(providerId, 'provider-sync-settled', {
      requestId,
      runId,
      runToken,
      movieOk: classified.movieOk,
      seriesOk: classified.seriesOk,
      liveOk: classified.liveOk,
      movieError: classified.movieError,
      seriesError: classified.seriesError,
      liveError: classified.liveError,
      movieStatus: classified.movieStatus,
      seriesStatus: classified.seriesStatus,
      liveStatus: classified.liveStatus,
      outcome: classified.outcome,
    });
    if (classified.outcome === 'ok') {
      return;
    }

    if (classified.abortMovieIndex) {
      try {
        getMovieCatalogIndex(providerId)?.abortSync();
      } catch {
        // Preserve browse state best-effort.
      }
    }
    if (classified.abortSeriesIndex) {
      try {
        getSeriesCatalogIndex(providerId)?.abortSync();
      } catch {
        // Preserve browse state best-effort.
      }
    }

    if (classified.notifyProviderError) {
      notifyPhase(providerId, 'error');
    }

    markCatalogAuditSync('failed', {
      providerId,
      error: classified.movieError ?? classified.seriesError ?? classified.liveError ?? 'catalog_sync_partial_failure',
      movieOk: classified.movieOk,
      seriesOk: classified.seriesOk,
      liveOk: classified.liveOk,
    });
    logSync(providerId, classified.outcome, {
      movieOk: classified.movieOk,
      seriesOk: classified.seriesOk,
      liveOk: classified.liveOk,
      movieError: classified.movieError,
      seriesError: classified.seriesError,
      liveError: classified.liveError,
      cachedDataPreserved: true,
      abortedSuccessfulSibling: false,
    });
    logSyncLifecycle(providerId, 'sync-run-rejected', {
      requestId,
      runId,
      runToken,
      movieOk: classified.movieOk,
      seriesOk: classified.seriesOk,
      liveOk: classified.liveOk,
      movieError: classified.movieError,
      seriesError: classified.seriesError,
      liveError: classified.liveError,
      movieStatus: classified.movieStatus,
      seriesStatus: classified.seriesStatus,
      liveStatus: classified.liveStatus,
    });
    throw firstSettledRejection(results);
  })
    .finally(() => {
      syncInFlight.delete(providerId);
      catalogSyncSetupCache.delete(catalogSyncSetupKey(providerId, runToken));
      const active = syncAuditRuns.get(providerId);
      logSyncLifecycle(providerId, 'sync-run-resolved', {
        requestId,
        runId,
        runToken,
        generationTokenState: runToken === syncGeneration ? 'current' : 'stale',
        pendingRequestPresent: pendingSyncInputs.has(providerId),
      });
      if (active?.runId === runId) {
        syncAuditRuns.delete(providerId);
      }
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
  logMoviePromiseProbe('provider-task-created', {
    providerId,
    runId,
    requestId,
    runToken,
    awaitedByBundle: true,
    movieDelayMs: movieCatalogScheduleDelayMs,
    seriesDelayMs: seriesCatalogScheduleDelayMs,
    liveDelayMs: liveCatalogScheduleDelayMs,
  });
  return task;
}

export function scheduleProviderCatalogSync(input: ProviderCatalogSyncInput) {
  const requestId = `request-${++syncAuditSequence}`;
  logSyncLifecycle(input.providerId, 'coordinator-enter', {
    requestId,
    requestSource: input.requestSource ?? 'unspecified',
    coordinatorState: syncInFlight.has(input.providerId) ? 'active' : 'idle',
    pendingRequestPresent: pendingSyncInputs.has(input.providerId),
  });
  markCatalogAuditSync('requested', { providerId: input.providerId });
  logSync(input.providerId, 'sync-requested', { requestId, requestSource: input.requestSource ?? 'unspecified' });

  const existing = syncInFlight.get(input.providerId);
  if (existing) {
    const active = syncAuditRuns.get(input.providerId);
    const duplicateActivation =
      input.requestSource === 'provider-bundle-activation' &&
      active?.source === 'provider-bundle-activation';
    // Duplicate provider activation requests attach to the existing bootstrap.
    // They must not become a second generation after the first run completes.
    if (!duplicateActivation) {
      // Keep the latest non-bootstrap request; resume once the in-flight job finishes.
      pendingSyncInputs.set(input.providerId, input);
    }
    logSyncLifecycle(input.providerId, 'sync-request-deduped', {
      requestId,
      requestSource: input.requestSource ?? 'unspecified',
      requestedWhileActive: true,
      dedupeAction: duplicateActivation ? 'attach-existing-bootstrap' : 'queue-latest-refresh',
      pendingRequestPresent: pendingSyncInputs.has(input.providerId),
    });
    logSyncLifecycle(input.providerId, 'coordinator-deduped', {
      requestId,
      requestSource: input.requestSource ?? 'unspecified',
      coordinatorState: 'active',
      pendingRequestPresent: pendingSyncInputs.has(input.providerId),
      duplicateActivation,
    });
    logLivePublicationTrace('live-publication-skipped', {
      providerId: input.providerId,
      requestSource: input.requestSource ?? null,
      skipReason: duplicateActivation
        ? 'sync-request-deduped-attach-existing-bootstrap'
        : 'sync-request-queued-behind-in-flight-movie-series-live',
    });
    return existing;
  }

  const runToken = syncGeneration;
  logSyncLifecycle(input.providerId, 'coordinator-queued', {
    requestId,
    requestSource: input.requestSource ?? 'unspecified',
    coordinatorState: 'queued',
    pendingRequestPresent: pendingSyncInputs.has(input.providerId),
    runToken,
  });
  return startProviderCatalogSync(input, runToken, requestId);
}

/** Stage 4.2D: force the next Movies sync onto full-dump-stream-category. */
export function forceMoviesFullDumpForProvider(providerId: string, reason: string) {
  forceMoviesFullDumpByProvider.set(providerId, reason);
}

/** Invalidate the completed checkpoint so sparse catalogs cannot skip repair. */
export async function invalidateMoviesCatalogSyncCheckpoint(providerId: string): Promise<void> {
  if (typeof AsyncStorage.removeItem !== 'function') {
    return;
  }
  await AsyncStorage.removeItem(catalogSyncCheckpointKey(providerId)).catch(() => undefined);
}

/**
 * Movies-only sparse repair: force full dump, invalidate checkpoint, reschedule sync.
 * Does not clear credentials, activation, Live TV, or Series data.
 */
export function scheduleMoviesCatalogRepair(input: {
  providerId: string;
  forceFullDump: boolean;
  reason: string;
  movies: MovieDataSource;
  series: ProviderSeriesRepository;
  live: ProviderLiveRepository;
  providerType?: string;
  displayName?: string;
}) {
  if (input.forceFullDump) {
    forceMoviesFullDumpForProvider(input.providerId, input.reason);
  }
  void invalidateMoviesCatalogSyncCheckpoint(input.providerId);
  return scheduleProviderCatalogSync({
    providerId: input.providerId,
    providerType: input.providerType,
    displayName: input.displayName,
    movies: input.movies,
    series: input.series,
    live: input.live,
  });
}

export function cancelProviderCatalogSync(
  providerId?: string,
  meta?: { cancelSource?: string; cancelCaller?: string },
) {
  const cancelSource = meta?.cancelSource ?? 'sync-lifecycle-cleanup';
  const cancelCaller = meta?.cancelCaller ?? 'cancelProviderCatalogSync';
  noteSeriesCancelRequested({
    providerId: providerId ?? null,
    cancelSource,
    cancelCaller,
    abortReason: 'provider-catalog-sync-cancelled',
    catalogRequestSource: null,
    coordinatorEpoch: syncGeneration + 1,
  });
  if (providerId) {
    logSyncLifecycle(providerId, 'sync-run-cancelled', {
      reason: 'provider-catalog-sync-cancelled',
      cancelSource,
      cancelCaller,
      syncGenerationBefore: syncGeneration,
    });
  }
  syncGeneration += 1;
  if (providerId) {
    for (const [key, latch] of pendingSeriesRetryLatches) {
      if (latch.providerId === providerId) {
        if (latch.timer) clearTimeout(latch.timer);
        pendingSeriesRetryLatches.delete(key);
        logSeriesRetryEvent('series-retry-stale-discarded', latch, {
          reason: 'provider-generation-cancelled',
        });
      }
    }
    pendingSyncInputs.delete(providerId);
    invalidateCatalogSyncForProvider(providerId, { cancelSource, cancelCaller });
  } else {
    for (const [key, latch] of pendingSeriesRetryLatches) {
      if (latch.timer) clearTimeout(latch.timer);
      pendingSeriesRetryLatches.delete(key);
    }
    pendingSyncInputs.clear();
    cancelCatalogSync(undefined, undefined, { cancelSource, cancelCaller });
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
  pendingSeriesRetryLatches.clear();
  moviesCriticalWindowLogged.clear();
  syncInFlight.clear();
  syncAuditRuns.clear();
  syncAuditSequence = 0;
  pendingSyncInputs.clear();
  syncListeners.clear();
  catalogSyncSetupCache.clear();
  mediaJobCompletion.clear();
  forceMoviesFullDumpByProvider.clear();
  checkpointWriteChain = Promise.resolve();
  syncGeneration = 0;
  lastReleasedBatchLabel = null;
  movieCatalogScheduleDelayMs = 0;
  seriesCatalogScheduleDelayMs = 0;
  liveCatalogScheduleDelayMs = 0;
  lastCheckpointWriteAt = 0;
  clearCatalogSyncCoordinatorForTests();
  resetProviderCatalogNetworkGateForTests();
}

export function getForceMoviesFullDumpReasonForTests(providerId: string) {
  return forceMoviesFullDumpByProvider.get(providerId) ?? null;
}

export function setCatalogSyncShellDelaysForTests(delays: {
  movieMs?: number;
  seriesMs?: number;
  liveMs?: number;
}) {
  if (typeof delays.movieMs === 'number') {
    movieCatalogScheduleDelayMs = delays.movieMs;
  }
  if (typeof delays.seriesMs === 'number') {
    seriesCatalogScheduleDelayMs = delays.seriesMs;
  }
  if (typeof delays.liveMs === 'number') {
    liveCatalogScheduleDelayMs = delays.liveMs;
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
