import { requireAdmin } from '../_shared/admin.ts';
import { corsHeaders } from '../_shared/http.ts';

// TEMPORARY: admin diagnostics is called by both production and beta admin UIs.
const APPROVED_ADMIN_ORIGINS = new Set([
  'https://novacast-connect.netlify.app',
  'https://beta-rolling-download--novacast-connect.netlify.app',
]);

function adminCorsHeaders(request: Request) {
  const headers: Record<string, string> = { ...corsHeaders, Vary: 'Origin' };
  delete headers['Access-Control-Allow-Origin'];

  const origin = request.headers.get('origin');
  if (origin && APPROVED_ADMIN_ORIGINS.has(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }

  return headers;
}

function adminResponse(request: Request, body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: adminCorsHeaders(request) });
}

function adminOptionsResponse(request: Request) {
  return new Response('ok', { headers: adminCorsHeaders(request) });
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return adminOptionsResponse(request);
  if (request.method !== 'GET') return adminResponse(request, { errorCategory: 'method_not_allowed' }, 405);
  try {
    const { client } = await requireAdmin(request);
    const url = new URL(request.url);
    const hours = Math.min(Math.max(Number(url.searchParams.get('hours') ?? 24) || 24, 1), 168);
    const requestedDeviceCode = url.searchParams.get('deviceId')?.trim().toUpperCase() ?? '';
    const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
    const [health, sessions, events, providers, providerHealth, devices] = await Promise.all([
      client.from('device_health').select('*').order('updated_at', { ascending: false }).limit(500),
      client.from('diagnostic_sessions').select('*').gte('started_at', since).order('started_at', { ascending: false }).limit(500),
      client.from('diagnostic_events').select('*').gte('event_at', since).order('event_at', { ascending: false }).limit(1000),
      client.from('managed_providers').select('id,display_name,slug').limit(200),
      client.from('provider_health').select('*').limit(200),
      client.from('devices').select('id,public_device_code,friendly_name,assigned_tester_name,assigned_tester_email,manufacturer,model,platform,os_version,app_version,app_build,managed_provider_id,last_seen_at,current_route,app_focus').limit(500),
    ]);
    if (health.error || sessions.error || events.error || providers.error || providerHealth.error || devices.error) throw new Error('admin_query_failed');
    const healthRows = health.data ?? [];
    const sessionRows = sessions.data ?? [];
    const eventRows = events.data ?? [];
    const selectedIdentity = requestedDeviceCode
      ? (devices.data ?? []).find((row) => String(row.public_device_code ?? '').toUpperCase() === requestedDeviceCode)
      : null;
    const [logs, commands] = selectedIdentity
      ? await Promise.all([
        client.from('diagnostic_logs').select('*').eq('device_id', selectedIdentity.id).gte('logged_at', since).order('logged_at', { ascending: false }).limit(100),
        client.from('device_commands').select('command,payload,status,created_at').eq('device_id', selectedIdentity.id).in('command', ['start_diagnostics_capture', 'stop_diagnostics_capture']).order('created_at', { ascending: false }).limit(10),
      ])
      : [{ data: [], error: null }, { data: [], error: null }];
    if (logs.error || commands.error) throw new Error('admin_query_failed');
    const logRows = logs.data ?? [];
    const latestCaptureCommand = commands.data?.[0] as Record<string, unknown> | undefined;
    const capturePayload = latestCaptureCommand?.payload && typeof latestCaptureCommand.payload === 'object'
      ? latestCaptureCommand.payload as Record<string, unknown>
      : {};
    const captureExpiresAt = typeof capturePayload.expiresAt === 'string' ? capturePayload.expiresAt : null;
    const captureActive = latestCaptureCommand?.command === 'start_diagnostics_capture'
      && capturePayload.enabled === true
      && !!captureExpiresAt
      && Date.parse(captureExpiresAt) > Date.now();
    const active = healthRows.filter((row) => row.health_status === 'DEGRADED' || row.health_status === 'CRITICAL');
    const offlineCutoff = Date.now() - 30 * 60 * 1000;
    // Heartbeats update devices.last_seen_at. device_health is a diagnostic
    // snapshot and may be older (or absent) when the TV is otherwise active.
    // Use the newest authoritative timestamp from either record so a stale
    // health snapshot cannot incorrectly mark a connected TV offline.
    const latestSeenByDevice = new Map<string, number>();
    for (const row of healthRows) {
      const seen = Date.parse(String(row.last_seen_at ?? ''));
      if (Number.isFinite(seen)) latestSeenByDevice.set(row.device_id, Math.max(latestSeenByDevice.get(row.device_id) ?? 0, seen));
    }
    for (const row of devices.data ?? []) {
      const seen = Date.parse(String(row.last_seen_at ?? ''));
      if (Number.isFinite(seen)) latestSeenByDevice.set(row.id, Math.max(latestSeenByDevice.get(row.id) ?? 0, seen));
    }
    const offline = new Set(
      [...new Set([...healthRows.map((row) => row.device_id), ...(devices.data ?? []).map((row) => row.id)])]
        .filter((deviceId) => (latestSeenByDevice.get(deviceId) ?? 0) < offlineCutoff),
    );
    const failures = eventRows.filter((row) => ['playback_error', 'source_timeout', 'decoder_error', 'manifest_error'].includes(row.event_type));
    const providerNames = new Map((providers.data ?? []).map((row) => [row.id, row.display_name ?? row.slug ?? row.id]));
    const providerHealthById = new Map((providerHealth.data ?? []).map((row) => [row.managed_provider_id, row]));
    const deviceById = new Map((devices.data ?? []).map((row) => [row.id, row]));
    const providerActivityByDevice = new Map<string, { latestRequestAt: string | null; latestSuccessAt: string | null; latestFailureAt: string | null; providerId: string | null }>();
    for (const row of eventRows) {
      if (!['play_attempt', 'provider_request', 'provider_request_started', 'provider_request_succeeded', 'provider_request_failed', 'playback_error', 'source_timeout', 'manifest_error'].includes(row.event_type)) continue;
      const current = providerActivityByDevice.get(row.device_id) ?? { latestRequestAt: null, latestSuccessAt: null, latestFailureAt: null, providerId: null };
      const session = sessionRows.find((candidate) => candidate.id === row.session_id);
      current.providerId = session?.managed_provider_id ?? current.providerId;
      if (!current.latestRequestAt || Date.parse(row.event_at) > Date.parse(current.latestRequestAt)) current.latestRequestAt = row.event_at;
      if (['provider_request', 'provider_request_succeeded'].includes(row.event_type) && (!current.latestSuccessAt || Date.parse(row.event_at) > Date.parse(current.latestSuccessAt))) current.latestSuccessAt = row.event_at;
      if (['provider_request_failed', 'playback_error', 'source_timeout', 'manifest_error'].includes(row.event_type) && (!current.latestFailureAt || Date.parse(row.event_at) > Date.parse(current.latestFailureAt))) current.latestFailureAt = row.event_at;
      providerActivityByDevice.set(row.device_id, current);
    }
    const byDevice = new Map<string, Record<string, unknown>>();
    for (const row of healthRows) byDevice.set(row.device_id, { ...row, recentPlayback: null, recentError: null });
    for (const row of devices.data ?? []) {
      if (!byDevice.has(row.id)) byDevice.set(row.id, { managed_provider_id: row.managed_provider_id ?? null, recentPlayback: null, recentError: null });
    }
    for (const row of sessionRows) {
      const device = byDevice.get(row.device_id);
      if (device && !device.recentPlayback) device.recentPlayback = row;
    }
    for (const row of failures) {
      const device = byDevice.get(row.device_id);
      if (device && !device.recentError) device.recentError = row;
    }
    const supportDevices = [...byDevice.entries()].map(([deviceId, row]) => {
      const identity = deviceById.get(deviceId) ?? {};
      const providerId = row.managed_provider_id ?? identity.managed_provider_id ?? null;
      const provider = providerHealthById.get(providerId);
      const providerActivity = providerActivityByDevice.get(deviceId);
      const healthStatus = offline.has(deviceId)
        ? 'OFFLINE'
        : String(row.health_status ?? 'UNKNOWN').toUpperCase();
      const playback = row.recentPlayback as Record<string, unknown> | null;
      const error = row.recentError as Record<string, unknown> | null;
      const playbackMetadata = playback?.metadata && typeof playback.metadata === 'object' ? playback.metadata as Record<string, unknown> : {};
      const errorMetadata = error?.metadata && typeof error.metadata === 'object' ? error.metadata as Record<string, unknown> : {};
      const latestContentTitle = playback?.content_title ?? playbackMetadata.contentTitle ?? errorMetadata.contentTitle ?? null;
      const observedProviderId = playback?.managed_provider_id ?? providerActivity?.providerId ?? providerId;
      const inferredCause = error
        ? (error.event_type === 'decoder_error' ? 'PLAYER' : ['network_request_failure'].includes(error.event_type) ? 'NETWORK' : ['source_timeout', 'manifest_error'].includes(error.event_type) ? 'STREAM_RESOLUTION' : 'PROVIDER')
        : playback ? 'NONE_DETECTED' : 'INSUFFICIENT_DATA';
      return {
        publicDeviceCode: identity.public_device_code ?? null,
        friendlyName: identity.friendly_name ?? null,
        assignedTesterName: identity.assigned_tester_name ?? null,
        assignedTesterEmail: identity.assigned_tester_email ?? null,
        manufacturer: identity.manufacturer ?? row.manufacturer ?? null,
        model: identity.model ?? row.device_model ?? null,
        platform: identity.platform ?? row.platform ?? null,
        osVersion: identity.os_version ?? row.os_version ?? null,
        appVersion: identity.app_version ?? row.app_version ?? null,
        appBuild: identity.app_build ?? row.version_code ?? null,
        overallStatus: healthStatus,
        lastSeenAt: identity.last_seen_at ?? row.last_seen_at ?? null,
        currentRoute: identity.current_route ?? null,
        appFocus: identity.app_focus ?? null,
        internet: row.internet_reachable === false ? 'PROBLEM' : row.network_connected === false ? 'WARNING' : row.internet_reachable === true ? 'GOOD' : 'UNKNOWN',
        network: { connected: row.network_connected ?? null, connectionType: row.connection_type ?? 'unknown', internetReachable: row.internet_reachable ?? null, latencyMs: row.network_latency_ms ?? null },
        providerStatus: providerActivity?.latestFailureAt ? 'PROBLEM' : providerActivity?.latestRequestAt ? 'GOOD' : provider?.health_status ?? 'UNKNOWN',
        playbackStatus: error ? 'WARNING' : playback ? 'GOOD' : 'UNKNOWN',
        providerName: providerNames.get(observedProviderId) ?? 'Unassigned',
        providerDiagnostics: {
          lastProviderRequestAt: providerActivity?.latestRequestAt ?? null,
          lastSuccessfulProviderRequestAt: providerActivity?.latestSuccessAt ?? null,
          lastFailedProviderRequestAt: providerActivity?.latestFailureAt ?? null,
        },
        likelyCause: row.likely_cause && row.likely_cause !== 'UNKNOWN' ? row.likely_cause : inferredCause,
        likelyCauseExplanation: row.likely_cause_explanation ?? (playback ? 'Recent playback telemetry shows no recorded failure.' : 'No playback or error signal has been recorded in this time range.'),
        recentPlayback: playback ? {
          contentTitle: latestContentTitle,
          contentType: playback.content_type ?? playbackMetadata.contentType ?? null,
          contentId: playback.content_id ?? playbackMetadata.contentId ?? null,
          providerId: playback.managed_provider_id ?? providerActivity?.providerId ?? null,
          startedAt: playback.started_at ?? null,
          endedAt: playback.ended_at ?? null,
          timeToFirstFrameMs: playback.time_to_first_frame_ms ?? null,
          bufferCount: playback.buffer_count ?? 0,
          totalBufferDurationMs: playback.total_buffer_duration_ms ?? 0,
          playbackDurationMs: playback.playback_duration_ms ?? null,
          finalResult: playback.exit_reason ?? (playback.diagnostic_status === 'failed' ? 'FAILED' : playback.diagnostic_status === 'complete' ? 'SUCCESS' : 'IN PROGRESS'),
          lastErrorCode: playback.last_error_code ?? null,
        } : null,
        recentError: error ? {
          eventType: error.event_type,
          errorCode: error.error_code,
          nativeErrorCode: error.native_error_code,
          httpStatus: error.http_status,
          contentTitle: errorMetadata.contentTitle ?? null,
        } : null,
        ...(selectedIdentity?.id === deviceId ? {
          supportLogs: logRows,
          captureActive,
          captureId: typeof capturePayload.captureId === 'string' ? capturePayload.captureId : null,
          captureExpiresAt,
        } : {}),
      };
    });
    const selectedEvents = selectedIdentity
      ? eventRows.filter((row) => row.device_id === selectedIdentity.id).slice(0, 200)
      : [];
    const selectedSessions = selectedIdentity
      ? sessionRows.filter((row) => row.device_id === selectedIdentity.id)
      : [];
    const selectedDeviceBase = selectedIdentity
      ? supportDevices.find((device) => device.publicDeviceCode === selectedIdentity.public_device_code) ?? null
      : null;
    const selectedDevice = selectedDeviceBase
      ? { ...selectedDeviceBase, events: selectedEvents, sessions: selectedSessions }
      : null;
    return adminResponse(request, {
      summary: { totalDevices: supportDevices.length, healthy: supportDevices.filter((row) => row.overallStatus === 'HEALTHY').length, degraded: active.length, offline: supportDevices.filter((row) => row.overallStatus === 'OFFLINE').length, activePlaybackIssues: failures.length },
      providers: providers.data ?? [],
      devices: supportDevices,
      ...(selectedDevice ? { selectedDevice, sessions: selectedSessions, events: selectedEvents, supportLogs: logRows } : {}),
    });
  } catch (error) {
    const unauthorized = error instanceof Error && error.message === 'admin_unauthorized';
    return adminResponse(request, { errorCategory: unauthorized ? 'admin_unauthorized' : 'admin_query_failed' }, unauthorized ? 401 : 500);
  }
});
