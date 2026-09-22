export type NovaPulseSportsStatus = 'scheduled' | 'starting_soon' | 'live' | 'final' | 'postponed' | 'cancelled';

export type NormalizedSportsEvent = {
  source: string;
  source_event_id: string;
  sport: string | null;
  league_id: string | null;
  league_name: string | null;
  event_name: string;
  event_stage: string | null;
  status: NovaPulseSportsStatus;
  status_detail: string | null;
  competitor_a: string | null;
  competitor_b: string | null;
  home_team_id: string | null;
  home_name: string | null;
  home_team_logo_url: string | null;
  away_team_id: string | null;
  away_name: string | null;
  away_team_logo_url: string | null;
  home_score: string | null;
  away_score: string | null;
  winner_name: string | null;
  winner_id: string | null;
  loser_name: string | null;
  result_method: string | null;
  decision_type: string | null;
  result_round: string | null;
  result_time: string | null;
  period: string | null;
  clock: string | null;
  went_overtime: boolean;
  shootout: boolean;
  is_draw: boolean;
  is_no_contest: boolean;
  starts_at: string | null;
  completed_at: string | null;
  network: string | null;
  venue: string | null;
  event_artwork_url: string | null;
  source_updated_at: string | null;
  expires_at: string | null;
  metadata: Record<string, unknown>;
};

export const NOVA_PULSE_SUPPORTED_LEAGUES = [
  { id: '4391', name: 'NFL', sport: 'American Football' },
  { id: '4479', name: 'NCAA Division 1 Football', sport: 'American Football' },
  { id: '4387', name: 'NBA', sport: 'Basketball' },
  { id: '4607', name: "NCAA Men's Basketball", sport: 'Basketball' },
  { id: '4424', name: 'MLB', sport: 'Baseball' },
  { id: '4380', name: 'NHL', sport: 'Ice Hockey' },
] as const;

type TheSportsDbEvent = Record<string, unknown>;
type EnvLike = Pick<Deno.Env, 'get'>;

function text(value: unknown) {
  const result = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
  return result || null;
}

function numericScore(value: string | null) {
  if (!value || !/^\d+(?:\.\d+)?$/.test(value)) return null;
  return value;
}

function parseDate(event: TheSportsDbEvent) {
  const timestamp = text(event.strTimestamp);
  if (timestamp && Number.isFinite(Date.parse(timestamp))) return new Date(timestamp).toISOString();
  const date = text(event.dateEvent);
  const time = text(event.strTime)?.replace(/Z$/i, '') || '00:00:00';
  if (date && Number.isFinite(Date.parse(`${date}T${time}Z`))) return new Date(`${date}T${time}Z`).toISOString();
  return null;
}

function isFight(sport: string | null) {
  return /box|mma|ufc|fight|wrestl/i.test(sport ?? '');
}

function statusText(event: TheSportsDbEvent) {
  return [event.strStatus, event.status, event.strProgress]
    .map(text)
    .filter((value): value is string => Boolean(value))
    .join(' ')
    .toLowerCase();
}

export function resolveTheSportsDbStatus(event: TheSportsDbEvent, startsAt: string | null, now = new Date()): NovaPulseSportsStatus {
  const explicit = statusText(event);
  if (/cancel|abandon/.test(explicit)) return 'cancelled';
  if (/postpon|suspend/.test(explicit)) return 'postponed';
  // TheSportsDB uses compact result labels such as AOT (after overtime).
  // Preserve the original status_detail separately, but classify verified
  // completed/extra-period labels as final before considering live markers.
  if (/\baot\b|\bfinal(?:\s*\/\s*\d+)?\b|\bfinished?\b|\bcompleted\b|\bended\b|\bft\b|after extra time|after overtime|after extra innings|after penalties/.test(explicit)) return 'final';
  if (/\b(?:not live|not in progress|not started)\b/.test(explicit)) return 'scheduled';
  const explicitInProgress = /\blive\b|\bin progress\b|\bplaying\b|\bactive\b|\bhalftime\b|\bhalf time\b|\bcurrently underway\b/.test(explicit);
  const explicitExtraInning = /\b(?:extra innings?|\d+(?:st|nd|rd|th)?\s+inning)\b/.test(explicit);
  if (explicitInProgress || (explicitExtraInning && !/scheduled|not started|upcoming|tbd|pending/.test(explicit))) return 'live';
  const start = startsAt ? Date.parse(startsAt) : Number.NaN;
  if (Number.isFinite(start) && start >= now.getTime() && start <= now.getTime() + 60 * 60_000) return 'starting_soon';
  return 'scheduled';
}

function explicitCompletionTime(event: TheSportsDbEvent) {
  const value = text(event.strCompletedAt) ?? text(event.completedAt) ?? text(event.strCompletionTimestamp);
  return value && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
}

function expiryFor(status: NovaPulseSportsStatus, startsAt: string | null, completedAt: string | null) {
  const base = status === 'final' ? completedAt ?? startsAt : startsAt;
  if (!base) return null;
  const hours = status === 'final' ? 18 : 8 * 24;
  return new Date(Date.parse(base) + hours * 60 * 60_000).toISOString();
}

export function normalizeTheSportsDbEvent(event: TheSportsDbEvent, now = new Date(), leagueId?: string): NormalizedSportsEvent | null {
  const sourceEventId = text(event.idEvent);
  const eventName = text(event.strEvent) ?? text(event.strEventAlternate);
  if (!sourceEventId || !eventName) return null;
  const sport = text(event.strSport);
  const homeName = text(event.strHomeTeam);
  const awayName = text(event.strAwayTeam);
  const startsAt = parseDate(event);
  const status = resolveTheSportsDbStatus(event, startsAt, now);
  const homeScore = numericScore(text(event.intHomeScore));
  const awayScore = numericScore(text(event.intAwayScore));
  const result = text(event.strResult);
  const combat = isFight(sport);
  const explicitWinner = text(event.strWinner);
  const providerWinner = explicitWinner && (explicitWinner === homeName || explicitWinner === awayName)
    ? explicitWinner
    : result && homeName && result.toLowerCase() === homeName.toLowerCase()
      ? homeName
      : result && awayName && result.toLowerCase() === awayName.toLowerCase()
        ? awayName
        : null;
  const winner = status === 'final' ? providerWinner : null;
  const draw = status === 'final' && homeScore !== null && awayScore !== null && homeScore === awayScore;
  const noContest = status === 'final' && /no contest/i.test(result ?? '');
  const completedAt = status === 'final' ? (explicitCompletionTime(event) ?? startsAt) : null;
  const league = NOVA_PULSE_SUPPORTED_LEAGUES.find((candidate) => candidate.id === leagueId);
  return {
    source: 'thesportsdb', source_event_id: sourceEventId, sport, league_id: leagueId ?? null, league_name: text(event.strLeague) ?? league?.name ?? null,
    event_name: eventName, event_stage: text(event.strRound) ?? text(event.intRound), status,
    status_detail: text(event.strProgress) ?? text(event.strStatus), competitor_a: combat ? homeName : awayName, competitor_b: combat ? awayName : homeName,
    home_team_id: text(event.idHomeTeam), home_name: homeName, home_team_logo_url: text(event.strHomeTeamBadge) ?? text(event.strHomeTeamLogo),
    away_team_id: text(event.idAwayTeam), away_name: awayName, away_team_logo_url: text(event.strAwayTeamBadge) ?? text(event.strAwayTeamLogo),
    home_score: homeScore, away_score: awayScore, winner_name: winner, winner_id: winner === homeName ? text(event.idHomeTeam) : winner === awayName ? text(event.idAwayTeam) : null,
    loser_name: status === 'final' && !draw && !noContest ? (winner === homeName ? awayName : winner === awayName ? homeName : null) : null,
    result_method: status === 'final' && combat ? text(event.strResultMethod) ?? result : null,
    decision_type: status === 'final' && combat ? text(event.strDecision) : null,
    result_round: status === 'final' && combat ? text(event.intRound) ?? text(event.strRound) : null,
    result_time: status === 'final' && combat ? text(event.strResultTime) ?? text(event.strFightTime) : null,
    period: status === 'live' ? text(event.strPeriod) ?? text(event.strProgress) : null,
    clock: status === 'live' ? text(event.strClock) : null,
    went_overtime: /overtime|extra time/i.test(`${event.strStatus ?? ''} ${event.strProgress ?? ''}`), shootout: /shootout/i.test(`${event.strStatus ?? ''} ${event.strProgress ?? ''}`),
    is_draw: draw, is_no_contest: noContest, starts_at: startsAt, completed_at: completedAt, network: text(event.strTVStation), venue: text(event.strVenue),
    event_artwork_url: text(event.strThumb) ?? text(event.strPoster) ?? text(event.strEventPoster), source_updated_at: null,
    expires_at: expiryFor(status, startsAt, completedAt), metadata: {},
  };
}

function configuredLeagues(env: EnvLike = Deno.env) {
  const raw = env.get('NOVAPULSE_SPORTS_LEAGUE_IDS')?.trim();
  if (!raw) return [...NOVA_PULSE_SUPPORTED_LEAGUES];
  const allowed = new Set(raw.split(',').map((value) => value.trim()).filter((value) => /^\d+$/.test(value)));
  return NOVA_PULSE_SUPPORTED_LEAGUES.filter((league) => allowed.has(league.id));
}

export function configuredLeagueIds(env: EnvLike = Deno.env) {
  return configuredLeagues(env).map((league) => league.id);
}

function withinWindow(event: NormalizedSportsEvent, from: Date, to: Date) {
  if (!event.starts_at) return false;
  const time = Date.parse(event.starts_at);
  return Number.isFinite(time) && time >= from.getTime() && time <= to.getTime();
}

export function createTheSportsDbAdapter(env: EnvLike = Deno.env, fetchImpl: typeof fetch = fetch) {
  const key = env.get('THESPORTSDB_API_KEY')?.trim() ?? '';
  const timeoutMs = Math.min(20_000, Math.max(3_000, Number(env.get('NOVAPULSE_SPORTS_TIMEOUT_MS') ?? 10_000)));
  async function request(path: string) {
    if (!key) return [] as TheSportsDbEvent[];
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`https://www.thesportsdb.com/api/v1/json/${encodeURIComponent(key)}/${path}`, { signal: controller.signal });
      if (!response.ok) throw new Error(`sports_provider_http_${response.status}`);
      const payload = await response.json() as { events?: unknown };
      return Array.isArray(payload.events) ? payload.events.filter((item): item is TheSportsDbEvent => Boolean(item && typeof item === 'object')) : [];
    } finally { clearTimeout(timeout); }
  }
  async function collect(now: Date, from: Date, to: Date, path: (leagueId: string) => string) {
    const output: NormalizedSportsEvent[] = [];
    const failedLeagues: string[] = [];
    for (const league of configuredLeagues(env)) {
      try {
        for (const raw of await request(path(league.id))) {
          const event = normalizeTheSportsDbEvent(raw, now, league.id);
          if (event && withinWindow(event, from, to)) output.push(event);
        }
      } catch { failedLeagues.push(league.id); }
    }
    return { events: output, failedLeagues };
  }
  return {
    configured: Boolean(key),
    async upcoming(now = new Date(), days = 7) { return collect(now, new Date(now.getTime() - 12 * 60 * 60_000), new Date(now.getTime() + days * 86_400_000), (id) => `eventsnextleague.php?id=${id}`); },
    async recent(now = new Date(), hours = 18) { return collect(now, new Date(now.getTime() - hours * 60 * 60_000), now, (id) => `eventspastleague.php?id=${id}`); },
  };
}
