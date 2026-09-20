export type NormalizedSportsEvent = {
  provider: string;
  provider_event_id: string;
  sport: string | null;
  league: string | null;
  event_title: string;
  event_stage: string | null;
  event_status: 'upcoming' | 'live' | 'final' | 'unknown';
  competitor_a: string | null;
  competitor_b: string | null;
  home_name: string | null;
  away_name: string | null;
  home_score: string | null;
  away_score: string | null;
  winner_name: string | null;
  winner_id: string | null;
  loser_name: string | null;
  result_method: string | null;
  decision_type: string | null;
  result_round: string | null;
  result_time: string | null;
  period_detail: string | null;
  went_overtime: boolean;
  shootout: boolean;
  is_draw: boolean;
  is_no_contest: boolean;
  start_time: string | null;
  completed_at: string | null;
  network: string | null;
  venue: string | null;
  artwork_url: string | null;
  raw_updated_at: string | null;
};

type TheSportsDbEvent = Record<string, unknown>;

function text(value: unknown) {
  const result = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
  return result || null;
}

function parseDate(event: TheSportsDbEvent) {
  const timestamp = text(event.strTimestamp);
  if (timestamp && Number.isFinite(Date.parse(timestamp))) return new Date(timestamp).toISOString();
  const date = text(event.dateEvent);
  const time = text(event.strTime)?.replace('Z', '') || '00:00:00';
  if (date && Number.isFinite(Date.parse(`${date}T${time}Z`))) return new Date(`${date}T${time}Z`).toISOString();
  return null;
}

function isFight(sport: string | null) {
  return /box|mma|ufc|fight|wrestl/i.test(sport ?? '');
}

function isTeamSport(sport: string | null) {
  return !isFight(sport);
}

function completionBufferHours(sport: string | null) {
  const value = sport ?? '';
  if (/baseball/i.test(value)) return 5;
  if (/soccer|football|basketball|hockey/i.test(value)) return 4;
  return 4;
}

function stateText(event: TheSportsDbEvent) {
  return [event.strStatus, event.status, event.strProgress]
    .map(text)
    .filter((value): value is string => Boolean(value))
    .join(' ')
    .toLowerCase();
}

export function resolveTheSportsDbStatus(event: TheSportsDbEvent, startTime: string | null, sport: string | null, now = new Date()): NormalizedSportsEvent['event_status'] {
  const explicit = stateText(event);
  if (/postpon|cancel|suspend|abandon/.test(explicit)) return 'unknown';
  if (/live|in progress|playing|active|halftime|half time|currently underway/.test(explicit)) return 'live';
  if (/finish|final|completed|ended|\bft\b|after extra time|after penalties/.test(explicit)) return 'final';
  if (/scheduled|not started|upcoming|tbd|pending/.test(explicit)) return 'upcoming';

  // Free-tier responses can omit lifecycle text. Only team events with two
  // numeric scores and a conservative post-start buffer may use this fallback.
  const homeScore = numericScore(text(event.intHomeScore));
  const awayScore = numericScore(text(event.intAwayScore));
  const startedAt = startTime ? Date.parse(startTime) : Number.NaN;
  const elapsedHours = Number.isFinite(startedAt) ? (now.getTime() - startedAt) / 3_600_000 : 0;
  if (isTeamSport(sport) && homeScore !== null && awayScore !== null && elapsedHours >= completionBufferHours(sport)) return 'final';
  return 'upcoming';
}

function numericScore(value: string | null) {
  if (value === null || value.trim() === '') return null;
  const score = Number(value);
  return Number.isFinite(score) ? score : null;
}

function explicitCompletionTime(event: TheSportsDbEvent) {
  const value = text(event.strCompletedAt) ?? text(event.completedAt) ?? text(event.strCompletionTimestamp);
  return value && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
}

export function normalizeTheSportsDbEvent(event: TheSportsDbEvent, now = new Date()): NormalizedSportsEvent | null {
  const providerEventId = text(event.idEvent);
  const title = text(event.strEvent) ?? text(event.strEventAlternate);
  if (!providerEventId || !title) return null;
  const sport = text(event.strSport);
  const home = text(event.strHomeTeam);
  const away = text(event.strAwayTeam);
  const startTime = parseDate(event);
  const status = resolveTheSportsDbStatus(event, startTime, sport, now);
  const homeScore = text(event.intHomeScore);
  const awayScore = text(event.intAwayScore);
  const result = text(event.strResult);
  const combat = isFight(sport);
  const homeNumeric = numericScore(homeScore);
  const awayNumeric = numericScore(awayScore);
  const explicitWinner = text(event.strWinner);
  const providerWinner = explicitWinner && (explicitWinner === home || explicitWinner === away)
    ? explicitWinner
    : result && home && result.toLowerCase() === home.toLowerCase()
      ? home
      : result && away && result.toLowerCase() === away.toLowerCase()
        ? away
        : null;
  const derivedWinner = status === 'final' && homeNumeric !== null && awayNumeric !== null && homeNumeric !== awayNumeric
    ? homeNumeric > awayNumeric ? home : away
    : null;
  const winner = status === 'final' ? (providerWinner ?? derivedWinner) : null;
  const draw = status === 'final' && ((homeNumeric !== null && awayNumeric !== null && homeNumeric === awayNumeric) || /\bdraw\b/i.test(result ?? ''));
  const noContest = status === 'final' && /no contest/i.test(result ?? '');
  // TheSportsDB does not currently provide a reliable completion timestamp for these rows.
  // completed_at therefore uses the event timestamp as a stable ordering fallback, not as a precise finish time.
  const completedAt = status === 'final' ? (explicitCompletionTime(event) ?? startTime) : null;
  return {
    provider: 'thesportsdb', provider_event_id: providerEventId, sport, league: text(event.strLeague), event_title: title,
    event_stage: text(event.strRound) ?? text(event.intRound), event_status: status,
    competitor_a: isFight(sport) ? home : away, competitor_b: isFight(sport) ? away : home,
    home_name: home, away_name: away, home_score: homeScore, away_score: awayScore,
    winner_name: winner, winner_id: winner === home ? text(event.idHomeTeam) : winner === away ? text(event.idAwayTeam) : null,
    loser_name: status === 'final' && !draw && !noContest ? (winner === home ? away : winner === away ? home : null) : null,
    result_method: status === 'final' && combat ? (text(event.strResultMethod) ?? result) : null,
    decision_type: status === 'final' && combat ? text(event.strDecision) : null,
    result_round: status === 'final' && combat ? (text(event.intRound) ?? text(event.strRound)) : null,
    result_time: status === 'final' && combat ? (text(event.strResultTime) ?? text(event.strFightTime)) : null,
    period_detail: text(event.strProgress), went_overtime: /overtime|extra time/i.test(`${event.strStatus ?? ''} ${event.strProgress ?? ''}`),
    shootout: /shootout/i.test(`${event.strStatus ?? ''} ${event.strProgress ?? ''}`), is_draw: draw, is_no_contest: noContest,
    start_time: startTime, completed_at: completedAt, network: text(event.strTVStation), venue: text(event.strVenue),
    artwork_url: text(event.strThumb) ?? text(event.strPoster) ?? text(event.strEventPoster), raw_updated_at: null,
  };
}

export function configuredLeagueIds(env = Deno.env) {
  return (env.get('NOVAPULSE_SPORTS_LEAGUE_IDS') ?? '').split(',').map((value) => value.trim()).filter((value) => /^\d+$/.test(value)).slice(0, 8);
}

function withinWindow(event: NormalizedSportsEvent, from: Date, to: Date) {
  if (!event.start_time) return false;
  const time = Date.parse(event.start_time);
  return Number.isFinite(time) && time >= from.getTime() && time <= to.getTime();
}

export function createTheSportsDbAdapter(env = Deno.env, fetchImpl: typeof fetch = fetch) {
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
  async function collect(from: Date, to: Date, path: (leagueId: string) => string) {
    const output: NormalizedSportsEvent[] = [];
    for (const leagueId of configuredLeagueIds(env)) {
      let rawEvents: TheSportsDbEvent[] = [];
      try { rawEvents = await request(path(leagueId)); } catch { continue; }
      for (const raw of rawEvents) {
        const event = normalizeTheSportsDbEvent(raw);
        if (event && withinWindow(event, from, to)) output.push(event);
      }
    }
    return output;
  }
  return {
    async upcoming(now = new Date(), days = 7) { return collect(now, new Date(now.getTime() + days * 86_400_000), (id) => `eventsnextleague.php?id=${id}`); },
    async recent(now = new Date(), days = 2) { return collect(new Date(now.getTime() - days * 86_400_000), now, (id) => `eventspastleague.php?id=${id}`); },
  };
}
