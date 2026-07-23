import { jsonResponse, optionsResponse, readJson } from '../_shared/http.ts';
import { requireAdmin } from '../_shared/admin.ts';
import { encryptSecret } from '../_shared/security.ts';

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return optionsResponse();

  try {
    const { client } = await requireAdmin(request);

    if (request.method === 'GET') {
      const { data, error } = await client
        .from('managed_providers')
        .select('id,slug,display_name,status,content_policy,notes,last_validated_at,created_at,updated_at')
        .order('created_at', { ascending: false });
      if (error) throw new Error('admin_query_failed');

      const providers = [];
      for (const provider of data ?? []) {
        const { count } = await client
          .from('device_provider_assignments')
          .select('id', { count: 'exact', head: true })
          .eq('managed_provider_id', provider.id)
          .eq('status', 'active');
        providers.push({ ...provider, assignedDevices: count ?? 0 });
      }

      return jsonResponse({ providers });
    }

    if (request.method !== 'POST' && request.method !== 'PATCH') {
      return jsonResponse({ errorCategory: 'method_not_allowed' }, 405);
    }

    const body = await readJson(request);

    if (request.method === 'PATCH') {
      const id = typeof body?.id === 'string' ? body.id : '';
      if (!id) return jsonResponse({ errorCategory: 'invalid_request' }, 400);

      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (typeof body?.displayName === 'string') patch.display_name = body.displayName.slice(0, 120);
      if (typeof body?.notes === 'string') patch.notes = body.notes.slice(0, 2000);
      if (typeof body?.contentPolicy === 'string') patch.content_policy = body.contentPolicy.slice(0, 64);
      if (['active', 'paused', 'revoked'].includes(String(body?.status))) patch.status = body.status;

      if (body?.credentials && typeof body.credentials === 'object') {
        const baseUrl = String(body.credentials.baseUrl ?? '').trim();
        const username = String(body.credentials.username ?? '').trim();
        const password = String(body.credentials.password ?? '');
        if (!baseUrl || !username || !password) {
          return jsonResponse({ errorCategory: 'invalid_credentials' }, 400);
        }
        const encrypted = await encryptSecret(
          JSON.stringify({ type: 'xtream', baseUrl, username, password }),
        );
        patch.credentials_ciphertext = encrypted.ciphertext;
        patch.credentials_iv = encrypted.iv;
        patch.last_validated_at = null;
      }

      const { error } = await client.from('managed_providers').update(patch).eq('id', id);
      if (error) throw new Error('admin_update_failed');
      return jsonResponse({ ok: true });
    }

    const slug = String(body?.slug ?? '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64);
    const displayName = String(body?.displayName ?? '').trim().slice(0, 120);
    const baseUrl = String(body?.credentials?.baseUrl ?? '').trim();
    const username = String(body?.credentials?.username ?? '').trim();
    const password = String(body?.credentials?.password ?? '');

    if (!slug || !displayName || !baseUrl || !username || !password) {
      return jsonResponse({ errorCategory: 'invalid_request' }, 400);
    }

    const encrypted = await encryptSecret(JSON.stringify({ type: 'xtream', baseUrl, username, password }));
    const { data, error } = await client
      .from('managed_providers')
      .insert({
        slug,
        display_name: displayName,
        credentials_ciphertext: encrypted.ciphertext,
        credentials_iv: encrypted.iv,
        content_policy: typeof body?.contentPolicy === 'string' ? body.contentPolicy.slice(0, 64) : 'us_only',
        notes: typeof body?.notes === 'string' ? body.notes.slice(0, 2000) : null,
        status: 'active',
      })
      .select('id,slug,display_name,status,content_policy,notes,created_at')
      .single();

    if (error || !data) throw new Error('admin_create_failed');
    return jsonResponse({ provider: data });
  } catch (error) {
    const category =
      error instanceof Error && error.message === 'admin_unauthorized' ? error.message : 'admin_request_failed';
    return jsonResponse({ errorCategory: category }, category === 'admin_unauthorized' ? 401 : 500);
  }
});
