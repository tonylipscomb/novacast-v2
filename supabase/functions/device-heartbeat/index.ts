import { jsonResponse, optionsResponse, readJson } from '../_shared/http.ts';
import { authenticateDevice, deviceRateKey } from '../_shared/device.ts';
import { consumeRateLimit, getAdminClient } from '../_shared/supabase.ts';
import { hashToken } from '../_shared/security.ts';

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return optionsResponse();
  if (request.method !== 'POST') return jsonResponse({ errorCategory: 'method_not_allowed' }, 405);
  try {
    const client = getAdminClient();
    const device = await authenticateDevice(request, client);
    if (!(await consumeRateLimit(client, await deviceRateKey(request, device.id, 'heartbeat'), 4, 600))) return jsonResponse({ errorCategory: 'rate_limited' }, 429);
    const body = await readJson(request);
    const metadata = body?.metadata && typeof body.metadata === 'object' ? body.metadata as Record<string, unknown> : {};
    const patch: Record<string, unknown> = { last_seen_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    for (const [source, target, limit] of [['platform', 'platform', 40], ['manufacturer', 'manufacturer', 80], ['model', 'model', 120], ['deviceType', 'device_type', 40], ['osVersion', 'os_version', 40], ['appVersion', 'app_version', 40], ['appBuild', 'app_build', 40]] as const) {
      if (typeof metadata[source] === 'string') patch[target] = metadata[source].slice(0, limit);
    }
    patch.last_ip_hash = await hashToken(request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown-client');
    await client.from('devices').update(patch).eq('id', device.id);
    return jsonResponse({ ok: true });
  } catch (error) {
    const category = error instanceof Error && ['invalid_device', 'rate_limited'].includes(error.message) ? error.message : 'device_heartbeat_failed';
    return jsonResponse({ errorCategory: category }, category === 'rate_limited' ? 429 : 401);
  }
});
