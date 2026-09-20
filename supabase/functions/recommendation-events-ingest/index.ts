import { authenticateDevice } from '../_shared/device.ts';
import { jsonResponse, optionsResponse } from '../_shared/http.ts';
import { getAdminClient } from '../_shared/supabase.ts';
import { AnalyticsValidationError, MAX_EVENTS_PER_HOUR, responseStatus } from '../_shared/analytics.ts';
import {
  MAX_RECOMMENDATION_BATCH,
  MAX_RECOMMENDATION_BODY_BYTES,
  validateRecommendationEvent,
} from '../_shared/recommendationEvents.ts';

function temporaryDatabaseError(error: unknown) {
  return Boolean(error && typeof error === 'object' && 'code' in error && ['08000', '08003', '08006', '57P01'].includes(String((error as { code?: unknown }).code)));
}

function errorResponse(category: string, status = responseStatus(category)) {
  return jsonResponse({ ok: false, accepted: 0, duplicates: 0, invalid: 0, transientFailed: 0, errorCategory: category, retryable: status >= 500 || status === 408 || status === 429 }, status);
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return optionsResponse();
  if (request.method !== 'POST') return errorResponse('method_not_allowed');

  try {
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_RECOMMENDATION_BODY_BYTES) return errorResponse('body_size_limit');
    let body: Record<string, unknown>;
    try {
      const parsed = JSON.parse(rawBody);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid_body');
      body = parsed as Record<string, unknown>;
    } catch {
      return errorResponse('invalid_json');
    }
    const events = body.events;
    if (!Array.isArray(events)) return errorResponse('invalid_field_type');
    if (events.length > MAX_RECOMMENDATION_BATCH) return errorResponse('batch_size_limit');
    const client = getAdminClient();
    const device = await authenticateDevice(request, client);
    const rateLimit = await client.rpc('consume_analytics_rate_limit', {
      p_device_id: device.id,
      p_event_count: events.length,
      p_limit: MAX_EVENTS_PER_HOUR,
      p_window_seconds: 3600,
    });
    if (rateLimit.error) return errorResponse(temporaryDatabaseError(rateLimit.error) ? 'temporary_database_error' : 'rate_limit_failed');
    if (!rateLimit.data) return errorResponse('rate_limited', 429);

    const results: Array<{ index: number; status: 'accepted' | 'duplicate' | 'invalid' }> = [];
    let accepted = 0;
    let duplicates = 0;
    let invalid = 0;
    let transientFailed = 0;
    for (let index = 0; index < events.length; index += 1) {
      try {
        const validated = await validateRecommendationEvent(events[index]);
        const inserted = await client.from('recommendation_events').insert({
          device_id: device.id,
          session_ref: validated.refs.sessionRef,
          provider_ref: validated.refs.providerRef,
          provider_content_ref: validated.refs.providerContentRef,
          content_fingerprint_ref: validated.refs.contentFingerprintRef,
          content_type: validated.contentType,
          event_type: validated.eventType,
          occurred_at: validated.occurredAt,
          watch_duration_ms: validated.watchDurationMs ?? null,
          content_duration_ms: validated.contentDurationMs ?? null,
          progress_bucket: validated.progressBucket ?? null,
          idempotency_ref: validated.refs.idempotencyRef,
        }).select('id').maybeSingle();
        if (inserted.error) {
          if (String((inserted.error as { code?: unknown }).code) === '23505') {
            duplicates += 1;
            results.push({ index, status: 'duplicate' });
            continue;
          }
          if (temporaryDatabaseError(inserted.error)) {
            transientFailed += 1;
            continue;
          }
          invalid += 1;
          results.push({ index, status: 'invalid' });
          continue;
        }
        accepted += 1;
        results.push({ index, status: 'accepted' });
      } catch (error) {
        if (error instanceof AnalyticsValidationError) {
          invalid += 1;
          results.push({ index, status: 'invalid' });
          continue;
        }
        transientFailed += 1;
      }
    }

    return jsonResponse({ ok: transientFailed === 0, accepted, duplicates, invalid, transientFailed, results, retryable: transientFailed > 0 });
  } catch (error) {
    return errorResponse(error instanceof Error && error.message === 'invalid_device' ? 'invalid_device' : 'temporary_database_error');
  }
});
