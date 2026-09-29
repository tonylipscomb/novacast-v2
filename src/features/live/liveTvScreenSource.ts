export const LIVE_SCREEN_SOURCE_LOG = '[NovaCast Live Screen Source]';
export const LIVE_SCREEN_READ_TRACE_LOG = '[NovaCast Live Screen Read Trace]';

export type LiveTvScreenSource = 'published-sqlite' | 'provider-fallback' | 'none';

export type LiveTvScreenSourceFields = {
  providerId: string | null;
  source: LiveTvScreenSource | null;
  readableGeneration: number | null;
  publishedTotal: number | null;
  categoryCount: number | null;
  selectedCategoryId: string | null;
  loadedChannelCount: number | null;
  fallbackReason: string | null;
  errorReason: string | null;
};

export type LiveScreenReadTraceEvent =
  | 'model-enter'
  | 'published-state-read-start'
  | 'published-state-read-result'
  | 'published-category-read-start'
  | 'published-category-read-result'
  | 'source-selection'
  | 'selected-category-resolved'
  | 'channel-read-start'
  | 'channel-read-result'
  | 'early-return'
  | 'error';

export type LiveScreenReadTraceFields = {
  providerId?: string | null;
  readableGeneration?: number | null;
  publishedGeneration?: number | null;
  publishedTotal?: number | null;
  categoryCount?: number | null;
  channelCount?: number | null;
  selectedCategoryId?: string | null;
  source?: LiveTvScreenSource | null;
  returnReason?: string | null;
  errorName?: string | null;
  errorMessage?: string | null;
};

export function logLiveScreenSource(fields: LiveTvScreenSourceFields) {
  console.info(
    LIVE_SCREEN_SOURCE_LOG,
    JSON.stringify({
      providerId: fields.providerId,
      source: fields.source,
      readableGeneration: fields.readableGeneration,
      publishedTotal: fields.publishedTotal,
      categoryCount: fields.categoryCount,
      selectedCategoryId: fields.selectedCategoryId,
      loadedChannelCount: fields.loadedChannelCount,
      fallbackReason: fields.fallbackReason,
      errorReason: fields.errorReason,
    }),
  );
}

export function logLiveScreenReadTrace(event: LiveScreenReadTraceEvent, fields: LiveScreenReadTraceFields = {}) {
  console.info(
    LIVE_SCREEN_READ_TRACE_LOG,
    JSON.stringify({
      event,
      providerId: fields.providerId ?? null,
      readableGeneration: fields.readableGeneration ?? null,
      publishedGeneration: fields.publishedGeneration ?? null,
      publishedTotal: fields.publishedTotal ?? null,
      categoryCount: fields.categoryCount ?? null,
      channelCount: fields.channelCount ?? null,
      selectedCategoryId: fields.selectedCategoryId ?? null,
      source: fields.source ?? null,
      returnReason: fields.returnReason ?? null,
      errorName: fields.errorName ?? null,
      errorMessage: fields.errorMessage ?? null,
    }),
  );
}
