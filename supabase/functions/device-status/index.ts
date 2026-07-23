import { jsonResponse, optionsResponse } from '../_shared/http.ts';
import { authenticateDevice, deviceRateKey } from '../_shared/device.ts';
import { consumeRateLimit, getAdminClient } from '../_shared/supabase.ts';

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return optionsResponse();
  if (request.method !== 'POST') return jsonResponse({ errorCategory: 'method_not_allowed' }, 405);

  try {
    const client = getAdminClient();
    const device = await authenticateDevice(request, client);
    if (!(await consumeRateLimit(client, await deviceRateKey(request, device.id, 'status'), 60, 600))) {
      return jsonResponse({ errorCategory: 'rate_limited' }, 429);
    }

    const now = new Date();
    const nowIso = now.toISOString();
    const nowMs = now.getTime();

    await client.from('devices').update({ last_seen_at: nowIso, updated_at: nowIso }).eq('id', device.id);

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

    let activationStatus =
      activation?.expires_at && new Date(activation.expires_at).getTime() <= nowMs
        ? 'expired'
        : activation?.status ?? device.activation_status;

    if (activationStatus === 'expired') {
      await client.from('devices').update({ activation_status: 'expired', updated_at: nowIso }).eq('id', device.id);
    }

    const remaining = activation?.expires_at
      ? Math.max(0, new Date(activation.expires_at).getTime() - nowMs)
      : null;

    return jsonResponse({
      deviceId: device.id,
      publicDeviceCode: device.public_device_code,
      status: device.status,
      activationStatus,
      activationExpiresAt: activation?.expires_at ?? null,
      remainingBetaMs: remaining,
      remainingBetaHours: remaining == null ? null : Math.ceil(remaining / (60 * 60 * 1000)),
      providerAssigned: Boolean(assignment?.managed_provider_id),
      managedProviderId: assignment?.managed_provider_id ?? activation?.managed_provider_id ?? null,
      contentPolicy: assignment?.content_policy ?? activation?.content_policy ?? 'us_only',
      requiresProviderDownload: Boolean(assignment?.managed_provider_id),
      serverTime: nowIso,
      offlineGraceUntil:
        activationStatus === 'active' ? new Date(nowMs + 24 * 60 * 60 * 1000).toISOString() : null,
    });
  } catch (error) {
    const category =
      error instanceof Error && ['invalid_device', 'rate_limited'].includes(error.message)
        ? error.message
        : 'device_status_unavailable';
    return jsonResponse({ errorCategory: category }, category === 'rate_limited' ? 429 : 401);
  }
});
