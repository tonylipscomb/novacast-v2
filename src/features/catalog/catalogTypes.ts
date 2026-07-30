/**
 * Stage 1 local catalog types.
 * No React. Not wired to UI screens yet.
 */

export type CatalogMediaType = 'movie' | 'series';

export type CatalogSyncStatus =
  | 'idle'
  | 'syncing'
  | 'ready'
  | 'error';

export type CatalogItemSort = 'title' | 'newest' | 'rating' | 'provider';

export type CatalogProviderRecord = {
  providerId: string;
  providerType: string;
  displayName?: string | null;
  catalogGeneration: number;
  lastSuccessfulSyncAt?: number | null;
  lastAttemptedSyncAt?: number | null;
  syncStatus?: CatalogSyncStatus | null;
  syncErrorCode?: string | null;
};

export type CatalogCategoryRecord = {
  providerId: string;
  mediaType: CatalogMediaType;
  categoryId: string;
  categoryName: string;
  sortOrder?: number | null;
  itemCount?: number;
  syncGeneration: number;
  updatedAt: number;
};

export type CatalogItemRecord = {
  providerId: string;
  mediaType: CatalogMediaType;
  contentId: string;
  categoryId?: string | null;
  title: string;
  normalizedTitle: string;
  artworkUrl?: string | null;
  backdropUrl?: string | null;
  releaseDate?: string | null;
  releaseYear?: number | null;
  rating?: number | null;
  description?: string | null;
  streamExtension?: string | null;
  providerSortOrder?: number | null;
  /** Derived US-first rank; lower preferred. Not computed on per-category fetch. */
  regionRank?: number | null;
  seriesId?: string | null;
  seasonNumber?: number | null;
  episodeNumber?: number | null;
  syncGeneration: number;
  updatedAt: number;
};

export type CatalogSeasonRecord = {
  providerId: string;
  seriesId: string;
  seasonNumber: number;
  title?: string | null;
  artworkUrl?: string | null;
  episodeCount?: number;
  syncGeneration: number;
  updatedAt: number;
};

export type CatalogSyncStateRecord = {
  providerId: string;
  mediaType: CatalogMediaType;
  status: CatalogSyncStatus;
  phase?: string | null;
  processedCount: number;
  totalCount?: number | null;
  generation: number;
  startedAt?: number | null;
  completedAt?: number | null;
  errorCode?: string | null;
};

export type CatalogItemsPageQuery = {
  providerId: string;
  mediaType: CatalogMediaType;
  categoryId?: string | null;
  query?: string | null;
  limit?: number;
  offset?: number;
  sort?: CatalogItemSort;
};

export type CatalogItemsPage = {
  items: CatalogItemRecord[];
  totalCount: number;
  limit: number;
  offset: number;
  hasMore: boolean;
};

/** Default UI page size band is 36–50; Stage 1 uses 48. */
export const CATALOG_DEFAULT_PAGE_SIZE = 48;

export const CATALOG_SCHEMA_VERSION = 1;

export const CATALOG_DATABASE_NAME = 'novacast-catalog.db';

export function normalizeCatalogTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, ' ');
}
