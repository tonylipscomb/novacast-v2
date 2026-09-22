import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

import { composeNovaPulseFeedV2, NOVA_PULSE_V2_MAX_ITEMS, NOVA_PULSE_V2_MIN_ITEMS } from '../src/features/novapulse/novaPulseV2.ts';
import { createNovaPulseLiveEpgSource } from '../src/features/novapulse/novaPulseSources.ts';
import { createNovaPulseArtworkPrefetchPlan } from '../src/features/novapulse/novaPulseArtworkPrefetch.ts';
import { preserveNovaPulseIndex } from '../src/features/novapulse/novaPulseComposer.ts';

function item(id, type = 'movie', overrides = {}) {
  return {
    id,
    type,
    title: `${type} ${id}`,
    description: 'A real description',
    artworkUrl: `https://cdn.example/${id}.jpg`,
    rating: 8,
    year: 2024,
    priority: 80,
    action: { type: type === 'movie' || type === 'series' ? 'details' : 'none' },
    ...overrides,
  };
}

function source(items) {
  return { id: 'test', getItems: () => ({ sourceId: 'test', items }) };
}

test('V2 selects at least five strong real candidates without padding', () => {
  const result = composeNovaPulseFeedV2([source([
    item('m1'), item('m2'), item('m3'), item('s1', 'series'), item('s2', 'series'), item('a1', 'announcement'),
  ])]);
  assert.ok(result.items.length >= NOVA_PULSE_V2_MIN_ITEMS);
  assert.equal(result.items.length, 6);
});

test('V2 caps the selected feed at twelve items', () => {
  const result = composeNovaPulseFeedV2([source(Array.from({ length: 20 }, (_, index) => item(`m${index}`)))]);
  assert.equal(result.items.length, NOVA_PULSE_V2_MAX_ITEMS);
});

test('V2 removes duplicate stable IDs', () => {
  const result = composeNovaPulseFeedV2([source([item('same'), item('same'), item('s1', 'series'), item('s2', 'series'), item('a1', 'announcement')])]);
  assert.equal(new Set(result.items.map((entry) => entry.id)).size, result.items.length);
});

test('V2 selects multiple movies and series', () => {
  const result = composeNovaPulseFeedV2([source([item('m1'), item('m2'), item('m3'), item('s1', 'series'), item('s2', 'series'), item('s3', 'series')])]);
  assert.ok(result.diagnostics.selectedMovies > 1);
  assert.ok(result.diagnostics.selectedSeries > 1);
});

test('V2 diversity limits same-type runs to two when alternatives exist', () => {
  const result = composeNovaPulseFeedV2([source([
    ...Array.from({ length: 8 }, (_, index) => item(`m${index}`)),
    ...Array.from({ length: 4 }, (_, index) => item(`s${index}`, 'series')),
  ])]);
  let run = 0;
  let previous = '';
  for (const entry of result.items) {
    run = entry.type === previous ? run + 1 : 1;
    previous = entry.type;
    assert.ok(run <= 2);
  }
});

test('V2 output is deterministic and contains no randomness', () => {
  const inputs = [source([item('m1'), item('m2'), item('s1', 'series'), item('a1', 'announcement')])];
  const first = composeNovaPulseFeedV2(inputs);
  const second = composeNovaPulseFeedV2(inputs);
  assert.deepEqual(first, second);
  assert.doesNotMatch(fs.readFileSync(new URL('../src/features/novapulse/novaPulseV2.ts', import.meta.url), 'utf8'), /Math\.random|random\(/);
});

test('V2 preserves the active card by stable ID', () => {
  const before = [item('m1'), item('m2'), item('s1', 'series')];
  const after = [item('m3'), item('m1'), item('m2'), item('s1', 'series')];
  assert.equal(preserveNovaPulseIndex(after, before[1].id, 1), 2);
});

test('V2 keeps sports and announcements bounded and compatible', () => {
  const result = composeNovaPulseFeedV2([source([
    item('m1'), item('s1', 'series'), item('sport1', 'sports', { sports: { eventStatus: 'UPCOMING' } }), item('final1', 'sports', { subtype: 'final' }), item('notice', 'announcement'),
  ])]);
  assert.ok(result.items.some((entry) => entry.type === 'sports'));
  assert.ok(result.items.some((entry) => entry.type === 'announcement'));
  assert.ok(result.diagnostics.selectedSports <= 2);
});

test('V2 prefers different sports leagues when two comparable cards are available', () => {
  const result = composeNovaPulseFeedV2([source([
    item('nba-upcoming', 'sports', { subtype: 'upcoming', sports: { eventStatus: 'UPCOMING', league: 'NBA' } }),
    item('nba-final', 'sports', { subtype: 'final', sports: { eventStatus: 'FINAL', league: 'NBA' } }),
    item('nfl-final', 'sports', { subtype: 'final', sports: { eventStatus: 'FINAL', league: 'NFL' } }),
  ])]);
  const selected = result.items.filter((entry) => entry.type === 'sports');
  assert.equal(selected.length, 2);
  assert.deepEqual(selected.map((entry) => entry.sports?.league), ['NBA', 'NFL']);
});

test('V2 admits actionable live EPG candidates as a protected family', () => {
  const live = item('live-1', 'live_epg', { priority: 80, action: { type: 'channel', target: '/live', contentId: 'channel-1' } });
  const result = composeNovaPulseFeedV2([
    source([item('m1'), item('m2'), item('s1', 'series'), item('s2', 'series')]),
    createNovaPulseLiveEpgSource([live]),
  ]);
  assert.equal(result.diagnostics.candidateLive, 1);
  assert.equal(result.diagnostics.selectedLive, 1);
  assert.equal(result.items.find((entry) => entry.type === 'live_epg')?.action?.contentId, 'channel-1');
});

test('V2 caps final live EPG selection at two and keeps the overall cap at twelve', () => {
  const live = Array.from({ length: 3 }, (_, index) => item(`live-${index}`, 'live_epg', {
    priority: 80 - index,
    action: { type: 'channel', target: '/live', contentId: `channel-${index}` },
  }));
  const catalog = Array.from({ length: 20 }, (_, index) => item(`movie-${index}`));
  const result = composeNovaPulseFeedV2([source(catalog), createNovaPulseLiveEpgSource(live)]);
  assert.equal(result.diagnostics.candidateLive, 2);
  assert.equal(result.diagnostics.selectedLive, 2);
  assert.equal(result.items.filter((entry) => entry.type === 'live_epg').length, 2);
  assert.ok(result.items.length <= NOVA_PULSE_V2_MAX_ITEMS);
});

test('V2 does not use weak candidates only to fill the maximum', () => {
  const result = composeNovaPulseFeedV2([source([
    item('strong-1'), item('strong-2'), item('strong-3'), item('strong-4'), item('strong-5'),
    item('weak-1', 'movie', { description: '', artworkUrl: undefined, rating: undefined, year: undefined, priority: 0 }),
  ])]);
  assert.equal(result.items.length, 5);
  assert.doesNotMatch(result.items.map((entry) => entry.id).join(','), /weak-1/);
});

test('artwork prefetch is derived from final selected items only', () => {
  const result = composeNovaPulseFeedV2([source([item('m1'), item('s1', 'series'), item('m2')])]);
  const plan = createNovaPulseArtworkPrefetchPlan(result.items, 'provider');
  assert.deepEqual(plan.urls.sort(), result.items.filter((entry) => entry.artworkUrl).map((entry) => entry.artworkUrl).sort());
});

test('V2 diagnostics expose bounded candidate and selected counts without URLs', () => {
  const result = composeNovaPulseFeedV2([source([item('m1'), item('s1', 'series'), item('a1', 'announcement')])]);
  assert.equal(result.diagnostics.selectedCount, result.items.length);
  assert.equal(result.diagnostics.signature.includes('https://'), false);
  assert.equal(JSON.stringify(result.diagnostics).includes('cdn.example'), false);
});

test('V1 visual/media contracts remain outside V2 ranking', () => {
  const card = fs.readFileSync(new URL('../src/features/novapulse/NovaPulseCard.tsx', import.meta.url), 'utf8');
  const hook = fs.readFileSync(new URL('../src/features/novapulse/useNovaPulse.ts', import.meta.url), 'utf8');
  assert.match(card, /height: 272/);
  assert.match(card, /width: '55%'/);
  assert.match(card, /width: '45%'/);
  assert.match(hook, /8_000/);
});
