import type { MovieDataSource } from './MovieDataSource.ts';
import { MOCK_ALL_MOVIES, MOCK_MOVIE_CATEGORIES, matchesMovie, normalizeQuery } from '../movieMockData.ts';
import type { MovieCategory, MovieSummary } from '../movieTypes.ts';
import { sortContentItems, type ContentSortOption } from '../../media-browser/contentSorting.ts';

function pageItems(items: MovieSummary[], offset: number, limit: number) {
  const start = Math.max(0, offset);
  const end = Math.max(start, start + limit);
  const sliced = items.slice(start, end);

  return {
    items: sliced,
    totalCount: items.length,
    hasMore: end < items.length,
  };
}

export class MockMovieDataSource implements MovieDataSource {
  readonly providerId: string;

  constructor(providerId = 'demo-provider') {
    this.providerId = providerId;
  }

  async getCategories(): Promise<MovieCategory[]> {
    return MOCK_MOVIE_CATEGORIES;
  }

  async getMoviesPage(input: {
    categoryId: string;
    offset: number;
    limit: number;
    sort?: ContentSortOption;
  }): Promise<{
    items: MovieSummary[];
    totalCount: number;
    hasMore: boolean;
  }> {
    const source =
      input.categoryId === 'all'
        ? MOCK_ALL_MOVIES
        : MOCK_ALL_MOVIES.filter((movie) => movie.categoryId === input.categoryId);

    return pageItems(sortContentItems(source, input.sort ?? 'newest', 'movie'), input.offset, input.limit);
  }

  async searchMovies(input: {
    query: string;
    offset: number;
    limit: number;
  }): Promise<{
    items: MovieSummary[];
    totalCount: number;
    hasMore: boolean;
  }> {
    const normalized = normalizeQuery(input.query);
    const matches = MOCK_ALL_MOVIES.filter((movie) => matchesMovie(movie, normalized));

    return pageItems(matches, input.offset, input.limit);
  }

  async getCategoryCount(categoryId: string): Promise<number> {
    if (categoryId === 'all') {
      return MOCK_ALL_MOVIES.length;
    }

    return MOCK_ALL_MOVIES.filter((movie) => movie.categoryId === categoryId).length;
  }

  async prefetchAllCategoryCounts(
    categoryIds: string[],
    onCategoryCount: (categoryId: string, count: number) => void,
  ): Promise<void> {
    for (const categoryId of categoryIds) {
      onCategoryCount(categoryId, await this.getCategoryCount(categoryId));
    }
  }

  async listCategoryMovies(categoryId: string): Promise<MovieSummary[]> {
    if (categoryId === 'all') {
      return MOCK_ALL_MOVIES;
    }

    return MOCK_ALL_MOVIES.filter((movie) => movie.categoryId === categoryId);
  }
}
