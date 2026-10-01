import { adminJsonResponse, adminOptionsResponse } from '../_shared/http.ts';
import { requireAdmin } from '../_shared/admin.ts';

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return adminOptionsResponse(request);
  try {
    const { client } = await requireAdmin(request);
    const url = new URL(request.url);
    const search = url.searchParams.get('search')?.trim() ?? '';
    const page = Math.max(1, Math.floor(Number(url.searchParams.get('page') ?? 1) || 1));
    const pageSize = Math.min(Math.max(Math.floor(Number(url.searchParams.get('pageSize') ?? 25) || 25), 1), 100);
    const status = url.searchParams.get('status')?.trim().toLowerCase() ?? 'all';
    const platform = url.searchParams.get('platform')?.trim() ?? '';
    const activation = url.searchParams.get('activation')?.trim().toLowerCase() ?? 'all';
    const version = url.searchParams.get('version')?.trim() ?? '';
    const providerId = url.searchParams.get('providerId')?.trim() ?? '';
    const providerHealth = url.searchParams.get('providerHealth')?.trim().toLowerCase() ?? 'all';
    const searchTerm = search.replace(/[%,()]/g, ' ').replace(/\s+/g, ' ').trim();
    const onlineCutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const providerHealthResult = providerHealth !== 'all'
      ? await client.from('provider_health').select('managed_provider_id').eq('health_status', providerHealth.toUpperCase())
      : { data: [], error: null };
    if (providerHealthResult.error) throw new Error('admin_query_failed');
    const selectedProviderIds = providerHealthResult.data?.map((row) => row.managed_provider_id).filter((id): id is string => typeof id === 'string') ?? [];
    if (providerHealth !== 'all' && !selectedProviderIds.length) {
      return adminJsonResponse(request, { devices: [], items: [], page, pageSize, total: 0, totalPages: 0 });
    }
    let query = client.from('devices').select('id,public_device_code,friendly_name,platform,manufacturer,model,device_type,os_version,app_version,app_build,status,activation_status,last_seen_at,created_at,revoked_at,content_policy,managed_provider_id,assigned_tester_name,assigned_tester_email,current_route,app_focus,last_diagnostics', { count: 'exact' });
    if (searchTerm) query = query.or(`public_device_code.ilike.%${searchTerm}%,friendly_name.ilike.%${searchTerm}%,model.ilike.%${searchTerm}%,assigned_tester_name.ilike.%${searchTerm}%`);
    if (status === 'online') query = query.gte('last_seen_at', onlineCutoff);
    else if (status === 'offline' || status === 'stale') query = query.lt('last_seen_at', onlineCutoff);
    else if (status !== 'all') query = query.eq('status', status);
    if (activation !== 'all') query = query.eq('activation_status', activation);
    if (platform && platform !== 'all') query = query.eq('platform', platform);
    if (version) query = query.eq('app_version', version);
    if (providerId) query = query.eq('managed_provider_id', providerId);
    if (providerHealth !== 'all') query = query.in('managed_provider_id', selectedProviderIds);
    const from = (page - 1) * pageSize;
    const { data, error, count } = await query.order('last_seen_at', { ascending: false, nullsFirst: false }).order('id', { ascending: true }).range(from, from + pageSize - 1);
    if (error) throw new Error('admin_query_failed');
    const deviceRows = data ?? [];
    const ids = deviceRows.map((row) => row.id).filter((id): id is string => typeof id === 'string');
    const activations = ids.length
      ? await client.from('device_activations').select('device_id,expires_at').in('device_id', ids).eq('status', 'active')
      : { data: [], error: null };
    if (activations.error) throw new Error('admin_query_failed');
    const expiryByDevice = new Map((activations.data ?? []).map((row) => [row.device_id, row.expires_at]));
    const assignments = ids.length
      ? await client
          .from('device_provider_assignments')
          .select('id,device_id,managed_provider_id,assigned_at,updated_at,status')
          .in('device_id', ids)
          .eq('status', 'active')
      : { data: [], error: null };
    if (assignments.error) throw new Error('admin_query_failed');
    const assignmentByDevice = new Map(
      (assignments.data ?? []).map((row) => [row.device_id, row]),
    );
    const commands = ids.length
      ? await client
          .from('device_commands')
          .select('id,device_id,status,completed_at,created_at,payload')
          .in('device_id', ids)
          .eq('command', 'push_configuration')
          .order('created_at', { ascending: false })
          .limit(Math.max(ids.length * 3, 20))
      : { data: [], error: null };
    if (commands.error) throw new Error('admin_query_failed');
    const commandByDevice = new Map<string, (typeof commands.data)[number]>();
    for (const command of commands.data ?? []) {
      if (!commandByDevice.has(command.device_id)) {
        commandByDevice.set(command.device_id, command);
      }
    }
    const items = deviceRows.map((row) => {
        const assignment = assignmentByDevice.get(row.id);
        const command = commandByDevice.get(row.id);
        const diagnostics =
          row.last_diagnostics && typeof row.last_diagnostics === 'object'
            ? (row.last_diagnostics as Record<string, unknown>)
            : {};
        return {
          ...row,
          activation_expires_at: expiryByDevice.get(row.id) ?? null,
          assignment_id: assignment?.id ?? null,
          assigned_at: assignment?.assigned_at ?? null,
          assignment_command_status: command?.status ?? null,
          assignment_applied_at:
            (typeof diagnostics.appliedAssignmentAt === 'string' && diagnostics.appliedAssignmentAt) ||
            command?.completed_at ||
            null,
          applied_assignment_id:
            (typeof diagnostics.appliedAssignmentId === 'string' && diagnostics.appliedAssignmentId) ||
            null,
        };
      });
    const total = count ?? 0;
    return adminJsonResponse(request, { devices: items, items, page, pageSize, total, totalPages: total ? Math.ceil(total / pageSize) : 0 });
  } catch (error) {
    const category = error instanceof Error && error.message === 'admin_unauthorized' ? error.message : 'admin_query_failed';
    return adminJsonResponse(request, { errorCategory: category }, category === 'admin_unauthorized' ? 401 : 500);
  }
});
