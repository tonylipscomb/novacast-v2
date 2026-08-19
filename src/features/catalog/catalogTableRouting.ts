import type { CatalogMediaType } from './catalogTypes.ts';

/** Stage 3C marker — generation-safe Movies catalog tables. */
export const STAGE3C_GENERATION_SAFE_MARKER = 'stage3c-generation-safe-catalog-v2';

/**
 * Stage 4.2O.2: Movies and Series both use generation-scoped v2 tables.
 * The v2 schema was already parameterized by media_type — Series simply
 * flows through the same generic tables/functions Movies uses, filtered by
 * media_type: 'series'. Legacy (non-generation-scoped) tables are retained
 * for rollback / pre-migration fragment recovery only.
 */
export function usesGenerationSafeCatalog(mediaType: CatalogMediaType): boolean {
  return mediaType === 'movie' || mediaType === 'series';
}

export function catalogItemsTable(mediaType: CatalogMediaType): string {
  return usesGenerationSafeCatalog(mediaType) ? 'catalog_items_v2' : 'catalog_items';
}

export function catalogCategoriesTable(mediaType: CatalogMediaType): string {
  return usesGenerationSafeCatalog(mediaType) ? 'catalog_categories_v2' : 'catalog_categories';
}

export function catalogSeasonsTable(_mediaType: CatalogMediaType): string {
  // Seasons/episodes are not stored in the browse-level catalog for either
  // media type — Series season/episode hydration stays on-demand via the
  // provider path (see Stage 4.2O.2 report, "browse SQLite is card-level only").
  return 'catalog_seasons';
}

export function catalogItemsConflictTarget(mediaType: CatalogMediaType): string {
  return usesGenerationSafeCatalog(mediaType)
    ? 'provider_id, media_type, sync_generation, content_id'
    : 'provider_id, media_type, content_id';
}

export function catalogCategoriesConflictTarget(mediaType: CatalogMediaType): string {
  return usesGenerationSafeCatalog(mediaType)
    ? 'provider_id, media_type, sync_generation, category_id'
    : 'provider_id, media_type, category_id';
}
