import { assert, assertEquals } from 'jsr:@std/assert@1.0.19';
import { createTheSportsDbAdapter, normalizeTheSportsDbEvent, resolveTheSportsDbStatus } from './novapulseSports.ts';

const env = { get(name: string) { return name === 'THESPORTSDB_API_KEY' ? 'test-key' : name === 'NOVAPULSE_SPORTS_LEAGUE_IDS' ? '1,2,ignored,3,4,5,6,7,8,9' : undefined; } };

Deno.test('normalizes team and final event semantics', () => {
  const event = normalizeTheSportsDbEvent({ idEvent: '42', strSport: 'Soccer', strLeague: 'Test League', strEvent: 'Away v Home', dateEvent: '2030-01-01', strTime: '20:00:00', strAwayTeam: 'Away', strHomeTeam: 'Home', intAwayScore: '2', intHomeScore: '1', strStatus: 'Match Finished', strVenue: 'Arena' });
  assert(event);
  assertEquals(event.provider_event_id, '42');
  assertEquals(event.event_status, 'final');
  assertEquals(event.away_name, 'Away');
  assertEquals(event.home_score, '1');
});

Deno.test('adapter filters to configured leagues and bounded date windows', async () => {
  const now = new Date('2030-01-01T00:00:00.000Z');
  const fetchImpl: typeof fetch = async (url) => {
    const id = new URL(String(url)).searchParams.get('id');
    return new Response(JSON.stringify({ events: [
      { idEvent: `in-${id}`, strSport: 'Basketball', strLeague: 'League', strEvent: `In ${id}`, dateEvent: '2030-01-02', strTime: '12:00:00', strAwayTeam: 'A', strHomeTeam: 'B' },
      { idEvent: `out-${id}`, strSport: 'Basketball', strLeague: 'League', strEvent: `Out ${id}`, dateEvent: '2030-02-01', strTime: '12:00:00', strAwayTeam: 'A', strHomeTeam: 'B' },
    ] }), { status: 200 });
  };
  const adapter = createTheSportsDbAdapter(env as unknown as Deno.Env, fetchImpl);
  const events = await adapter.upcoming(now, 7);
  assertEquals(events.length, 8);
  assert(events.every((event) => event.provider_event_id.startsWith('in-')));
});

Deno.test('provider failure is isolated to one league and live scores stay live', async () => {
  const now = new Date('2030-01-01T00:00:00.000Z');
  const fetchImpl: typeof fetch = async (url) => {
    const id = new URL(String(url)).searchParams.get('id');
    if (id === '2') throw new Error('provider_failure');
    return new Response(JSON.stringify({ events: [{ idEvent: `live-${id}`, strSport: 'Basketball', strLeague: 'League', strEvent: 'Live Game', dateEvent: '2030-01-01', strTime: '12:00:00', strStatus: 'In Progress', intAwayScore: '2', intHomeScore: '1', strAwayTeam: 'A', strHomeTeam: 'B' }] }), { status: 200 });
  };
  const adapter = createTheSportsDbAdapter(env as unknown as Deno.Env, fetchImpl);
  const events = await adapter.upcoming(now, 1);
  assertEquals(events.length, 7);
  assert(events.every((event) => event.event_status === 'live'));
});

Deno.test('upcoming NFL rows discard misleading winner and fight-result fields', () => {
  const event = normalizeTheSportsDbEvent({ idEvent: 'nfl-1', strSport: 'American Football', strEvent: 'Atlanta Falcons vs Carolina Panthers', dateEvent: '2030-01-02', strTime: '12:00:00', strStatus: 'Scheduled', strWinner: 'Atlanta Falcons', strResult: 'Quarter 1: 7 - 0; Quarter 2: 3 - 7', strRound: '2', intHomeScore: '1', strHomeTeam: 'Atlanta Falcons', strAwayTeam: 'Carolina Panthers' });
  assert(event);
  assertEquals(event.event_status, 'upcoming');
  assertEquals(event.winner_name, null);
  assertEquals(event.loser_name, null);
  assertEquals(event.result_method, null);
  assertEquals(event.result_round, null);
});

Deno.test('completed NFL, soccer, and football rows use the conservative past-score fallback', () => {
  const now = new Date('2026-09-19T22:00:00.000Z');
  const base = { dateEvent: '2026-09-18', strTime: '00:15:00', intHomeScore: '41', intAwayScore: '31', strHomeTeam: 'Buffalo Bills', strAwayTeam: 'Detroit Lions' };
  assertEquals(resolveTheSportsDbStatus(base, '2026-09-18T00:15:00.000Z', 'American Football', now), 'final');
  assertEquals(resolveTheSportsDbStatus({ ...base, intHomeScore: '0', intAwayScore: '1' }, '2026-09-18T23:30:00.000Z', 'Soccer', now), 'final');
  assertEquals(resolveTheSportsDbStatus({ ...base, intHomeScore: '0', intAwayScore: '1' }, '2026-09-19T16:30:00.000Z', 'Soccer', now), 'final');
});

Deno.test('upcoming MLB partial scores remain upcoming and team detail is not a result method', () => {
  const event = normalizeTheSportsDbEvent({ idEvent: 'mlb-1', strSport: 'Baseball', strEvent: 'Mets vs Phillies', dateEvent: '2030-01-02', strTime: '12:00:00', strStatus: 'Scheduled', strResult: 'Innings: 1, Hits: 4, Errors: 0', intHomeScore: '1', strHomeTeam: 'Phillies', strAwayTeam: 'Mets' });
  assert(event);
  assertEquals(event.event_status, 'upcoming');
  assertEquals(event.result_method, null);
  assertEquals(event.result_round, null);
});

Deno.test('scheduled and future events stay upcoming despite stale or partial scores', () => {
  const now = new Date('2026-09-19T20:00:00.000Z');
  assertEquals(resolveTheSportsDbStatus({ strStatus: 'Scheduled', intHomeScore: '1', intAwayScore: '1' }, '2026-09-19T12:00:00.000Z', 'Baseball', now), 'upcoming');
  assertEquals(resolveTheSportsDbStatus({ intHomeScore: '1', intAwayScore: null }, '2026-09-19T20:10:00.000Z', 'Baseball', now), 'upcoming');
  assertEquals(resolveTheSportsDbStatus({}, '2026-09-19T23:00:00.000Z', 'Ice Hockey', now), 'upcoming');
  assertEquals(resolveTheSportsDbStatus({}, '2026-09-20T17:00:00.000Z', 'American Football', now), 'upcoming');
});

Deno.test('explicit lifecycle state wins over score-based fallback', () => {
  const now = new Date('2026-09-19T20:00:00.000Z');
  const scored = { intHomeScore: '2', intAwayScore: '1' };
  assertEquals(resolveTheSportsDbStatus({ ...scored, strStatus: 'In Progress' }, '2026-09-18T00:00:00.000Z', 'Soccer', now), 'live');
  assertEquals(resolveTheSportsDbStatus({ ...scored, strStatus: 'Final' }, '2026-09-20T00:00:00.000Z', 'Soccer', now), 'final');
  assertEquals(resolveTheSportsDbStatus({ ...scored, strStatus: 'Scheduled' }, '2026-09-18T00:00:00.000Z', 'Soccer', now), 'upcoming');
});

Deno.test('final soccer derives the away winner and final draw derives is_draw', () => {
  const final = normalizeTheSportsDbEvent({ idEvent: 'soccer-1', strSport: 'Soccer', strEvent: 'NYCFC vs NY Red Bulls', dateEvent: '2030-01-01', strTime: '12:00:00', strStatus: 'Match Finished', intHomeScore: '0', intAwayScore: '1', strHomeTeam: 'NYCFC', strAwayTeam: 'NY Red Bulls' });
  const draw = normalizeTheSportsDbEvent({ idEvent: 'soccer-2', strSport: 'Soccer', strEvent: 'A vs B', dateEvent: '2030-01-01', strTime: '12:00:00', strStatus: 'Final', intHomeScore: '1', intAwayScore: '1', strHomeTeam: 'A', strAwayTeam: 'B' });
  assert(final && draw);
  assertEquals(final.winner_name, 'NY Red Bulls');
  assertEquals(final.loser_name, 'NYCFC');
  assertEquals(final.is_draw, false);
  assertEquals(draw.winner_name, null);
  assertEquals(draw.loser_name, null);
  assertEquals(draw.is_draw, true);
});

Deno.test('combat finals preserve method and round while event stage stays separate', () => {
  const event = normalizeTheSportsDbEvent({ idEvent: 'fight-1', strSport: 'Boxing', strEvent: 'Fighter A vs Fighter B', dateEvent: '2030-01-01', strTime: '12:00:00', strStatus: 'Final', strResult: 'Unanimous Decision', strRound: '3', strResultTime: '2:14', strHomeTeam: 'Fighter A', strAwayTeam: 'Fighter B' });
  assert(event);
  assertEquals(event.result_method, 'Unanimous Decision');
  assertEquals(event.result_round, '3');
  assertEquals(event.result_time, '2:14');
  assertEquals(event.event_stage, '3');
});
