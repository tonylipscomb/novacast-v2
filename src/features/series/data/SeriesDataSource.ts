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
    hasMore: boolean;
  }>;

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
}
