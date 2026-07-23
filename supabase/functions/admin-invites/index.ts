import { jsonResponse, optionsResponse, readJson } from '../_shared/http.ts';
import { requireAdmin } from '../_shared/admin.ts';
import { createPairingCode, hashCode } from '../_shared/security.ts';

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return optionsResponse();
  try {
    const { client, user } = await requireAdmin(request);
    if (request.method === 'GET') {
      const { data, error } = await client.from('beta_invites').select('id,display_label,status,maximum_devices,redeemed_count,starts_at,expires_at,created_at,updated_at').order('created_at', { ascending: false });
      if (error) throw new Error('admin_query_failed');
      return jsonResponse({ invitations: data ?? [] });
    }
    if (request.method !== 'POST' && request.method !== 'PATCH') return jsonResponse({ errorCategory: 'method_not_allowed' }, 405);
    const body = await readJson(request);
    if (request.method === 'PATCH') {
      const id = typeof body?.id === 'string' ? body.id : '';
      const status = ['active', 'paused', 'revoked'].includes(String(body?.status)) ? body.status : null;
      if (!id || !status) return jsonResponse({ errorCategory: 'invalid_request' }, 400);
      const { error } = await client.from('beta_invites').update({ status, updated_at: new Date().toISOString() }).eq('id', id);
      if (error) throw new Error('admin_update_failed');
      return jsonResponse({ ok: true });
    }
    const code = createPairingCode();
    const { data, error } = await client.from('beta_invites').insert({ code_hash: await hashCode(code), display_label: typeof body?.label === 'string' ? body.label.slice(0, 120) : null, maximum_devices: Math.max(1, Math.min(10000, Number(body?.maximumDevices) || 1)), starts_at: typeof body?.startsAt === 'string' ? body.startsAt : null, expires_at: typeof body?.expiresAt === 'string' ? body.expiresAt : null, created_by: user.id }).select('id,display_label,status,maximum_devices,starts_at,expires_at,created_at').single();
    if (error || !data) throw new Error('admin_create_failed');
    return jsonResponse({ invitation: data, code });
  } catch (error) {
    const category = error instanceof Error && error.message === 'admin_unauthorized' ? error.message : 'admin_request_failed';
    return jsonResponse({ errorCategory: category }, category === 'admin_unauthorized' ? 401 : 500);
  }
});
