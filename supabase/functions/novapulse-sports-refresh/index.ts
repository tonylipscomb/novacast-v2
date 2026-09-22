import { getAdminClient } from '../_shared/supabase.ts';
import { jsonResponse, optionsResponse } from '../_shared/http.ts';
import { configuredLeagueIds, createTheSportsDbAdapter, type NormalizedSportsEvent } from '../_shared/novapulseSports.ts';
import { isNovaPulseSportsRefreshAuthorized } from '../_shared/novapulseSportsAuth.ts';

const UPCOMING_DAYS = 7;
const RECENT_HOURS = 18;

function authorized(request: Request) {
  return isNovaPulseSportsRefreshAuthorized({
    suppliedSecret: request.headers.get('x-novapulse-refresh-secret'),
    configuredSecret: Deno.env.get('NOVAPULSE_SPORTS_REFRESH_SECRET'),
    bearerToken: request.headers.get('authorization')?.replace(/^Bearer\s+/i, ''),
    serviceRoleKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
  });
}

function row(event: NormalizedSportsEvent) {
  return { ...event, updated_at: new Date().toISOString(), source_updated_at: new Date().toISOString() };
}

async function refresh() {
  const adapter = createTheSportsDbAdapter();
  if (!adapter.configured) {
    return { ok: false, reason: 'source_unconfigured', provider: 'thesportsdb', configuredLeagueCount: configuredLeagueIds().length };
  }
  const client = getAdminClient();
  const now = new Date();
  const upcoming = await adapter.upcoming(now, UPCOMING_DAYS);
  const recent = await adapter.recent(now, RECENT_HOURS);
  const events = Array.from(new Map([...upcoming.events, ...recent.events].map((event) => [`${event.source}:${event.source_event_id}`, event])).values()).map(row);
  const keys = events.map((event) => event.source_event_id);
  const { data: existing, error: existingError } = keys.length
    ? await client.from('novapulse_sports_events').select('source_event_id').eq('source', 'thesportsdb').in('source_event_id', keys)
    : { data: [], error: null };
  if (existingError) throw new Error('sports_existing_lookup_failed');
  const existingIds = new Set((existing ?? []).map((event) => String(event.source_event_id)));
  const { error } = events.length ? await client.from('novapulse_sports_events').upsert(events, { onConflict: 'source,source_event_id' }) : { error: null };
  if (error) throw new Error('sports_upsert_failed');
  const { count: expiredCount, error: expireError } = await client.from('novapulse_sports_events').delete({ count: 'exact' }).lt('expires_at', now.toISOString());
  if (expireError) throw new Error('sports_expire_failed');
  return {
    ok: true, provider: 'thesportsdb', configuredLeagueCount: configuredLeagueIds().length,
    eventsSeen: events.length, eventsUpserted: events.length,
    inserted: events.filter((event) => !existingIds.has(event.source_event_id)).length,
    updated: events.filter((event) => existingIds.has(event.source_event_id)).length,
    failedLeagues: [...new Set([...upcoming.failedLeagues, ...recent.failedLeagues])], expiredCount: expiredCount ?? 0,
    upcomingDays: UPCOMING_DAYS, recentHours: RECENT_HOURS,
  };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return optionsResponse();
  if (request.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405);
  if (!authorized(request)) return jsonResponse({ error: 'unauthorized' }, 401);
  try {
    return jsonResponse(await refresh());
  } catch (error) {
    return jsonResponse({ ok: false, error: error instanceof Error ? error.message : 'sports_refresh_failed' }, 502);
  }
});
