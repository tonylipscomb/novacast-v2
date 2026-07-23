import { jsonResponse, optionsResponse } from '../_shared/http.ts';
import { authenticateDevice, deviceRateKey } from '../_shared/device.ts';
import { consumeRateLimit, getAdminClient } from '../_shared/supabase.ts';
import { decryptSecret } from '../_shared/security.ts';

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return optionsResponse();
  if (request.method !== 'POST') return jsonResponse({ errorCategory: 'method_not_allowed' }, 405);

  try {
    const client = getAdminClient();
    const device = await authenticateDevice(request, client);
    if (!(await consumeRateLimit(client, await deviceRateKey(request, device.id, 'provider-download'), 12, 600))) {
      return jsonResponse({ errorCategory: 'rate_limited' }, 429);
    }

    const { data: activation } = await client
      .from('device_activations')
      .select('status,expires_at,content_policy')
      .eq('device_id', device.id)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!activation) {
      return jsonResponse({ errorCategory: 'activation_required' }, 403);
    }
    if (activation.expires_at && new Date(activation.expires_at).getTime() <= Date.now()) {
      return jsonResponse({ errorCategory: 'activation_expired' }, 403);
    }

    const { data: assignment } = await client
      .from('device_provider_assignments')
      .select('id,managed_provider_id,content_policy')
      .eq('device_id', device.id)
      .eq('status', 'active')
      .order('assigned_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!assignment) {
      return jsonResponse({ errorCategory: 'provider_not_assigned' }, 404);
    }

    const { data: provider, error } = await client
      .from('managed_providers')
      .select('id,display_name,slug,credentials_ciphertext,credentials_iv,content_policy,status')
      .eq('id', assignment.managed_provider_id)
      .maybeSingle();

    if (error || !provider || provider.status !== 'active') {
      return jsonResponse({ errorCategory: 'provider_unavailable' }, 404);
    }

    const credentials = JSON.parse(
      await decryptSecret(provider.credentials_ciphertext, provider.credentials_iv),
    ) as {
      type: 'xtream';
      baseUrl: string;
      username: string;
      password: string;
    };

    if (credentials.type !== 'xtream' || !credentials.baseUrl || !credentials.username || !credentials.password) {
      return jsonResponse({ errorCategory: 'provider_unavailable' }, 500);
    }

    return jsonResponse({
      providerId: provider.id,
      providerName: provider.display_name,
      providerSlug: provider.slug,
      contentPolicy: assignment.content_policy ?? provider.content_policy ?? activation.content_policy ?? 'us_only',
      type: 'xtream',
      baseUrl: credentials.baseUrl,
      username: credentials.username,
      password: credentials.password,
      serverTime: new Date().toISOString(),
    });
  } catch (error) {
    const category =
      error instanceof Error && ['invalid_device', 'rate_limited'].includes(error.message)
        ? error.message
        : 'provider_download_failed';
    return jsonResponse({ errorCategory: category }, category === 'rate_limited' ? 429 : 401);
  }
});
