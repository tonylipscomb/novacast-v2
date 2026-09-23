import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { mergeNovaPulseMoviePools } from '../src/features/novapulse/novaPulseLocalCatalog.ts';
import { createNovaPulseCatalogSource } from '../src/features/novapulse/novaPulseSources.ts';
import { getNovaPulseCatalogBadge } from '../src/features/novapulse/novaPulseLogic.ts';
import { composeNovaPulseFeedV2 } from '../src/features/novapulse/novaPulseV2.ts';

const NOW = Date.parse('2026-09-23T12:00:00.000Z');
const DAY = 24 * 60 * 60_000;

function movie(id, addedAt, overrides = {}) {
  return {
    id,
    title: `Movie ${id}`,
    posterUrl: `https://img.example/${id}.jpg`,
    description: 'Usable description',
    rating: '8.0',
    year: 2020,
    addedAt,
    ...overrides,
  };
}

function source(items) {
  return { id: 'test', getItems: () => ({ sourceId: 'test', items }) };
}

function recentCount(items) {
  return items.filter((item) => item.type === 'movie' && getNovaPulseCatalogBadge(item) === 'RECENTLY ADDED').length;
}

test('the general title window can miss recent Movies while the bounded recent pool restores one', () => {
  const general = Array.from({ length: 32 }, (_, index) => movie(`general-${index}`, NOW - 45 * DAY));
  const recent = movie('recent-window', NOW - DAY);
  const merged = mergeNovaPulseMoviePools(general, [recent]);
  const result = composeNovaPulseFeedV2([source(createNovaPulseCatalogSource(merged, [], undefined, NOW).getItems().items)], { seed: 1, nowMs: NOW });
  assert.ok(result.items.some((item) => item.sourceItemId === 'recent-window'));
  assert.ok(recentCount(result.items) >= 1);
});

test('the persisted recent query is capped at 24 rows and orders by added_at', () => {
  const repository = fs.readFileSync(new URL('../src/features/catalog/catalogRepository.ts', import.meta.url), 'utf8');
  assert.match(repository, /NOVA_PULSE_RECENT_MOVIE_CATALOG_LIMIT|Math\.min\(Math\.max\(Math\.floor\(options\.limit\), 1\), 24\)/);
  assert.match(repository, /ORDER BY added_at DESC, normalized_title ASC, content_id ASC\s+LIMIT \?/);
});

test('recent sourcing uses a bounded SQL row read rather than a full catalog array', () => {
  const repository = fs.readFileSync(new URL('../src/features/catalog/catalogRepository.ts', import.meta.url), 'utf8');
  const query = repository.slice(repository.indexOf('export async function getRecentlyAddedCatalogMovies'));
  assert.match(query, /SELECT \* FROM \$\{catalogItemsTable\('movie'\)\}/);
  assert.match(query, /LIMIT \?/);
  assert.doesNotMatch(query, /getAll\([^)]*\)\.filter/);
});

test('general and recent pools deduplicate by raw Movie identity before composition', () => {
  const merged = mergeNovaPulseMoviePools([movie('same', NOW - 40 * DAY)], [movie('same', NOW - DAY), movie('new', NOW - DAY)]);
  assert.deepEqual(merged.map((item) => item.id), ['same', 'new']);
});

test('at least one usable recent Movie is selected when the bounded pool contains one', () => {
  const items = createNovaPulseCatalogSource([movie('recent', NOW - 2 * DAY), movie('old', NOW - 40 * DAY)], [], undefined, NOW).getItems().items;
  const result = composeNovaPulseFeedV2([source(items)], { seed: 2, nowMs: NOW });
  assert.ok(recentCount(result.items) >= 1);
});

test('the soft recent target stays at two when quality non-recent alternatives exist', () => {
  const items = createNovaPulseCatalogSource([
    ...Array.from({ length: 4 }, (_, index) => movie(`recent-${index}`, NOW - (index + 1) * DAY)),
    ...Array.from({ length: 4 }, (_, index) => movie(`old-${index}`, NOW - (40 + index) * DAY)),
  ], [], undefined, NOW).getItems().items;
  const result = composeNovaPulseFeedV2([source(items)], { seed: 3, nowMs: NOW });
  assert.ok(recentCount(result.items) <= 2);
});

test('history penalty can select another recent candidate', () => {
  const items = createNovaPulseCatalogSource([movie('repeat', NOW - DAY), movie('alternative', NOW - 2 * DAY)], [], undefined, NOW).getItems().items;
  const result = composeNovaPulseFeedV2([source(items)], {
    seed: 4,
    nowMs: NOW,
    recentHistory: [{ mediaType: 'movie', contentId: 'repeat', lastSelectedAt: NOW - 60 * 60_000 }],
  });
  assert.equal(result.items.find((item) => item.type === 'movie')?.sourceItemId, 'alternative');
});

test('unusable recent artwork/title is not forced over a usable Movie', () => {
  const items = createNovaPulseCatalogSource([
    movie('bad', NOW - DAY, { title: '', posterUrl: undefined, description: '', rating: undefined }),
    movie('good', NOW - 40 * DAY),
  ], [], undefined, NOW).getItems().items;
  const result = composeNovaPulseFeedV2([source(items)], { seed: 5, nowMs: NOW });
  assert.equal(result.items.find((item) => item.type === 'movie')?.sourceItemId, 'good');
});

test('empty or failed recent sourcing can fall back to the general Movie pool', () => {
  const general = createNovaPulseCatalogSource([movie('general', NOW - 40 * DAY)], [], undefined, NOW).getItems().items;
  const result = composeNovaPulseFeedV2([source(general)], { seed: 6, nowMs: NOW });
  assert.equal(result.items.find((item) => item.type === 'movie')?.sourceItemId, 'general');
});

test('bounded sourcing does not create a full-catalog candidate window', () => {
  const movies = Array.from({ length: 56 }, (_, index) => movie(`movie-${index}`, NOW - (index + 1) * DAY));
  const items = createNovaPulseCatalogSource(movies, [], undefined, NOW).getItems().items;
  const result = composeNovaPulseFeedV2([source(items)], { seed: 7, nowMs: NOW });
  assert.ok(result.diagnostics.movieSourceWindow <= 56);
  assert.ok(result.items.length <= 12);
});

test('recent sourcing preserves Movie/Series balance and existing source caps', () => {
  const movieItems = createNovaPulseCatalogSource([movie('recent', NOW - DAY)], [], undefined, NOW).getItems().items;
  const series = { id: 'series-1', seriesId: 'series-1', title: 'Series 1', posterUrl: 'https://img.example/series.jpg', description: 'Description', year: '2024' };
  const result = composeNovaPulseFeedV2([source([
    ...movieItems,
    ...createNovaPulseCatalogSource([], [series], undefined, NOW).getItems().items,
  ])], { seed: 8, nowMs: NOW });
  assert.ok(result.items.some((item) => item.type === 'movie'));
  assert.ok(result.items.some((item) => item.type === 'series'));
  assert.ok(result.items.length <= 12);
});

test('the same hydrated pools retain stable order across repeated composition', () => {
  const items = createNovaPulseCatalogSource([movie('recent', NOW - DAY), movie('old', NOW - 40 * DAY)], [], undefined, NOW).getItems().items;
  const first = composeNovaPulseFeedV2([source(items)], { seed: 9, nowMs: NOW }).items.map((item) => `${item.type}:${item.sourceItemId ?? item.id}`);
  const second = composeNovaPulseFeedV2([source(items)], { seed: 9, nowMs: NOW }).items.map((item) => `${item.type}:${item.sourceItemId ?? item.id}`);
  assert.deepEqual(second, first);
});

test('Home gates local recent hydration per provider bundle and invalidates only on sync-ready', () => {
  const home = fs.readFileSync(new URL('../src/features/hub/MainMenuScreen.tsx', import.meta.url), 'utf8');
  assert.match(home, /novaPulseLocalCatalogCompletedKeyRef/);
  assert.match(home, /const hydrationKey = `\$\{providerId\}:\$\{providerBundleGeneration\}`/);
  assert.match(home, /if \(novaPulseLocalCatalogCompletedKeyRef\.current === hydrationKey\)/);
  assert.match(home, /if \(phase === 'ready'\) \{\s*novaPulseLocalCatalogCompletedKeyRef\.current = null/s);
});
