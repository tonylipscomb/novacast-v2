import type { NovaPulseItem, NovaPulseSportsData } from './novaPulseTypes';

export type NovaPulseSportsRow = {
  source: string; source_event_id: string; sport?: string | null; league_name?: string | null; event_name: string;
  event_stage?: string | null; status: 'scheduled' | 'starting_soon' | 'live' | 'final' | 'postponed' | 'cancelled';
  status_detail?: string | null; competitor_a?: string | null; competitor_b?: string | null; home_name?: string | null; away_name?: string | null;
  home_team_id?: string | null; away_team_id?: string | null; home_team_logo_url?: string | null; away_team_logo_url?: string | null;
  home_score?: string | null; away_score?: string | null; winner_name?: string | null; winner_id?: string | null; loser_name?: string | null;
  result_method?: string | null; decision_type?: string | null; result_round?: string | null; result_time?: string | null; period?: string | null; clock?: string | null;
  went_overtime?: boolean; shootout?: boolean; is_draw?: boolean; is_no_contest?: boolean; starts_at?: string | null; completed_at?: string | null;
  network?: string | null; venue?: string | null; event_artwork_url?: string | null; updated_at?: string | null;
};

type SportsFeedResponse = { ok: true; events: NovaPulseSportsRow[]; freshness?: { stale?: boolean } } | { ok: false };

const CACHE_TTL_MS = 10 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 5_000;
let cache: { items: readonly NovaPulseItem[]; expiresAt: number } | null = null;

export const NOVA_PULSE_SPORTS_ENABLED = process.env.EXPO_PUBLIC_NOVAPULSE_SPORTS_ENABLED === 'true';

function clientConfig() {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim().replace(/\/+$/, '') ||
    process.env.EXPO_PUBLIC_NOVACAST_PAIRING_API_URL?.trim().replace(/\/functions\/v1$/i, '').replace(/\/+$/, '');
  const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim();
  return url && key ? { url, key } : null;
}

function priorityFor(row: NovaPulseSportsRow) {
  if (row.status === 'live') return 100;
  if (row.status === 'starting_soon') return 90;
  const start = row.starts_at ? Date.parse(row.starts_at) : Number.NaN;
  const today = Number.isFinite(start) && new Date(start).toDateString() === new Date().toDateString();
  return row.status === 'final' ? 60 : today ? 80 : 70;
}

export function mapNovaPulseSportsRow(row: NovaPulseSportsRow): NovaPulseItem | null {
  if ((row.status === 'scheduled' || row.status === 'starting_soon') && (!row.starts_at || !Number.isFinite(Date.parse(row.starts_at)))) return null;
  if (row.status === 'postponed' || row.status === 'cancelled') return null;
  const isFinal = row.status === 'final';
  const isLive = row.status === 'live';
  const isFight = /box|mma|ufc|fight|wrestl/i.test(row.sport ?? '');
  const first = isFight ? row.competitor_a : row.away_name;
  const second = isFight ? row.competitor_b : row.home_name;
  const sports: NovaPulseSportsData = {
    format: isFight ? 'fight' : 'team', sport: row.sport ?? undefined, league: row.league_name ?? undefined, eventStage: row.event_stage ?? undefined,
    eventStatus: isLive ? 'LIVE' : isFinal ? 'FINAL' : undefined, eventTitle: row.event_name,
    competitorA: row.competitor_a ?? undefined, competitorB: row.competitor_b ?? undefined, awayName: row.away_name ?? undefined, homeName: row.home_name ?? undefined,
    awayScore: row.away_score ?? undefined, homeScore: row.home_score ?? undefined, awayTeamLogoUrl: row.away_team_logo_url ?? undefined, homeTeamLogoUrl: row.home_team_logo_url ?? undefined,
    statusText: row.status_detail ?? undefined, clockText: row.clock ?? undefined, network: row.network ?? undefined, venue: row.venue ?? undefined,
    resultStatus: isFinal && row.is_no_contest ? 'NO_CONTEST' : isFinal && row.is_draw ? 'DRAW' : isFinal ? 'FINAL' : undefined,
    finalScoreA: isFinal ? row.away_score ?? undefined : undefined, finalScoreB: isFinal ? row.home_score ?? undefined : undefined,
    winnerName: isFinal ? row.winner_name ?? undefined : undefined, winnerId: isFinal ? row.winner_id ?? undefined : undefined,
    loserName: isFinal ? row.loser_name ?? undefined : undefined, resultMethod: isFinal ? row.result_method ?? undefined : undefined,
    decisionType: isFinal ? row.decision_type ?? undefined : undefined, resultRound: isFinal ? row.result_round ?? undefined : undefined,
    resultTime: isFinal ? row.result_time ?? undefined : undefined, periodDetail: isLive ? row.period ?? row.status_detail ?? undefined : undefined,
    wentOvertime: isFinal ? row.went_overtime : undefined, shootout: isFinal ? row.shootout : undefined, isDraw: isFinal ? row.is_draw : false,
    isNoContest: isFinal ? row.is_no_contest : false, completedAt: isFinal ? row.completed_at ?? undefined : undefined,
  };
  return {
    id: `sports-${row.source}-${row.source_event_id}`, type: 'sports', subtype: isFinal ? 'final' : isLive ? 'live' : 'upcoming',
    title: first && second ? `${first} vs ${second}` : row.event_name, subtitle: [row.sport, row.league_name].filter(Boolean).join(' • ') || undefined,
    startsAt: row.starts_at ?? undefined, expiresAt: row.completed_at ? new Date(Date.parse(row.completed_at) + 18 * 60 * 60_000).toISOString() : undefined,
    priority: priorityFor(row), artworkUrl: row.event_artwork_url ?? undefined, sports, sourceId: `sports-${row.source}`, sourceItemId: row.source_event_id,
    dedupeKey: `sports:${row.source}:${row.source_event_id}`, updatedAt: row.updated_at ? Date.parse(row.updated_at) || undefined : undefined, action: { type: 'none' },
  };
}

async function requestFeed() {
  const config = clientConfig();
  if (!config) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${config.url}/functions/v1/novapulse-sports-feed`, {
      headers: { apikey: config.key, Authorization: `Bearer ${config.key}` }, signal: controller.signal,
    });
    const payload = await response.json().catch(() => null) as SportsFeedResponse | null;
    if (!response.ok || !payload || payload.ok !== true || payload.freshness?.stale) return null;
    return payload.events.map(mapNovaPulseSportsRow).filter((item): item is NovaPulseItem => Boolean(item));
  } finally { clearTimeout(timeout); }
}

export async function fetchNovaPulseSportsItems() {
  if (!NOVA_PULSE_SPORTS_ENABLED) return null;
  if (cache && cache.expiresAt > Date.now()) return cache.items;
  try {
    const items = await requestFeed();
    if (items?.length) {
      cache = { items, expiresAt: Date.now() + CACHE_TTL_MS };
      return items;
    }
  } catch { /* Preserve the last valid cache and let Home continue. */ }
  return cache?.items ?? null;
}

export function clearNovaPulseSportsCache() {
  cache = null;
}

export const NOVA_PULSE_SPORTS_CACHE_TTL_MS = CACHE_TTL_MS;
