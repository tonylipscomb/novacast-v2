import { jsonResponse, optionsResponse, readJson } from '../_shared/http.ts';
import { authenticateDevice, deviceRateKey } from '../_shared/device.ts';
import { consumeRateLimit, getAdminClient } from '../_shared/supabase.ts';
import { hashToken } from '../_shared/security.ts';

type HeartbeatBody = {
  metadata?: Record<string, unknown>;
  diagnostics?: Record<string, unknown>;
  currentRoute?: string;
  appFocus?: string;
  acknowledgedCommandIds?: string[];
  commandResults?: Array<{ id: string; status: 'completed' | 'failed'; result?: Record<string, unknown> }>;
};

function remainingMs(expiresAt: string | null | undefined, nowMs: number) {
  if (!expiresAt) return null;
  return Math.max(0, new Date(expiresAt).getTime() - nowMs);
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return optionsResponse();
  if (request.method !== 'POST') return jsonResponse({ errorCategory: 'method_not_allowed' }, 405);

  try {
    const client = getAdminClient();
    const device = await authenticateDevice(request, client);
    if (!(await consumeRateLimit(client, await deviceRateKey(request, device.id, 'heartbeat'), 8, 600))) {
      return jsonResponse({ errorCategory: 'rate_limited' }, 429);
    }

    const body = (await readJson(request)) as HeartbeatBody;
    const metadata = body?.metadata && typeof body.metadata === 'object' ? body.metadata : {};
    const now = new Date();
    const nowIso = now.toISOString();
    const nowMs = now.getTime();

    const patch: Record<string, unknown> = {
      last_seen_at: nowIso,
      updated_at: nowIso,
      last_ip_hash: await hashToken(request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown-client'),
    };

    for (const [source, target, limit] of [
      ['platform', 'platform', 40],
      ['manufacturer', 'manufacturer', 80],
      ['model', 'model', 120],
      ['deviceType', 'device_type', 40],
      ['osVersion', 'os_version', 40],
      ['appVersion', 'app_version', 40],
      ['appBuild', 'app_build', 40],
    ] as const) {
      if (typeof metadata[source] === 'string') patch[target] = String(metadata[source]).slice(0, limit);
    }

    if (body?.diagnostics && typeof body.diagnostics === 'object') {
      patch.last_diagnostics = body.diagnostics;
    }
    if (typeof body?.currentRoute === 'string') {
      patch.current_route = body.currentRoute.slice(0, 120);
    }
    if (typeof body?.appFocus === 'string') {
      patch.app_focus = body.appFocus.slice(0, 120);
    }

    await client.from('devices').update(patch).eq('id', device.id);

    const ackIds = Array.isArray(body?.acknowledgedCommandIds)
      ? body.acknowledgedCommandIds.filter((id): id is string => typeof id === 'string')
      : [];
    if (ackIds.length) {
      await client
        .from('device_commands')
        .update({ status: 'acked', acked_at: nowIso, updated_at: nowIso })
        .eq('device_id', device.id)
        .in('id', ackIds)
        .eq('status', 'pending');
    }

    const results = Array.isArray(body?.commandResults) ? body.commandResults : [];
    for (const result of results) {
      if (!result?.id || !['completed', 'failed'].includes(result.status)) continue;
      await client
        .from('device_commands')
        .update({
          status: result.status,
          completed_at: nowIso,
          result: result.result ?? {},
          updated_at: nowIso,
        })
        .eq('device_id', device.id)
        .eq('id', result.id);
    }

    const { data: activation } = await client
      .from('device_activations')
      .select('status,expires_at,content_policy,managed_provider_id')
      .eq('device_id', device.id)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: assignment } = await client
      .from('device_provider_assignments')
      .select('managed_provider_id,content_policy')
      .eq('device_id', device.id)
      .eq('status', 'active')
      .maybeSingle();

    const { data: pendingCommands } = await client
      .from('device_commands')
      .select('id,command,payload,created_at')
      .eq('device_id', device.id)
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(20);

    let activationStatus =
      activation?.expires_at && new Date(activation.expires_at).getTime() <= nowMs
        ? 'expired'
        : activation?.status ?? device.activation_status;

    if (activationStatus === 'expired') {
      await client.from('devices').update({ activation_status: 'expired', updated_at: nowIso }).eq('id', device.id);
      await client
        .from('device_activations')
        .update({ status: 'expired', updated_at: nowIso })
        .eq('device_id', device.id)
        .eq('status', 'active');
    }

    const remaining = remainingMs(activation?.expires_at, nowMs);

    return jsonResponse({
      ok: true,
      deviceActive: activationStatus === 'active' && device.status === 'active',
      activationStatus,
      expirationTime: activation?.expires_at ?? null,
      remainingBetaMs: remaining,
      remainingBetaHours: remaining == null ? null : Math.ceil(remaining / (60 * 60 * 1000)),
      providerAssigned: Boolean(assignment?.managed_provider_id),
      managedProviderId: assignment?.managed_provider_id ?? activation?.managed_provider_id ?? null,
      contentPolicy: assignment?.content_policy ?? activation?.content_policy ?? 'us_only',
      serverTime: nowIso,
      pendingCommands: pendingCommands ?? [],
      appVersion: typeof metadata.appVersion === 'string' ? metadata.appVersion : null,
      requiredSync: Boolean(assignment?.managed_provider_id),
      offlineGraceUntil:
        activationStatus === 'active' ? new Date(nowMs + 24 * 60 * 60 * 1000).toISOString() : null,
    });
  } catch (error) {
    const category =
      error instanceof Error && ['invalid_device', 'rate_limited'].includes(error.message)
        ? error.message
        : 'device_heartbeat_failed';
    return jsonResponse({ errorCategory: category }, category === 'rate_limited' ? 429 : 401);
  }
});
