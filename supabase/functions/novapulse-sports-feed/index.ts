import { getAdminClient } from '../_shared/supabase.ts';
import { jsonResponse, optionsResponse } from '../_shared/http.ts';

const MAX_UPCOMING = 6;
const MAX_FINAL = 2;
const STALE_AFTER_MS = 3 * 86_400_000;

function hasPublicApiKey(request: Request) {
  return Boolean(request.headers.get('apikey')?.trim() || request.headers.get('authorization')?.trim());
}

const PUBLIC_COLUMNS = [
  'source', 'source_event_id', 'sport', 'league_id', 'league_name', 'event_name', 'event_stage', 'status', 'status_detail',
  'competitor_a', 'competitor_b', 'home_team_id', 'home_name', 'home_team_logo_url', 'away_team_id', 'away_name',
  'away_team_logo_url', 'home_score', 'away_score', 'winner_name', 'winner_id', 'loser_name', 'result_method',
  'decision_type', 'result_round', 'result_time', 'period', 'clock', 'went_overtime', 'shootout', 'is_draw',
  'is_no_contest', 'starts_at', 'completed_at', 'network', 'venue', 'event_artwork_url', 'source_updated_at',
  'expires_at', 'updated_at',
].join(',');

async function readFeed() {
  const client = getAdminClient();
  const now = new Date();
  const nowIso = now.toISOString();
  const upcomingFrom = new Date(now.getTime() - 12 * 60 * 60_000).toISOString();
  const [upcoming, finals] = await Promise.all([
    client.from('novapulse_sports_events').select(PUBLIC_COLUMNS).not('league_id', 'is', null).in('status', ['scheduled', 'starting_soon', 'live']).gte('starts_at', upcomingFrom).lte('starts_at', new Date(now.getTime() + 7 * 86_400_000).toISOString()).gt('expires_at', nowIso).order('starts_at', { ascending: true }).order('source_event_id', { ascending: true }).limit(MAX_UPCOMING),
    client.from('novapulse_sports_events').select(PUBLIC_COLUMNS).not('league_id', 'is', null).eq('status', 'final').gt('expires_at', nowIso).order('completed_at', { ascending: false }).order('source_event_id', { ascending: true }).limit(MAX_FINAL),
  ]);
  if (upcoming.error || finals.error) throw new Error('sports_feed_query_failed');
  const rows = [...((upcoming.data ?? []) as unknown as Array<Record<string, unknown>>), ...((finals.data ?? []) as unknown as Array<Record<string, unknown>>)];
  const stale = rows.length === 0 || rows.some((row) => {
    const fetchedAt = Date.parse(String(row.updated_at ?? row.source_updated_at ?? ''));
    return !Number.isFinite(fetchedAt) || fetchedAt < now.getTime() - STALE_AFTER_MS;
  });
  return {
    ok: true,
    events: rows,
    freshness: { fetchedAt: rows.reduce((latest, row) => Math.max(latest, Date.parse(String(row.updated_at ?? '')) || 0), 0) || null, stale },
    limits: { maxUpcoming: MAX_UPCOMING, maxFinal: MAX_FINAL, maxTotal: MAX_UPCOMING + MAX_FINAL },
  };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return optionsResponse();
  if (request.method !== 'GET' && request.method !== 'POST') return jsonResponse({ ok: false, error: 'method_not_allowed' }, 405);
  if (!hasPublicApiKey(request)) return jsonResponse({ ok: false, error: 'unauthorized' }, 401);
  try {
    return jsonResponse(await readFeed());
  } catch {
    return jsonResponse({ ok: false, error: 'sports_feed_unavailable', events: [], freshness: { fetchedAt: null, stale: true } }, 503);
  }
});
