import { entryToSummary, getMovieCatalogIndex, type MovieCatalogEntry } from '../../movies/smart/movieCatalogIndex.ts';
import type { MovieDataSource } from '../../movies/data/MovieDataSource.ts';
import { matchesMovie } from '../../movies/movieMockData.ts';
import { normalizeSearchQuery } from '../searchQuery.ts';

import { scanCatalogForSearchAsync } from '../searchCatalogScan.ts';
import { compareSearchCandidates } from '../searchRanking.ts';
import { SEARCH_PROVIDER_FALLBACK_TIMEOUT_MS } from '../searchConstants.ts';
import { createSearchTimer, logSearchTiming, withSearchTimeout } from '../searchTiming.ts';
import type { MovieSearchResult, SearchPageRequest, SearchPageResult } from '../searchTypes.ts';

function entryToSearchResult(providerId: string, entry: MovieCatalogEntry): MovieSearchResult {
  return {
    type: 'movie',
    id: entry.id,
    providerId,
    title: entry.title,
    year: entry.year,
    posterUrl: entry.posterUrl,
    genres: entry.genreTags,
    rating: entry.rating > 0 ? `${entry.rating}` : undefined,
    categoryId: entry.categoryId,
  };
}

function searchMovieCatalogIndex(
  providerId: string,
  query: string,
  offset: number,
  limit: number,
  signal?: AbortSignal,
): Promise<SearchPageResult<MovieSearchResult> | null> {
  const index = getMovieCatalogIndex(providerId);
  if (!index.size) {
    return Promise.resolve(null);
  }

  index.ensureSearchMetadata();

  const timer = createSearchTimer();
  return scanCatalogForSearchAsync<MovieCatalogEntry, MovieSearchResult>({
    query,
    offset,
    limit,
    signal,
    forEachEntry: (visit) => index.forEachEntry(visit),
    fastReject: (entry, normalizedQuery) => {
      const haystack = entry.searchHaystack || entry.normalizedTitle || normalizeSearchQuery(entry.title);
      return !haystack.includes(normalizedQuery);
    },
    toCandidate: (entry) => ({
      title: entry.title,
      metadata: entry.searchHaystack,
      popularity: entry.popularity,
      recency: entry.added,
    }),
    toResult: (entry) => entryToSearchResult(providerId, entry),
  }).then((page) => {
    logSearchTiming({
      stage: 'index-scan',
      scope: 'movie',
      queryLength: query.trim().length,
      repository: 'index',
      candidateCount: page.totalCount,
      returnedCount: page.items.length,
      queryDurationMs: timer.elapsed(),
      totalDurationMs: timer.elapsed(),
      indexSize: index.size,
    });

    return page;
  });
}

export async function searchMovies(
  providerId: string,
  dataSource: MovieDataSource | null | undefined,
  request: SearchPageRequest,
): Promise<SearchPageResult<MovieSearchResult>> {
  if (request.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  const indexed = await searchMovieCatalogIndex(providerId, request.query, request.offset, request.limit, request.signal);
  if (indexed) {
    return indexed;
  }

  if (!dataSource?.searchMovies) {
    return { items: [], totalCount: 0, hasMore: false };
  }

  const timer = createSearchTimer();
  try {
    const page = await withSearchTimeout(
      dataSource.searchMovies({
        query: request.query,
        offset: request.offset,
        limit: request.limit,
      }),
      SEARCH_PROVIDER_FALLBACK_TIMEOUT_MS,
      'Movie search timed out while your library is still indexing.',
    );

    if (request.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    if (page.totalCount > 0) {
      const normalized = request.query.trim().toLowerCase();
      const sorted = [...page.items].sort((left, right) => {
        if (matchesMovie(left, normalized) && !matchesMovie(right, normalized)) {
          return -1;
        }

        if (!matchesMovie(left, normalized) && matchesMovie(right, normalized)) {
          return 1;
        }

        return compareSearchCandidates(request.query, { title: left.title }, { title: right.title });
      });

      const mapped = sorted.map((movie) => ({
        type: 'movie' as const,
        id: movie.id,
        providerId,
        title: movie.title,
        year: movie.year,
        posterUrl: movie.posterUrl,
        genres: movie.genres,
        rating: movie.rating,
        categoryId: movie.categoryId,
      }));

      logSearchTiming({
        stage: 'provider-fallback',
        scope: 'movie',
        queryLength: request.query.trim().length,
        repository: 'provider',
        returnedCount: mapped.length,
        queryDurationMs: timer.elapsed(),
        totalDurationMs: timer.elapsed(),
      });

      return {
        items: mapped,
        totalCount: page.totalCount,
        hasMore: page.hasMore,
      };
    }
  } catch (error) {
    logSearchTiming({
      stage: 'provider-fallback',
      scope: 'movie',
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

export function movieSummaryToSearchResult(providerId: string, movie: ReturnType<typeof entryToSummary>): MovieSearchResult {
  return {
    type: 'movie',
    id: movie.id,
    providerId,
    title: movie.title,
    year: movie.year,
    posterUrl: movie.posterUrl,
    genres: movie.genres,
    rating: movie.rating,
    categoryId: movie.categoryId,
  };
}
