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

const PERF_LOG_PREFIX = '[NovaCast CatalogSqlite]';

export type CatalogSqliteMediaSyncHandle = {
  enabled: boolean;
  providerId: string;
  mediaType: CatalogMediaType;
  generation: number;
};

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

function parseReleaseYear(value: string | number | undefined): number | null {
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
): CatalogItemInput {
  const contentId =
    mediaType === 'series' ? record.seriesId || record.contentId : record.contentId;
  return {
    providerId,
    mediaType,
    contentId,
    categoryId: record.categoryId || fallbackCategoryId,
    title: record.title,
    artworkUrl: record.artworkUrl ?? null,
    backdropUrl: record.backdropUrl ?? null,
    releaseDate: record.releaseDate != null ? String(record.releaseDate) : null,
    releaseYear: parseReleaseYear(record.releaseDate),
    rating: typeof record.rating === 'number' ? record.rating : parseRatingNumber(record.rating),
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
      marker: 'stage295-native-completion-v1',
    });
    return {
      enabled: true,
      providerId: input.providerId,
      mediaType: input.mediaType,
      generation,
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
    } else if (handle.mediaType === 'series') {
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
      (item, index) => mapItem(item, index),
      async (batch) => {
        written += await writeCatalogItemsBatch(batch);
      },
      {
        kind: options?.mapKind ?? 'itemWrites',
        writeKind: 'itemWrites',
        minItems: 4,
        maxItems: 24,
        isCancelled: options?.isCancelled,
      },
    );
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
}): Promise<void> {
  const { handle, ok, processedCount, errorCode } = input;
  if (!handle.enabled) {
    return;
  }

  try {
    if (ok) {
      await completeCatalogSync(handle.providerId, handle.mediaType, handle.generation, {
        processedCount,
      });
      logSqlite('sqlite-sync-completed', {
        providerId: handle.providerId,
        mediaType: handle.mediaType,
        generation: handle.generation,
        processedCount,
      });
      return;
    }

    await failCatalogSync(handle.providerId, handle.mediaType, errorCode ?? 'sync_failed');
    logSqlite('sqlite-sync-failed', {
      providerId: handle.providerId,
      mediaType: handle.mediaType,
      generation: handle.generation,
      errorCode: errorCode ?? 'sync_failed',
    });
  } catch (error) {
    logSqliteError('sqlite-sync-finish-failed', error, {
      providerId: handle.providerId,
      mediaType: handle.mediaType,
      generation: handle.generation,
      ok,
    });
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
