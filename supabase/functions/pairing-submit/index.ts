import { getClientAddress, jsonResponse, optionsResponse, readJson } from '../_shared/http.ts';
import { pairingDiagnostic } from '../_shared/diagnostics.ts';
import { consumeRateLimit, getAdminClient } from '../_shared/supabase.ts';
import {
  encryptSecret,
  createSecretToken,
  hashCode,
  hashToken,
  normalizeCode,
  normalizeProviderUrl,
  validateXtreamProvider,
} from '../_shared/security.ts';

const ALLOWED_FAILURES = new Set([
  'invalid_pairing_code',
  'expired_pairing_code',
  'pairing_code_already_used',
  'invalid_provider_url',
  'http_provider_not_allowed',
  'unsafe_provider_target',
  'provider_unreachable',
  'authentication_failed',
  'provider_response_invalid',
  'validation_timed_out',
  'rate_limited',
]);

function failureCategory(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  return ALLOWED_FAILURES.has(message) ? message : 'unexpected_server_error';
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return optionsResponse();
  if (request.method !== 'POST') return jsonResponse({ errorCategory: 'method_not_allowed' }, 405);

  let client;
  let sessionId = '';
  try {
    const body = await readJson(request);
    const code = normalizeCode(body?.code);
    const provider = body?.provider && typeof body.provider === 'object' ? (body.provider as Record<string, unknown>) : null;
    const providerName = typeof provider?.name === 'string' ? provider.name.trim() : '';
    const username = typeof provider?.username === 'string' ? provider.username.trim() : '';
    const password = typeof provider?.password === 'string' ? provider.password : '';
    if (code.length !== 8 || !providerName || providerName.length > 120 || !username || username.length > 240 || !password || password.length > 500) {
      return jsonResponse({ errorCategory: 'invalid_provider_details' }, 400);
    }

    const baseUrl = await normalizeProviderUrl(provider?.baseUrl);
    client = getAdminClient();
    const codeHash = await hashCode(code);
    const ipKey = await hashToken(`${getClientAddress(request)}:submit`);
    const codeKey = await hashToken(`${codeHash}:submit`);
    if (!(await consumeRateLimit(client, ipKey, 30, 600)) || !(await consumeRateLimit(client, codeKey, 8, 600))) {
      return jsonResponse({ errorCategory: 'rate_limited' }, 429);
    }

    const { data: claimed, error: claimError } = await client
      .from('pairing_sessions')
      .update({ state: 'validating', claimed_at: new Date().toISOString(), validation_attempts: 1 })
      .eq('code_hash', codeHash)
      .eq('state', 'pending')
      .gt('expires_at', new Date().toISOString())
      .select('id,installation_hash')
      .maybeSingle();
    if (claimError) throw new Error('server_configuration_error');
    if (!claimed) {
      const { data: existing } = await client.from('pairing_sessions').select('state,expires_at').eq('code_hash', codeHash).maybeSingle();
      if (!existing || new Date(existing.expires_at).getTime() <= Date.now()) throw new Error('expired_pairing_code');
      throw new Error('pairing_code_already_used');
    }
    sessionId = claimed.id;
    pairingDiagnostic('provider-validation-started', { state: 'validating' });

    const account = await validateXtreamProvider(baseUrl, username, password);
    const credentials = await encryptSecret(JSON.stringify({ type: 'xtream', baseUrl, username, password }));
    const redemptionToken = createSecretToken();
    const redemption = await encryptSecret(redemptionToken);
    const providerRecord = {
      pairing_session_id: sessionId,
      installation_hash: claimed.installation_hash,
      provider_name: providerName,
      server_id: new URL(baseUrl).origin + new URL(baseUrl).pathname.replace(/\/$/, ''),
      credentials_ciphertext: credentials.ciphertext,
      credentials_iv: credentials.iv,
    };
    const { data: record, error: recordError } = await client.from('pairing_provider_records').insert(providerRecord).select('id').single();
    if (recordError || !record) throw new Error('unexpected_server_error');

    const { error: completeError } = await client
      .from('pairing_sessions')
      .update({
        state: 'completed',
        completed_at: new Date().toISOString(),
        provider_record_id: record.id,
        redemption_hash: await hashToken(redemptionToken),
        redemption_ciphertext: redemption.ciphertext,
        redemption_iv: redemption.iv,
        redemption_expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        failure_category: null,
      })
      .eq('id', sessionId)
      .eq('state', 'validating');
    if (completeError) throw new Error('unexpected_server_error');

    pairingDiagnostic('provider-validation-succeeded', { state: 'completed' });
    return jsonResponse({ status: 'completed', providerName, expiresAt: account.expiresAt });
  } catch (error) {
    const category = failureCategory(error);
    pairingDiagnostic('provider-validation-failed', { category });
    if (client && sessionId) {
      await client.from('pairing_sessions').update({ state: 'pending', failure_category: category }).eq('id', sessionId).eq('state', 'validating');
    }
    const status = category === 'rate_limited' ? 429 : category.includes('code') ? 409 : 400;
    return jsonResponse({ errorCategory: category }, status);
  }
});
