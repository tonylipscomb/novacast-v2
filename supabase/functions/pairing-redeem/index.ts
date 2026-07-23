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
    const token = typeof body?.redemptionToken === 'string' ? body.redemptionToken : '';
    const installationId = normalizeInstallationId(body?.installationId);
    if (!sessionId || token.length < 20) return jsonResponse({ errorCategory: 'invalid_redemption' }, 400);

    const client = getAdminClient();
    await optionalAuthenticateDevice(request, client).catch(() => null);
    pairingDiagnostic('redemption-started', { state: 'completed' });
    const installationHash = await hashInstallation(installationId);
    const rateKey = await hashToken(`${installationHash}:${getClientAddress(request)}:redeem`);
    if (!(await consumeRateLimit(client, rateKey, 12, 600))) return jsonResponse({ errorCategory: 'rate_limited' }, 429);

    const { data: session, error } = await client
      .from('pairing_sessions')
      .select('id,state,installation_hash,redemption_hash,redemption_expires_at,redemption_consumed_at,provider_record_id')
      .eq('id', sessionId)
      .eq('installation_hash', installationHash)
      .maybeSingle();
    if (error || !session || session.state !== 'completed' || !session.provider_record_id) return jsonResponse({ errorCategory: 'invalid_redemption' }, 409);
    if (session.redemption_expires_at && new Date(session.redemption_expires_at).getTime() <= Date.now()) return jsonResponse({ errorCategory: 'redemption_expired' }, 409);
    if (session.redemption_hash !== (await hashToken(token))) return jsonResponse({ errorCategory: 'invalid_redemption' }, 409);

    if (!session.redemption_consumed_at) {
      const { data: consumed } = await client
        .from('pairing_sessions')
        .update({ redemption_consumed_at: new Date().toISOString() })
        .eq('id', session.id)
        .is('redemption_consumed_at', null)
        .select('id')
        .maybeSingle();
      if (!consumed) return jsonResponse({ errorCategory: 'redemption_already_used' }, 409);
    }

    const { data: provider, error: providerError } = await client
      .from('pairing_provider_records')
      .select('provider_name,credentials_ciphertext,credentials_iv')
      .eq('id', session.provider_record_id)
      .single();
    if (providerError || !provider) throw new Error('server_configuration_error');

    const credentials = JSON.parse(await decryptSecret(provider.credentials_ciphertext, provider.credentials_iv)) as {
      type: 'xtream';
      baseUrl: string;
      username: string;
      password: string;
    };
    pairingDiagnostic('redemption-completed', { state: 'completed' });
    return jsonResponse({ providerName: provider.provider_name, ...credentials });
  } catch (error) {
    const category = error instanceof Error && ['invalid_device', 'rate_limited', 'invalid_redemption', 'redemption_expired', 'redemption_already_used', 'invalid_pairing_session'].includes(error.message)
      ? error.message
      : 'unexpected_server_error';
    const status = category === 'rate_limited' ? 429 : 409;
    return jsonResponse({ errorCategory: category }, status);
  }
});
