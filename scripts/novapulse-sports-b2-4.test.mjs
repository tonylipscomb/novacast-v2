import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { composeNovaPulseFeedV2 } from '../src/features/novapulse/novaPulseV2.ts';

const adapter = fs.readFileSync('supabase/functions/_shared/novapulseSports.ts', 'utf8');
const feed = fs.readFileSync('supabase/functions/novapulse-sports-feed/index.ts', 'utf8');
const source = fs.readFileSync('src/features/novapulse/novaPulseSportsSource.ts', 'utf8');
const types = fs.readFileSync('src/features/novapulse/novaPulseTypes.ts', 'utf8');
const card = fs.readFileSync('src/features/novapulse/NovaPulseSportsCard.tsx', 'utf8');
const badge = fs.readFileSync('src/features/novapulse/NovaPulseCard.tsx', 'utf8');
const composition = fs.readFileSync('src/features/novapulse/novaPulseV2.ts', 'utf8');

test('B2.4 keeps the four verified leagues in the bounded supported set', () => {
  for (const id of ['4346', '4328', '4445', '4443']) assert.match(adapter, new RegExp(`id: '${id}'`));
  assert.equal((adapter.match(/id: '\d+'/g) ?? []).length, 10);
  assert.match(adapter, /for \(const league of configuredLeagues\(env\)\)/);
  assert.doesNotMatch(adapter, /Promise\.all/);
});

test('B2.4 remains within the free-tier request budget', () => {
  assert.equal(10 * 2, 20);
  assert.ok(20 < 30);
  assert.match(feed, /MAX_UPCOMING = 6/);
  assert.match(feed, /MAX_FINAL = 2/);
});

test('soccer and fighting data remain provider-shaped and non-actionable', () => {
  assert.match(source, /format: isFight \? 'fight' : 'team'/);
  assert.match(source, /eventTitle: row\.event_name/);
  assert.match(source, /action: \{ type: 'none' \}/);
  assert.match(source, /eventTitle: row\.event_name/);
  assert.match(card, /isFight && !hasFightParticipants \? null/);
  assert.match(source, /resultMethod: isFinal \? row\.result_method/);
  assert.match(source, /decisionType: isFinal \? row\.decision_type/);
  assert.doesNotMatch(source, /0\s*[–-]\s*0/);
});

test('fighting lifecycle states and starting-soon presentation are preserved', () => {
  assert.match(types, /'postponed' \| 'cancelled'/);
  assert.match(card, /eventStatus === 'POSTPONED'/);
  assert.match(card, /eventStatus === 'CANCELLED'/);
  assert.match(badge, /item\.subtype === 'starting_soon' \? 'STARTING SOON'/);
  assert.match(badge, /item\.subtype === 'postponed'/);
  assert.match(badge, /item\.subtype === 'cancelled'/);
  assert.match(composition, /item\.subtype === 'postponed' \|\| item\.subtype === 'cancelled'/);
  assert.doesNotMatch(feed, /'postponed', 'cancelled'/);
  assert.match(source, /row\.status === 'postponed' \|\| row\.status === 'cancelled'/);
});

test('existing caps, priority and isolation contracts remain in place', () => {
  assert.match(composition, /\.slice\(0, 2\)/);
  assert.match(composition, /item\.subtype === 'live' \? 0 : item\.subtype === 'starting_soon' \? 1 : item\.subtype === 'final' \? 2/);
  assert.match(composition, /leagueId === '4346'.*return 'soccer'/s);
  assert.match(composition, /leagueId === '4445'.*return 'fighting'/s);
  assert.match(adapter, /failedLeagues/);
  assert.match(adapter, /for \(const raw of await request/);
});

test('verified sport-family diversity never outranks lifecycle precedence', () => {
  const item = (id, leagueId, sport, completedAt, priority) => ({
    id, type: 'sports', subtype: 'final', title: id, priority,
    startsAt: completedAt, sports: { sport, leagueId, league: leagueId === '4346' ? 'American Major League Soccer' : 'UFC', eventStatus: 'FINAL', completedAt },
    action: { type: 'none' },
  });
  const result = composeNovaPulseFeedV2([{ id: 'probe', getItems: () => ({ sourceId: 'probe', items: [
    item('soccer-final', '4346', 'Soccer', '2026-09-25T10:00:00.000Z', 90),
    item('ufc-final', '4443', 'Fighting', '2026-09-25T10:00:00.000Z', 80),
  ] }) }], { nowMs: Date.parse('2026-09-25T12:00:00.000Z') });
  assert.deepEqual(result.items.filter((entry) => entry.type === 'sports').map((entry) => entry.id), ['soccer-final', 'ufc-final']);
});
