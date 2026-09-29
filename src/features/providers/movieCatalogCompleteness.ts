import { normalizeStreamCategoryId } from '../catalog/vodCategoryFilterCapability.ts';

export const MOVIE_COMPLETENESS_PROBE = '[NovaCast Movie Completeness Probe]';

export type MovieIdSetComparison = {
  overlapCount: number;
  moviesOnlyInFullDump: number;
  moviesOnlyInCategoryCrawl: number;
};

export function compareMovieCatalogIdSets(
  categoryCrawlIds: Iterable<string>,
  fullDumpIds: Iterable<string>,
): MovieIdSetComparison {
  const crawl = categoryCrawlIds instanceof Set ? categoryCrawlIds : new Set(
    Array.from(categoryCrawlIds).filter(Boolean),
  );
  const dump = fullDumpIds instanceof Set ? fullDumpIds : new Set(Array.from(fullDumpIds).filter(Boolean));
  let overlapCount = 0;
  let moviesOnlyInFullDump = 0;
  for (const id of dump) {
    if (crawl.has(id)) {
      overlapCount += 1;
    } else {
      moviesOnlyInFullDump += 1;
    }
  }
  let moviesOnlyInCategoryCrawl = 0;
  for (const id of crawl) {
    if (!dump.has(id)) {
      moviesOnlyInCategoryCrawl += 1;
    }
  }
  return { overlapCount, moviesOnlyInFullDump, moviesOnlyInCategoryCrawl };
}

export function countIdsMissingFromMetadata(
  metadataCategoryIds: Iterable<string>,
  streamCategoryIds: Iterable<string>,
): number {
  const known = new Set(
    Array.from(metadataCategoryIds)
      .map((id) => String(id).trim())
      .filter(Boolean),
  );
  let missing = 0;
  for (const raw of streamCategoryIds) {
    const id = String(raw).trim();
    if (id && !known.has(id)) {
      missing += 1;
    }
  }
  return missing;
}

export function resolveMovieCompletionConfidence(input: {
  dumpAvailable: boolean;
  dumpFailed: boolean;
  crawlScope: 'full-metadata-crawl' | 'skipped-full-dump-strategy' | 'none';
  metadataCategoryCount: number;
  distinctMovieCategoryIds: number;
  categoryCrawlDistinctCount: number;
  fullDumpDistinctCount: number;
  moviesOnlyInFullDump: number;
  overlapCount: number;
}): string {
  if (!input.dumpAvailable) {
    return input.dumpFailed ? 'dump-failed' : 'dump-unavailable';
  }
  if (input.fullDumpDistinctCount <= 0) {
    return 'dump-empty';
  }
  if (
    input.distinctMovieCategoryIds > 0 &&
    input.metadataCategoryCount > 0 &&
    input.distinctMovieCategoryIds >= Math.max(input.metadataCategoryCount * 2, input.metadataCategoryCount + 8)
  ) {
    return 'metadata-categories-incomplete';
  }
  if (input.crawlScope === 'skipped-full-dump-strategy') {
    return 'dump-authoritative-crawl-skipped';
  }
  if (input.categoryCrawlDistinctCount <= 0) {
    return 'category-crawl-incomplete';
  }
  const dump = input.fullDumpDistinctCount;
  if (input.moviesOnlyInFullDump >= Math.max(1, Math.floor(dump * 0.1))) {
    return 'category-crawl-incomplete';
  }
  if (
    input.overlapCount >= Math.floor(dump * 0.9) &&
    input.moviesOnlyInFullDump < Math.max(10, Math.floor(dump * 0.05))
  ) {
    return 'category-crawl-complete';
  }
  return 'inconclusive';
}

export function logMovieCompletenessProbe(fields: Record<string, unknown>) {
  console.info(
    MOVIE_COMPLETENESS_PROBE,
    JSON.stringify({
      mediaType: 'movie',
      ...fields,
    }),
  );
}

export type MovieCompletenessTracker = {
  noteCrawlIds(ids: Array<string | null | undefined>): void;
  noteCrawlRaw(count: number): void;
  markFullDumpStrategy(): void;
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

export function createMovieCompletenessTracker(input: {
  providerId: string;
  generation: number | null;
  metadataCategoryCount: number;
  metadataCategoryIds: Iterable<string>;
}): MovieCompletenessTracker {
  const crawlIds = new Set<string>();
  let categoryCrawlRawCount = 0;
  let crawlScope: 'full-metadata-crawl' | 'skipped-full-dump-strategy' | 'none' = 'none';
  const dumpIds = new Set<string>();
  const dumpCategoryIds = new Set<string>();
  let fullDumpRawCount: number | null = null;
  let decodedMovieCount: number | null = null;
  let moviesWithMissingCategoryId = 0;
  let dumpFailed = false;
  let dumpAvailable = false;
  let filteringReliable = false;
  let filterReason = 'not-probed';
  let emitted = false;
  const metadataIds = Array.from(input.metadataCategoryIds).map((id) => String(id).trim()).filter(Boolean);

  return {
    noteCrawlIds(ids) {
      crawlScope = 'full-metadata-crawl';
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
    markFullDumpStrategy() {
      if (crawlScope === 'none') {
        crawlScope = 'skipped-full-dump-strategy';
      }
    },
    noteDumpStats(stats) {
      dumpAvailable = true;
      dumpFailed = false;
      fullDumpRawCount = stats.rawCount;
      decodedMovieCount = stats.decodedCount;
      moviesWithMissingCategoryId = stats.missingCategoryIdCount;
      dumpIds.clear();
      dumpCategoryIds.clear();
      for (const id of stats.distinctIds) {
        if (id) {
          dumpIds.add(id);
        }
      }
      for (const id of stats.distinctCategoryIds) {
        if (id) {
          dumpCategoryIds.add(normalizeStreamCategoryId(id));
        }
      }
    },
    noteDumpFailed(reason) {
      dumpFailed = true;
      dumpAvailable = false;
      filterReason = filterReason === 'not-probed' ? reason : filterReason;
    },
    noteDumpUnavailable(reason) {
      dumpAvailable = false;
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
      const comparison = compareMovieCatalogIdSets(crawlIds, dumpIds);
      const distinctMovieCategoryIds = dumpCategoryIds.size;
      const movieCategoryIdsMissingFromMetadata = countIdsMissingFromMetadata(metadataIds, dumpCategoryIds);
      const rawMovieCount = fullDumpRawCount ?? 0;
      const distinctMovieIds = dumpIds.size;
      logMovieCompletenessProbe({
        providerId: input.providerId,
        generation: input.generation,
        rawMovieCount: fullDumpRawCount,
        decodedMovieCount,
        distinctMovieIds,
        duplicateMovieCount: Math.max(0, rawMovieCount - distinctMovieIds),
        distinctMovieCategoryIds,
        metadataCategoryCount: input.metadataCategoryCount,
        movieCategoryIdsMissingFromMetadata,
        moviesWithMissingCategoryId,
        categoryCrawlRawCount,
        categoryCrawlDistinctCount: crawlIds.size,
        crawlScope,
        moviesOnlyInFullDump: comparison.moviesOnlyInFullDump,
        moviesOnlyInCategoryCrawl: comparison.moviesOnlyInCategoryCrawl,
        overlapCount: comparison.overlapCount,
        filteringReliable,
        filterReason,
        completionConfidence: resolveMovieCompletionConfidence({
          dumpAvailable,
          dumpFailed,
          crawlScope,
          metadataCategoryCount: input.metadataCategoryCount,
          distinctMovieCategoryIds,
          categoryCrawlDistinctCount: crawlIds.size,
          fullDumpDistinctCount: distinctMovieIds,
          moviesOnlyInFullDump: comparison.moviesOnlyInFullDump,
          overlapCount: comparison.overlapCount,
        }),
        ignoredXtreamVodEndpoints: ['get_vod_info'],
        vodCatalogActionsUsed: ['get_vod_categories', 'get_vod_streams'],
        ...extra,
      });
    },
  };
}
