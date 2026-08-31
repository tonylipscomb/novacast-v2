export const SERIES_SCREEN_SOURCE_LOG = '[NovaCast Series Screen Source]';

export type SeriesScreenSource = 'published-sqlite' | 'provider-fallback';

export type SeriesScreenSourceFields = {
  providerId: string | null;
  source: SeriesScreenSource | null;
  readableGeneration: number | null;
  publishedTotal: number | null;
  metadataCategoryCount: number | null;
  publishedCategoryCount: number | null;
  selectedCategoryId: string | null;
  loadedSeriesCount: number | null;
  fallbackReason: string | null;
  errorReason: string | null;
};

export function logSeriesScreenSource(fields: SeriesScreenSourceFields) {
  console.info(
    SERIES_SCREEN_SOURCE_LOG,
    JSON.stringify({
      providerId: fields.providerId,
      source: fields.source,
      readableGeneration: fields.readableGeneration,
      publishedTotal: fields.publishedTotal,
      metadataCategoryCount: fields.metadataCategoryCount,
      publishedCategoryCount: fields.publishedCategoryCount,
      selectedCategoryId: fields.selectedCategoryId,
      loadedSeriesCount: fields.loadedSeriesCount,
      fallbackReason: fields.fallbackReason,
      errorReason: fields.errorReason,
    }),
  );
}
