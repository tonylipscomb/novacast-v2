import { authenticateDevice } from '../_shared/device.ts';
import { jsonResponse, optionsResponse } from '../_shared/http.ts';
import { getAdminClient } from '../_shared/supabase.ts';
import {
  AnalyticsValidationError,
  MAX_BATCH_EVENTS,
  MAX_BODY_BYTES,
  MAX_EVENTS_PER_HOUR,
  clampTimestamp,
  hashContentReference,
  hashProviderReference,
  optionalNonnegativeInteger,
  optionalBoolean,
  optionalString,
  requiredString,
  responseStatus,
  validateEventName,
  validateMetadata,
} from '../_shared/analytics.ts';

type EventInput = Record<string, unknown>;
type SessionInput = Record<string, unknown>;
type StateInput = Record<string, unknown>;

function isTemporaryDatabaseError(error: unknown) {
  return Boolean(error && typeof error === 'object' && 'code' in error && ['08000', '08003', '08006', '57P01'].includes(String((error as { code?: unknown }).code)));
}

function errorResponse(category: string) {
  return jsonResponse({ ok: false, errorCategory: category, accepted: 0, duplicates: 0, rejected: 0, retryable: responseStatus(category) >= 500 }, responseStatus(category));
}

function readSessionUuid(input: EventInput | SessionInput | StateInput | undefined) {
  return input ? optionalString(input.sessionUuid, 80) : undefined;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return optionsResponse();
  if (request.method !== 'POST') return errorResponse('method_not_allowed');

  try {
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) return errorResponse('body_size_limit');
    let body: Record<string, unknown>;
    try {
      const parsed = JSON.parse(rawBody);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid_body');
      body = parsed as Record<string, unknown>;
    } catch {
      return errorResponse('invalid_json');
    }

    const events = body.events === undefined ? [] : body.events;
    if (!Array.isArray(events)) return errorResponse('invalid_field_type');
    if (events.length > MAX_BATCH_EVENTS) return errorResponse('batch_size_limit');
    if (body.session !== undefined && (!body.session || typeof body.session !== 'object' || Array.isArray(body.session))) return errorResponse('invalid_field_type');
    if (body.state !== undefined && (!body.state || typeof body.state !== 'object' || Array.isArray(body.state))) return errorResponse('invalid_field_type');

    const client = getAdminClient();
    const device = await authenticateDevice(request, client);
    if (!events.length && body.session === undefined && body.state === undefined) {
      return jsonResponse({ ok: true, accepted: 0, duplicates: 0, rejected: 0, retryable: false });
    }

    const rateLimit = await client.rpc('consume_analytics_rate_limit', {
      p_device_id: device.id,
      p_event_count: events.length,
      p_limit: MAX_EVENTS_PER_HOUR,
      p_window_seconds: 3600,
    });
    if (rateLimit.error) return errorResponse(isTemporaryDatabaseError(rateLimit.error) ? 'temporary_database_error' : 'rate_limit_failed');
    if (!rateLimit.data) {
      return errorResponse('rate_limited');
    }

    const sessionInput = body.session as SessionInput | undefined;
    const stateInput = body.state as StateInput | undefined;
    const eventInputs = events as EventInput[];
    const sessionUuid = readSessionUuid(sessionInput) ?? readSessionUuid(stateInput) ?? readSessionUuid(eventInputs[0]);
    if (!sessionUuid) return errorResponse('invalid_session');

    const sessionQuery = await client.from('analytics_sessions').select('*').eq('session_uuid', sessionUuid).maybeSingle();
    if (sessionQuery.error && !isTemporaryDatabaseError(sessionQuery.error)) return errorResponse('temporary_database_error');
    if (sessionQuery.error) return errorResponse('temporary_database_error');
    let session = sessionQuery.data as Record<string, unknown> | null;
    if (session && session.device_id !== device.id) return errorResponse('invalid_session_ownership');

    const now = Date.now();
    const sessionStartedAt = clampTimestamp(sessionInput?.startedAt, now);
    const sessionLastSeenAt = clampTimestamp(sessionInput?.lastSeenAt ?? sessionInput?.startedAt, now);
    const sessionEndedAt = sessionInput?.endedAt == null ? undefined : clampTimestamp(sessionInput.endedAt, now);
    const appVersion = requiredString(sessionInput?.appVersion ?? body.appVersion ?? session?.app_version, 40);
    const appBuild = optionalString(sessionInput?.appBuild ?? body.appBuild ?? session?.app_build, 40);

    if (!session) {
      if (!sessionInput) return errorResponse('invalid_session');
      const insert = await client.from('analytics_sessions').insert({
        session_uuid: sessionUuid,
        device_id: device.id,
        public_device_id: device.public_device_code,
        started_at: sessionStartedAt.toISOString(),
        last_seen_at: sessionLastSeenAt.toISOString(),
        ended_at: sessionEndedAt?.toISOString() ?? null,
        duration_ms: optionalNonnegativeInteger(sessionInput.durationMs),
        app_version: appVersion,
        app_build: appBuild ?? null,
        manufacturer: optionalString(sessionInput.manufacturer, 80) ?? null,
        model: optionalString(sessionInput.model, 120) ?? null,
        platform_api_level: optionalNonnegativeInteger(sessionInput.platformApiLevel),
        environment: optionalString(sessionInput.environment, 16) ?? 'beta',
        exit_reason: optionalString(sessionInput.exitReason, 80) ?? null,
      }).select('*').single();
      if (insert.error) return errorResponse(isTemporaryDatabaseError(insert.error) ? 'temporary_database_error' : 'session_write_failed');
      session = insert.data as Record<string, unknown>;
    } else if (sessionInput) {
      const update: Record<string, unknown> = {
        last_seen_at: sessionLastSeenAt.toISOString(),
        updated_at: new Date(now).toISOString(),
      };
      if (sessionEndedAt) {
        update.ended_at = sessionEndedAt.toISOString();
        update.duration_ms = optionalNonnegativeInteger(sessionInput.durationMs);
        update.exit_reason = optionalString(sessionInput.exitReason, 80) ?? null;
      }
      const updated = await client.from('analytics_sessions').update(update).eq('id', session.id).eq('device_id', device.id).select('*').single();
      if (updated.error) return errorResponse(isTemporaryDatabaseError(updated.error) ? 'temporary_database_error' : 'session_write_failed');
      session = updated.data as Record<string, unknown>;
    }

    if (!session) return errorResponse('invalid_session');

    let accepted = 0;
    let duplicates = 0;
    for (const input of eventInputs) {
      const eventSessionUuid = readSessionUuid(input) ?? sessionUuid;
      if (eventSessionUuid !== sessionUuid) return errorResponse('invalid_session_ownership');
      const { name, category } = validateEventName(input.eventName);
      const idempotencyKey = requiredString(input.idempotencyKey, 160);
      const metadata = validateMetadata(input.metadata);
      const eventDate = clampTimestamp(input.occurredAt, now);
      const providerRef = await hashProviderReference(input.providerId);
      const contentRef = await hashContentReference(input.contentId);
      const row = {
        idempotency_key: idempotencyKey,
        session_id: session.id,
        device_id: device.id,
        public_device_id: device.public_device_code,
        event_name: name,
        event_category: category,
        occurred_at: eventDate.toISOString(),
        route: optionalString(input.route, 96) ?? null,
        provider_ref: providerRef,
        content_ref: contentRef,
        content_type: optionalString(input.contentType, 40) ?? null,
        outcome: optionalString(input.outcome, 48) ?? null,
        duration_ms: optionalNonnegativeInteger(input.durationMs),
        count_value: optionalNonnegativeInteger(input.countValue),
        metadata,
        app_version: requiredString(input.appVersion ?? session.app_version, 40),
        app_build: optionalString(input.appBuild ?? session.app_build, 40) ?? null,
      };
      const inserted = await client.from('analytics_events').insert(row).select('id').maybeSingle();
      if (inserted.error) {
        if (String((inserted.error as { code?: unknown }).code) === '23505') {
          duplicates += 1;
          continue;
        }
        return errorResponse(isTemporaryDatabaseError(inserted.error) ? 'temporary_database_error' : 'event_write_failed');
      }
      accepted += 1;
    }

    if (stateInput) {
      const stateSessionUuid = readSessionUuid(stateInput);
      if (stateSessionUuid && stateSessionUuid !== sessionUuid) return errorResponse('invalid_session_ownership');
      const state = {
        device_id: device.id,
        public_device_id: device.public_device_code,
        current_session_id: session.id,
        last_seen_at: clampTimestamp(stateInput.lastSeenAt, now).toISOString(),
        current_route: optionalString(stateInput.currentRoute, 96) ?? null,
        current_activity: optionalString(stateInput.currentActivity, 48) ?? null,
        provider_state: optionalString(stateInput.providerState, 48) ?? null,
        playback_state: optionalString(stateInput.playbackState, 48) ?? null,
        network_connected: optionalBoolean(stateInput.networkConnected) ?? null,
        app_version: requiredString(stateInput.appVersion ?? session.app_version, 40),
        app_build: optionalString(stateInput.appBuild ?? session.app_build, 40) ?? null,
        updated_at: new Date(now).toISOString(),
      };
      const stateWrite = await client.from('analytics_device_state').upsert(state, { onConflict: 'device_id' });
      if (stateWrite.error) return errorResponse(isTemporaryDatabaseError(stateWrite.error) ? 'temporary_database_error' : 'state_write_failed');
    }

    return jsonResponse({ ok: true, accepted, duplicates, rejected: 0, retryable: false });
  } catch (error) {
    const category = error instanceof AnalyticsValidationError
      ? error.category
      : error instanceof Error && error.message === 'invalid_device'
        ? 'invalid_device'
        : isTemporaryDatabaseError(error)
          ? 'temporary_database_error'
          : 'temporary_database_error';
    return errorResponse(category);
  }
});
