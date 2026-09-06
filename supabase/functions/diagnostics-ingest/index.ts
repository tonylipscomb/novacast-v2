import { authenticateDevice } from '../_shared/device.ts';
import { jsonResponse, optionsResponse, readJson } from '../_shared/http.ts';
import { getAdminClient } from '../_shared/supabase.ts';
import { redact } from './sanitizer.ts';

const MAX_EVENTS = 25;
const MAX_BODY = 128 * 1024;
const ALLOWED = new Set([
  'play_attempt', 'provider_request_started', 'provider_request_succeeded', 'provider_request_failed',
  'stream_resolution_started', 'stream_resolution_succeeded', 'stream_resolution_failed', 'player_preparing', 'player_ready',
  'playback_loading', 'playback_started', 'first_frame', 'buffer_start', 'buffer_end', 'buffering_started', 'buffering_ended',
  'playback_error', 'playback_stopped', 'playback_completed', 'channel_change', 'source_timeout',
  'decoder_error', 'manifest_error', 'provider_request', 'network_request_failure',
  'app_launch', 'app_resumed', 'app_backgrounded', 'route_changed',
  'catalog_sync_started', 'catalog_sync_completed', 'catalog_sync_failed',
  'provider_assignment_changed', 'connectivity_changed', 'retry_started', 'playback_recovered',
]);

function sessionCause(eventType: string, metadata: Record<string, unknown>, errorCode?: string) {
  const text = `${eventType} ${errorCode ?? ''} ${String(metadata.error_classification ?? '')}`.toLowerCase();
  if (eventType === 'decoder_error' || /decoder|codec|decode/.test(text)) {
    return { cause: 'PLAYBACK_DECODER', explanation: 'The stream responded, but the device decoder reported a playback failure.' };
  }
  if (eventType === 'network_request_failure' || /network|connection|offline|dns/.test(text)) {
    return { cause: 'DEVICE_NETWORK', explanation: 'Multiple network failures were reported by this device.' };
  }
  if (eventType === 'source_timeout' || /timeout|timed out/.test(text)) {
    return { cause: 'STREAM_SERVER', explanation: 'The provider API was reachable, but the stream timed out.' };
  }
  if (eventType === 'playback_error' || eventType === 'manifest_error') {
    return { cause: 'UNKNOWN', explanation: 'NovaCast recorded a playback problem, but more evidence is needed.' };
  }
  return { cause: 'HEALTHY', explanation: 'No recent playback problem was detected.' };
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function supportCategory(eventType: string) {
  if (eventType.includes('provider_request')) return 'provider';
  if (eventType.includes('stream_resolution')) return 'stream';
  if (eventType.includes('player') || eventType === 'first_frame') return 'player';
  if (eventType.includes('decoder')) return 'decoder';
  if (eventType.includes('network')) return 'network';
  if (eventType.includes('provider')) return 'provider';
  if (eventType.includes('catalog')) return 'catalog';
  if (eventType.includes('assignment')) return 'assignment';
  if (eventType.includes('playback') || eventType.includes('buffer') || eventType === 'first_frame' || eventType === 'play_attempt') return 'playback';
  return 'app';
}

function supportMessage(eventType: string) {
  const labels: Record<string, string> = {
    app_launch: 'NovaCast opened', app_resumed: 'NovaCast resumed', app_backgrounded: 'NovaCast went to the background',
    play_attempt: 'Trying to play', provider_request_started: 'Contacting provider', provider_request_succeeded: 'Provider responded', provider_request_failed: 'Provider request failed',
    stream_resolution_started: 'Resolving stream', stream_resolution_succeeded: 'Stream resolved', stream_resolution_failed: 'Stream could not be resolved',
    player_preparing: 'Player preparing', player_ready: 'Player ready', first_frame: 'Picture appeared', playback_started: 'Playback started',
    buffer_start: 'Started buffering', buffering_started: 'Started buffering', buffer_end: 'Buffer recovered', buffering_ended: 'Buffer recovered', playback_error: 'Playback failed',
    playback_stopped: 'Playback ended', source_timeout: 'Stream timed out', decoder_error: 'Device playback/decoder error',
    network_request_failure: 'Internet/network request failed', provider_request: 'Provider request completed',
  };
  return labels[eventType] ?? eventType.replace(/_/g, ' ');
}

function supportLevel(eventType: string) {
  if (['playback_error', 'provider_request_failed', 'stream_resolution_failed', 'source_timeout', 'decoder_error', 'network_request_failure'].includes(eventType)) return 'error';
  if (['buffer_start', 'buffering_started', 'provider_request_started'].includes(eventType)) return 'warning';
  return 'info';
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return optionsResponse();
  if (request.method !== 'POST') return jsonResponse({ ok: false, errorCategory: 'method_not_allowed' }, 405);
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY) return jsonResponse({ ok: false, errorCategory: 'body_size_limit' }, 413);
    const body = JSON.parse(raw) as Record<string, unknown>;
    const events = Array.isArray(body.events) ? body.events : [];
    if (events.length > MAX_EVENTS) return jsonResponse({ ok: false, errorCategory: 'batch_size_limit' }, 413);
    const client = getAdminClient();
    const device = await authenticateDevice(request, client);
    const setting = await client.from('app_settings').select('value').eq('key', 'beta_diagnostics_enabled').maybeSingle();
    if (setting.error) return jsonResponse({ ok: false, errorCategory: 'configuration_unavailable' }, 503);
    if (setting.data?.value !== true) return jsonResponse({ ok: true, accepted: 0, diagnosticsEnabled: false });
    const metadata = redact(body.device);
    const network = metadata.network && typeof metadata.network === 'object' ? metadata.network as Record<string, unknown> : {};
    const health = {
      device_id: device.id,
      device_model: metadata.model ?? null,
      manufacturer: metadata.manufacturer ?? null,
      platform: metadata.platform ?? null,
      os_version: metadata.osVersion ?? null,
      app_version: metadata.appVersion ?? null,
      version_code: metadata.appBuild ?? null,
      network_connected: network.networkConnected === true ? true : network.networkConnected === false ? false : null,
      connection_type: ['wifi', 'ethernet', 'cellular', 'unknown'].includes(String(network.connectionType)) ? network.connectionType : 'unknown',
      internet_reachable: network.internetReachable === true ? true : network.internetReachable === false ? false : null,
      network_latency_ms: typeof network.latencyMs === 'number' && Number.isFinite(network.latencyMs) ? Math.max(0, Math.round(network.latencyMs)) : null,
      last_seen_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    await client.from('device_health').upsert(health, { onConflict: 'device_id' });
    const acceptedEvents = events.filter((event): event is Record<string, unknown> => Boolean(event && typeof event === 'object'))
      .filter((event) => typeof event.eventType === 'string' && ALLOWED.has(event.eventType))
      .map((event) => ({ event, metadata: redact({ ...event, metadata: event.metadata }) }));
    const sessionByEvent = new Map<Record<string, unknown>, string>();
    for (const accepted of acceptedEvents) {
      const event = accepted.event;
      const metadata = accepted.metadata;
      const eventType = String(event.eventType);
      const eventAt = typeof event.eventAt === 'string' ? event.eventAt : new Date().toISOString();
      const contentId = typeof metadata.contentId === 'string' ? metadata.contentId : null;
      const contentType = typeof metadata.contentType === 'string' ? metadata.contentType : null;
      const contentTitle = typeof metadata.contentTitle === 'string' ? metadata.contentTitle : null;
      let sessionId: string | null = null;
      if (eventType === 'play_attempt') {
        const insertedSession = await client.from('diagnostic_sessions').insert({
          ...(isUuid(event.sessionId) ? { id: event.sessionId } : {}),
          device_id: device.id,
          managed_provider_id: isUuid(event.managedProviderId) ? event.managedProviderId : null,
          provider_assignment_id: isUuid(event.providerAssignmentId) ? event.providerAssignmentId : null,
          content_type: contentType,
          content_id: contentId,
          content_title: contentTitle,
          stream_host: typeof metadata.streamHost === 'string' ? metadata.streamHost : null,
          started_at: eventAt,
          diagnostic_status: 'active',
        }).select('id').single();
        if (!insertedSession.error && insertedSession.data?.id) sessionId = insertedSession.data.id;
      } else {
        if (isUuid(event.sessionId)) {
          sessionId = event.sessionId;
        } else {
          const current = await client.from('diagnostic_sessions').select('id').eq('device_id', device.id).eq('diagnostic_status', 'active').order('started_at', { ascending: false }).limit(1).maybeSingle();
          if (!current.error && current.data?.id) sessionId = current.data.id;
        }
      }
      if (sessionId) {
        sessionByEvent.set(event, sessionId);
        const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
        if (contentTitle) patch.content_title = contentTitle;
        if (eventType === 'first_frame') {
          patch.first_frame_at = eventAt;
          patch.time_to_first_frame_ms = Number.isFinite(event.durationMs) ? Math.max(0, Number(event.durationMs)) : null;
        } else if (eventType === 'buffer_start') {
          patch.buffer_count = Number((await client.from('diagnostic_sessions').select('buffer_count').eq('id', sessionId).single()).data?.buffer_count ?? 0) + 1;
        } else if (eventType === 'buffer_end') {
          const duration = Number.isFinite(event.durationMs) ? Math.max(0, Number(event.durationMs)) : 0;
          patch.total_buffer_duration_ms = Number.isFinite(event.totalBufferDurationMs)
            ? Math.max(0, Number(event.totalBufferDurationMs))
            : duration;
          patch.longest_buffer_duration_ms = duration;
          if (Number.isFinite(event.bufferCount)) patch.buffer_count = Math.max(0, Number(event.bufferCount));
        } else if (['playback_error', 'source_timeout', 'decoder_error', 'manifest_error'].includes(eventType)) {
          const cause = sessionCause(eventType, metadata, typeof event.errorCode === 'string' ? event.errorCode : undefined);
          patch.last_error_code = typeof event.errorCode === 'string' ? event.errorCode : null;
          patch.last_native_error_code = typeof event.nativeErrorCode === 'string' ? event.nativeErrorCode : null;
          patch.last_http_status = Number.isInteger(event.httpStatus) ? event.httpStatus : null;
          patch.diagnostic_status = 'failed';
          patch.likely_cause = cause.cause;
          patch.likely_cause_explanation = cause.explanation;
        } else if (eventType === 'playback_stopped' || eventType === 'playback_completed') {
          patch.ended_at = eventAt;
          patch.playback_duration_ms = Number.isFinite(event.durationMs) ? Math.max(0, Number(event.durationMs)) : null;
          patch.exit_reason = typeof event.outcome === 'string' ? event.outcome : null;
          patch.diagnostic_status = 'complete';
        }
        await client.from('diagnostic_sessions').update(patch).eq('id', sessionId);
      }
    }
    const rows = acceptedEvents
      .map(({ event, metadata }) => ({
        device_id: device.id,
        session_id: sessionByEvent.get(event) ?? (isUuid(event.sessionId) ? event.sessionId : null),
        event_type: String(event.eventType).slice(0, 48),
        event_at: typeof event.eventAt === 'string' ? event.eventAt : new Date().toISOString(),
        error_code: typeof event.errorCode === 'string' ? event.errorCode.slice(0, 96) : null,
        native_error_code: typeof event.nativeErrorCode === 'string' ? event.nativeErrorCode.slice(0, 96) : null,
        http_status: Number.isInteger(event.httpStatus) ? event.httpStatus : null,
        duration_ms: Number.isFinite(event.durationMs) ? Math.max(0, Number(event.durationMs)) : null,
        metadata,
      }));
    if (rows.length) {
      const inserted = await client.from('diagnostic_events').insert(rows);
      if (inserted.error) return jsonResponse({ ok: false, errorCategory: 'event_write_failed' }, 503);
      const logs = acceptedEvents.map(({ event, metadata }) => {
        const eventType = String(event.eventType);
        return {
          device_id: device.id,
          logged_at: typeof event.eventAt === 'string' ? event.eventAt : new Date().toISOString(),
          level: supportLevel(eventType),
          category: supportCategory(eventType),
          event_code: eventType.slice(0, 64),
          message: supportMessage(eventType).slice(0, 240),
          context: metadata,
          capture_id: isUuid(event.captureId) ? event.captureId : null,
        };
      });
      const logInsert = await client.from('diagnostic_logs').insert(logs);
      if (logInsert.error) return jsonResponse({ ok: false, errorCategory: 'support_log_write_failed' }, 503);
      await client.from('diagnostic_logs').delete().eq('device_id', device.id).lt('logged_at', new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString());
      const overflow = await client.from('diagnostic_logs').select('id').eq('device_id', device.id).order('logged_at', { ascending: false }).range(2000, 10_000);
      if (overflow.data?.length) await client.from('diagnostic_logs').delete().in('id', overflow.data.map((row) => row.id));
    }
    return jsonResponse({ ok: true, accepted: rows.length, diagnosticsEnabled: true });
  } catch (error) {
    const category = error instanceof Error && error.message === 'invalid_device' ? 'invalid_device' : 'diagnostics_ingest_failed';
    return jsonResponse({ ok: false, errorCategory: category }, category === 'invalid_device' ? 401 : 400);
  }
});
