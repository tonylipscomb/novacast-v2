import type { MediaCategory, SeriesDetail, SeriesSummary } from '../../media-browser/mediaTypes.ts';
import type { ContentSortOption } from '../../media-browser/contentSorting.ts';

export type SeriesQueryPurpose = 'startup-viewport' | 'category-switch' | 'pagination' | 'search';

export interface SeriesDataSource {
  getCategories(): Promise<MediaCategory[]>;

  getSeriesPage(input: {
    categoryId: string;
    offset: number;
    limit: number;
    sort?: ContentSortOption;
    /** Stage 4.2P #7: caller states the query's purpose explicitly — the data source never infers it from `offset`. */
    queryPurpose?: SeriesQueryPurpose;
  }): Promise<{
    items: SeriesSummary[];
    totalCount: number;
    hasMore: boolean;
  }>;

  /**
   * Stage 4.2P #1/#3 — cheap current-readable-generation probe used only for
   * the warm-reconcile short-circuit validation in `useSeriesScreenModel.ts`.
   * SQLite-backed sources return the real readable generation (0 when none
   * is readable); sources without a local SQLite catalog omit this method
   * entirely so callers fail closed to the existing reconciliation path.
   */
  getReadableGeneration?(): Promise<number>;

  searchSeries?(input: {
    query: string;
    offset: number;
    limit: number;
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
