import { jsonResponse, optionsResponse } from '../_shared/http.ts';
import { requireAdmin } from '../_shared/admin.ts';

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return optionsResponse();
  try {
    const { client } = await requireAdmin(request);
    const url = new URL(request.url);
    const search = url.searchParams.get('search')?.trim() ?? '';
    let query = client.from('devices').select('id,public_device_code,friendly_name,platform,manufacturer,model,device_type,os_version,app_version,app_build,status,activation_status,last_seen_at,created_at,revoked_at,content_policy,managed_provider_id,assigned_tester_name,assigned_tester_email,current_route,app_focus,last_diagnostics').order('last_seen_at', { ascending: false, nullsFirst: false }).limit(Math.min(Number(url.searchParams.get('limit') ?? 100), 200));
    if (search) query = query.or(`public_device_code.ilike.%${search}%,friendly_name.ilike.%${search}%,model.ilike.%${search}%`);
    const { data, error } = await query;
    if (error) throw new Error('admin_query_failed');
    return jsonResponse({ devices: data ?? [] });
  } catch (error) {
    const category = error instanceof Error && error.message === 'admin_unauthorized' ? error.message : 'admin_query_failed';
    return jsonResponse({ errorCategory: category }, category === 'admin_unauthorized' ? 401 : 500);
  }
});
