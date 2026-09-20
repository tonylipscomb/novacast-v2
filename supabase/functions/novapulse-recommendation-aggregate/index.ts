import { jsonResponse, optionsResponse, readJson } from '../_shared/http.ts';
import { getAdminClient } from '../_shared/supabase.ts';
import { isNovaPulseSportsRefreshAuthorized } from '../_shared/novapulseSportsAuth.ts';

type AggregateBody = {
  now?: unknown;
  retentionDays?: unknown;
};

function authorized(request: Request) {
  return isNovaPulseSportsRefreshAuthorized({
    suppliedSecret: request.headers.get('x-novapulse-aggregation-secret'),
    configuredSecret: Deno.env.get('NOVAPULSE_RECOMMENDATION_AGGREGATION_SECRET'),
    bearerToken: request.headers.get('authorization')?.replace(/^Bearer\s+/i, ''),
    serviceRoleKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
  });
}

function aggregateNow(value: unknown) {
  if (value == null) return new Date().toISOString();
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw new Error('invalid_now');
  return new Date(value).toISOString();
}

function retentionDays(value: unknown) {
  if (value == null) return 90;
  if (!Number.isInteger(value) || Number(value) < 7 || Number(value) > 365) throw new Error('invalid_retention_days');
  return Number(value);
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return optionsResponse();
  if (request.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405);
  if (!authorized(request)) return jsonResponse({ error: 'unauthorized' }, 401);

  try {
    const body = (await readJson(request).catch(() => ({}))) as AggregateBody;
    const now = aggregateNow(body?.now);
    const retention = retentionDays(body?.retentionDays);
    const startedAt = Date.now();
    const { data, error } = await getAdminClient().rpc('rebuild_novapulse_recommendation_aggregates', {
      p_now: now,
      p_retention_days: retention,
    });
    if (error) throw new Error('aggregation_failed');
    const summary = data && typeof data === 'object' ? data as Record<string, unknown> : {};
    console.info('[NOVAPULSE_RECS_AGG]', JSON.stringify({
      eventRowsRead: Number(summary.eventRowsRead ?? 0),
      trendRowsWritten: Number(summary.trendRowsWritten ?? 0),
      affinityRowsWritten: Number(summary.affinityRowsWritten ?? 0),
      suppressedTrendRows: Number(summary.suppressedTrendRows ?? 0),
      suppressedAffinityRows: Number(summary.suppressedAffinityRows ?? 0),
      window: String(summary.window ?? '24h+7d'),
      durationMs: Date.now() - startedAt,
    }));
    return jsonResponse({ ok: true, summary });
  } catch (error) {
    const category = error instanceof Error && ['invalid_now', 'invalid_retention_days'].includes(error.message)
      ? error.message
      : 'aggregation_failed';
    return jsonResponse({ ok: false, error: category }, category.startsWith('invalid_') ? 400 : 502);
  }
});
