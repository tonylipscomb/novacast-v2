export const SERIES_DATA_SOURCE_AUDIT = '[NovaCast Series Data Source Audit]';

export type SeriesDataSourceAuditEvent =
  | 'screen-enter'
  | 'data-source-selection'
  | 'sqlite-source-created'
  | 'repository-source-created'
  | 'source-getCategories-enter'
  | 'source-getCategories-result'
  | 'source-getItems-enter'
  | 'source-getItems-result'
  | 'fallback-triggered'
  | 'source-error';

export type SeriesDataSourceAuditFields = {
  event: SeriesDataSourceAuditEvent;
  providerId?: string | null;
  selectedSource?: string | null;
  sourceClass?: string | null;
  sqliteEnabled?: boolean | null;
  readableGeneration?: number | null;
  generationStatus?: string | null;
  categoryCount?: number | null;
  itemCount?: number | null;
  selectedCategoryId?: string | null;
  fallbackReason?: string | null;
  errorName?: string | null;
  errorMessage?: string | null;
  [key: string]: unknown;
};

export function logSeriesDataSourceAudit(fields: SeriesDataSourceAuditFields): void {
  console.info(
    SERIES_DATA_SOURCE_AUDIT,
    JSON.stringify({
      event: fields.event,
      providerId: fields.providerId ?? null,
      selectedSource: fields.selectedSource ?? null,
      sourceClass: fields.sourceClass ?? null,
      sqliteEnabled: fields.sqliteEnabled ?? null,
      readableGeneration: fields.readableGeneration ?? null,
      generationStatus: fields.generationStatus ?? null,
      categoryCount: fields.categoryCount ?? null,
      itemCount: fields.itemCount ?? null,
      selectedCategoryId: fields.selectedCategoryId ?? null,
      fallbackReason: fields.fallbackReason ?? null,
      errorName: fields.errorName ?? null,
      errorMessage: fields.errorMessage ?? null,
    }),
  );
}
