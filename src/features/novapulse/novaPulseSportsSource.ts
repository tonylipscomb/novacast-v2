import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { NovaPulseItem, NovaPulseSportsData } from './novaPulseTypes';

type SportsRow = {
  provider: string; provider_event_id: string; sport?: string | null; league?: string | null; event_title: string;
  event_stage?: string | null; event_status: 'upcoming' | 'live' | 'final' | 'unknown'; competitor_a?: string | null; competitor_b?: string | null;
  home_name?: string | null; away_name?: string | null; home_score?: string | null; away_score?: string | null; winner_name?: string | null;
  winner_id?: string | null; loser_name?: string | null; result_method?: string | null; decision_type?: string | null; result_round?: string | null;
  result_time?: string | null; period_detail?: string | null; went_overtime?: boolean; shootout?: boolean; is_draw?: boolean; is_no_contest?: boolean;
  start_time?: string | null; completed_at?: string | null; network?: string | null; venue?: string | null; artwork_url?: string | null; updated_at?: string | null;
};

function clientFromEnv() {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim().replace(/\/+$/, '') || process.env.EXPO_PUBLIC_NOVACAST_PAIRING_API_URL?.trim().replace(/\/functions\/v1$/i, '').replace(/\/+$/, '');
  const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim();
  return url && key ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }) : null;
}

function mapRow(row: SportsRow): NovaPulseItem {
  const isFinal = row.event_status === 'final';
  const isLive = row.event_status === 'live';
  const isFight = /box|mma|ufc|fight|wrestl/i.test(row.sport ?? '');
  const firstName = isFight ? row.competitor_a : row.away_name;
  const secondName = isFight ? row.competitor_b : row.home_name;
  const normalizedTitle = firstName && secondName ? `${firstName} vs ${secondName}` : row.event_title;
  const sports: NovaPulseSportsData = {
    format: isFight ? 'fight' : 'team', sport: row.sport ?? undefined, league: row.league ?? undefined, eventStage: row.event_stage ?? undefined,
    eventStatus: isLive ? 'LIVE' : isFinal ? 'FINAL' : 'UPCOMING', eventTitle: row.event_title,
    competitorA: row.competitor_a ?? undefined, competitorB: row.competitor_b ?? undefined, awayName: row.away_name ?? undefined, homeName: row.home_name ?? undefined,
    awayScore: row.away_score ?? undefined, homeScore: row.home_score ?? undefined, network: row.network ?? undefined, venue: row.venue ?? undefined,
    resultStatus: isFinal && row.is_no_contest ? 'NO_CONTEST' : isFinal && row.is_draw ? 'DRAW' : isFinal ? 'FINAL' : undefined,
    finalScoreA: isFinal ? row.away_score ?? undefined : undefined, finalScoreB: isFinal ? row.home_score ?? undefined : undefined,
    winnerName: isFinal ? row.winner_name ?? undefined : undefined, winnerId: isFinal ? row.winner_id ?? undefined : undefined,
    loserName: isFinal ? row.loser_name ?? undefined : undefined, resultMethod: isFinal ? row.result_method ?? undefined : undefined,
    decisionType: isFinal ? row.decision_type ?? undefined : undefined, resultRound: isFinal ? row.result_round ?? undefined : undefined,
    resultTime: isFinal ? row.result_time ?? undefined : undefined, periodDetail: isLive ? row.period_detail ?? undefined : undefined,
    wentOvertime: isFinal ? row.went_overtime : undefined, shootout: isFinal ? row.shootout : undefined,
    isDraw: isFinal ? row.is_draw : false, isNoContest: isFinal ? row.is_no_contest : false, completedAt: isFinal ? row.completed_at ?? undefined : undefined,
  };
  return { id: `sports-${row.provider}-${row.provider_event_id}`, type: 'sports', subtype: isFinal ? 'final' : row.event_status === 'live' ? 'live' : 'upcoming', title: normalizedTitle, subtitle: [row.sport, row.league].filter(Boolean).join(' • ') || undefined, startsAt: row.start_time ?? undefined, priority: isFinal ? 58 : 72, artworkUrl: row.artwork_url ?? undefined, sports, sourceId: `sports-${row.provider}`, sourceItemId: row.provider_event_id, dedupeKey: `sports:${row.provider}:${row.provider_event_id}`, updatedAt: row.updated_at ? Date.parse(row.updated_at) || undefined : undefined, action: { type: 'none' } };
}

export async function fetchNovaPulseSportsItems(options: { client?: SupabaseClient; now?: Date; maxUpcoming?: number; maxFinal?: number } = {}) {
  const client = options.client ?? clientFromEnv();
  if (!client) return null;
  const now = options.now ?? new Date();
  const upcomingLimit = Math.min(3, Math.max(1, options.maxUpcoming ?? 3));
  const finalLimit = Math.min(2, Math.max(1, options.maxFinal ?? 2));
  const recent = new Date(now.getTime() - 2 * 86_400_000).toISOString();
  const [upcoming, finals] = await Promise.all([
    client.from('novapulse_sports_events').select('*').in('event_status', ['upcoming', 'live']).gte('start_time', now.toISOString()).lte('start_time', new Date(now.getTime() + 7 * 86_400_000).toISOString()).order('start_time', { ascending: true }).limit(upcomingLimit),
    client.from('novapulse_sports_events').select('*').eq('event_status', 'final').gte('completed_at', recent).order('completed_at', { ascending: false }).limit(finalLimit),
  ]);
  if (upcoming.error || finals.error) return null;
  const rows = [...((upcoming.data ?? []) as SportsRow[]), ...((finals.data ?? []) as SportsRow[])];
  if (!rows.length) return null;
  const stale = rows.some((row) => row.updated_at && Date.parse(row.updated_at) < now.getTime() - 3 * 86_400_000);
  return stale ? null : rows.map(mapRow);
}
