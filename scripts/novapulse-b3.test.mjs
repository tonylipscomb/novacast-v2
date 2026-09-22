import assert from 'node:assert/strict';
import test from 'node:test';

import { composeNovaPulseFeedV2, createNovaPulseCompositionSession, NOVA_PULSE_COMPOSITION_BUCKET_MS, NOVA_PULSE_V2_MAX_ITEMS } from '../src/features/novapulse/novaPulseV2.ts';
import { preserveNovaPulseIndex } from '../src/features/novapulse/novaPulseComposer.ts';

function item(id, type = 'movie', overrides = {}) {
  return {
    id,
    sourceId: `provider-${type}`,
    sourceItemId: id,
    type,
    title: `${type} ${id}`,
    description: 'Verified description',
    artworkUrl: `https://cdn.example/${id}.jpg`,
    rating: 8,
    year: 2024,
    runtimeMinutes: 100,
    priority: 80,
    action: { type: type === 'movie' || type === 'series' ? 'details' : 'none' },
    ...overrides,
  };
}

function source(items) {
  return { id: 'test', getItems: () => ({ sourceId: 'test', items }) };
}

test('B3 full mixed feed stays bounded and includes both catalog types', () => {
  const result = composeNovaPulseFeedV2([source([
    ...Array.from({ length: 8 }, (_, index) => item(`m${index}`)),
    ...Array.from({ length: 8 }, (_, index) => item(`s${index}`, 'series')),
    ...Array.from({ length: 4 }, (_, index) => item(`sport${index}`, 'sports', { subtype: 'upcoming', startsAt: '2026-09-22T20:00:00Z' })),
    item('live-1', 'live_epg', { action: { type: 'channel', contentId: 'channel-1' } }),
    item('live-2', 'live_epg', { action: { type: 'channel', contentId: 'channel-2' } }),
  ])], { seed: 'full', nowMs: Date.parse('2026-09-22T12:00:00Z') });
  assert.ok(result.items.length <= NOVA_PULSE_V2_MAX_ITEMS);
  assert.ok(result.items.some((entry) => entry.type === 'movie'));
  assert.ok(result.items.some((entry) => entry.type === 'series'));
  assert.ok(result.items.filter((entry) => entry.type === 'sports').length <= 2);
  assert.ok(result.items.filter((entry) => entry.type === 'live_epg').length <= 2);
});

test('B3 gracefully handles missing sports, movies, series, and Live EPG sources', () => {
  const noSports = composeNovaPulseFeedV2([source([item('m1'), item('s1', 'series')])]);
  const noMovies = composeNovaPulseFeedV2([source([item('s1', 'series'), item('s2', 'series')])]);
  const noSeries = composeNovaPulseFeedV2([source([item('m1'), item('m2')])]);
  const sparse = composeNovaPulseFeedV2([source([item('m1', 'movie', { description: '', artworkUrl: undefined })])]);
  assert.equal(noSports.diagnostics.selectedSports, 0);
  assert.equal(noMovies.diagnostics.selectedMovies, 0);
  assert.equal(noSeries.diagnostics.selectedSeries, 0);
  assert.equal(sparse.items.length, 1);
});

test('B3 ranks live, starting soon, final, and upcoming sports and caps at two', () => {
  const nowMs = Date.parse('2026-09-22T12:00:00Z');
  const result = composeNovaPulseFeedV2([source([
    item('upcoming', 'sports', { subtype: 'upcoming', startsAt: '2026-09-24T12:00:00Z', sports: { league: 'NFL' } }),
    item('final', 'sports', { subtype: 'final', sports: { league: 'NBA' } }),
    item('soon', 'sports', { subtype: 'starting_soon', startsAt: '2026-09-22T12:30:00Z', sports: { league: 'MLB' } }),
    item('live', 'sports', { subtype: 'live', sports: { league: 'NHL' } }),
    item('stale', 'sports', { subtype: 'upcoming', startsAt: '2026-09-20T12:00:00Z', expiresAt: '2026-09-21T12:00:00Z' }),
    item('missing-start', 'sports', { subtype: 'upcoming' }),
  ])], { seed: 1, nowMs });
  const selected = result.items.filter((entry) => entry.type === 'sports');
  assert.equal(selected.length, 2);
  assert.deepEqual(selected.map((entry) => entry.id), ['live', 'soon']);
});

test('B3 places recent finals before upcoming events when higher-priority groups are absent', () => {
  const nowMs = Date.parse('2026-09-22T12:00:00Z');
  const result = composeNovaPulseFeedV2([source([
    item('upcoming-near', 'sports', { subtype: 'upcoming', startsAt: '2026-09-22T13:00:00Z', sports: { league: 'NFL' } }),
    item('final-recent', 'sports', { subtype: 'final', startsAt: '2026-09-22T10:00:00Z', expiresAt: '2026-09-23T04:00:00Z', sports: { league: 'NBA', completedAt: '2026-09-22T11:00:00Z' } }),
    item('final-old', 'sports', { subtype: 'final', startsAt: '2026-09-21T10:00:00Z', expiresAt: '2026-09-22T04:00:00Z', sports: { league: 'MLB', completedAt: '2026-09-21T13:00:00Z' } }),
  ])], { seed: 'finals', nowMs });
  assert.deepEqual(result.items.filter((entry) => entry.type === 'sports').map((entry) => entry.id), ['final-recent', 'upcoming-near']);
});

test('B3 deduplicates by provider identity and preserves same-title distinct IDs', () => {
  const result = composeNovaPulseFeedV2([source([
    item('same', 'movie'),
    item('same', 'movie'),
    item('movie-a', 'movie', { title: 'Shared title' }),
    item('movie-b', 'movie', { title: 'Shared title' }),
    item('series-a', 'series'),
  ])]);
  assert.equal(result.items.filter((entry) => entry.id === 'same').length, 1);
  assert.equal(result.items.filter((entry) => entry.title === 'Shared title').length, 2);
});

test('B3 uses the same seed for stable order and varies later seed buckets', () => {
  const candidates = Array.from({ length: 12 }, (_, index) => item(`m${index}`));
  const first = composeNovaPulseFeedV2([source(candidates)], { seed: 'bucket-a' });
  const repeat = composeNovaPulseFeedV2([source(candidates)], { seed: 'bucket-a' });
  const later = composeNovaPulseFeedV2([source(candidates)], { seed: 'bucket-b' });
  assert.deepEqual(first.items.map((entry) => entry.id), repeat.items.map((entry) => entry.id));
  assert.notDeepEqual(first.items.map((entry) => entry.id), later.items.map((entry) => entry.id));
});

test('B3 session seed and focused identity stay stable across a six-hour boundary', () => {
  const startedAt = Date.parse('2026-09-22T05:59:00Z');
  const session = createNovaPulseCompositionSession(startedAt);
  const candidates = Array.from({ length: 12 }, (_, index) => item(`m${index}`));
  const before = composeNovaPulseFeedV2([source(candidates)], { seed: session.seed, nowMs: session.startedAt });
  const afterBoundary = composeNovaPulseFeedV2([source(candidates)], {
    seed: session.seed,
    nowMs: startedAt + NOVA_PULSE_COMPOSITION_BUCKET_MS + 1,
  });
  assert.deepEqual(afterBoundary.items.map((entry) => entry.id), before.items.map((entry) => entry.id));
  assert.equal(preserveNovaPulseIndex(afterBoundary.items, before.items[3].id, 3), 3);
  const nextSession = createNovaPulseCompositionSession(startedAt + NOVA_PULSE_COMPOSITION_BUCKET_MS + 1);
  const next = composeNovaPulseFeedV2([source(candidates)], { seed: nextSession.seed, nowMs: nextSession.startedAt });
  assert.notDeepEqual(next.items.map((entry) => entry.id), before.items.map((entry) => entry.id));
});

test('B3 incomplete metadata influences quality without permanently excluding a legitimate item', () => {
  const result = composeNovaPulseFeedV2([source([
    item('title-only', 'movie', { description: '', artworkUrl: undefined, rating: undefined, year: undefined, runtimeMinutes: undefined, priority: 0 }),
    item('rich', 'movie'),
  ])]);
  assert.ok(result.items.some((entry) => entry.id === 'title-only'));
  assert.ok(result.items.some((entry) => entry.id === 'rich'));
});

test('B3 composition does not add mock sports or demo media', () => {
  const result = composeNovaPulseFeedV2([source([item('real-movie'), item('real-series', 'series')])]);
  assert.equal(result.items.some((entry) => entry.type === 'sports'), false);
  assert.equal(result.items.some((entry) => entry.id.includes('superman') || entry.id.includes('demo')), false);
});
