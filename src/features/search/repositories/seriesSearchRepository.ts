import { entryToSeriesSummary, getSeriesCatalogIndex, type SeriesCatalogEntry } from '../../series/smart/seriesCatalogIndex.ts';
import type { SeriesDataSource } from '../../series/data/SeriesDataSource.ts';

import { scanCatalogForSearchAsync } from '../searchCatalogScan.ts';
import { SEARCH_PROVIDER_FALLBACK_TIMEOUT_MS } from '../searchConstants.ts';
import { createSearchTimer, logSearchTiming, withSearchTimeout } from '../searchTiming.ts';
import type { SearchPageRequest, SearchPageResult, SeriesSearchResult } from '../searchTypes.ts';

function entryToSearchResult(providerId: string, entry: SeriesCatalogEntry): SeriesSearchResult {
  return {
    type: 'series',
    id: entry.id,
    providerId,
    title: entry.title,
    year: entry.year ? String(entry.year) : undefined,
    posterUrl: entry.posterUrl,
    genres: entry.genreTags,
    rating: entry.rating > 0 ? `${entry.rating}` : undefined,
    seriesId: entry.seriesId,
    categoryId: entry.categoryId,
  };
}

async function searchSeriesCatalogIndex(
  providerId: string,
  query: string,
  offset: number,
  limit: number,
  signal?: AbortSignal,
): Promise<SearchPageResult<SeriesSearchResult> | null> {
  // search-s3-cancellable-series
  const index = getSeriesCatalogIndex(providerId);
  if (!index.size) {
    return null;
  }

  const timer = createSearchTimer();
  const page = await scanCatalogForSearchAsync<SeriesCatalogEntry, SeriesSearchResult>({
    query,
    offset,
    limit,
    forEachEntry: (visit) => index.forEachEntry(visit),
    signal,
    dedupeKey: (entry) => entry.seriesId || entry.id,
    toCandidate: (entry) => ({
      title: entry.title,
      metadata: [entry.genreTags.join(' '), entry.year, entry.rating].filter(Boolean).join(' '),
      popularity: entry.popularity,
      recency: entry.addedAt,
    }),
    toResult: (entry) => entryToSearchResult(providerId, entry),
  });

  logSearchTiming({
    stage: 'index-scan',
    scope: 'series',
    queryLength: query.trim().length,
    repository: 'index',
    candidateCount: page.totalCount,
    returnedCount: page.items.length,
    queryDurationMs: timer.elapsed(),
    totalDurationMs: timer.elapsed(),
    indexSize: index.size,
  });

  return page;
}

export async function searchSeriesDataSourceDirect(
  providerId: string,
  dataSource: SeriesDataSource | null | undefined,
  request: SearchPageRequest,
): Promise<SearchPageResult<SeriesSearchResult>> {
  // search-s4-authoritative-sqlite
  if (request.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  if (!dataSource?.searchSeries) {
    return { items: [], totalCount: 0, hasMore: false };
  }

  const timer = createSearchTimer();
  const page = await dataSource.searchSeries({
    query: request.query,
    offset: request.offset,
    limit: request.limit,
    signal: request.signal,
  });

  if (request.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  const seenSeriesIds = new Set<string>();
  const deduped = page.items.filter((item) => {
    const key = item.seriesId || item.id;
    if (seenSeriesIds.has(key)) {
      return false;
    }
    seenSeriesIds.add(key);
    return true;
  });

  const mapped: SearchPageResult<SeriesSearchResult> = {
    items: deduped.map((series) => seriesSummaryToSearchResult(providerId, series)),
    totalCount: page.totalCount,
    hasMore: page.hasMore,
  };

  const elapsed = timer.elapsed();
  logSearchTiming({
    stage: 'sqlite',
    scope: 'series',
    queryLength: request.query.trim().length,
    repository: 'sqlite',
    returnedCount: mapped.items.length,
    queryDurationMs: elapsed,
    totalDurationMs: elapsed,
  });

  return mapped;
}
export async function searchSeries(
  providerId: string,
  dataSource: SeriesDataSource | null | undefined,
  request: SearchPageRequest,
): Promise<SearchPageResult<SeriesSearchResult>> {
  if (request.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  const indexed = await searchSeriesCatalogIndex(providerId, request.query, request.offset, request.limit, request.signal);
  if (indexed) {
    return indexed;
  }

  if (!dataSource?.searchSeries) {
    return { items: [], totalCount: 0, hasMore: false };
  }

  const timer = createSearchTimer();
  try {
    const page = await withSearchTimeout(
      dataSource.searchSeries({
        query: request.query,
        offset: request.offset,
        limit: request.limit,
        signal: request.signal,
      }),
      SEARCH_PROVIDER_FALLBACK_TIMEOUT_MS,
      'Series search timed out while your library is still indexing.',
      request.signal,
    );

    if (request.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    const seenSeriesIds = new Set<string>();
    const deduped = page.items.filter((item) => {
      const key = item.seriesId || item.id;
      if (seenSeriesIds.has(key)) {
        return false;
      }

      seenSeriesIds.add(key);
      return true;
    });

    if (deduped.length > 0) {
      logSearchTiming({
        stage: 'provider-fallback',
        scope: 'series',
        queryLength: request.query.trim().length,
        repository: 'provider',
        returnedCount: deduped.length,
        queryDurationMs: timer.elapsed(),
        totalDurationMs: timer.elapsed(),
      });

      return {
        items: deduped.map((series) => ({
          type: 'series' as const,
          id: series.id,
          providerId,
          title: series.title,
          year: series.year,
          posterUrl: series.posterUrl,
          genres: series.genres,
          rating: series.rating,
          seriesId: series.seriesId,
          categoryId: series.categoryId,
        })),
        totalCount: page.totalCount,
        hasMore: page.hasMore,
      };
    }
  } catch (error) {
    logSearchTiming({
      stage: 'provider-fallback',
      scope: 'series',
      queryLength: request.query.trim().length,
      repository: 'provider',
      queryDurationMs: timer.elapsed(),
      totalDurationMs: timer.elapsed(),
      timedOut: error instanceof Error && /timed out/i.test(error.message),
    });
    throw error;
  }

  return { items: [], totalCount: 0, hasMore: false };
}

export function seriesSummaryToSearchResult(providerId: string, series: ReturnType<typeof entryToSeriesSummary>): SeriesSearchResult {
  return {
    type: 'series',
    id: series.id,
    providerId,
    title: series.title,
    year: series.year,
    posterUrl: series.posterUrl,
    genres: series.genres,
    rating: series.rating,
    seriesId: series.seriesId,
    categoryId: series.categoryId,
  };
}
