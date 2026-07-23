import { jsonResponse, optionsResponse } from '../_shared/http.ts';
import { authenticateDevice, deviceRateKey } from '../_shared/device.ts';
import { consumeRateLimit, getAdminClient } from '../_shared/supabase.ts';

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return optionsResponse();
  if (request.method !== 'POST') return jsonResponse({ errorCategory: 'method_not_allowed' }, 405);
  try {
    const client = getAdminClient();
    const device = await authenticateDevice(request, client);
    if (!(await consumeRateLimit(client, await deviceRateKey(request, device.id, 'status'), 60, 600))) return jsonResponse({ errorCategory: 'rate_limited' }, 429);
    const { data: activation } = await client.from('device_activations').select('status,expires_at').eq('device_id', device.id).eq('status', 'active').order('created_at', { ascending: false }).limit(1).maybeSingle();
    const now = new Date().toISOString();
    await client.from('devices').update({ last_seen_at: now, updated_at: now }).eq('id', device.id);
    const activationStatus = activation?.expires_at && new Date(activation.expires_at).getTime() <= Date.now() ? 'expired' : activation?.status ?? device.activation_status;
    return jsonResponse({ deviceId: device.id, publicDeviceCode: device.public_device_code, status: device.status, activationStatus, activationExpiresAt: activation?.expires_at ?? null, serverTime: now, offlineGraceUntil: activationStatus === 'active' ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() : null });
  } catch (error) {
    const category = error instanceof Error && ['invalid_device', 'rate_limited'].includes(error.message) ? error.message : 'device_status_unavailable';
    return jsonResponse({ errorCategory: category }, category === 'rate_limited' ? 429 : 401);
  }
});
