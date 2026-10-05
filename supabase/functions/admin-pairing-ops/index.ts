import { adminJsonResponse, adminOptionsResponse } from '../_shared/http.ts';
import { requireAdmin } from '../_shared/admin.ts';

const MAX_PAGE_SIZE = 50;
const DEFAULT_PAGE_SIZE = 25;

function boundedInteger(value: string | null, fallback: number, max: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return adminOptionsResponse(request);
  if (request.method !== 'GET') return adminJsonResponse(request, { errorCategory: 'method_not_allowed' }, 405);

  try {
    const { client } = await requireAdmin(request);
    const url = new URL(request.url);
    const page = boundedInteger(url.searchParams.get('page'), 1, 10_000);
    const pageSize = boundedInteger(url.searchParams.get('pageSize'), DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    const now = Date.now();
    const dayAgo = new Date(now - 24 * 60 * 60_000).toISOString();
    const [rows, total, states, recentFailures, recentCompleted, recentRedeemed] = await Promise.all([
      client.from('pairing_sessions')
        .select('id,state,created_at,expires_at,claimed_at,completed_at,failure_category,validation_attempts,provider_record_id', { count: 'exact' })
        .order('created_at', { ascending: false }).range(from, to),
      client.from('pairing_sessions').select('id', { count: 'exact', head: true }),
      Promise.all(['pending', 'claiming', 'validating', 'completed', 'expired', 'cancelled', 'failed'].map(async (state) => {
        const result = await client.from('pairing_sessions').select('id', { count: 'exact', head: true }).eq('state', state);
        return [state, result.count ?? 0] as const;
      })),
      client.from('pairing_sessions').select('id', { count: 'exact', head: true }).not('failure_category', 'is', null).gte('created_at', dayAgo),
      client.from('pairing_sessions').select('id', { count: 'exact', head: true }).eq('state', 'completed').gte('completed_at', dayAgo),
      client.from('pairing_sessions').select('id', { count: 'exact', head: true }).eq('state', 'completed').not('completed_at', 'is', null).gte('completed_at', dayAgo),
    ]);
    if (rows.error || total.error || recentFailures.error || recentCompleted.error || recentRedeemed.error || states.some(([, value]) => value < 0)) {
      throw new Error('admin_query_failed');
    }

    const providerIds = [...new Set((rows.data ?? []).map((row) => row.provider_record_id).filter((id): id is string => typeof id === 'string' && id.length > 0))];
    const providerRecords = providerIds.length
      ? await client.from('pairing_provider_records').select('id,provider_name').in('id', providerIds).limit(providerIds.length)
      : { data: [], error: null };
    if (providerRecords.error) throw new Error('admin_query_failed');
    const providerNames = new Map((providerRecords.data ?? []).map((row) => [String(row.id), String(row.provider_name ?? 'Unknown provider')]));

    return adminJsonResponse(request, {
      page, pageSize, total: total.count ?? 0, totalPages: Math.ceil((total.count ?? 0) / pageSize),
      summary: {
        states: Object.fromEntries(states),
        last24Hours: { failures: recentFailures.count ?? 0, completed: recentCompleted.count ?? 0, redeemed: recentRedeemed.count ?? 0 },
        rateLimits: { state: 'not_exposed', reason: 'rate-limit keys are private and no aggregate audit table exists' },
        autoActivation: { state: 'not_persisted', reason: 'activation source is not recorded on pairing sessions' },
      },
      sessions: (rows.data ?? []).map((row) => ({
        id: row.id, state: row.state, createdAt: row.created_at, expiresAt: row.expires_at,
        claimedAt: row.claimed_at, completedAt: row.completed_at,
        deviceReference: row.provider_record_id ? 'provider-linked' : 'device-session',
        providerName: row.provider_record_id ? providerNames.get(String(row.provider_record_id)) ?? 'Unknown provider' : null,
        failureCategory: row.failure_category ?? null,
        validationAttempts: Number(row.validation_attempts ?? 0),
      })),
    });
  } catch (error) {
    const category = error instanceof Error && error.message === 'admin_unauthorized' ? error.message : 'admin_request_failed';
    return adminJsonResponse(request, { errorCategory: category }, category === 'admin_unauthorized' ? 401 : 500);
  }
});
