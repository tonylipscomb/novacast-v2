import { getAdminClient } from '../_shared/supabase.ts';
import { jsonResponse, optionsResponse } from '../_shared/http.ts';
import { configuredLeagueIds, createTheSportsDbAdapter, type NormalizedSportsEvent } from '../_shared/novapulseSports.ts';
import { isNovaPulseSportsRefreshAuthorized } from '../_shared/novapulseSportsAuth.ts';

const UPCOMING_DAYS = 7;
const RECENT_DAYS = 2;

function authorized(request: Request) {
  return isNovaPulseSportsRefreshAuthorized({
    suppliedSecret: request.headers.get('x-novapulse-refresh-secret'),
    configuredSecret: Deno.env.get('NOVAPULSE_SPORTS_REFRESH_SECRET'),
    bearerToken: request.headers.get('authorization')?.replace(/^Bearer\s+/i, ''),
    serviceRoleKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
  });
}

function row(event: NormalizedSportsEvent) {
  return { ...event, updated_at: new Date().toISOString() };
}

async function refresh() {
  const client = getAdminClient();
  const adapter = createTheSportsDbAdapter();
  const now = new Date();
  const [upcoming, recent] = await Promise.all([adapter.upcoming(now, UPCOMING_DAYS), adapter.recent(now, RECENT_DAYS)]);
  const events = Array.from(new Map([...upcoming, ...recent].map((event) => [`${event.provider}:${event.provider_event_id}`, event])).values()).map(row);
  if (!events.length) return { provider: 'thesportsdb', configuredLeagueCount: configuredLeagueIds().length, eventsSeen: 0, eventsUpserted: 0, inserted: 0, updated: 0, upcomingDays: UPCOMING_DAYS, recentDays: RECENT_DAYS };
  const keys = events.map((event) => event.provider_event_id);
  const { data: existing, error: existingError } = await client.from('novapulse_sports_events').select('provider_event_id').eq('provider', 'thesportsdb').in('provider_event_id', keys);
  if (existingError) throw new Error('sports_existing_lookup_failed');
  const existingIds = new Set((existing ?? []).map((event) => String(event.provider_event_id)));
  const { error } = await client.from('novapulse_sports_events').upsert(events, { onConflict: 'provider,provider_event_id' });
  if (error) throw new Error('sports_upsert_failed');
  return { provider: 'thesportsdb', configuredLeagueCount: configuredLeagueIds().length, eventsSeen: events.length, eventsUpserted: events.length, inserted: events.filter((event) => !existingIds.has(event.provider_event_id)).length, updated: events.filter((event) => existingIds.has(event.provider_event_id)).length, upcomingDays: UPCOMING_DAYS, recentDays: RECENT_DAYS };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return optionsResponse();
  if (request.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405);
  if (!authorized(request)) return jsonResponse({ error: 'unauthorized' }, 401);
  try {
    return jsonResponse({ ok: true, summary: await refresh() });
  } catch (error) {
    return jsonResponse({ ok: false, error: error instanceof Error ? error.message : 'sports_refresh_failed' }, 502);
  }
});
