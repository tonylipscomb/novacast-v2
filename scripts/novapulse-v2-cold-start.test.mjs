import assert from 'node:assert/strict';
import test from 'node:test';

import { createNovaPulseCatalogSource } from '../src/features/novapulse/novaPulseSources.ts';
import { sanitizeNovaPulseDisplayTitle } from '../src/features/novapulse/novaPulseLogic.ts';
import { composeNovaPulseFeedV2 } from '../src/features/novapulse/novaPulseV2.ts';

function source(items) {
  return { id: 'test', getItems: () => ({ sourceId: 'test', items }) };
}

function movie(id, overrides = {}) {
  return {
    id,
    categoryId: 'movies',
    title: id,
    genres: [],
    posterStyleKey: 'ember',
    ...overrides,
  };
}

function sports(id, subtype, priority = 1) {
  return {
    id,
    type: 'sports',
    subtype,
    title: id,
    priority,
    action: { type: 'none' },
  };
}

test('cold-start catalog keeps a bounded source window and ranks beyond the first alphabetical eight', () => {
  const input = [
    ...Array.from({ length: 8 }, (_, index) => movie(`A-${index}`)),
    ...Array.from({ length: 24 }, (_, index) => movie(`B-${index}`, {
      description: 'A useful catalog description',
      posterUrl: `https://cdn.example/${index}.jpg`,
      rating: '8.5',
      year: 2024,
    })),
  ];
  const catalog = createNovaPulseCatalogSource(input, []).getItems();
  const result = composeNovaPulseFeedV2([source(catalog.items)]);
  assert.equal(catalog.items.length, 32);
  assert.equal(result.diagnostics.movieSourceWindow, 32);
  assert.equal(result.diagnostics.movieRankedCandidates, 32);
  assert.ok(result.items.some((item) => item.sourceItemId?.startsWith('B-')));
  assert.ok(result.items.every((item) => item.sourceItemId?.startsWith('B-')));
});

test('cold-start output is deterministic and uses no randomness', () => {
  const catalog = createNovaPulseCatalogSource(
    Array.from({ length: 32 }, (_, index) => movie(`Movie-${index}`, { rating: String(6 + (index % 3)) })),
    [],
  ).getItems();
  const first = composeNovaPulseFeedV2([source(catalog.items)]);
  const second = composeNovaPulseFeedV2([source(catalog.items)]);
  assert.deepEqual(first, second);
});

test('provider presentation prefixes are stripped iteratively without mutating raw titles', () => {
  assert.equal(sanitizeNovaPulseDisplayTitle('AR - American History X'), 'American History X');
  assert.equal(sanitizeNovaPulseDisplayTitle('AR - AR-SUBS - American Beauty'), 'American Beauty');
  assert.equal(sanitizeNovaPulseDisplayTitle('A+ - Amber Brown'), 'Amber Brown');
  assert.equal(sanitizeNovaPulseDisplayTitle('ARCADE'), 'ARCADE');

  const raw = movie('raw-1', { title: 'AR - American History X' });
  const result = createNovaPulseCatalogSource([raw], []).getItems();
  assert.equal(raw.title, 'AR - American History X');
  assert.equal(result.items[0].title, 'American History X');
});

test('sports guard preserves upcoming and final cards when the movie pool is full', () => {
  const result = composeNovaPulseFeedV2([source([
    ...Array.from({ length: 20 }, (_, index) => ({
      id: `movie-${index}`,
      type: 'movie',
      title: `Movie ${index}`,
      description: 'A strong movie',
      artworkUrl: `https://cdn.example/movie-${index}.jpg`,
      rating: 9,
      year: 2024,
      priority: 90,
    })),
    sports('upcoming-1', 'upcoming'),
    sports('final-1', 'final'),
    sports('extra-1', 'upcoming'),
    { id: 'critical', type: 'announcement', title: 'Critical', announcementPriority: 'critical', priority: 1 },
    { id: 'normal-1', type: 'announcement', title: 'Normal one', announcementPriority: 'normal', priority: 1 },
    { id: 'normal-2', type: 'announcement', title: 'Normal two', announcementPriority: 'normal', priority: 1 },
  ])]);
  assert.equal(result.items.length, 12);
  assert.ok(result.items.some((item) => item.id === 'upcoming-1'));
  assert.ok(result.items.some((item) => item.id === 'final-1'));
  assert.ok(result.items.some((item) => item.id === 'critical'));
  assert.ok(result.diagnostics.sportsGuardApplied);
  assert.equal(result.diagnostics.selectedSports, 2);
  assert.equal(result.items.filter((item) => item.type === 'announcement' && item.announcementPriority !== 'critical').length, 1);
});

test('behavioral recommendation remains ahead of fallback while sports protection fills its reserved slots', () => {
  const result = composeNovaPulseFeedV2([source([
    { id: 'behavioral', type: 'movie', title: 'Behavioral', priority: 1, recommendation: { reason: 'viewers_also_watched', behaviorScore: 0.95 } },
    ...Array.from({ length: 12 }, (_, index) => ({ id: `fallback-${index}`, type: 'movie', title: `Fallback ${index}`, priority: 90, description: 'fallback', artworkUrl: `https://cdn.example/fallback-${index}.jpg` })),
    sports('upcoming-2', 'upcoming'),
  ])]);
  assert.ok(result.items.some((item) => item.id === 'behavioral'));
  assert.ok(result.items.some((item) => item.id === 'upcoming-2'));
});
