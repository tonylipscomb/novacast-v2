import { jsonResponse, optionsResponse, readJson } from '../_shared/http.ts';
import { consumeRateLimit, getAdminClient } from '../_shared/supabase.ts';
import { hashCode, hashToken, normalizeCode, normalizePublicDeviceCode } from '../_shared/security.ts';

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return optionsResponse();
  if (request.method !== 'POST') return jsonResponse({ errorCategory: 'method_not_allowed' }, 405);
  try {
    const body = await readJson(request);
    const deviceCode = normalizePublicDeviceCode(body?.deviceId);
    const inviteCode = normalizeCode(body?.invitationCode);
    if (!inviteCode || inviteCode.length < 6 || inviteCode.length > 32) throw new Error('activation_unavailable');
    const client = getAdminClient();
    if (!(await consumeRateLimit(client, await hashToken(`${deviceCode}:activation`), 10, 600))) return jsonResponse({ errorCategory: 'rate_limited' }, 429);
    const { data, error } = await client.rpc('activate_device_with_invite', { p_public_device_code: deviceCode, p_code_hash: await hashCode(inviteCode), p_friendly_name: typeof body?.friendlyName === 'string' ? body.friendlyName : null });
    if (error || !data?.[0]) return jsonResponse({ errorCategory: 'activation_unavailable' }, 400);
    return jsonResponse({ activated: true, deviceId: data[0].device_id, activationStatus: data[0].activation_status, expiresAt: data[0].expires_at });
  } catch (error) {
    const category = error instanceof Error && ['rate_limited', 'activation_unavailable', 'invalid_device'].includes(error.message) ? error.message : 'activation_unavailable';
    return jsonResponse({ errorCategory: category }, category === 'rate_limited' ? 429 : 400);
  }
});
