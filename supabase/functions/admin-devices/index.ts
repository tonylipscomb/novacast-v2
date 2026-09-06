import { adminJsonResponse, adminOptionsResponse } from '../_shared/http.ts';
import { requireAdmin } from '../_shared/admin.ts';

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return adminOptionsResponse(request);
  try {
    const { client } = await requireAdmin(request);
    const url = new URL(request.url);
    const search = url.searchParams.get('search')?.trim() ?? '';
    let query = client.from('devices').select('id,public_device_code,friendly_name,platform,manufacturer,model,device_type,os_version,app_version,app_build,status,activation_status,last_seen_at,created_at,revoked_at,content_policy,managed_provider_id,assigned_tester_name,assigned_tester_email,current_route,app_focus,last_diagnostics').order('last_seen_at', { ascending: false, nullsFirst: false }).limit(Math.min(Number(url.searchParams.get('limit') ?? 100), 200));
    if (search) query = query.or(`public_device_code.ilike.%${search}%,friendly_name.ilike.%${search}%,model.ilike.%${search}%`);
    const { data, error } = await query;
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
    return adminJsonResponse(request, {
      devices: deviceRows.map((row) => {
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
      }),
    });
  } catch (error) {
    const category = error instanceof Error && error.message === 'admin_unauthorized' ? error.message : 'admin_query_failed';
    return adminJsonResponse(request, { errorCategory: category }, category === 'admin_unauthorized' ? 401 : 500);
  }
});
