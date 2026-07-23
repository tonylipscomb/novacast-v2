import type { MovieCategory, MovieSummary } from '../movieTypes.ts';
import type { ContentSortOption } from '../../media-browser/contentSorting.ts';
import type { MediaDetail } from '../../media-browser/mediaTypes.ts';

export interface MovieDataSource {
  getCategories(): Promise<MovieCategory[]>;

  getMoviesPage(input: {
    categoryId: string;
    offset: number;
    limit: number;
    sort?: ContentSortOption;
  }): Promise<{
    items: MovieSummary[];
    totalCount: number;
    hasMore: boolean;
  }>;

  searchMovies(input: {
    query: string;
    offset: number;
    limit: number;
  }): Promise<{
    items: MovieSummary[];
    totalCount: number;
    hasMore: boolean;
  }>;

  getMovieInfo?(movieId: string): Promise<MediaDetail | null>;

  /** Xtream providers resolve counts lazily, one category at a time. */
  getCategoryCount?(categoryId: string): Promise<number>;

  /** Prefetch title counts for many categories without retaining full stream payloads. */
  prefetchAllCategoryCounts?(
    categoryIds: string[],
    onCategoryCount: (categoryId: string, count: number) => void,
  ): Promise<void>;

  /** Load all movies for a provider category (used by background catalog sync). */
  listCategoryMovies?(categoryId: string): Promise<MovieSummary[]>;
}
