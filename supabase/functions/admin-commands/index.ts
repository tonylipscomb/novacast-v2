import { jsonResponse, optionsResponse, readJson } from '../_shared/http.ts';
import { requireAdmin } from '../_shared/admin.ts';

const ALLOWED_COMMANDS = new Set([
  'refresh_library',
  'refresh_guide',
  'restart_app',
  'restart_player',
  'clear_image_cache',
  'clear_metadata_cache',
  'rebuild_search_index',
  'rebuild_categories',
  'run_diagnostics',
  'push_configuration',
  'show_notification',
  'reset_pairing',
  'factory_reset',
]);

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return optionsResponse();

  try {
    const { client, user } = await requireAdmin(request);

    if (request.method === 'GET') {
      const url = new URL(request.url);
      const deviceId = url.searchParams.get('deviceId');
      let query = client
        .from('device_commands')
        .select('id,device_id,command,payload,status,created_at,acked_at,completed_at,result')
        .order('created_at', { ascending: false })
        .limit(100);
      if (deviceId) query = query.eq('device_id', deviceId);
      const { data, error } = await query;
      if (error) throw new Error('admin_query_failed');
      return jsonResponse({ commands: data ?? [] });
    }

    if (request.method !== 'POST') {
      return jsonResponse({ errorCategory: 'method_not_allowed' }, 405);
    }

    const body = await readJson(request);
    const deviceId = typeof body?.deviceId === 'string' ? body.deviceId : '';
    const command = typeof body?.command === 'string' ? body.command.trim() : '';
    if (!deviceId || !ALLOWED_COMMANDS.has(command)) {
      return jsonResponse({ errorCategory: 'invalid_request' }, 400);
    }

    const payload = body?.payload && typeof body.payload === 'object' ? body.payload : {};
    const { data, error } = await client
      .from('device_commands')
      .insert({
        device_id: deviceId,
        command,
        payload,
        status: 'pending',
        created_by: user.id,
      })
      .select('id,device_id,command,payload,status,created_at')
      .single();

    if (error || !data) throw new Error('admin_create_failed');
    return jsonResponse({ command: data });
  } catch (error) {
    const category =
      error instanceof Error && error.message === 'admin_unauthorized' ? error.message : 'admin_request_failed';
    return jsonResponse({ errorCategory: category }, category === 'admin_unauthorized' ? 401 : 500);
  }
});
