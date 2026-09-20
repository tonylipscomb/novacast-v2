import {
  AnalyticsValidationError,
  clampTimestamp,
  hashContentReference,
  hashProviderReference,
  optionalNonnegativeInteger,
  requiredString,
} from './analytics.ts';

export const RECOMMENDATION_EVENT_TYPES = [
  'play_start', 'meaningful_watch', 'complete', 'abandon', 'repeat_watch',
  'favorite_add', 'favorite_remove', 'watchlist_add', 'watchlist_remove',
] as const;
export const RECOMMENDATION_CONTENT_TYPES = ['movie', 'series', 'episode', 'live'] as const;
export const RECOMMENDATION_PROGRESS_BUCKETS = ['started', 'meaningful', 'half', 'near_complete', 'complete'] as const;
export const MAX_RECOMMENDATION_BATCH = 50;
export const MAX_RECOMMENDATION_BODY_BYTES = 32 * 1024;

export type RecommendationEventType = typeof RECOMMENDATION_EVENT_TYPES[number];
export type RecommendationContentType = typeof RECOMMENDATION_CONTENT_TYPES[number];

type RecommendationInput = Record<string, unknown>;

const allowedKeys = new Set([
  'eventType', 'contentType', 'fingerprint', 'providerId', 'providerContentId', 'sessionId',
  'occurredAt', 'watchDurationMs', 'contentDurationMs', 'progressBucket', 'idempotencyKey',
]);

function enumValue<T extends readonly string[]>(value: unknown, values: T, category: string): T[number] {
  const text = requiredString(value, 48, category);
  if (!values.includes(text)) throw new AnalyticsValidationError(category);
  return text as T[number];
}

function requiredReference(value: unknown, max: number, category: string) {
  const result = requiredString(value, max, category).trim();
  if (!result) throw new AnalyticsValidationError(category);
  return result;
}

function timestamp(value: unknown, now = Date.now()) {
  const raw = requiredString(value, 80, 'malformed_timestamp');
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed) || parsed > now + 5 * 60_000 || parsed < now - 7 * 24 * 60 * 60_000) {
    throw new AnalyticsValidationError('malformed_timestamp');
  }
  return clampTimestamp(raw, now).toISOString();
}

function assertSemantics(eventType: RecommendationEventType, contentType: RecommendationContentType) {
  if ((eventType === 'meaningful_watch' || eventType === 'complete' || eventType === 'abandon' || eventType === 'repeat_watch') && contentType === 'live') {
    throw new AnalyticsValidationError('invalid_event_semantics');
  }
  if ((eventType.startsWith('favorite_') || eventType.startsWith('watchlist_')) && contentType === 'live') {
    throw new AnalyticsValidationError('invalid_event_semantics');
  }
}

export async function validateRecommendationEvent(input: unknown, now = Date.now()) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AnalyticsValidationError('invalid_field_type');
  const event = input as RecommendationInput;
  for (const key of Object.keys(event)) {
    if (!allowedKeys.has(key)) throw new AnalyticsValidationError('unexpected_field');
  }

  const eventType = enumValue(event.eventType, RECOMMENDATION_EVENT_TYPES, 'invalid_event_type');
  const contentType = enumValue(event.contentType, RECOMMENDATION_CONTENT_TYPES, 'invalid_content_type');
  assertSemantics(eventType, contentType);
  const fingerprint = requiredReference(event.fingerprint, 512, 'invalid_fingerprint');
  const providerId = requiredReference(event.providerId, 256, 'invalid_provider_reference');
  const providerContentId = requiredReference(event.providerContentId, 256, 'invalid_content_reference');
  const sessionId = requiredReference(event.sessionId, 160, 'invalid_session');
  const idempotencyKey = requiredReference(event.idempotencyKey, 256, 'invalid_idempotency_key');
  const occurredAt = timestamp(event.occurredAt, now);
  const watchDurationMs = optionalNonnegativeInteger(event.watchDurationMs, 'invalid_duration');
  const contentDurationMs = optionalNonnegativeInteger(event.contentDurationMs, 'invalid_duration');
  if (watchDurationMs != null && watchDurationMs > 7 * 24 * 60 * 60_000) throw new AnalyticsValidationError('invalid_duration');
  if (contentDurationMs != null && contentDurationMs > 7 * 24 * 60 * 60_000) throw new AnalyticsValidationError('invalid_duration');
  const progressBucket = event.progressBucket == null ? undefined : enumValue(event.progressBucket, RECOMMENDATION_PROGRESS_BUCKETS, 'invalid_progress_bucket');

  return {
    eventType,
    contentType,
    occurredAt,
    watchDurationMs,
    contentDurationMs,
    progressBucket,
    refs: {
      sessionRef: await hashContentReference(`recommendation-session:${sessionId}`),
      providerRef: await hashProviderReference(providerId),
      providerContentRef: await hashContentReference(`recommendation-content:${providerContentId}`),
      contentFingerprintRef: await hashContentReference(`recommendation-fingerprint:${fingerprint}`),
      idempotencyRef: await hashContentReference(`recommendation-idempotency:${idempotencyKey}`),
    },
  };
}
