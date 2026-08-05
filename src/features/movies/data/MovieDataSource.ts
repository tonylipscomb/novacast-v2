import type { MovieCategory, MovieSummary } from '../movieTypes.ts';
import type { ContentSortOption } from '../../media-browser/contentSorting.ts';
import type { MediaDetail } from '../../media-browser/mediaTypes.ts';

export interface MovieDataSource {
  /** Identifies the active read backend without changing the public data contract. */
  sourceKind?: 'legacy' | 'sqlite';

  getCategories(): Promise<MovieCategory[]>;

  getMoviesPage(input: {
    categoryId: string;
    offset: number;
    limit: number;
    sort?: ContentSortOption;
    /**
     * Stage 4.2L.1: when set with queryPurpose 'startup-viewport', read only the
     * bounded SQL page for this generation — no readiness/recovery/inventory.
     */
    pinnedGeneration?: number;
    startupSessionId?: string | null;
    queryPurpose?: 'startup-viewport' | 'runtime';
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

  /**
   * Optional progressive enrichment after local Detail is shown.
   * Must not remount Detail; merge into the existing record when possible.
   */
  enrichMovieInfo?(movieId: string): Promise<MediaDetail | null>;

  /** Xtream providers resolve counts lazily, one category at a time. */
  getCategoryCount?(categoryId: string): Promise<number>;

  /** Prefetch title counts for many categories without retaining full stream payloads. */
  prefetchAllCategoryCounts?(
    categoryIds: string[],
    onCategoryCount: (categoryId: string, count: number) => void,
  ): Promise<void>;

  /** Load all movies for a provider category (used by background catalog sync). */
  listCategoryMovies?(categoryId: string): Promise<MovieSummary[]>;

  /**
   * Absolute Xtream player_api URL for native off-JS catalog decode.
   * Must never be logged. Returns null when native decode cannot be used.
   */
  getCatalogListRequestUrl?(categoryId: string): string | null;
}
