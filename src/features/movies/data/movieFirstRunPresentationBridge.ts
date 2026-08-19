import type { MovieDataSource } from './MovieDataSource.ts';
import type { MovieCategory, MovieSummary } from '../movieTypes.ts';
import type { ContentSortOption } from '../../media-browser/contentSorting.ts';

const BRIDGE_PAGE_LIMIT = 30;

function logBridge(event: string, fields: Record<string, unknown> = {}) {
  console.info('[NovaCast Movies First Run Bridge]', JSON.stringify({ event, ...fields }));
}

export function createMovieFirstRunPresentationBridge(
  providerId: string,
  providerMovies: MovieDataSource,
): MovieDataSource {
  const categoryCache = new Map<string, Promise<MovieCategory[]>>();
  const pageCache = new Map<string, Promise<{ items: MovieSummary[]; totalCount: number; hasMore: boolean }>>();
  let bridgeEpoch = 0;

  const getCategories = async () => {
    const startedAt = Date.now();
    const cached = categoryCache.get('categories');
    if (cached) {
      logBridge('bridge-category-cache-hit', { providerId, bridgeEpoch });
      return cached;
    }
    const request = providerMovies.getCategories();
    categoryCache.set('categories', request);
    logBridge('bridge-categories-request', { providerId, bridgeEpoch });
    const categories = await request;
    logBridge('bridge-categories-ready', {
      providerId,
      bridgeEpoch,
      returnedCount: categories.length,
      elapsedMs: Date.now() - startedAt,
    });
    return categories;
  };

  const getMoviesPage = (input: {
    categoryId: string;
    offset: number;
    limit: number;
    sort?: ContentSortOption;
  }) => {
    const limit = Math.min(Math.max(1, input.limit), BRIDGE_PAGE_LIMIT);
    const key = `${input.categoryId}:${input.offset}:${limit}:${input.sort ?? 'newest'}`;
    const cached = pageCache.get(key);
    if (cached) {
      logBridge('bridge-category-cache-hit', {
        providerId,
        bridgeEpoch,
        selectedCategoryId: input.categoryId,
        requestedLimit: limit,
      });
      return cached;
    }

    const requestStartedAt = Date.now();
    logBridge('bridge-page-request', {
      providerId,
      bridgeEpoch,
      selectedCategoryId: input.categoryId,
      requestedLimit: limit,
      requestToken: key,
    });
    const request = providerMovies.getMoviesPage({ ...input, limit });
    pageCache.set(key, request);
    return request.then((page) => {
      logBridge('bridge-page-ready', {
        providerId,
        bridgeEpoch,
        selectedCategoryId: input.categoryId,
        requestedLimit: limit,
        returnedCount: page.items.length,
        elapsedMs: Date.now() - requestStartedAt,
        requestToken: key,
      });
      return page;
    });
  };

  return {
    sourceKind: 'legacy',
    getCategories,
    getMoviesPage,
    searchMovies: (input) => providerMovies.searchMovies(input),
    getMovieInfo: providerMovies.getMovieInfo
      ? (movieId) => providerMovies.getMovieInfo!(movieId)
      : undefined,
    enrichMovieInfo: providerMovies.enrichMovieInfo
      ? (movieId) => providerMovies.enrichMovieInfo!(movieId)
      : undefined,
    getCategoryCount: providerMovies.getCategoryCount
      ? (categoryId) => providerMovies.getCategoryCount!(categoryId)
      : undefined,
    prefetchAllCategoryCounts: providerMovies.prefetchAllCategoryCounts
      ? (categoryIds, onCategoryCount) => providerMovies.prefetchAllCategoryCounts!(categoryIds, onCategoryCount)
      : undefined,
    listCategoryMovies: providerMovies.listCategoryMovies
      ? (categoryId) => providerMovies.listCategoryMovies!(categoryId)
      : undefined,
    getCatalogListRequestUrl: providerMovies.getCatalogListRequestUrl
      ? (categoryId) => providerMovies.getCatalogListRequestUrl!(categoryId)
      : undefined,
  };
}
