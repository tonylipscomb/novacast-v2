import type { MovieSummary } from '../movies/movieTypes.ts';
import type { SeriesSummary } from '../media-browser/mediaTypes.ts';
import { parseRatingNumber } from '../movies/smart/movieMetadata.ts';
import type { NativeCatalogRecord } from './nativeCatalogDecodeTypes.ts';
import { initializeCatalogDatabase } from './catalogDatabase.ts';
import {
  processStreamingBatches,
  type ChunkWorkKind,
  type TimeBudgetResult,
} from './jsChunkBudget.ts';
import {
  beginCatalogSync,
  completeCatalogSync,
  failCatalogSync,
  getCatalogGenerationLargestCategory,
  getCatalogGenerationPhysicalStats,
  getMovieActivationBaseline,
  getCatalogSyncState,
  resolveReadableCatalogGeneration,
  upsertCatalogProvider,
  writeCatalogCategoriesBatch,
  writeCatalogItemsBatch,
  type CatalogCompletionStatsSnapshot,
} from './catalogRepository.ts';
import { isUsableReleaseDate, parseCatalogReleaseYear } from './catalogSortOrder.ts';
import type { CatalogCategoryRecord, CatalogItemRecord, CatalogMediaType } from './catalogTypes.ts';
import { earlyBootTimed } from '../diagnostics/earlyBootAudit.ts';
import { recordCatalogWritePhase, timedCatalogWritePhase } from './catalogWritePhaseAudit.ts';
import {
  beginCatalogWriteQuietPeriod,
  endCatalogWriteQuietPeriod,
} from './catalogWriteQuietPeriod.ts';
import { validateMoviesCategoryDistribution } from './moviesCategoryDistributionValidation.ts';
import { resolveCatalogItemCategoryId } from './vodCategoryFilterCapability.ts';
import { isCatalogGuidePriorityActive, waitUntilCatalogGuidePriorityIdle } from '../providers/catalogSyncGuidePriority.ts';

const PERF_LOG_PREFIX = '[NovaCast CatalogSqlite]';

function logMovieCompletionTailAudit(input: Record<string, unknown>) {
  console.info('[NovaCast Movie Completion Tail Audit]', input);
}

function logMovieCompletionTailSummary(input: Record<string, unknown>) {
  console.info('[NovaCast Movie Completion Tail Summary]', input);
}

async function waitForGuideBeforeCatalogWrite(providerId: string, mediaType: CatalogMediaType) {
  if (!isCatalogGuidePriorityActive()) {
    return;
  }

  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    console.info('[Catalog Writer Guide]', {
      event: 'batch-yielded-for-guide',
      providerId,
      mediaType,
    });
  }

  await waitUntilCatalogGuidePriorityIdle();

  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    console.info('[Catalog Writer Guide]', {
      event: 'batch-resumed-after-guide',
      providerId,
      mediaType,
    });
  }
}

export type CatalogSqliteMediaSyncHandle = {
  enabled: boolean;
  providerId: string;
  mediaType: CatalogMediaType;
  generation: number;
  runId?: string;
  accounting: CatalogSqliteWriterAccounting;
  pendingCategories: CatalogCategoryInput[];
};

export type CatalogSqliteWriterAccounting = {
  decodedCount: number;
  normalizedCount: number;
  queuedCount: number;
  committedCount: number;
  duplicateCount: number;
  pendingWriteCount: number;
  peakBatchMs: number;
  pressurePauseCount: number;
  nativeDone: boolean;
  writerDrained: boolean;
  processedCategoryCount: number;
  successfulCategoryCount: number;
  failedCategoryCount: number;
  emptyCategoryCount: number;
  checkpointCategoryIndex: number;
};

function createWriterAccounting(): CatalogSqliteWriterAccounting {
  return {
    decodedCount: 0,
    normalizedCount: 0,
    queuedCount: 0,
    committedCount: 0,
    duplicateCount: 0,
    pendingWriteCount: 0,
    peakBatchMs: 0,
    pressurePauseCount: 0,
    nativeDone: false,
    writerDrained: true,
    processedCategoryCount: 0,
    successfulCategoryCount: 0,
    failedCategoryCount: 0,
    emptyCategoryCount: 0,
    checkpointCategoryIndex: 0,
  };
}

export function recordCatalogSqliteCategoryResult(
  handle: CatalogSqliteMediaSyncHandle,
  result: { itemCount: number; failed?: boolean },
) {
  if (!handle.enabled) return;
  handle.accounting.processedCategoryCount += 1;
  if (result.failed) {
    handle.accounting.failedCategoryCount += 1;
  } else if (result.itemCount > 0) {
    handle.accounting.successfulCategoryCount += 1;
  } else {
    handle.accounting.emptyCategoryCount += 1;
  }
}

export function recordCatalogSqliteCheckpoint(
  handle: CatalogSqliteMediaSyncHandle,
  categoryIndex: number,
) {
  if (handle.enabled) {
    handle.accounting.checkpointCategoryIndex = Math.max(
      handle.accounting.checkpointCategoryIndex,
      categoryIndex,
    );
  }
}

export function createDisabledCatalogSqliteMediaSyncHandle(
  providerId: string,
  mediaType: CatalogMediaType,
): CatalogSqliteMediaSyncHandle {
  return {
    enabled: false,
    providerId,
    mediaType,
    generation: 0,
    accounting: createWriterAccounting(),
    pendingCategories: [],
  };
}

export function recordCatalogSqliteDecoded(
  handle: CatalogSqliteMediaSyncHandle,
  count: number,
) {
  if (handle.enabled && count > 0) {
    handle.accounting.decodedCount += count;
  }
}

export async function waitForCatalogSqliteWriterDrain(
  handle: CatalogSqliteMediaSyncHandle,
): Promise<void> {
  while (handle.accounting.pendingWriteCount > 0) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  handle.accounting.writerDrained = true;
}

type CatalogItemInput = Omit<CatalogItemRecord, 'normalizedTitle' | 'updatedAt'>;
type CatalogCategoryInput = Omit<CatalogCategoryRecord, 'itemCount' | 'updatedAt'>;

/** Series category writes wait until Movies finishes category upserts for the same provider. */
type MovieCategoryWriteGate = {
  promise: Promise<void>;
  resolve: () => void;
  open: boolean;
  generation: number;
  runId?: string;
};

const movieCategoryWriteGates = new Map<string, MovieCategoryWriteGate>();

function ensureGate(
  map: Map<string, MovieCategoryWriteGate>,
  providerId: string,
  generation: number,
  runId?: string,
) {
  const existing = map.get(providerId);
  if (existing && !existing.open) {
    return existing;
  }
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  const gate = { promise, resolve, open: false, generation, runId };
  map.set(providerId, gate);
  logSqlite('gate-created', {
    providerId,
    generation,
    runId: runId ?? null,
    mediaType: 'movie',
    writeType: 'category',
    gateName: 'movie-category',
    reason: existing ? 'previous-gate-open' : 'new-provider-gate',
  });
  return gate;
}

function releaseGate(
  map: Map<string, MovieCategoryWriteGate>,
  providerId: string,
  generation: number,
  reason: string,
) {
  const gate = map.get(providerId);
  if (!gate || gate.open || gate.generation !== generation) {
    return;
  }
  gate.open = true;
  gate.resolve();
  logSqlite('gate-resolved', {
    providerId,
    generation,
    runId: gate.runId ?? null,
    mediaType: 'movie',
    writeType: 'category',
    gateName: 'movie-category',
    reason,
  });
}

function ensureMovieCategoryGate(providerId: string, generation: number, runId?: string) {
  return ensureGate(movieCategoryWriteGates, providerId, generation, runId);
}

function releaseMovieCategoryGate(providerId: string, generation: number, reason: string) {
  releaseGate(movieCategoryWriteGates, providerId, generation, reason);
}

export function clearCatalogSqliteWriterGatesForTests() {
  for (const gate of movieCategoryWriteGates.values()) {
    if (!gate.open) {
      gate.open = true;
      gate.resolve();
    }
  }
  movieCategoryWriteGates.clear();
}

function logSqlite(message: string, payload: Record<string, unknown> = {}) {
  console.info(PERF_LOG_PREFIX, { message, ...payload });
}

function logSqliteError(message: string, error: unknown, payload: Record<string, unknown> = {}) {
  const errorMessage = error instanceof Error ? error.message : String(error);
  console.error(PERF_LOG_PREFIX, { message, error: errorMessage, ...payload });
}

function parseOptionalPositiveNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

function parseReleaseYear(value: string | number | null | undefined): number | null {
  return parseCatalogReleaseYear(value);
}

export function mapMovieSummaryToCatalogItem(
  movie: MovieSummary,
  providerId: string,
  generation: number,
): CatalogItemInput {
  return {
    providerId,
    mediaType: 'movie',
    contentId: movie.id,
    categoryId: movie.categoryId,
    title: movie.title,
    artworkUrl: movie.posterUrl ?? null,
    releaseDate: isUsableReleaseDate(movie.releaseDate != null ? String(movie.releaseDate) : null)
      ? String(movie.releaseDate)
      : null,
    releaseYear: movie.year ?? parseReleaseYear(movie.releaseDate),
    rating: parseRatingNumber(movie.rating),
    addedAt: parseOptionalPositiveNumber(movie.addedAt),
    popularity: parseOptionalPositiveNumber(movie.popularity),
    description: movie.description ?? null,
    streamExtension: movie.containerExtension ?? null,
    providerSortOrder: movie.providerSortOrder ?? null,
    syncGeneration: generation,
  };
}

/** Direct native→SQLite map for writer-only diagnostic (avoids MovieSummary remapping). */
export function mapNativeRecordToCatalogItem(
  record: NativeCatalogRecord,
  providerId: string,
  mediaType: CatalogMediaType,
  fallbackCategoryId: string,
  generation: number,
  options?: { allowCategoryFallback?: boolean },
): CatalogItemInput {
  const contentId =
    mediaType === 'series' ? record.seriesId || record.contentId : record.contentId;
  return {
    providerId,
    mediaType,
    contentId,
    categoryId: resolveCatalogItemCategoryId(record.categoryId, fallbackCategoryId, {
      allowFallback: options?.allowCategoryFallback !== false,
    }),
    title: record.title,
    artworkUrl: record.artworkUrl ?? null,
    backdropUrl: record.backdropUrl ?? null,
    releaseDate: isUsableReleaseDate(record.releaseDate) ? String(record.releaseDate) : null,
    releaseYear: parseReleaseYear(record.releaseYear ?? record.releaseDate),
    rating: typeof record.rating === 'number' ? record.rating : parseRatingNumber(record.rating ?? undefined),
    addedAt: parseOptionalPositiveNumber(record.addedAt),
    popularity: parseOptionalPositiveNumber(record.popularity),
    description: null,
    streamExtension: record.streamExtension ?? null,
    seriesId: mediaType === 'series' ? contentId : null,
    providerSortOrder: record.providerSortOrder ?? null,
    syncGeneration: generation,
  };
}

export function mapSeriesSummaryToCatalogItem(
  series: SeriesSummary,
  providerId: string,
  generation: number,
  providerSortOrder?: number | null,
): CatalogItemInput {
  return {
    providerId,
    mediaType: 'series',
    contentId: series.id,
    categoryId: series.categoryId,
    title: series.title,
    artworkUrl: series.posterUrl ?? null,
    backdropUrl: series.backdropUrl ?? null,
    releaseDate: isUsableReleaseDate(series.releaseDate != null ? String(series.releaseDate) : null)
      ? String(series.releaseDate)
      : null,
    releaseYear: parseReleaseYear(series.year ?? series.releaseDate),
    rating: parseRatingNumber(series.rating),
    addedAt: parseOptionalPositiveNumber(series.addedAt),
    popularity: parseOptionalPositiveNumber(series.popularity),
    description: series.description ?? null,
    seriesId: series.seriesId,
    providerSortOrder: providerSortOrder ?? null,
    syncGeneration: generation,
  };
}

export async function startCatalogSqliteMediaSync(input: {
  providerId: string;
  mediaType: CatalogMediaType;
  providerType: string;
  displayName?: string | null;
  runId?: string;
}): Promise<CatalogSqliteMediaSyncHandle> {
  let generation: number | null = null;
  try {
    await earlyBootTimed('sqlite.initializeCatalogDatabase', () => initializeCatalogDatabase());
    await earlyBootTimed('sqlite.upsertCatalogProvider', () =>
      upsertCatalogProvider({
        providerId: input.providerId,
        providerType: input.providerType,
        displayName: input.displayName ?? null,
      }),
    );
    logSqlite('beginCatalogSync-enter', {
      providerId: input.providerId,
      mediaType: input.mediaType,
      runId: input.runId,
      currentAttemptGeneration: null,
      currentStatus: null,
    });
    generation = await earlyBootTimed('sqlite.beginCatalogSync', () =>
      beginCatalogSync(input.providerId, input.mediaType, {
        phase: 'categories',
      }),
    );
    logSqlite('beginCatalogSync-complete', {
      providerId: input.providerId,
      mediaType: input.mediaType,
      generation,
      runId: input.runId,
    });
    if (input.mediaType === 'movie') {
      ensureMovieCategoryGate(input.providerId, generation, input.runId);
      beginCatalogWriteQuietPeriod(25_000);
    } else if (input.mediaType === 'series') {
      beginCatalogWriteQuietPeriod(25_000);
    }
    recordCatalogWritePhase('sqlite.beginCatalogSync', {
      wallMs: 0,
      itemCount: 1,
      meta: { providerId: input.providerId, mediaType: input.mediaType, generation },
    });
    logSqlite('sqlite-sync-started', {
      providerId: input.providerId,
      mediaType: input.mediaType,
      generation,
      runId: input.runId,
      marker:
        input.mediaType === 'movie'
          ? 'stage3b1-onn-writer-pressure-v1'
          : 'stage295-native-completion-v1',
    });
    return {
      enabled: true,
      providerId: input.providerId,
      mediaType: input.mediaType,
      generation,
      runId: input.runId,
      accounting: createWriterAccounting(),
      pendingCategories: [],
    };
  } catch (error) {
    if (input.mediaType === 'movie' && generation !== null) {
      releaseMovieCategoryGate(input.providerId, generation, 'media-sync-start-failed');
    }
    logSqliteError('sqlite-sync-start-failed', error, {
      providerId: input.providerId,
      mediaType: input.mediaType,
    });
    return {
      enabled: false,
      providerId: input.providerId,
      mediaType: input.mediaType,
      generation: 0,
      runId: input.runId,
      accounting: createWriterAccounting(),
      pendingCategories: [],
    };
  }
}

/**
 * Stream categories: bounded normalize → write → release → macrotask yield.
 * Never builds a second full-size mapped array beyond the caller source list.
 */
export async function writeCategoriesFromSourceBudgeted<T>(
  handle: CatalogSqliteMediaSyncHandle,
  categories: readonly T[],
  mapCategory: (category: T, index: number) => CatalogCategoryInput,
  options?: { isCancelled?: () => boolean },
): Promise<number> {
  if (!handle.enabled || !categories.length) {
    if (handle.enabled && handle.mediaType === 'movie') {
      releaseMovieCategoryGate(handle.providerId, handle.generation, 'empty-category-source');
    }
    return 0;
  }

  // Stage 4 / 4.2A: stage pendingCategories for the atomic ready transition,
  // then stream category rows for sync progress. Movies UI must not treat
  // these as a usable rail until the item generation is readable/active.
  if (handle.mediaType === 'movie') {
    handle.pendingCategories = categories.map(mapCategory);
  }

  try {
    if (handle.mediaType === 'series') {
      const gate = movieCategoryWriteGates.get(handle.providerId);
      if (gate && !gate.open) {
        const gateWaitStarted = Date.now();
        logSqlite('sqlite-categories-await-movie-gate', {
          providerId: handle.providerId,
          mediaType: handle.mediaType,
          writeType: 'category',
          generation: handle.generation,
          runId: handle.runId ?? null,
          gateBeingWaitedOn: 'movie-category',
          elapsedMs: 0,
          event: 'gate-wait-start',
        });
        await gate.promise;
        logSqlite('sqlite-categories-resumed-after-movie-gate', {
          providerId: handle.providerId,
          mediaType: handle.mediaType,
          writeType: 'category',
          generation: handle.generation,
          runId: handle.runId ?? null,
          gateBeingWaitedOn: 'movie-category',
          elapsedMs: Date.now() - gateWaitStarted,
          event: 'gate-wait-end',
        });
      }
    }

    beginCatalogWriteQuietPeriod(20_000);
    let written = 0;
    await timedCatalogWritePhase(
      'category.normalize',
      async () => {
        const result = await processStreamingBatches(
          categories,
          (category, index) => mapCategory(category, index),
          async (batch) => {
            written += await writeCatalogCategoriesBatch(batch, {
              mediaType: handle.mediaType,
            });
          },
          {
            kind: 'categories',
            writeKind: 'categories',
            minItems: 4,
            maxItems: 12,
            isCancelled: options?.isCancelled,
            beforeFlush: () => waitForGuideBeforeCatalogWrite(handle.providerId, handle.mediaType),
          },
        );
        logSqlite('sqlite-categories-streamed', {
          providerId: handle.providerId,
          mediaType: handle.mediaType,
          generation: handle.generation,
          written,
          chunks: result.chunks,
          maxChunkMs: Math.round(result.maxChunkMs),
          totalMs: Math.round(result.totalMs),
        });
      },
      { itemCount: categories.length },
    );
    return written;
  } catch (error) {
    logSqliteError('sqlite-categories-write-failed', error, {
      providerId: handle.providerId,
      mediaType: handle.mediaType,
      generation: handle.generation,
    });
    return 0;
  } finally {
    endCatalogWriteQuietPeriod();
    if (handle.mediaType === 'movie') {
      releaseMovieCategoryGate(handle.providerId, handle.generation, 'category-write-finally');
    }
  }
}

/** @deprecated Prefer writeCategoriesFromSourceBudgeted to avoid full pre-map arrays. */
export async function writeCategoriesBudgeted(
  handle: CatalogSqliteMediaSyncHandle,
  categories: CatalogCategoryInput[],
  options?: { isCancelled?: () => boolean },
): Promise<number> {
  return writeCategoriesFromSourceBudgeted(handle, categories, (category) => category, options);
}

/**
 * Stream items: bounded map → write → release refs → yield.
 * No full-size mapped array / SQL parameter array.
 */
export async function writeCatalogItemsFromSourceBudgeted<T>(
  handle: CatalogSqliteMediaSyncHandle,
  items: readonly T[],
  mapItem: (item: T, index: number) => CatalogItemInput,
  options?: {
    isCancelled?: () => boolean;
    mapKind?: ChunkWorkKind;
  },
): Promise<{ written: number; timing: TimeBudgetResult | null }> {
  if (!handle.enabled || !items.length) {
    return { written: 0, timing: null };
  }

  handle.accounting.pendingWriteCount += 1;
  handle.accounting.writerDrained = false;
  try {
    let written = 0;
    const timing = await processStreamingBatches(
      items,
      async (item, index) => {
        const mapped = await mapItem(item, index);
        handle.accounting.normalizedCount += 1;
        handle.accounting.queuedCount += 1;
        return mapped;
      },
      async (batch) => {
        const batchWritten = await writeCatalogItemsBatch(batch);
        written += batchWritten;
      },
      {
        kind: options?.mapKind ?? (handle.mediaType === 'movie' ? 'movieMapping' : 'itemWrites'),
        writeKind: handle.mediaType === 'movie' ? 'movieItemWrites' : 'itemWrites',
        minItems: handle.mediaType === 'movie' ? 8 : 4,
        maxItems: handle.mediaType === 'movie' ? 12 : 24,
        hardMs: handle.mediaType === 'movie' ? 100 : undefined,
        pressureMode: handle.mediaType === 'movie',
        diagnostic: true,
        isCancelled: options?.isCancelled,
        beforeFlush: () => waitForGuideBeforeCatalogWrite(handle.providerId, handle.mediaType),
        onChunk: (info) => {
          if (
            handle.mediaType === 'movie' &&
            (info.chunkMs >= 75 || (info.eventLoopLagMs ?? 0) >= 250)
          ) {
            console.info('[Catalog Writer Pressure]', {
              mediaType: handle.mediaType,
              generation: handle.generation,
              batchSize: info.chunkItems,
              transactionMs: Math.round(info.chunkMs),
              eventLoopLagMs: Math.round(info.eventLoopLagMs ?? 0),
              nextBatchSize: info.batchSize,
              pauseMs: info.pauseMs ?? 0,
            });
          }
        },
      },
    );
    handle.accounting.peakBatchMs = Math.max(handle.accounting.peakBatchMs, timing.peakBatchMs);
    handle.accounting.pressurePauseCount += timing.pressurePauseCount;
    logSqlite('sqlite-items-streamed', {
      providerId: handle.providerId,
      mediaType: handle.mediaType,
      generation: handle.generation,
      written,
      chunks: timing.chunks,
      maxChunkMs: Math.round(timing.maxChunkMs),
      totalMs: Math.round(timing.totalMs),
      overruns: timing.overruns,
    });
    return { written, timing };
  } catch (error) {
    logSqliteError('sqlite-items-write-failed', error, {
      providerId: handle.providerId,
      mediaType: handle.mediaType,
      generation: handle.generation,
      itemCount: items.length,
    });
    return { written: 0, timing: null };
  } finally {
    handle.accounting.pendingWriteCount = Math.max(0, handle.accounting.pendingWriteCount - 1);
    handle.accounting.writerDrained = handle.accounting.pendingWriteCount === 0;
  }
}

/** @deprecated Prefer writeCatalogItemsFromSourceBudgeted. */
export async function writeCatalogItemsBudgeted(
  handle: CatalogSqliteMediaSyncHandle,
  items: CatalogItemInput[],
  options?: { isCancelled?: () => boolean },
): Promise<number> {
  const result = await writeCatalogItemsFromSourceBudgeted(handle, items, (item) => item, options);
  return result.written;
}

export async function finishCatalogSqliteMediaSync(input: {
  handle: CatalogSqliteMediaSyncHandle;
  ok: boolean;
  processedCount?: number;
  errorCode?: string;
  nativeDone?: boolean;
}): Promise<boolean> {
  const { handle, ok, processedCount, errorCode } = input;
  if (!handle.enabled) {
    return true;
  }

  try {
    if (ok) {
      if (handle.mediaType === 'movie') {
        handle.accounting.nativeDone = input.nativeDone === true;
        await waitForCatalogSqliteWriterDrain(handle);
        const completionTailStarted = Date.now();
        let barrierStatsMs = 0;
        let recoveryMs = 0;
        let physicalStatsMs = 0;
        let distributionValidationMs = 0;
        let previousGenerationStatsMs = 0;
        let pointerPromotionMs = 0;
        const itemStatsStarted = Date.now();
        const itemStats = await getCatalogGenerationPhysicalStats(
          handle.providerId,
          handle.mediaType,
          handle.generation,
        );
        console.info('[NovaCast Movie Completion Phase]', {
          phase: 'get-generation-item-stats',
          generation: handle.generation,
          durationMs: Date.now() - itemStatsStarted,
        });
        barrierStatsMs = Date.now() - itemStatsStarted;
        logMovieCompletionTailAudit({
          phase: 'barrier-stats',
          generation: handle.generation,
          connection: 'catalog-primary',
          queryType: 'aggregate-read',
          querySignature: 'completion-snapshot-item-stats',
          callCount: 1,
          durationMs: Date.now() - itemStatsStarted,
          reusedCachedResult: false,
          currentGeneration: handle.generation,
        });
        const completionStats: CatalogCompletionStatsSnapshot = {
          providerId: handle.providerId,
          mediaType: 'movie',
          generation: handle.generation,
          itemRows: itemStats.itemRows,
          distinctContentIds: itemStats.distinctContentIds,
          distinctItemCategoryIds: itemStats.distinctItemCategoryIds,
          categoryRows: itemStats.categoryRows,
        };
        console.info('[NovaCast Movie Completion Stats Reuse]', {
          generation: handle.generation,
          snapshotCreated: true,
          sourcePhase: 'writer-drain-completion-barrier',
          itemRows: completionStats.itemRows,
          distinctContentIds: completionStats.distinctContentIds,
          distinctItemCategoryIds: completionStats.distinctItemCategoryIds,
          categoryRows: completionStats.categoryRows,
          reusedItemStats: false,
          refreshedCategoryRows: false,
          invalidated: false,
          invalidationReason: null,
          avoidedAggregateQuery: false,
          estimatedRowsAvoided: 0,
        });
        const dbRowCount = completionStats.itemRows;
        handle.accounting.committedCount = completionStats.distinctContentIds;
        const barrierPassed =
          handle.accounting.nativeDone &&
          handle.accounting.pendingWriteCount === 0 &&
          handle.accounting.writerDrained &&
          handle.accounting.committedCount > 0 &&
          dbRowCount === handle.accounting.committedCount;

        const barrierFailureReason = !handle.accounting.nativeDone
          ? 'native-not-done'
          : handle.accounting.pendingWriteCount !== 0
            ? 'pending-writes'
            : !handle.accounting.writerDrained
              ? 'writer-not-drained'
              : handle.accounting.committedCount <= 0
                ? 'no-committed-content'
                : dbRowCount !== handle.accounting.committedCount
                  ? 'db-row-count-mismatch'
                  : null;

        console.info('[NovaCast Movie Completion Audit]', {
          generation: handle.generation,
          expectedCategoryCount: handle.pendingCategories.length,
          processedCategoryCount: handle.accounting.processedCategoryCount,
          successfulCategoryCount: handle.accounting.successfulCategoryCount,
          failedCategoryCount: handle.accounting.failedCategoryCount,
          emptyCategoryCount: handle.accounting.emptyCategoryCount,
          writtenItemCount: dbRowCount,
          distinctWrittenItemCount: handle.accounting.committedCount,
          checkpointCategoryIndex: handle.accounting.checkpointCategoryIndex,
          completionCandidate: barrierPassed,
          completionBarrierPassed: barrierPassed,
          barrierFailureReason,
          actual: {
            decodedCount: handle.accounting.decodedCount,
            normalizedCount: handle.accounting.normalizedCount,
            queuedCount: handle.accounting.queuedCount,
            pendingWriteCount: handle.accounting.pendingWriteCount,
            nativeDone: handle.accounting.nativeDone,
            writerDrained: handle.accounting.writerDrained,
            dbRowCount,
            committedCount: handle.accounting.committedCount,
          },
        });

        console.info('[Catalog Completion Barrier]', {
          providerId: handle.providerId,
          generation: handle.generation,
          decodedCount: handle.accounting.decodedCount,
          committedCount: handle.accounting.committedCount,
          dbRowCount,
          pendingWriteCount: handle.accounting.pendingWriteCount,
          peakBatchMs: Math.round(handle.accounting.peakBatchMs),
          pressurePauseCount: handle.accounting.pressurePauseCount,
          nativeDone: handle.accounting.nativeDone,
          writerDrained: handle.accounting.writerDrained,
        });

        if (!barrierPassed) {
          await failCatalogSync(handle.providerId, handle.mediaType, 'completion_barrier_failed');
          return false;
        }

        const recoveryStarted = Date.now();
        const readableGeneration = await resolveReadableCatalogGeneration(
          handle.providerId,
          handle.mediaType,
        ).catch(() => 0);
        logMovieCompletionTailAudit({
          phase: 'readable-recovery-before-validation',
          generation: handle.generation,
          connection: 'catalog-read',
          queryType: 'recovery-assessment',
          querySignature: 'resolve-readable-generation',
          callCount: 1,
          durationMs: Date.now() - recoveryStarted,
          reusedCachedResult: false,
          fallbackScanPerformed: null,
          currentGeneration: handle.generation,
          readableGeneration,
        });
        recoveryMs = Date.now() - recoveryStarted;
        const syncState = await getCatalogSyncState(handle.providerId, handle.mediaType).catch(() => null);
        console.info('[NovaCast Movie Completion Audit]', {
          generation: handle.generation,
          currentGeneration: handle.generation,
          readableGeneration,
          expectedCategoryTotal: handle.pendingCategories.length,
          completedCategoryTotal: handle.accounting.processedCategoryCount,
          writtenRows: dbRowCount,
          failedCategories: handle.accounting.failedCategoryCount,
          staleGeneration: readableGeneration > 0 && readableGeneration !== handle.generation,
          completionState: syncState?.status ?? 'unknown',
          event: 'before-generation-promotion',
        });

        // Stage 3C.2 / 4.2D: reject collapsed/sparse category distributions before activation.
        let physical: {
          itemRows: number;
          distinctContentIds: number;
          categoryRows: number;
          distinctItemCategoryIds: number;
        };
        const snapshotValidationStarted = Date.now();
        const snapshotStillValid =
          completionStats.providerId === handle.providerId &&
          completionStats.mediaType === 'movie' &&
          completionStats.generation === handle.generation &&
          handle.accounting.nativeDone === true &&
          handle.accounting.writerDrained === true &&
          handle.accounting.pendingWriteCount === 0 &&
          handle.accounting.decodedCount === completionStats.itemRows &&
          handle.accounting.queuedCount === completionStats.itemRows;
        const snapshotValidationMs = Date.now() - snapshotValidationStarted;
        const physicalStarted = Date.now();
        if (snapshotStillValid) {
          // No category-table mutation occurs between the writer-drain barrier
          // snapshot and this preparation read. Category metadata is refreshed
          // later during activation after category upsert/recompute.
          const categoryRows = completionStats.categoryRows;
          physical = {
            itemRows: completionStats.itemRows,
            distinctContentIds: completionStats.distinctContentIds,
            categoryRows,
            distinctItemCategoryIds: completionStats.distinctItemCategoryIds,
          };
          console.info('[NovaCast Movie Completion Stats Reuse]', {
            generation: handle.generation,
            snapshotCreated: true,
            sourcePhase: 'writer-drain-completion-barrier',
            consumerPhase: 'completion-preparation',
            itemRows: completionStats.itemRows,
            distinctContentIds: completionStats.distinctContentIds,
            distinctItemCategoryIds: completionStats.distinctItemCategoryIds,
            categoryRows,
            reusedItemStats: true,
            reusedCategoryRows: true,
            refreshedCategoryRows: false,
            invalidated: false,
            invalidationReason: null,
            avoidedAggregateQuery: true,
            estimatedRowsAvoided: completionStats.itemRows,
            avoidedCategoryRowCountQuery: true,
          });
          console.info('[NovaCast Movie Completion Stats Reuse Timing]', {
            generation: handle.generation,
            consumerPhase: 'completion-preparation',
            snapshotValidationMs,
            generationStateLookupMs: 0,
            categoryRowCountQueueWaitMs: 0,
            categoryRowCountSqlMs: 0,
            categoryRowCountTotalMs: 0,
            connectionAcquireMs: 0,
            transactionMs: 0,
            otherMs: Math.max(0, Date.now() - physicalStarted - snapshotValidationMs),
            totalMs: Date.now() - physicalStarted,
            categoryRows,
            reusedItemStats: true,
            reusedCategoryRows: true,
            avoidedAggregateQuery: true,
            avoidedCategoryRowCountQuery: true,
          });
        } else {
          physical = await getCatalogGenerationPhysicalStats(
            handle.providerId,
            handle.mediaType,
            handle.generation,
          );
          console.info('[NovaCast Movie Completion Stats Reuse]', {
            generation: handle.generation,
            snapshotCreated: true,
            sourcePhase: 'writer-drain-completion-barrier',
            consumerPhase: 'completion-preparation',
            itemRows: physical.itemRows,
            distinctContentIds: physical.distinctContentIds,
            distinctItemCategoryIds: physical.distinctItemCategoryIds,
            categoryRows: physical.categoryRows,
            reusedItemStats: false,
            refreshedCategoryRows: false,
            invalidated: true,
            invalidationReason: 'completion-accounting-changed',
            avoidedAggregateQuery: false,
            estimatedRowsAvoided: 0,
          });
        }
        console.info('[NovaCast Movie Completion Phase]', {
          phase: 'completion-preparation-physical-stats',
          generation: handle.generation,
          durationMs: Date.now() - physicalStarted,
        });
        logMovieCompletionTailAudit({
          phase: 'completion-preparation-physical-stats',
          generation: handle.generation,
          connection: 'catalog-primary',
          queryType: snapshotStillValid ? 'completion-snapshot-reuse' : 'aggregate-read-fallback',
          querySignature: snapshotStillValid
            ? 'completion-snapshot-item-stats+category-rows'
            : 'active-generation-physical-stats',
          callCount: snapshotStillValid ? 1 : 2,
          durationMs: Date.now() - physicalStarted,
          reusedCachedResult: snapshotStillValid,
          avoidedAggregateQuery: snapshotStillValid
            ? 'item-count-distinct-content-distinct-category'
            : false,
          avoidedCategoryRowCountQuery: snapshotStillValid,
          currentGeneration: handle.generation,
        });
        physicalStatsMs = Date.now() - physicalStarted;
        const largestStarted = Date.now();
        const largest = await getCatalogGenerationLargestCategory(
          handle.providerId,
          handle.mediaType,
          handle.generation,
          undefined,
          'completion-preparation',
        );
        console.info('[NovaCast Movie Completion Phase]', {
          phase: 'completion-preparation-largest-category',
          generation: handle.generation,
          durationMs: Date.now() - largestStarted,
        });
        const secondRecoveryStarted = Date.now();
        const previousReadable = await resolveReadableCatalogGeneration(
          handle.providerId,
          handle.mediaType,
        ).catch(() => 0);
        logMovieCompletionTailAudit({
          phase: 'readable-recovery-before-promotion-validation',
          generation: handle.generation,
          connection: 'catalog-read',
          queryType: 'recovery-assessment',
          querySignature: 'resolve-readable-generation',
          callCount: 1,
          durationMs: Date.now() - secondRecoveryStarted,
          reusedCachedResult: false,
          fallbackScanPerformed: null,
          currentGeneration: handle.generation,
          readableGeneration: previousReadable,
        });
        let previousTotalItems: number | null = null;
        let previousNonzeroCategoryCount: number | null = null;
        if (previousReadable > 0 && previousReadable !== handle.generation) {
          const previousGenerationStarted = Date.now();
          let baselineLookupMs = 0;
          const baselineLookupStarted = Date.now();
          const baseline = await getMovieActivationBaseline(
            handle.providerId,
            previousReadable,
          );
          baselineLookupMs = Date.now() - baselineLookupStarted;
          const baselineValid =
            baseline.lifecycleState === 'ready' &&
            baseline.totalItems != null &&
            baseline.nonzeroCategoryCount != null &&
            Number.isFinite(baseline.totalItems) &&
            Number.isFinite(baseline.nonzeroCategoryCount) &&
            baseline.totalItems >= 0 &&
            baseline.nonzeroCategoryCount >= 0;
          let previousPhysicalMs = 0;
          let previousLargestMs = 0;
          if (baselineValid) {
            previousTotalItems = baseline.totalItems;
            previousNonzeroCategoryCount = baseline.nonzeroCategoryCount;
          } else {
            const previousPhysicalStarted = Date.now();
            const previousLargestStarted = Date.now();
            const [prevPhysical, prevLargest] = await Promise.all([
              getCatalogGenerationPhysicalStats(
                handle.providerId,
                handle.mediaType,
                previousReadable,
              ).then((value) => {
                previousPhysicalMs = Date.now() - previousPhysicalStarted;
                return value;
              }),
              getCatalogGenerationLargestCategory(
                handle.providerId,
                handle.mediaType,
                previousReadable,
                undefined,
                'previous-generation-validation',
              ).then((value) => {
                previousLargestMs = Date.now() - previousLargestStarted;
                return value;
              }),
            ]);
            previousTotalItems = prevPhysical.itemRows;
            previousNonzeroCategoryCount = prevLargest.nonzeroCategoryCount;
          }
          previousGenerationStatsMs = Date.now() - previousGenerationStarted;
          console.info('[NovaCast Movie Previous Ready Baseline Reuse]', {
            currentGeneration: handle.generation,
            previousGeneration: previousReadable,
            previousLifecycleState: baseline.lifecycleState,
            baselineFound: baseline.lifecycleState != null,
            baselineValid,
            baselineSource: baselineValid ? 'catalog_generation_state' : null,
            previousTotalItems,
            previousNonzeroCategoryCount,
            reusedPreviousTotalItems: baselineValid,
            reusedPreviousNonzeroCategoryCount: baselineValid,
            avoidedPreviousPhysicalStatsQuery: baselineValid,
            avoidedPreviousLargestCategoryQuery: baselineValid,
            fallbackUsed: !baselineValid,
            fallbackReason: baselineValid ? null : 'missing-or-invalid-ready-baseline',
            baselineLookupMs,
            requiredFields: ['previousTotalItems', 'previousNonzeroCategoryCount'],
            physicalStatsMs: previousPhysicalMs,
            largestCategoryMs: previousLargestMs,
            totalBaselineMs: previousGenerationStatsMs,
            sourcePhase: 'activation-validation',
            consumerPhase: 'finishCatalogSqliteMediaSync',
          });
        }
        const metadataCategoryCount =
          handle.pendingCategories?.length || physical.categoryRows;
        const distributionStarted = Date.now();
        const distribution = validateMoviesCategoryDistribution({
          generation: handle.generation,
          totalItems: physical.itemRows,
          distinctCategoryIds: physical.distinctItemCategoryIds,
          metadataCategoryCount,
          nonzeroCategoryCount: largest.nonzeroCategoryCount,
          largestCategoryId: largest.categoryId,
          largestCategoryCount: largest.itemCount,
          previousGeneration: previousReadable > 0 ? previousReadable : null,
          previousTotalItems,
          previousNonzeroCategoryCount,
        });
        distributionValidationMs = Date.now() - distributionStarted;
        if (!distribution.validationPassed) {
          await failCatalogSync(
            handle.providerId,
            handle.mediaType,
            distribution.rejectionReason ?? 'category_distribution_failed',
          );
          return false;
        }

        const promotionStarted = Date.now();
        const activated = await completeCatalogSync(
          handle.providerId,
          handle.mediaType,
          handle.generation,
          {
            processedCount,
            categories: handle.pendingCategories,
            completionStats,
          },
        );
        console.info('[NovaCast Movie Completion Phase]', {
          phase: 'complete-catalog-sync-promotion',
          generation: handle.generation,
          durationMs: Date.now() - promotionStarted,
        });
        pointerPromotionMs = Date.now() - promotionStarted;
        if (!activated) {
          return false;
        }
        logMovieCompletionTailSummary({
          generation: handle.generation,
          totalTimeMs: Date.now() - completionTailStarted,
          barrierStatsMs,
          recoveryMs,
          distributionValidationMs,
          physicalStatsMs,
          previousGenerationStatsMs,
          categoryRecomputeMs: null,
          activationValidationMs: null,
          cleanupMs: null,
          pointerPromotionMs,
          transactionOverheadMs: null,
          otherMs: null,
          readableGeneration: previousReadable,
        });
        logSqlite('sqlite-sync-completed', {
          providerId: handle.providerId,
          mediaType: handle.mediaType,
          generation: handle.generation,
          processedCount,
        });
        return true;
      }

      // Stage 4.2O.2: Series now shares the generation-safe pipeline with Movies —
      // completeCatalogSync's validated `activated` result must be honored here
      // (previously this branch unconditionally returned true, masking a failed
      // promotion). A false result leaves the prior readable generation intact
      // because completeCatalogSync never advances catalog_providers on rejection.
      const activated = await completeCatalogSync(handle.providerId, handle.mediaType, handle.generation, {
        processedCount,
      });
      logSqlite(activated ? 'sqlite-sync-completed' : 'sqlite-sync-promotion-rejected', {
        providerId: handle.providerId,
        mediaType: handle.mediaType,
        generation: handle.generation,
        processedCount,
        activated,
      });
      return activated;
    }

    await failCatalogSync(handle.providerId, handle.mediaType, errorCode ?? 'sync_failed');
    logSqlite('sqlite-sync-failed', {
      providerId: handle.providerId,
      mediaType: handle.mediaType,
      generation: handle.generation,
      errorCode: errorCode ?? 'sync_failed',
    });
    return true;
  } catch (error) {
    logSqliteError('sqlite-sync-finish-failed', error, {
      providerId: handle.providerId,
      mediaType: handle.mediaType,
      generation: handle.generation,
      ok,
    });
    return false;
  } finally {
    if (handle.mediaType === 'movie') {
      releaseMovieCategoryGate(handle.providerId, handle.generation, 'media-sync-finally');
      endCatalogWriteQuietPeriod();
    }
    if (handle.mediaType === 'series') {
      endCatalogWriteQuietPeriod();
    }
  }
}
