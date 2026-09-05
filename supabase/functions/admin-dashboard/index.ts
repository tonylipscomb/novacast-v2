import { adminJsonResponse, adminOptionsResponse } from '../_shared/http.ts';
import { requireAdmin } from '../_shared/admin.ts';

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return adminOptionsResponse(request);
  if (request.method !== 'GET') return adminJsonResponse(request, { errorCategory: 'method_not_allowed' }, 405);

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
      client.from('devices').select('id,status,activation_status,last_seen_at,app_version,app_build'),
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
    const reportedBuilds = deviceRows
      .map((row) => {
        const version =
          typeof row.app_version === 'string' && row.app_version.trim()
            ? row.app_version.trim()
            : null;

        const rawBuild =
          typeof row.app_build === 'string' || typeof row.app_build === 'number'
            ? String(row.app_build).trim()
            : '';

        const build = /^\d+$/.test(rawBuild) ? Number(rawBuild) : null;
        const lastSeen =
          typeof row.last_seen_at === 'string'
            ? Date.parse(row.last_seen_at)
            : 0;

        return { version, build, rawBuild, lastSeen };
      })
      .filter((row) => row.version || row.build !== null);

    reportedBuilds.sort((a, b) => {
      const buildDelta = (b.build ?? -1) - (a.build ?? -1);
      if (buildDelta !== 0) return buildDelta;
      return b.lastSeen - a.lastSeen;
    });

    const latestReported = reportedBuilds[0] ?? null;
    const currentBetaBuild = latestReported
      ? `${latestReported.version ?? 'Unknown'}${latestReported.rawBuild ? ` (${latestReported.rawBuild})` : ''}`
      : null;

    return adminJsonResponse(request, {
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
    return adminJsonResponse(request, { errorCategory: category }, category === 'admin_unauthorized' ? 401 : 500);
  }
});
