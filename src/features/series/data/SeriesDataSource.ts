import type { MediaCategory, SeriesDetail, SeriesSummary } from '../../media-browser/mediaTypes.ts';
import type { ContentSortOption } from '../../media-browser/contentSorting.ts';

export interface SeriesDataSource {
  getCategories(): Promise<MediaCategory[]>;

  getSeriesPage(input: {
    categoryId: string;
    offset: number;
    limit: number;
    sort?: ContentSortOption;
  }): Promise<{
    items: SeriesSummary[];
    totalCount: number;
    /**
     * series-total-count-exactness-v1
     * false means totalCount is only a lower-bound/pagination estimate and
     * must not overwrite an authoritative category count.
     * Omitted means exact/backward-compatible for existing provider sources.
     */
    totalCountIsExact?: boolean;
    hasMore: boolean;
  }>;

  searchSeries?(input: {
    query: string;
    offset: number;
    limit: number;
    // search-s3-cancellable-series
    signal?: AbortSignal;
  }): Promise<{
    items: SeriesSummary[];
    totalCount: number;
    hasMore: boolean;
  }>;

  getSeriesInfo(seriesId: string): Promise<SeriesDetail | null>;

  getCategoryCount?(categoryId: string): Promise<number>;

  prefetchAllCategoryCounts?(
    categoryIds: string[],
    onCategoryCount: (categoryId: string, count: number) => void,
  ): Promise<void>;

  listCategorySeries?(categoryId: string): Promise<SeriesSummary[]>;

  /**
   * Absolute Xtream player_api URL for native off-JS catalog decode.
   * Must never be logged. Returns null when native decode cannot be used.
   */
  getCatalogListRequestUrl?(categoryId: string): string | null;
}
