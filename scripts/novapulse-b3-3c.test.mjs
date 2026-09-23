import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getNovaPulseCatalogBadge,
  getNovaPulseMovieFreshness,
  NOVA_PULSE_RECENTLY_ADDED_FLOOR_MS,
  NOVA_PULSE_RECENTLY_ADDED_WINDOW_MS,
} from '../src/features/novapulse/novaPulseLogic.ts';
import { createNovaPulseCatalogSource } from '../src/features/novapulse/novaPulseSources.ts';
import { composeNovaPulseFeedV2 } from '../src/features/novapulse/novaPulseV2.ts';

const NOW = Date.parse('2026-09-23T12:00:00.000Z');
const DAY = 24 * 60 * 60_000;

function movie(id, addedAt, overrides = {}) {
  return {
    id,
    categoryId: 'catalog',
    title: `Movie ${id}`,
    genres: ['Drama'],
    posterStyleKey: 'ember',
    posterUrl: `https://img.example/${id}.jpg`,
    description: 'A usable description.',
    rating: '8.0',
    year: 1999,
    addedAt,
    ...overrides,
  };
}

function series(id, addedAt) {
  return {
    id,
    seriesId: id,
    categoryId: 'catalog',
    title: `Series ${id}`,
    genres: ['Drama'],
    posterStyleKey: 'ember',
    posterUrl: `https://img.example/${id}.jpg`,
    description: 'A usable description.',
    rating: '8.0',
    year: '2024',
    addedAt,
  };
}

function catalog(movies, seriesItems = []) {
  return createNovaPulseCatalogSource(movies, seriesItems, undefined, NOW).getItems().items;
}

test('Movie freshness accepts the 24-hour future tolerance and rejects invalid boundaries', () => {
  assert.equal(getNovaPulseMovieFreshness(NOW - DAY, NOW), 'strong');
  assert.equal(getNovaPulseMovieFreshness(NOW + DAY, NOW), 'strong');
  assert.equal(getNovaPulseMovieFreshness(NOW - NOVA_PULSE_RECENTLY_ADDED_WINDOW_MS, NOW), 'moderate');
  assert.equal(getNovaPulseMovieFreshness(NOW - NOVA_PULSE_RECENTLY_ADDED_WINDOW_MS - 1, NOW), null);
  assert.equal(getNovaPulseMovieFreshness(NOVA_PULSE_RECENTLY_ADDED_FLOOR_MS - 1, NOW), null);
  assert.equal(getNovaPulseMovieFreshness(undefined, NOW), null);
  assert.equal(getNovaPulseMovieFreshness(NOW + DAY + 1, NOW), null);
});

test('Movie badge uses provider addedAt only and preserves old release years', () => {
  const items = catalog([movie('recent', NOW - 2 * DAY), movie('old', NOW - 31 * DAY)]);
  assert.equal(getNovaPulseCatalogBadge(items.find((item) => item.sourceItemId === 'recent')), 'RECENTLY ADDED');
  assert.equal(getNovaPulseCatalogBadge(items.find((item) => item.sourceItemId === 'old')), 'MOVIE');
  assert.equal(items.find((item) => item.sourceItemId === 'recent')?.year, 1999);
});

test('Series never receives the Movie Recently Added badge', () => {
  const item = catalog([], [series('series-recent', NOW - DAY)])[0];
  assert.equal(item.type, 'series');
  assert.equal(item.addedAt, undefined);
  assert.equal(getNovaPulseCatalogBadge(item), 'SERIES');
});

test('strong and moderate freshness boosts are deterministic and modest', () => {
  const source = (items) => ({ id: 'test', getItems: () => ({ sourceId: 'test', items }) });
  const strong = { ...catalog([movie('strong', NOW - DAY)])[0], priority: 80 };
  const moderate = { ...catalog([movie('moderate', NOW - 14 * DAY)])[0], priority: 80 };
  const old = { ...catalog([movie('old', NOW - 31 * DAY)])[0], priority: 80 };
  const result = composeNovaPulseFeedV2([source([strong, moderate, old])], { seed: 1, nowMs: NOW });
  assert.deepEqual(result.items.filter((item) => item.type === 'movie').map((item) => item.sourceItemId), ['strong', 'moderate', 'old']);
});

test('soft recent target limits recent Movies when quality alternatives exist', () => {
  const items = catalog([
    ...Array.from({ length: 4 }, (_, index) => movie(`recent-${index}`, NOW - (index + 1) * DAY)),
    ...Array.from({ length: 4 }, (_, index) => movie(`old-${index}`, NOW - (31 + index) * DAY)),
  ]);
  const result = composeNovaPulseFeedV2([{ id: 'test', getItems: () => ({ sourceId: 'test', items }) }], { seed: 5, nowMs: NOW });
  const selectedMovies = result.items.filter((item) => item.type === 'movie');
  assert.ok(selectedMovies.length >= 4);
  assert.ok(selectedMovies.filter((item) => item.catalogStatus === 'RECENTLY ADDED').length <= 2);
});

test('sparse Movie pools may reuse all eligible recent items', () => {
  const items = catalog([movie('recent-1', NOW - DAY), movie('recent-2', NOW - 2 * DAY)]);
  const result = composeNovaPulseFeedV2([{ id: 'test', getItems: () => ({ sourceId: 'test', items }) }], { seed: 2, nowMs: NOW });
  assert.equal(result.items.filter((item) => item.type === 'movie').length, 2);
  assert.equal(result.items.filter((item) => item.catalogStatus === 'RECENTLY ADDED').length, 2);
});

test('history penalty still applies to recently added Movies', () => {
  const items = catalog([movie('repeat', NOW - DAY), movie('alternative', NOW - 2 * DAY)]);
  const result = composeNovaPulseFeedV2([{ id: 'test', getItems: () => ({ sourceId: 'test', items }) }], {
    seed: 3,
    nowMs: NOW,
    recentHistory: [{ mediaType: 'movie', contentId: 'repeat', lastSelectedAt: NOW - 60 * 60_000 }],
  });
  assert.equal(result.items.find((item) => item.type === 'movie')?.sourceItemId, 'alternative');
});

test('freshness remains stable when the session clock later advances', () => {
  const item = catalog([movie('stable', NOW - 6 * DAY)])[0];
  assert.equal(getNovaPulseCatalogBadge(item), 'RECENTLY ADDED');
  assert.equal(getNovaPulseMovieFreshness(item.addedAt, NOW), 'strong');
  assert.equal(getNovaPulseMovieFreshness(item.addedAt, NOW + 8 * DAY), 'moderate');
  assert.equal(getNovaPulseCatalogBadge(item), 'RECENTLY ADDED');
});

test('quality still rejects an unusable recent Movie', () => {
  const items = catalog([
    movie('bad-recent', NOW - DAY, { title: '', posterUrl: undefined, description: '', rating: undefined }),
    movie('good-old', NOW - 31 * DAY),
  ]);
  const result = composeNovaPulseFeedV2([{ id: 'test', getItems: () => ({ sourceId: 'test', items }) }], { seed: 4, nowMs: NOW });
  assert.equal(result.items.find((item) => item.type === 'movie')?.sourceItemId, 'good-old');
});
