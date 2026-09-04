import { evaluateVodCategoryFilterCapability, normalizeStreamCategoryId } from '../catalog/vodCategoryFilterCapability.ts';
import type { NativeCatalogRecord } from '../catalog/nativeCatalogDecodeTypes.ts';
import type { StreamXtreamCategoryDecodeResult } from '../catalog/nativeCatalogDecodeTypes.ts';
import { retrySeriesCategoryDecode } from './seriesCategoryDecodeRetry.ts';
import { canonicalSeriesContentId } from './seriesCatalogCompletion.ts';
import { withProviderCatalogNetworkGate } from './providerCatalogNetworkGate.ts';
import { collectSeriesStreamRowCategoryNames } from '../series/seriesCategoryNameResolution.ts';

export const SERIES_COMPLETENESS_PROBE = '[NovaCast Series Completeness Probe]';

export type SeriesCompletenessStrategy =
  | 'category-crawl-only'
  | 'full-dump-diagnostic'
  | 'full-dump-unavailable'
  | 'full-dump-failed';

export type SeriesIdSetComparison = {
  overlapCount: number;
  seriesOnlyInFullDump: number;
  seriesOnlyInCategoryCrawl: number;
};

export function compareSeriesCatalogIdSets(
  categoryCrawlIds: Iterable<string>,
  fullDumpIds: Iterable<string>,
): SeriesIdSetComparison {
  const crawl = categoryCrawlIds instanceof Set ? categoryCrawlIds : new Set(
    Array.from(categoryCrawlIds).filter(Boolean),
  );
  const dump = fullDumpIds instanceof Set ? fullDumpIds : new Set(Array.from(fullDumpIds).filter(Boolean));
  let overlapCount = 0;
  let seriesOnlyInFullDump = 0;
  for (const id of dump) {
    if (crawl.has(id)) {
      overlapCount += 1;
    } else {
      seriesOnlyInFullDump += 1;
    }
  }
  let seriesOnlyInCategoryCrawl = 0;
  for (const id of crawl) {
    if (!dump.has(id)) {
      seriesOnlyInCategoryCrawl += 1;
    }
  }
  return { overlapCount, seriesOnlyInFullDump, seriesOnlyInCategoryCrawl };
}

export function resolveSeriesCompletionConfidence(input: {
  dumpAvailable: boolean;
  dumpFailed: boolean;
  metadataCategoryCount: number;
  distinctSeriesCategoryIds: number;
  categoryCrawlDistinctCount: number;
  fullDumpDistinctCount: number;
  seriesOnlyInFullDump: number;
  overlapCount: number;
}): string {
  if (!input.dumpAvailable) {
    return 'dump-unavailable';
  }
  if (input.dumpFailed) {
    return 'dump-failed';
  }
  if (input.fullDumpDistinctCount <= 0) {
    return 'dump-empty';
  }
  if (
    input.distinctSeriesCategoryIds > 0 &&
    input.metadataCategoryCount > 0 &&
    input.distinctSeriesCategoryIds >= Math.max(input.metadataCategoryCount * 2, input.metadataCategoryCount + 8)
  ) {
    return 'metadata-categories-incomplete';
  }
  if (input.categoryCrawlDistinctCount <= 0) {
    return 'category-crawl-incomplete';
  }
  const dump = input.fullDumpDistinctCount;
  if (input.seriesOnlyInFullDump >= Math.max(1, Math.floor(dump * 0.1))) {
    return 'category-crawl-incomplete';
  }
  if (
    input.overlapCount >= Math.floor(dump * 0.9) &&
    input.seriesOnlyInFullDump < Math.max(10, Math.floor(dump * 0.05))
  ) {
    return 'category-crawl-complete';
  }
  return 'inconclusive';
}

export function logSeriesCompletenessProbe(fields: Record<string, unknown>) {
  console.info(
    SERIES_COMPLETENESS_PROBE,
    JSON.stringify({
      mediaType: 'series',
      ...fields,
    }),
  );
}

export type SeriesDumpAccumulator = {
  rawCount: number;
  decodedCount: number;
  missingCategoryIdCount: number;
  distinctIds: Set<string>;
  distinctCategoryIds: Set<string>;
  noteRecords(records: NativeCatalogRecord[]): void;
};

export function createSeriesDumpAccumulator(): SeriesDumpAccumulator {
  const distinctIds = new Set<string>();
  const distinctCategoryIds = new Set<string>();
  const acc: SeriesDumpAccumulator = {
    rawCount: 0,
    decodedCount: 0,
    missingCategoryIdCount: 0,
    distinctIds,
    distinctCategoryIds,
    noteRecords(records) {
      acc.decodedCount += records.length;
      for (const record of records) {
        const contentId = typeof record.contentId === 'string' ? record.contentId.trim() : '';
        if (contentId) {
          distinctIds.add(contentId);
        }
        const source =
          record.categoryId != null && String(record.categoryId).trim() !== ''
            ? String(record.categoryId)
            : null;
        if (!source) {
          acc.missingCategoryIdCount += 1;
        } else {
          distinctCategoryIds.add(normalizeStreamCategoryId(source));
        }
      }
    },
  };
  return acc;
}

export type SeriesCompletenessTracker = {
  noteCrawlIds(ids: Array<string | null | undefined>): void;
  noteCrawlRaw(count: number): void;
  noteDumpStats(input: {
    rawCount: number;
    decodedCount: number;
    missingCategoryIdCount: number;
    distinctIds: Iterable<string>;
    distinctCategoryIds: Iterable<string>;
  }): void;
  noteDumpFailed(reason: string): void;
  noteDumpUnavailable(reason: string): void;
  noteFilterCapability(input: { filteringReliable: boolean; filterReason: string }): void;
  emit(extra?: Record<string, unknown>): void;
};

export function createSeriesCompletenessTracker(input: {
  providerId: string;
  generation: number | null;
  metadataCategoryCount: number;
}): SeriesCompletenessTracker {
  const crawlIds = new Set<string>();
  let categoryCrawlRawCount = 0;
  const dumpIds = new Set<string>();
  const dumpCategoryIds = new Set<string>();
  let fullDumpRawCount: number | null = null;
  let decodedSeriesCount: number | null = null;
  let missingCategoryIdCount = 0;
  let strategy: SeriesCompletenessStrategy = 'category-crawl-only';
  let dumpFailed = false;
  let dumpAvailable = false;
  let filteringReliable = false;
  let filterReason = 'not-probed';
  let emitted = false;

  return {
    noteCrawlIds(ids) {
      for (const id of ids) {
        const value = typeof id === 'string' ? id.trim() : '';
        if (value) {
          crawlIds.add(value);
        }
      }
    },
    noteCrawlRaw(count) {
      if (Number.isFinite(count) && count > 0) {
        categoryCrawlRawCount += count;
      }
    },
    noteDumpStats(stats) {
      dumpAvailable = true;
      dumpFailed = false;
      strategy = 'full-dump-diagnostic';
      fullDumpRawCount = stats.rawCount;
      decodedSeriesCount = stats.decodedCount;
      missingCategoryIdCount = stats.missingCategoryIdCount;
      dumpIds.clear();
      dumpCategoryIds.clear();
      for (const id of stats.distinctIds) {
        if (id) {
          dumpIds.add(id);
        }
      }
      for (const id of stats.distinctCategoryIds) {
        if (id) {
          dumpCategoryIds.add(id);
        }
      }
    },
    noteDumpFailed(reason) {
      dumpFailed = true;
      dumpAvailable = false;
      strategy = 'full-dump-failed';
      filterReason = filterReason === 'not-probed' ? reason : filterReason;
    },
    noteDumpUnavailable(reason) {
      dumpAvailable = false;
      strategy = 'full-dump-unavailable';
      filterReason = filterReason === 'not-probed' ? reason : filterReason;
    },
    noteFilterCapability(capability) {
      filteringReliable = capability.filteringReliable;
      filterReason = capability.filterReason;
    },
    emit(extra = {}) {
      if (emitted) {
        return;
      }
      emitted = true;
      const comparison = compareSeriesCatalogIdSets(crawlIds, dumpIds);
      const distinctSeriesCategoryIds = dumpCategoryIds.size;
      const completionConfidence = resolveSeriesCompletionConfidence({
        dumpAvailable,
        dumpFailed,
        metadataCategoryCount: input.metadataCategoryCount,
        distinctSeriesCategoryIds,
        categoryCrawlDistinctCount: crawlIds.size,
        fullDumpDistinctCount: dumpIds.size,
        seriesOnlyInFullDump: comparison.seriesOnlyInFullDump,
        overlapCount: comparison.overlapCount,
      });
      logSeriesCompletenessProbe({
        providerId: input.providerId,
        generation: input.generation,
        strategy,
        metadataCategoryCount: input.metadataCategoryCount,
        categoryCrawlRawCount,
        categoryCrawlDistinctCount: crawlIds.size,
        fullDumpRawCount,
        fullDumpDistinctCount: dumpAvailable ? dumpIds.size : null,
        decodedSeriesCount,
        distinctSeriesCategoryIds,
        missingCategoryIdCount,
        seriesOnlyInFullDump: dumpAvailable ? comparison.seriesOnlyInFullDump : null,
        seriesOnlyInCategoryCrawl: dumpAvailable ? comparison.seriesOnlyInCategoryCrawl : null,
        overlapCount: dumpAvailable ? comparison.overlapCount : null,
        filteringReliable,
        filterReason,
        completionConfidence,
        publicationUnchanged: true,
        ...extra,
      });
    },
  };
}

export async function decodeUnfilteredSeriesDump(input: {
  providerId: string;
  generation: number | null;
  requestUrl: string;
  isCancelled?: () => boolean;
  runId?: string | null;
  streamDecode: (options: {
    requestUrl: string;
    mediaType: 'series';
    filterCategoryId: string;
    providerId: string;
    generation?: number;
    categoryIndex?: number;
    categoryPosition?: number;
    totalCategoryCount?: number;
    requestAttempt?: number;
    isCancelled?: () => boolean;
    skipCatalogNetworkGate?: boolean;
    catalogNetworkMediaType?: 'movie' | 'series' | 'live';
    catalogNetworkOperation?: string;
    catalogNetworkRequestSource?: string | null;
    catalogNetworkBackground?: boolean;
    catalogNetworkCancellable?: boolean;
    catalogNetworkForeground?: boolean;
    catalogNetworkActiveSurface?: 'live' | 'movies' | 'series' | 'other';
    catalogNetworkReadableGenerationPresent?: boolean;
    catalogNetworkOnPreemptionRequested?: () => boolean;
    catalogNetworkOnPreemptionReleased?: (input: { ownerHeldMs: number }) => void;
    runId?: string | null;
    onBatch: (records: NativeCatalogRecord[]) => Promise<void>;
  }) => Promise<StreamXtreamCategoryDecodeResult>;
}): Promise<{
  rawCount: number;
  decodedCount: number;
  missingCategoryIdCount: number;
  distinctIds: Set<string>;
  distinctCategoryIds: Set<string>;
  statsRawSeen: number | null;
}> {
  return withProviderCatalogNetworkGate(
    input.providerId,
    'series',
    'get_series',
    () => retrySeriesCategoryDecode({
    providerId: input.providerId,
    generation: input.generation,
    categoryId: 'all',
    categoryIndex: -1,
    categoryPosition: 0,
    totalCategoryCount: 0,
    isCancelled: input.isCancelled,
    work: async (attempt) => {
      const acc = createSeriesDumpAccumulator();
      const decodeResult = await input.streamDecode({
        requestUrl: input.requestUrl,
        mediaType: 'series',
        filterCategoryId: 'all',
        providerId: input.providerId,
        generation: input.generation ?? undefined,
        categoryIndex: -1,
        categoryPosition: 0,
        totalCategoryCount: 0,
        requestAttempt: attempt,
        isCancelled: input.isCancelled,
        skipCatalogNetworkGate: true,
        catalogNetworkMediaType: 'series',
        catalogNetworkOperation: 'get_series',
        runId: input.runId ?? null,
        onBatch: async (records) => {
          acc.noteRecords(records);
          acc.rawCount += records.length;
        },
      });
      if (decodeResult.cancelled || input.isCancelled?.()) {
        throw Object.assign(new Error('cancelled'), { errorReason: 'cancelled' });
      }
      const statsRawSeen =
        typeof decodeResult.stats.rawSeen === 'number' ? decodeResult.stats.rawSeen : acc.rawCount;
      return {
        rawCount: statsRawSeen,
        decodedCount: acc.decodedCount,
        missingCategoryIdCount: acc.missingCategoryIdCount,
        distinctIds: acc.distinctIds,
        distinctCategoryIds: acc.distinctCategoryIds,
        statsRawSeen,
      };
    },
  }),
    { isCancelled: input.isCancelled, runId: input.runId ?? null },
  );
}

export async function decodeSeriesFullDumpUnique(input: {
  providerId: string;
  generation: number | null;
  requestUrl: string;
  isCancelled?: () => boolean;
  runId?: string | null;
  catalogNetworkRequestSource?: string | null;
  catalogNetworkBackground?: boolean;
  catalogNetworkCancellable?: boolean;
  catalogNetworkForeground?: boolean;
  catalogNetworkActiveSurface?: 'live' | 'movies' | 'series' | 'other' | null;
  catalogNetworkReadableGenerationPresent?: boolean;
  catalogNetworkOnPreemptionRequested?: () => boolean;
  catalogNetworkOnPreemptionReleased?: (input: { ownerHeldMs: number }) => void;
  streamDecode: (options: {
    requestUrl: string;
    mediaType: 'series';
    filterCategoryId: string;
    providerId: string;
    generation?: number;
    categoryIndex?: number;
    categoryPosition?: number;
    totalCategoryCount?: number;
    requestAttempt?: number;
    isCancelled?: () => boolean;
    skipCatalogNetworkGate?: boolean;
    catalogNetworkMediaType?: 'movie' | 'series' | 'live';
    catalogNetworkOperation?: string;
    catalogNetworkRequestSource?: string | null;
    catalogNetworkBackground?: boolean;
    catalogNetworkCancellable?: boolean;
    catalogNetworkForeground?: boolean;
    catalogNetworkActiveSurface?: 'live' | 'movies' | 'series' | 'other';
    catalogNetworkReadableGenerationPresent?: boolean;
    catalogNetworkOnPreemptionRequested?: () => boolean;
    catalogNetworkOnPreemptionReleased?: (input: { ownerHeldMs: number }) => void;
    runId?: string | null;
    onBatch: (records: NativeCatalogRecord[]) => Promise<void>;
  }) => Promise<StreamXtreamCategoryDecodeResult>;
}): Promise<{
  uniqueRecords: NativeCatalogRecord[];
  rawCount: number;
  decodedCount: number;
  distinctIds: Set<string>;
  distinctCategoryIds: Set<string>;
  missingCategoryIdCount: number;
  duplicateSeriesCount: number;
  streamRowNames: Map<string, string>;
  firstItemKeys: string[];
  seriesCategoryNameFieldPresentCount: number;
}> {
  return withProviderCatalogNetworkGate(
    input.providerId,
    'series',
    'get_series',
    () => retrySeriesCategoryDecode({
    providerId: input.providerId,
    generation: input.generation,
    categoryId: 'all',
    categoryIndex: -1,
    categoryPosition: 0,
    totalCategoryCount: 0,
    isCancelled: input.isCancelled,
    work: async (attempt) => {
      const unique = new Map<string, NativeCatalogRecord>();
      const distinctCategoryIds = new Set<string>();
      const streamRowNames = new Map<string, string>();
      let rawCount = 0;
      let missingCategoryIdCount = 0;
      const decodeResult = await input.streamDecode({
        requestUrl: input.requestUrl,
        mediaType: 'series',
        filterCategoryId: 'all',
        providerId: input.providerId,
        generation: input.generation ?? undefined,
        categoryIndex: -1,
        categoryPosition: 0,
        totalCategoryCount: 0,
        requestAttempt: attempt,
        isCancelled: input.isCancelled,
        skipCatalogNetworkGate: true,
        catalogNetworkMediaType: 'series',
        catalogNetworkOperation: 'get_series',
        runId: input.runId ?? null,
        onBatch: async (records) => {
          for (const [categoryId, name] of collectSeriesStreamRowCategoryNames(records)) {
            if (!streamRowNames.has(categoryId)) {
              streamRowNames.set(categoryId, name);
            }
          }
          for (const record of records) {
            rawCount += 1;
            const source =
              record.categoryId != null && String(record.categoryId).trim() !== ''
                ? String(record.categoryId).trim()
                : null;
            if (!source) {
              missingCategoryIdCount += 1;
            } else {
              distinctCategoryIds.add(normalizeStreamCategoryId(source));
            }
            const contentId = canonicalSeriesContentId(record);
            if (contentId && !unique.has(contentId)) {
              unique.set(contentId, record);
            }
          }
        },
      });
      if (decodeResult.cancelled || input.isCancelled?.()) {
        unique.clear();
        throw Object.assign(new Error('cancelled'), { errorReason: 'cancelled' });
      }
      const statsRawSeen =
        typeof decodeResult.stats.rawSeen === 'number' ? decodeResult.stats.rawSeen : rawCount;
      const distinctIds = new Set(unique.keys());
      return {
        uniqueRecords: Array.from(unique.values()),
        rawCount: statsRawSeen,
        decodedCount: unique.size,
        distinctIds,
        distinctCategoryIds,
        missingCategoryIdCount,
        duplicateSeriesCount: Math.max(0, statsRawSeen - unique.size),
        streamRowNames,
        firstItemKeys: Array.isArray(decodeResult.stats.firstItemKeys)
          ? decodeResult.stats.firstItemKeys.map(String)
          : [],
        seriesCategoryNameFieldPresentCount:
          typeof decodeResult.stats.seriesCategoryNameFieldPresentCount === 'number'
            ? decodeResult.stats.seriesCategoryNameFieldPresentCount
            : streamRowNames.size,
      };
    },
  }),
    {
      isCancelled: input.isCancelled,
      runId: input.runId ?? null,
      requestSource: input.catalogNetworkRequestSource ?? null,
      background: input.catalogNetworkBackground ?? false,
      cancellable: input.catalogNetworkCancellable ?? false,
      foreground: input.catalogNetworkForeground ?? false,
      activeSurface: input.catalogNetworkActiveSurface ?? null,
      readableGenerationPresent: input.catalogNetworkReadableGenerationPresent ?? false,
      onPreemptionRequested: input.catalogNetworkOnPreemptionRequested,
      onPreemptionReleased: input.catalogNetworkOnPreemptionReleased,
    },
  );
}

export function evaluateSeriesCategoryFilterFromProbes(input: {
  providerId: string;
  probes: Array<{
    requestedCategoryId: string;
    returnedCount: number;
    distinctReturnedCategoryIds: number;
    matchingRequestedCategoryCount: number;
    firstContentIds: string[];
    contentIdSample: string[];
  }>;
  metadataCategoryCount: number;
  estimatedCatalogSize?: number;
}) {
  return evaluateVodCategoryFilterCapability({
    providerId: input.providerId,
    probes: input.probes,
    metadataCategoryCount: input.metadataCategoryCount,
    estimatedCatalogSize: input.estimatedCatalogSize,
  });
}
