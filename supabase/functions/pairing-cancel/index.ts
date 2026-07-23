import { jsonResponse, optionsResponse, readJson } from '../_shared/http.ts';
import { pairingDiagnostic } from '../_shared/diagnostics.ts';
import { getAdminClient } from '../_shared/supabase.ts';
import { hashInstallation, normalizeInstallationId } from '../_shared/security.ts';
import { optionalAuthenticateDevice } from '../_shared/device.ts';

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return optionsResponse();
  if (request.method !== 'POST') return jsonResponse({ errorCategory: 'method_not_allowed' }, 405);

  try {
    const body = await readJson(request);
    const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : '';
    const installationId = normalizeInstallationId(body?.installationId);
    if (!sessionId) return jsonResponse({ errorCategory: 'invalid_pairing_session' }, 400);
    const client = getAdminClient();
    // Optional auth: activation-required mode can be enforced later without breaking cancel.
    await optionalAuthenticateDevice(request, client).catch(() => null);

    const { error } = await client
      .from('pairing_sessions')
      .update({ state: 'cancelled' })
      .eq('id', sessionId)
      .eq('installation_hash', await hashInstallation(installationId))
      .in('state', ['pending', 'claiming', 'validating']);
    if (error) throw new Error('server_configuration_error');
    pairingDiagnostic('session-cancelled', { state: 'cancelled' });
    return jsonResponse({ status: 'cancelled' });
  } catch {
    return jsonResponse({ errorCategory: 'pairing_request_failed' }, 503);
  }
});
