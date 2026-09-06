import type { ProviderRepositoryBundle } from '../../providers/providerBundle.ts';

import { GLOBAL_PREVIEW_LIMIT, SEARCH_PAGE_SIZE } from '../searchConstants.ts';
import { createSearchTimer, logSearchTiming } from '../searchTiming.ts';
import type { GroupedSearchResults, SearchPageRequest, SearchPageResult, SearchResult, SearchScope } from '../searchTypes.ts';
import { resolveMoviesSearchDatasource } from '../moviesSearchDatasource.ts';
import { resolveSeriesSearchDatasource } from '../seriesSearchDatasource.ts';
import { novacastTrace } from '../../diagnostics/novacastLogPolicy.ts';
import { searchGuidePrograms } from './guideSearchRepository.ts';
import { searchLiveChannels } from './liveSearchRepository.ts';
import { searchMovies } from './movieSearchRepository.ts';
import { searchSeries, searchSeriesDataSourceDirect } from './seriesSearchRepository.ts';

export function createEmptyGroupedResults(): GroupedSearchResults {
  const empty = { items: [], totalCount: 0, hasMore: false };
  return {
    live: { ...empty },
    movie: { ...empty },
    series: { ...empty },
    guide: { ...empty },
  };
}

export async function searchGlobalGrouped(
  bundle: ProviderRepositoryBundle,
  query: string,
  signal?: AbortSignal,
): Promise<GroupedSearchResults> {
  return searchGlobalGroupedIncremental(bundle, query, signal);
}

export async function searchGlobalGroupedIncremental(
  bundle: ProviderRepositoryBundle,
  query: string,
  signal?: AbortSignal,
  onPartial?: (partial: GroupedSearchResults) => void,
): Promise<GroupedSearchResults> {
  const timer = createSearchTimer();
  const requestBase = {
    providerId: bundle.providerId,
    query,
    signal,
  };
  const grouped = createEmptyGroupedResults();

  const tasks: Array<Promise<void>> = [
    searchLiveChannels(
      bundle.providerId,
      bundle,
      { ...requestBase, offset: 0, limit: GLOBAL_PREVIEW_LIMIT },
      { matchMode: 'global' }, // search-live-s1-global-mode
    )
      .then((live) => {
        if (signal?.aborted) {
          return;
        }
        grouped.live = live;
        onPartial?.({ ...grouped, live: { ...live } });
        logSearchTiming({
          stage: 'scope-complete',
          scope: 'live',
          queryLength: query.trim().length,
          repository: live.items.length > 0 ? 'index' : 'none',
          returnedCount: live.items.length,
          queryDurationMs: timer.elapsed(),
          totalDurationMs: timer.elapsed(),
        });
      })
      .catch(() => undefined),
    searchMovies(bundle.providerId, bundle.movies, { ...requestBase, offset: 0, limit: GLOBAL_PREVIEW_LIMIT })
      .then((movie) => {
        if (signal?.aborted) {
          return;
        }
        grouped.movie = movie;
        onPartial?.({ ...grouped, movie: { ...movie } });
        logSearchTiming({
          stage: 'scope-complete',
          scope: 'movie',
          queryLength: query.trim().length,
          repository: movie.items.length > 0 ? 'index' : 'none',
          returnedCount: movie.items.length,
          queryDurationMs: timer.elapsed(),
          totalDurationMs: timer.elapsed(),
        });
      })
      .catch(() => undefined),
    searchSeries(bundle.providerId, bundle.seriesDataSource, { ...requestBase, offset: 0, limit: GLOBAL_PREVIEW_LIMIT })
      .then((series) => {
        if (signal?.aborted) {
          return;
        }
        grouped.series = series;
        onPartial?.({ ...grouped, series: { ...series } });
        logSearchTiming({
          stage: 'scope-complete',
          scope: 'series',
          queryLength: query.trim().length,
          repository: series.items.length > 0 ? 'index' : 'none',
          returnedCount: series.items.length,
          queryDurationMs: timer.elapsed(),
          totalDurationMs: timer.elapsed(),
        });
      })
      .catch(() => undefined),
    searchGuidePrograms(bundle.providerId, { ...requestBase, offset: 0, limit: GLOBAL_PREVIEW_LIMIT })
      .then((guide) => {
        if (signal?.aborted) {
          return;
        }
        grouped.guide = guide;
        onPartial?.({ ...grouped, guide: { ...guide } });
        logSearchTiming({
          stage: 'scope-complete',
          scope: 'guide',
          queryLength: query.trim().length,
          repository: guide.items.length > 0 ? 'index' : 'none',
          returnedCount: guide.items.length,
          queryDurationMs: timer.elapsed(),
          totalDurationMs: timer.elapsed(),
        });
      })
      .catch(() => undefined),
  ];

  await Promise.all(tasks);

  logSearchTiming({
    stage: 'global-grouped',
    queryLength: query.trim().length,
    repository: 'index',
    returnedCount:
      grouped.live.items.length +
      grouped.movie.items.length +
      grouped.series.items.length +
      grouped.guide.items.length,
    queryDurationMs: timer.elapsed(),
    totalDurationMs: timer.elapsed(),
  });

  return grouped;
}

export async function searchByScope(
  bundle: ProviderRepositoryBundle,
  scope: SearchScope,
  request: SearchPageRequest,
): Promise<SearchPageResult<SearchResult>> {
  switch (scope) {
    case 'live':
      return searchLiveChannels(bundle.providerId, bundle, request);
    case 'movie': {
      // search-s4-authoritative-sqlite
      const selection = await resolveMoviesSearchDatasource({
        providerId: bundle.providerId,
        query: request.query,
        bundleMovies: bundle.movies,
      });
      return searchMovies(bundle.providerId, selection.dataSource, request);
    }
    case 'series': {
      // search-s4-authoritative-sqlite
      const startedAt = Date.now();
      const selection = await resolveSeriesSearchDatasource({
        providerId: bundle.providerId,
        query: request.query,
        offset: request.offset,
        limit: request.limit,
        bundleSeriesDataSource: bundle.seriesDataSource,
      });
      let result: SearchPageResult<SearchResult>;
      if (selection.selectedDatasource === 'sqlite-v2') {
        result = await searchSeriesDataSourceDirect(bundle.providerId, selection.dataSource, request);
      } else {
        result = await searchSeries(bundle.providerId, selection.dataSource, request);
      }
      novacastTrace(
        '[NovaCast Series Search Complete] ' +
          JSON.stringify({
            selectedDatasource: selection.selectedDatasource,
            elapsedMs: Date.now() - startedAt,
            returnedCount: result.items.length,
          }),
      );
      return result;
    }
    case 'guide':
      return searchGuidePrograms(bundle.providerId, request);
    case 'all':
    default: {
      const grouped = await searchGlobalGrouped(bundle, request.query, request.signal);
      const combined: SearchResult[] = [
        ...grouped.live.items,
        ...grouped.movie.items,
        ...grouped.series.items,
        ...grouped.guide.items,
      ];
      return {
        items: combined.slice(request.offset, request.offset + request.limit),
        totalCount:
          grouped.live.totalCount + grouped.movie.totalCount + grouped.series.totalCount + grouped.guide.totalCount,
        hasMore: request.offset + request.limit < combined.length,
      };
    }
  }
}

export function defaultScopedSearchPageSize(scope: SearchScope) {
  return scope === 'all' ? GLOBAL_PREVIEW_LIMIT : SEARCH_PAGE_SIZE;
}
