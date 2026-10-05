import { adminJsonResponse, adminOptionsResponse } from '../_shared/http.ts';
import { requireAdmin } from '../_shared/admin.ts';

const SOURCE_COLUMNS = 'id,managed_provider_id,source_kind,safe_label,priority,enabled,last_refresh_at,last_refresh_status,channel_count,programme_count,diagnostic_summary,active_cache_generation,created_at,updated_at';

function freshness(value: unknown, now: number) {
  if (typeof value !== 'string') return { state: 'unknown', ageMs: null };
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return { state: 'unknown', ageMs: null };
  const ageMs = Math.max(0, now - timestamp);
  return { state: ageMs <= 24 * 60 * 60_000 ? 'fresh' : 'stale', ageMs };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return adminOptionsResponse(request);
  if (request.method !== 'GET') return adminJsonResponse(request, { errorCategory: 'method_not_allowed' }, 405);
  try {
    const { client } = await requireAdmin(request);
    const now = Date.now();
    const [providers, sources, refreshes, assignments] = await Promise.all([
      client.from('managed_providers').select('id,display_name,status,epg_mode,epg_last_refresh_at,epg_last_refresh_status,epg_last_refresh_summary').order('display_name', { ascending: true }).limit(200),
      client.from('managed_provider_epg_sources').select(SOURCE_COLUMNS).order('managed_provider_id', { ascending: true }).order('priority', { ascending: true }).limit(500),
      client.from('managed_provider_epg_refresh_requests').select('managed_provider_id,source_id,status,requested_at,started_at,completed_at,failure_code').order('requested_at', { ascending: false }).limit(500),
      client.from('device_provider_assignments').select('managed_provider_id,device_id,status').in('status', ['active', 'assigned']).limit(1000),
    ]);
    if (providers.error || sources.error || refreshes.error || assignments.error) throw new Error('admin_query_failed');
    const providerRows = providers.data ?? [];
    const names = new Map(providerRows.map((row) => [String(row.id), String(row.display_name ?? 'Unknown provider')]));
    const deviceCounts = (assignments.data ?? []).reduce<Record<string, number>>((out, row) => { const id = String(row.managed_provider_id ?? ''); if (id) out[id] = (out[id] ?? 0) + 1; return out; }, {});
    const latestRefresh = new Map<string, Record<string, unknown>>();
    for (const row of refreshes.data ?? []) { const id = String(row.managed_provider_id); if (!latestRefresh.has(id)) latestRefresh.set(id, row); }
    const sourceRows = sources.data ?? [];
    const sourceCounts = sourceRows.reduce<Record<string, number>>((out, row) => { const id = String(row.managed_provider_id); out[id] = (out[id] ?? 0) + 1; return out; }, {});
    return adminJsonResponse(request, {
      generatedAt: new Date(now).toISOString(),
      providers: providerRows.map((provider) => {
        const id = String(provider.id);
        const latest = latestRefresh.get(id);
        return { id, name: names.get(id), status: provider.status, epgMode: provider.epg_mode, sourceCount: sourceCounts[id] ?? 0, assignedDeviceCount: deviceCounts[id] ?? 0, lastRefreshAt: provider.epg_last_refresh_at, lastRefreshStatus: provider.epg_last_refresh_status, freshness: freshness(provider.epg_last_refresh_at, now), latestResult: latest ? { status: latest.status, requestedAt: latest.requested_at, completedAt: latest.completed_at, failureCode: latest.failure_code } : null };
      }),
      sources: sourceRows.map((source) => ({ id: source.id, providerId: source.managed_provider_id, providerName: names.get(String(source.managed_provider_id)) ?? 'Unknown provider', kind: source.source_kind, label: source.safe_label, priority: source.priority, enabled: source.enabled, lastRefreshAt: source.last_refresh_at, lastRefreshStatus: source.last_refresh_status, channelCount: source.channel_count, programmeCount: source.programme_count, freshness: freshness(source.last_refresh_at, now), diagnostic: source.diagnostic_summary ?? null })),
      refreshRequests: (refreshes.data ?? []).slice(0, 100).map((row) => ({ providerId: row.managed_provider_id, sourceId: row.source_id, status: row.status, requestedAt: row.requested_at, startedAt: row.started_at, completedAt: row.completed_at, failureCode: row.failure_code })),
      limits: { providers: 200, sources: 500, refreshRequests: 500, assignments: 1000 },
    });
  } catch (error) {
    const category = error instanceof Error && error.message === 'admin_unauthorized' ? error.message : 'admin_request_failed';
    return adminJsonResponse(request, { errorCategory: category }, category === 'admin_unauthorized' ? 401 : 500);
  }
});
