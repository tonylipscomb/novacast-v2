/** Maximum unique Movie/Series entries indexed for smart-category generation. */
export const MAX_CATALOG_INDEX_ITEMS = 100_000;

export type CatalogCompletenessMetadata = {
  knownCatalogTotal: number;
  itemsIndexed: number;
  catalogComplete: boolean;
};

export function buildCatalogCompleteness(
  knownCatalogTotal: number,
  itemsIndexed: number,
  options: { indexTruncated?: boolean; categoryLoadTruncated?: boolean } = {},
): CatalogCompletenessMetadata {
  const catalogComplete =
    !options.indexTruncated &&
    !options.categoryLoadTruncated &&
    knownCatalogTotal > 0 &&
    knownCatalogTotal === itemsIndexed;

  return {
    knownCatalogTotal,
    itemsIndexed,
    catalogComplete,
  };
}
