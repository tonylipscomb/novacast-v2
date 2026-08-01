import type { CatalogMediaType } from './catalogTypes.ts';

/** Stage 3C marker — generation-safe Movies catalog tables. */
export const STAGE3C_GENERATION_SAFE_MARKER = 'stage3c-generation-safe-catalog-v2';

/**
 * Movies use generation-scoped v2 tables.
 * Series remain on legacy tables for this stage (no Series UI migration).
 */
export function usesGenerationSafeCatalog(mediaType: CatalogMediaType): boolean {
  return mediaType === 'movie';
}

export function catalogItemsTable(mediaType: CatalogMediaType): string {
  return usesGenerationSafeCatalog(mediaType) ? 'catalog_items_v2' : 'catalog_items';
}

export function catalogCategoriesTable(mediaType: CatalogMediaType): string {
  return usesGenerationSafeCatalog(mediaType) ? 'catalog_categories_v2' : 'catalog_categories';
}

export function catalogSeasonsTable(_mediaType: CatalogMediaType): string {
  // Series seasons stay on legacy; Movies do not write seasons in Stage 3C.
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
