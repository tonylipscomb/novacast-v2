import { authenticateDevice } from '../_shared/device.ts';
import { AnalyticsValidationError } from '../_shared/analytics.ts';
import { jsonResponse, optionsResponse } from '../_shared/http.ts';
import { getAdminClient } from '../_shared/supabase.ts';
import {
  buildRecommendationCandidates,
  MAX_CANDIDATE_BODY_BYTES,
  CANDIDATE_RATE_LIMIT_PER_HOUR,
  MAX_AFFINITY_ROWS_PER_SEED,
  MAX_TREND_ROWS,
  validateCandidateRequest,
  type AffinityRow,
  type TrendRow,
} from '../_shared/novapulseCandidates.ts';

function errorResponse(category: string, status = category === 'rate_limited' ? 429 : ['temporary_database_error', 'server_configuration_error'].includes(category) ? 503 : 400) {
  return jsonResponse({ ok: false, errorCategory: category, candidates: [], retryable: status >= 500 || status === 429 }, status);
}

async function readAffinity(client: ReturnType<typeof getAdminClient>, seedRef: string, providerRef?: string) {
  const read = async (scope: 'global' | 'provider', scopeRef: string) => {
    const { data, error } = await client.rpc('get_novapulse_affinity', {
      p_source_fingerprint_ref: seedRef,
      p_scope: scope,
      p_scope_ref: scopeRef,
      p_limit: MAX_AFFINITY_ROWS_PER_SEED,
      p_min_unique_viewers: 2,
      p_min_co_watch_count: 2,
    });
    if (error) throw new Error('candidate_affinity_read_failed');
    return (data ?? []) as AffinityRow[];
  };
  if (providerRef) {
    const providerRows = await read('provider', providerRef);
    if (providerRows.length) return { rows: providerRows, providerScoped: true };
  }
  return { rows: await read('global', ''), providerScoped: false };
}

async function readTrends(client: ReturnType<typeof getAdminClient>, providerRef: string | undefined, supportedContentTypes: readonly string[]) {
  const read = async (scope: 'global' | 'provider', scopeRef: string) => {
    const { data, error } = await client.rpc('get_novapulse_top_trends', {
      p_scope: scope,
      p_scope_ref: scopeRef,
      p_window_key: '24h',
      p_limit: MAX_TREND_ROWS,
      p_min_unique_viewers: 3,
    });
    if (error) throw new Error('candidate_trend_read_failed');
    return ((data ?? []) as TrendRow[]).filter((row) => supportedContentTypes.includes(row.content_type));
  };
  if (providerRef) {
    const providerRows = await read('provider', providerRef);
    if (providerRows.length) return { rows: providerRows, providerScoped: true };
  }
  return { rows: await read('global', ''), providerScoped: false };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return optionsResponse();
  if (request.method !== 'POST') return errorResponse('method_not_allowed');

  try {
    const startedAt = Date.now();
    const client = getAdminClient();
    const device = await authenticateDevice(request, client);
    const rateLimit = await client.rpc('consume_analytics_rate_limit', {
      p_device_id: device.id,
      p_event_count: 1,
      p_limit: CANDIDATE_RATE_LIMIT_PER_HOUR,
      p_window_seconds: 3600,
    });
    if (rateLimit.error) return errorResponse('temporary_database_error');
    if (!rateLimit.data) return errorResponse('rate_limited');

    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_CANDIDATE_BODY_BYTES) return errorResponse('body_size_limit');
    let requestInput: unknown;
    try {
      requestInput = JSON.parse(rawBody);
    } catch {
      return errorResponse('invalid_json');
    }
    const input = await validateCandidateRequest(requestInput);
    const affinityRows: Array<{ seedIndex: number; row: AffinityRow }> = [];
    let affinityRowsConsidered = 0;
    let providerScopedUsed = false;
    for (const seed of input.seeds) {
      const affinity = await readAffinity(client, seed.fingerprintRef, input.providerRef);
      providerScopedUsed ||= affinity.providerScoped;
      affinityRowsConsidered += affinity.rows.length;
      affinity.rows.forEach((row) => affinityRows.push({ seedIndex: seed.index, row }));
    }
    const trends = await readTrends(client, input.providerRef, input.supportedContentTypes);
    providerScopedUsed ||= trends.providerScoped;
    const candidates = buildRecommendationCandidates({ request: input, affinityRows, trendRows: trends.rows });
    const durationMs = Date.now() - startedAt;
    console.info('[NOVAPULSE_RECS_CANDIDATES]', JSON.stringify({
      seedCount: input.seeds.length,
      affinityRowsConsidered,
      trendRowsConsidered: trends.rows.length,
      dedupedCandidates: candidates.length,
      returnedCandidates: candidates.length,
      providerScopedUsed,
      coldStart: input.seeds.length === 0,
      durationMs,
    }));
    return jsonResponse({ ok: true, candidates, meta: { seedCount: input.seeds.length, providerScopedUsed, coldStart: input.seeds.length === 0 } });
  } catch (error) {
    if (error instanceof AnalyticsValidationError) return errorResponse(error.category);
    if (error instanceof Error && error.message === 'invalid_device') return errorResponse('invalid_device', 401);
    return errorResponse('temporary_database_error');
  }
});
