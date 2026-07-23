import { getClientAddress, jsonResponse, optionsResponse, readJson } from '../_shared/http.ts';
import { pairingDiagnostic } from '../_shared/diagnostics.ts';
import { getAdminClient, consumeRateLimit } from '../_shared/supabase.ts';
import { createPairingCode, hashCode, hashInstallation, hashToken, normalizeInstallationId } from '../_shared/security.ts';
import { authenticateDevice } from '../_shared/device.ts';

const SESSION_TTL_MS = 10 * 60 * 1000;

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return optionsResponse();
  if (request.method !== 'POST') return jsonResponse({ errorCategory: 'method_not_allowed' }, 405);

  try {
    const body = await readJson(request);
    const installationId = normalizeInstallationId(body?.installationId);
    const installationHash = await hashInstallation(installationId);
    const client = getAdminClient();
    const authenticatedDevice = request.headers.get('x-novacast-device-id') && request.headers.get('x-novacast-device-secret')
      ? await authenticateDevice(request, client)
      : null;
    if (Deno.env.get('DEVICE_ACTIVATION_REQUIRED') === 'true' && (!authenticatedDevice || authenticatedDevice.activation_status !== 'active')) {
      return jsonResponse({ errorCategory: 'activation_required' }, 403);
    }
    const clientKey = await hashToken(`${getClientAddress(request)}:create`);
    if (!(await consumeRateLimit(client, clientKey, 8, 600))) {
      return jsonResponse({ errorCategory: 'rate_limited' }, 429);
    }

    await client
      .from('pairing_sessions')
        .update({ state: 'cancelled' })
      .eq('installation_hash', installationHash)
      .in('state', ['pending', 'claiming', 'validating']);

    const webUrl = Deno.env.get('PAIRING_WEB_URL');
    if (!webUrl) throw new Error('server_configuration_error');

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const code = createPairingCode();
      const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
      const { data, error } = await client
        .from('pairing_sessions')
        .insert({ code_hash: await hashCode(code), installation_hash: installationHash, device_id: authenticatedDevice?.id ?? null, expires_at: expiresAt })
        .select('id, expires_at')
        .single();

      if (!error && data) {
        const pairUrl = new URL('/pair', webUrl);
        pairUrl.searchParams.set('code', code);
        pairingDiagnostic('session-created', { state: 'pending' });
        return jsonResponse({ sessionId: data.id, code, pairUrl: pairUrl.toString(), expiresAt: Date.parse(data.expires_at) });
      }

      if (error && !error.message.toLowerCase().includes('duplicate')) {
        throw new Error('server_configuration_error');
      }
    }

    return jsonResponse({ errorCategory: 'pairing_request_failed' }, 503);
  } catch (error) {
    const category = error instanceof Error ? error.message : 'pairing_request_failed';
    const status = category === 'rate_limited' ? 429 : category === 'invalid_device' ? 400 : 503;
    return jsonResponse({ errorCategory: category }, status);
  }
});
