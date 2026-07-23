import { getClientAddress, jsonResponse, optionsResponse, readJson } from '../_shared/http.ts';
import { pairingDiagnostic } from '../_shared/diagnostics.ts';
import { consumeRateLimit, getAdminClient } from '../_shared/supabase.ts';
import { decryptSecret, hashInstallation, hashToken, normalizeInstallationId } from '../_shared/security.ts';
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
    const authenticatedDevice = await optionalAuthenticateDevice(request, client);
    if (Deno.env.get('DEVICE_ACTIVATION_REQUIRED') === 'true' && (!authenticatedDevice || authenticatedDevice.activation_status !== 'active')) {
      return jsonResponse({ errorCategory: 'activation_required' }, 403);
    }
    const installationHash = await hashInstallation(installationId);
    const clientKey = await hashToken(`${installationHash}:${getClientAddress(request)}:status`);
    if (!(await consumeRateLimit(client, clientKey, 240, 600))) {
      return jsonResponse({ errorCategory: 'rate_limited' }, 429);
    }

    // Ownership remains installation_hash so polling works before/after device_id migration.
    const { data: session, error } = await client
      .from('pairing_sessions')
      .select('id,state,expires_at,provider_record_id,redemption_ciphertext,redemption_iv,redemption_expires_at,redemption_consumed_at')
      .eq('id', sessionId)
      .eq('installation_hash', installationHash)
      .maybeSingle();
    if (error) throw new Error('server_configuration_error');
    if (!session) return jsonResponse({ errorCategory: 'invalid_pairing_session' }, 404);

    if (new Date(session.expires_at).getTime() <= Date.now() && session.state === 'pending') {
      await client.from('pairing_sessions').update({ state: 'expired' }).eq('id', session.id).eq('state', 'pending');
      return jsonResponse({ status: 'expired' });
    }

    if (['expired', 'cancelled'].includes(session.state)) {
      return jsonResponse({ status: 'expired' });
    }

    if (session.state === 'validating') {
      pairingDiagnostic('session-polled', { state: 'validating' });
      return jsonResponse({ status: 'validating' });
    }

    if (
      session.state !== 'completed' ||
      !session.provider_record_id ||
      !session.redemption_ciphertext ||
      !session.redemption_iv
    ) {
      pairingDiagnostic('session-polled', { state: session.state });
      return jsonResponse({ status: 'waiting' });
    }

    if (session.redemption_expires_at && new Date(session.redemption_expires_at).getTime() <= Date.now()) {
      return jsonResponse({ status: 'expired' });
    }

    const { data: provider, error: providerError } = await client
      .from('pairing_provider_records')
      .select('provider_name')
      .eq('id', session.provider_record_id)
      .maybeSingle();
    if (providerError || !provider) throw new Error('server_configuration_error');

    pairingDiagnostic('session-ready-for-redemption', { state: 'completed' });
    return jsonResponse({
      status: 'completed',
      redemptionToken: await decryptSecret(session.redemption_ciphertext, session.redemption_iv),
      providerName: provider.provider_name,
    });
  } catch (error) {
    const category = error instanceof Error ? error.message : 'pairing_request_failed';
    const status = category === 'rate_limited' ? 429 : category === 'invalid_device' || category === 'invalid_pairing_session' ? 400 : 503;
    return jsonResponse({ errorCategory: category }, status);
  }
});
