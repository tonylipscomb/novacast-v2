import { jsonResponse, optionsResponse } from '../_shared/http.ts';
import { requireAdmin } from '../_shared/admin.ts';

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return optionsResponse();
  if (request.method !== 'GET') return jsonResponse({ errorCategory: 'method_not_allowed' }, 405);

  try {
    const { client } = await requireAdmin(request);
    const nowIso = new Date().toISOString();
    const onlineCutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();

    const [
      devices,
      activations,
      invites,
      providers,
      pendingCommands,
      recentErrors,
    ] = await Promise.all([
      client.from('devices').select('id,status,activation_status,last_seen_at,app_version'),
      client.from('device_activations').select('id,status,expires_at').eq('status', 'active'),
      client.from('beta_invites').select('id,status'),
      client.from('managed_providers').select('id,status'),
      client.from('device_commands').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      client
        .from('devices')
        .select('id,public_device_code,last_diagnostics,updated_at')
        .not('last_diagnostics', 'is', null)
        .order('updated_at', { ascending: false })
        .limit(10),
    ]);

    if (devices.error || activations.error || invites.error || providers.error) {
      throw new Error('admin_query_failed');
    }

    const deviceRows = devices.data ?? [];
    const online = deviceRows.filter((row) => row.last_seen_at && row.last_seen_at >= onlineCutoff).length;
    const offline = deviceRows.length - online;
    const activated = deviceRows.filter((row) => row.activation_status === 'active').length;
    const expired = deviceRows.filter((row) => row.activation_status === 'expired').length;
    const pendingActivations = deviceRows.filter((row) => row.activation_status === 'inactive').length;
    const activeInvites = (invites.data ?? []).filter((row) => row.status === 'active').length;
    const activeProviders = (providers.data ?? []).filter((row) => row.status === 'active').length;

    const builds = new Map<string, number>();
    for (const row of deviceRows) {
      const version = typeof row.app_version === 'string' && row.app_version ? row.app_version : 'unknown';
      builds.set(version, (builds.get(version) ?? 0) + 1);
    }
    const currentBetaBuild = [...builds.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

    return jsonResponse({
      serverTime: nowIso,
      dashboard: {
        devicesOnline: online,
        devicesOffline: offline,
        activatedDevices: activated,
        expiredDevices: expired,
        pendingActivations,
        providers: activeProviders,
        activeInvitations: activeInvites,
        syncQueue: pendingCommands.count ?? 0,
        currentBetaBuild,
        recentErrors: (recentErrors.data ?? []).map((row) => ({
          deviceId: row.id,
          publicDeviceCode: row.public_device_code,
          diagnostics: row.last_diagnostics,
          updatedAt: row.updated_at,
        })),
      },
    });
  } catch (error) {
    const category =
      error instanceof Error && error.message === 'admin_unauthorized' ? error.message : 'admin_request_failed';
    return jsonResponse({ errorCategory: category }, category === 'admin_unauthorized' ? 401 : 500);
  }
});
