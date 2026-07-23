import { jsonResponse, optionsResponse, readJson } from '../_shared/http.ts';
import { requireAdmin } from '../_shared/admin.ts';

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return optionsResponse();
  if (request.method !== 'POST') return jsonResponse({ errorCategory: 'method_not_allowed' }, 405);
  try {
    const { client } = await requireAdmin(request);
    const body = await readJson(request);
    const deviceId = typeof body?.deviceId === 'string' ? body.deviceId : '';
    const action = body?.action === 'restore' ? 'restore' : body?.action === 'revoke' ? 'revoke' : '';
    if (!deviceId || !action) return jsonResponse({ errorCategory: 'invalid_request' }, 400);
    const patch = action === 'revoke'
      ? { status: 'revoked', activation_status: 'revoked', revoked_at: new Date().toISOString(), updated_at: new Date().toISOString() }
      : { status: 'registered', activation_status: 'inactive', revoked_at: null, updated_at: new Date().toISOString() };
    const { error } = await client.from('devices').update(patch).eq('id', deviceId);
    if (error) throw new Error('admin_update_failed');
    if (action === 'revoke') await client.from('device_activations').update({ status: 'revoked', revoked_at: new Date().toISOString(), revoked_reason: typeof body?.reason === 'string' ? body.reason.slice(0, 200) : 'Revoked by administrator', updated_at: new Date().toISOString() }).eq('device_id', deviceId).eq('status', 'active');
    return jsonResponse({ ok: true });
  } catch (error) {
    const category = error instanceof Error && error.message === 'admin_unauthorized' ? error.message : 'admin_update_failed';
    return jsonResponse({ errorCategory: category }, category === 'admin_unauthorized' ? 401 : 500);
  }
});
