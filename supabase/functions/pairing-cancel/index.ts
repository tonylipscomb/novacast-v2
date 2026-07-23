import { jsonResponse, optionsResponse, readJson } from '../_shared/http.ts';
import { pairingDiagnostic } from '../_shared/diagnostics.ts';
import { getAdminClient } from '../_shared/supabase.ts';
import { hashInstallation, normalizeInstallationId } from '../_shared/security.ts';
import { authenticateDevice } from '../_shared/device.ts';

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return optionsResponse();
  if (request.method !== 'POST') return jsonResponse({ errorCategory: 'method_not_allowed' }, 405);

  try {
    const body = await readJson(request);
    const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : '';
    const installationId = normalizeInstallationId(body?.installationId);
    if (!sessionId) return jsonResponse({ errorCategory: 'invalid_pairing_session' }, 400);
    const client = getAdminClient();
    const authenticatedDevice = request.headers.get('x-novacast-device-id') && request.headers.get('x-novacast-device-secret')
      ? await authenticateDevice(request, client)
      : null;
    let sessionQuery = client
      .from('pairing_sessions')
      .update({ state: 'cancelled' })
      .eq('id', sessionId)
      .in('state', ['pending', 'claiming', 'validating']);
    sessionQuery = authenticatedDevice ? sessionQuery.eq('device_id', authenticatedDevice.id) : sessionQuery.eq('installation_hash', await hashInstallation(installationId));
    const { error } = await sessionQuery;
    if (error) throw new Error('server_configuration_error');
    pairingDiagnostic('session-cancelled', { state: 'cancelled' });
    return jsonResponse({ status: 'cancelled' });
  } catch {
    return jsonResponse({ errorCategory: 'pairing_request_failed' }, 503);
  }
});
