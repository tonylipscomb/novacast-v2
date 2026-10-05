import { adminJsonResponse, adminOptionsResponse } from '../_shared/http.ts';
import { requireAdmin } from '../_shared/admin.ts';

function ageState(value: unknown, staleAfterMs: number, now: number) {
  if (typeof value !== 'string') return { state: 'unknown', ageMs: null };
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return { state: 'unknown', ageMs: null };
  const ageMs = Math.max(0, now - timestamp);
  return { state: ageMs <= staleAfterMs ? 'fresh' : 'stale', ageMs };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return adminOptionsResponse(request);
  if (request.method !== 'GET') return adminJsonResponse(request, { errorCategory: 'method_not_allowed' }, 405);
  try {
    const { client } = await requireAdmin(request);
    const now = Date.now();
    const [sports, sportsLease, announcements, trends, affinity] = await Promise.all([
      client.from('novapulse_sports_events').select('id,status,updated_at,expires_at', { count: 'exact' }).gt('expires_at', new Date(now).toISOString()).order('updated_at', { ascending: false }).limit(1),
      client.from('novapulse_sports_refresh_leases').select('lease_name,acquired_at,expires_at,updated_at').limit(10),
      client.from('novapulse_announcements').select('id,status,updated_at,published_at', { count: 'exact' }).is('deleted_at', null).order('updated_at', { ascending: false }).limit(1),
      client.from('novapulse_content_trends').select('updated_at', { count: 'exact' }).order('updated_at', { ascending: false }).limit(1),
      client.from('novapulse_content_affinity').select('updated_at', { count: 'exact' }).order('updated_at', { ascending: false }).limit(1),
    ]);
    if (sports.error || sportsLease.error || announcements.error || trends.error || affinity.error) throw new Error('admin_query_failed');
    const sportsAt = sports.data?.[0]?.updated_at ?? null;
    const announcementAt = announcements.data?.[0]?.updated_at ?? null;
    const trendAt = trends.data?.[0]?.updated_at ?? null;
    const affinityAt = affinity.data?.[0]?.updated_at ?? null;
    return adminJsonResponse(request, {
      generatedAt: new Date(now).toISOString(),
      sources: {
        weather: { state: 'unknown', source: 'request-time edge feed', reason: 'no durable attempt/success record exists' },
        news: { state: 'unknown', source: 'request-time edge feed', reason: 'no durable attempt/success record exists' },
        sports: { ...ageState(sportsAt, 3 * 86_400_000, now), itemCount: sports.count ?? 0, lastSuccessAt: sportsAt, lease: sportsLease.data ?? [] },
        announcements: { ...ageState(announcementAt, 24 * 60 * 60_000, now), itemCount: announcements.count ?? 0, lastSuccessAt: announcementAt },
        recommendations: { ...ageState(trendAt ?? affinityAt, 7 * 86_400_000, now), trendCount: trends.count ?? 0, affinityCount: affinity.count ?? 0, lastSuccessAt: trendAt ?? affinityAt },
      },
      actions: { sportsRefresh: 'existing server refresh is secret/service-authorized; no browser action exposed', announcements: 'use /admin/novapulse', recommendations: 'aggregation is server scheduled; no browser action exposed' },
    });
  } catch (error) {
    const category = error instanceof Error && error.message === 'admin_unauthorized' ? error.message : 'admin_request_failed';
    return adminJsonResponse(request, { errorCategory: category }, category === 'admin_unauthorized' ? 401 : 500);
  }
});
