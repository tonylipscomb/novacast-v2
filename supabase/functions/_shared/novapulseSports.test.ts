import { assert, assertEquals, assertFalse, assertStringIncludes } from 'jsr:@std/assert@1.0.19';
import { createTheSportsDbAdapter, configuredLeagueIds, normalizeTheSportsDbEvent, NOVA_PULSE_SUPPORTED_LEAGUES, resolveTheSportsDbStatus } from './novapulseSports.ts';

const now = new Date('2026-09-20T12:00:00.000Z');
const base = { idEvent: '42', strSport: 'Basketball', strLeague: 'NBA', strEvent: 'Away vs Home', dateEvent: '2026-09-21', strTime: '18:00:00', strAwayTeam: 'Away', strHomeTeam: 'Home', idAwayTeam: 'a', idHomeTeam: 'h' };
const env = { get(name: string) {
  if (name === 'THESPORTSDB_API_KEY') return 'test-key';
  if (name === 'NOVAPULSE_SPORTS_LEAGUE_IDS') return '4391,4387';
  return undefined;
} };

Deno.test('normalizes a scheduled event with stable source identity and UTC time', () => {
  const event = normalizeTheSportsDbEvent(base, now, '4387');
  assert(event);
  assertEquals(event.source, 'thesportsdb');
  assertEquals(event.source_event_id, '42');
  assertEquals(event.status, 'scheduled');
  assertEquals(event.starts_at, '2026-09-21T18:00:00.000Z');
  assertEquals(event.league_id, '4387');
});

Deno.test('starting-soon uses a bounded one-hour window', () => {
  assertEquals(resolveTheSportsDbStatus({}, '2026-09-20T12:45:00.000Z', now), 'starting_soon');
  assertEquals(resolveTheSportsDbStatus({}, '2026-09-20T13:01:00.000Z', now), 'scheduled');
});

Deno.test('live and final require explicit upstream lifecycle text', () => {
  assertEquals(resolveTheSportsDbStatus({ strStatus: 'In Progress' }, '2026-09-19T12:00:00.000Z', now), 'live');
  assertEquals(resolveTheSportsDbStatus({ strStatus: 'Match Finished', intHomeScore: '2', intAwayScore: '1' }, '2026-09-19T12:00:00.000Z', now), 'final');
  assertEquals(resolveTheSportsDbStatus({ intHomeScore: '2', intAwayScore: '1' }, '2026-09-19T12:00:00.000Z', now), 'scheduled');
});

Deno.test('verified TheSportsDB AOT response is final and preserves its display detail', () => {
  const event = normalizeTheSportsDbEvent({
    ...base,
    idEvent: 'aot-2475404',
    strStatus: 'AOT',
    intHomeScore: '2',
    intAwayScore: '1',
    strProgress: 'AOT',
  }, now, '4391');
  assert(event);
  assertEquals(event.status, 'final');
  assertEquals(event.status_detail, 'AOT');
  assertEquals(event.home_score, '2');
  assertEquals(event.away_score, '1');
});

Deno.test('hypothetical explicit overtime and extra-inning lifecycle fixtures are safe', () => {
  // These exact strings are representative fixtures, not claimed observed
  // TheSportsDB values; only the AOT fixture above is from the probe.
  assertEquals(resolveTheSportsDbStatus({ strStatus: 'OT', strProgress: 'In Progress' }, '2026-09-19T12:00:00.000Z', now), 'live');
  assertEquals(resolveTheSportsDbStatus({ strStatus: 'In Progress', strProgress: '10th Inning' }, '2026-09-19T12:00:00.000Z', now), 'live');
  assertEquals(resolveTheSportsDbStatus({ strStatus: 'Final/10', strProgress: 'Final/10' }, '2026-09-19T12:00:00.000Z', now), 'final');
  assertEquals(resolveTheSportsDbStatus({ strStatus: 'OT' }, '2026-09-19T12:00:00.000Z', now), 'scheduled');
});

Deno.test('status matching does not promote incidental words to live or final', () => {
  assertEquals(resolveTheSportsDbStatus({ strStatus: 'Inactive' }, '2026-09-19T12:00:00.000Z', now), 'scheduled');
  assertEquals(resolveTheSportsDbStatus({ strStatus: 'Unfinished' }, '2026-09-19T12:00:00.000Z', now), 'scheduled');
  assertEquals(resolveTheSportsDbStatus({ strStatus: 'Not live' }, '2026-09-19T12:00:00.000Z', now), 'scheduled');
});

Deno.test('postponed and cancelled states are preserved safely', () => {
  assertEquals(resolveTheSportsDbStatus({ strStatus: 'Postponed' }, '2026-09-21T18:00:00.000Z', now), 'postponed');
  assertEquals(resolveTheSportsDbStatus({ strStatus: 'Cancelled' }, '2026-09-21T18:00:00.000Z', now), 'cancelled');
});

Deno.test('scores, winner, draw, and missing score values normalize without fabrication', () => {
  const final = normalizeTheSportsDbEvent({ ...base, strStatus: 'Final', intHomeScore: '3', intAwayScore: '1', strWinner: 'Home', strHomeTeamBadge: 'https://img/home.png', strAwayTeamBadge: 'https://img/away.png' }, now, '4387');
  const missing = normalizeTheSportsDbEvent({ ...base, strStatus: 'Final', intHomeScore: 'N/A' }, now, '4387');
  assert(final && missing);
  assertEquals(final.home_score, '3');
  assertEquals(final.winner_name, 'Home');
  assertEquals(final.home_team_logo_url, 'https://img/home.png');
  assertEquals(missing.home_score, null);
  assertEquals(missing.winner_name, null);
});

Deno.test('combat result fields stay separate from team result fields', () => {
  const event = normalizeTheSportsDbEvent({ idEvent: 'fight-1', strSport: 'Boxing', strEvent: 'Fighter A vs Fighter B', dateEvent: '2026-09-20', strTime: '18:00:00', strStatus: 'Final', strResult: 'Unanimous Decision', strRound: '3', strResultTime: '2:14', strHomeTeam: 'Fighter A', strAwayTeam: 'Fighter B' }, now);
  assert(event);
  assertEquals(event.result_method, 'Unanimous Decision');
  assertEquals(event.result_round, '3');
  assertEquals(event.competitor_a, 'Fighter A');
  assertEquals(event.home_score, null);
});

Deno.test('league configuration is canonical and rejects unknown ids', () => {
  assertEquals(NOVA_PULSE_SUPPORTED_LEAGUES.length, 6);
  assertEquals(configuredLeagueIds(env as unknown as Deno.Env), ['4391', '4387']);
  assertEquals(configuredLeagueIds({ get: () => '999999' } as unknown as Deno.Env), []);
});

Deno.test('adapter applies configured league windows and isolates one league failure', async () => {
  const fetchImpl: typeof fetch = async (url) => {
    const id = new URL(String(url)).searchParams.get('id');
    if (id === '4387') throw new Error('provider_failure');
    return new Response(JSON.stringify({ events: [{ ...base, idEvent: 'event-' + id, dateEvent: '2026-09-21', strTime: '12:00:00' }, { ...base, idEvent: 'old-' + id, dateEvent: '2026-10-01' }] }), { status: 200 });
  };
  const adapter = createTheSportsDbAdapter(env as unknown as Deno.Env, fetchImpl);
  const result = await adapter.upcoming(now, 7);
  assertEquals(result.events.length, 1);
  assertEquals(result.failedLeagues, ['4387']);
  assertStringIncludes(result.events[0].source_event_id, 'event-4391');
});

Deno.test('missing upstream key produces an unconfigured adapter without a request', async () => {
  let requests = 0;
  const adapter = createTheSportsDbAdapter({ get: () => undefined } as unknown as Deno.Env, async () => { requests += 1; return new Response('{}'); });
  assertFalse(adapter.configured);
  const result = await adapter.upcoming(now, 7);
  assertEquals(result.events, []);
  assertEquals(requests, 0);
});

Deno.test('malformed upstream event is discarded and event ids remain source scoped', () => {
  assertEquals(normalizeTheSportsDbEvent({ strEvent: 'missing id' }, now), null);
  const one = normalizeTheSportsDbEvent({ ...base, idEvent: 'same', strStatus: 'Scheduled' }, now, '4391');
  const two = normalizeTheSportsDbEvent({ ...base, idEvent: 'same', strStatus: 'Scheduled' }, now, '4387');
  assert(one && two);
  assertEquals(one.source + ':' + one.source_event_id, 'thesportsdb:same');
  assertEquals(two.source + ':' + two.source_event_id, 'thesportsdb:same');
});
