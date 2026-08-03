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
  getCatalogGenerationItemStats,
  getCatalogGenerationLargestCategory,
  getCatalogGenerationPhysicalStats,
  upsertCatalogProvider,
  writeCatalogCategoriesBatch,
  writeCatalogItemsBatch,
} from './catalogRepository.ts';
import type { CatalogCategoryRecord, CatalogItemRecord, CatalogMediaType } from './catalogTypes.ts';
import { earlyBootTimed } from '../diagnostics/earlyBootAudit.ts';
import { recordCatalogWritePhase, timedCatalogWritePhase } from './catalogWritePhaseAudit.ts';
import {
  beginCatalogWriteQuietPeriod,
  endCatalogWriteQuietPeriod,
} from './catalogWriteQuietPeriod.ts';
import { validateMoviesCategoryDistribution } from './moviesCategoryDistributionValidation.ts';
import { resolveCatalogItemCategoryId } from './vodCategoryFilterCapability.ts';

const PERF_LOG_PREFIX = '[NovaCast CatalogSqlite]';

export type CatalogSqliteMediaSyncHandle = {
  enabled: boolean;
  providerId: string;
  mediaType: CatalogMediaType;
  generation: number;
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
  };
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
const movieCategoryWriteGates = new Map<
  string,
  { promise: Promise<void>; resolve: () => void; open: boolean }
>();

/** Movies item writes wait until Series finishes category upserts (avoids 2s mutex/JS stalls). */
const seriesCategoryWriteGates = new Map<
  string,
  { promise: Promise<void>; resolve: () => void; open: boolean }
>();

function ensureGate(
  map: Map<string, { promise: Promise<void>; resolve: () => void; open: boolean }>,
  providerId: string,
) {
  const existing = map.get(providerId);
  if (existing && !existing.open) {
    return existing;
  }
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  const gate = { promise, resolve, open: false };
  map.set(providerId, gate);
  return gate;
}

function releaseGate(
  map: Map<string, { promise: Promise<void>; resolve: () => void; open: boolean }>,
  providerId: string,
) {
  const gate = map.get(providerId);
  if (!gate || gate.open) {
    return;
  }
  gate.open = true;
  gate.resolve();
}

function ensureMovieCategoryGate(providerId: string) {
  return ensureGate(movieCategoryWriteGates, providerId);
}

function releaseMovieCategoryGate(providerId: string) {
  releaseGate(movieCategoryWriteGates, providerId);
}

function ensureSeriesCategoryGate(providerId: string) {
  return ensureGate(seriesCategoryWriteGates, providerId);
}

function releaseSeriesCategoryGate(providerId: string) {
  releaseGate(seriesCategoryWriteGates, providerId);
}

export function clearCatalogSqliteWriterGatesForTests() {
  for (const map of [movieCategoryWriteGates, seriesCategoryWriteGates]) {
    for (const gate of map.values()) {
      if (!gate.open) {
        gate.open = true;
        gate.resolve();
      }
    }
    map.clear();
  }
}

function logSqlite(message: string, payload: Record<string, unknown> = {}) {
  console.info(PERF_LOG_PREFIX, { message, ...payload });
}

function logSqliteError(message: string, error: unknown, payload: Record<string, unknown> = {}) {
  const errorMessage = error instanceof Error ? error.message : String(error);
  console.error(PERF_LOG_PREFIX, { message, error: errorMessage, ...payload });
}

function parseReleaseYear(value: string | number | null | undefined): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const match = value.match(/\b(19|20)\d{2}\b/);
    if (match) {
      return Number.parseInt(match[0], 10);
    }
  }
  return null;
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
    releaseDate: movie.releaseDate != null ? String(movie.releaseDate) : null,
    releaseYear: movie.year ?? parseReleaseYear(movie.releaseDate),
    rating: parseRatingNumber(movie.rating),
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
    releaseDate: record.releaseDate != null ? String(record.releaseDate) : null,
    releaseYear: parseReleaseYear(record.releaseDate),
    rating: typeof record.rating === 'number' ? record.rating : parseRatingNumber(record.rating ?? undefined),
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
    releaseDate: series.releaseDate != null ? String(series.releaseDate) : null,
    releaseYear: parseReleaseYear(series.year ?? series.releaseDate),
    rating: parseRatingNumber(series.rating),
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
}): Promise<CatalogSqliteMediaSyncHandle> {
  try {
    await earlyBootTimed('sqlite.initializeCatalogDatabase', () => initializeCatalogDatabase());
    await earlyBootTimed('sqlite.upsertCatalogProvider', () =>
      upsertCatalogProvider({
        providerId: input.providerId,
        providerType: input.providerType,
        displayName: input.displayName ?? null,
      }),
    );
    const generation = await earlyBootTimed('sqlite.beginCatalogSync', () =>
      beginCatalogSync(input.providerId, input.mediaType, {
        phase: 'categories',
      }),
    );
    if (input.mediaType === 'movie') {
      ensureMovieCategoryGate(input.providerId);
      beginCatalogWriteQuietPeriod(25_000);
    } else if (input.mediaType === 'series') {
      ensureSeriesCategoryGate(input.providerId);
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
      accounting: createWriterAccounting(),
      pendingCategories: [],
    };
  } catch (error) {
    logSqliteError('sqlite-sync-start-failed', error, {
      providerId: input.providerId,
      mediaType: input.mediaType,
    });
    return {
      enabled: false,
      providerId: input.providerId,
      mediaType: input.mediaType,
      generation: 0,
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
      releaseMovieCategoryGate(handle.providerId);
    }
    if (handle.enabled && handle.mediaType === 'series') {
      releaseSeriesCategoryGate(handle.providerId);
    }
    return 0;
  }

  // Stage 4 category-rail: stage pendingCategories for the atomic ready
  // transition, then fall through and stream category rows immediately so the
  // Movies rail can read them before item sync completes.
  if (handle.mediaType === 'movie') {
    handle.pendingCategories = categories.map(mapCategory);
  }

  try {
    if (handle.mediaType === 'series') {
      const gate = movieCategoryWriteGates.get(handle.providerId);
      if (gate && !gate.open) {
        logSqlite('sqlite-categories-await-movie-gate', {
          providerId: handle.providerId,
        });
        await gate.promise;
      }
      ensureSeriesCategoryGate(handle.providerId);
    } else if (handle.mediaType === 'movie') {
      ensureMovieCategoryGate(handle.providerId);
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
      releaseMovieCategoryGate(handle.providerId);
    } else {
      releaseSeriesCategoryGate(handle.providerId);
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

export async function awaitSeriesCategoryGateForProvider(
  providerId: string,
  timeoutMs = 10_000,
): Promise<void> {
  const gate = seriesCategoryWriteGates.get(providerId);
  if (!gate || gate.open) {
    return;
  }
  logSqlite('sqlite-await-series-category-gate', { providerId, timeoutMs });
  await Promise.race([
    gate.promise,
    new Promise<void>((resolve) => {
      setTimeout(resolve, timeoutMs);
    }),
  ]);
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
    if (handle.mediaType === 'movie') {
      const gate = seriesCategoryWriteGates.get(handle.providerId);
      if (gate && !gate.open) {
        logSqlite('sqlite-items-await-series-category-gate', {
          providerId: handle.providerId,
        });
        await gate.promise;
      }
    }

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
        isCancelled: options?.isCancelled,
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
        const itemStats = await getCatalogGenerationItemStats(
          handle.providerId,
          handle.mediaType,
          handle.generation,
        );
        const dbRowCount = itemStats.rowCount;
        handle.accounting.committedCount = itemStats.distinctContentCount;
        const barrierPassed =
          handle.accounting.nativeDone &&
          handle.accounting.pendingWriteCount === 0 &&
          handle.accounting.writerDrained &&
          handle.accounting.committedCount > 0 &&
          dbRowCount === handle.accounting.committedCount;

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

        // Stage 3C.2: reject collapsed category distributions before activation.
        const physical = await getCatalogGenerationPhysicalStats(
          handle.providerId,
          handle.mediaType,
          handle.generation,
        );
        const largest = await getCatalogGenerationLargestCategory(
          handle.providerId,
          handle.mediaType,
          handle.generation,
        );
        const metadataCategoryCount =
          handle.pendingCategories?.length || physical.categoryRows;
        const distribution = validateMoviesCategoryDistribution({
          generation: handle.generation,
          totalItems: physical.itemRows,
          distinctCategoryIds: physical.distinctItemCategoryIds,
          metadataCategoryCount,
          nonzeroCategoryCount: largest.nonzeroCategoryCount,
          largestCategoryId: largest.categoryId,
          largestCategoryCount: largest.itemCount,
        });
        if (!distribution.validationPassed) {
          await failCatalogSync(
            handle.providerId,
            handle.mediaType,
            distribution.rejectionReason ?? 'category_distribution_failed',
          );
          return false;
        }

        const activated = await completeCatalogSync(
          handle.providerId,
          handle.mediaType,
          handle.generation,
          {
            processedCount,
            categories: handle.pendingCategories,
          },
        );
        if (!activated) {
          return false;
        }
        logSqlite('sqlite-sync-completed', {
          providerId: handle.providerId,
          mediaType: handle.mediaType,
          generation: handle.generation,
          processedCount,
        });
        return true;
      }

      await completeCatalogSync(handle.providerId, handle.mediaType, handle.generation, {
        processedCount,
      });
      logSqlite('sqlite-sync-completed', {
        providerId: handle.providerId,
        mediaType: handle.mediaType,
        generation: handle.generation,
        processedCount,
      });
      return true;
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
      releaseMovieCategoryGate(handle.providerId);
      endCatalogWriteQuietPeriod();
    }
    if (handle.mediaType === 'series') {
      releaseSeriesCategoryGate(handle.providerId);
      endCatalogWriteQuietPeriod();
    }
  }
}
