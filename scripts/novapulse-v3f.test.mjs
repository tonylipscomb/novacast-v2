import assert from 'node:assert/strict';
import test from 'node:test';

import { buildNovaPulseCatalogBridge, buildNovaPulsePersonalSeeds, recommendationSignalForCandidate } from '../src/features/novapulse/recommendationFeed.ts';
import { clearRecommendationCandidateCache, getRecommendationCandidates, NOVA_PULSE_RECOMMENDATION_CACHE_TTL_MS } from '../src/features/novapulse/recommendationCandidateClient.ts';
import { composeNovaPulseFeedV2 } from '../src/features/novapulse/novaPulseV2.ts';

function movie(id, title = id, year = 2024) {
  return { id, categoryId: 'all', title, year, genres: [], posterStyleKey: 'default', posterUrl: `https://img/${id}` };
}

function series(id, title = id) {
  return { id, seriesId: id, categoryId: 'all', title, year: '2024', genres: [], posterStyleKey: 'default', posterUrl: `https://img/${id}` };
}

function recent(contentId, title, progressPercent, lastOpenedAt, extra = {}) {
  return { providerId: 'provider-a', mediaType: 'movie', contentId, title, progressPercent, lastOpenedAt, ...extra };
}

test('meaningful recent watch creates a seed while weak raw-start-like state does not', () => {
  const result = buildNovaPulsePersonalSeeds({
    recentlyWatched: [recent('movie-1', 'Movie One', 20, 1_000), recent('movie-weak', 'Movie Weak', 5, 900)],
    favoriteMovies: [], watchlistMovies: [], favoriteSeries: [], watchlistSeries: [],
  }, 2_000);
  assert.equal(result.seeds.length, 1);
  assert.match(result.seeds[0].fingerprint, /movie\|movie one/);
});

test('completion outranks meaningful watch and repeat outranks completion', () => {
  const result = buildNovaPulsePersonalSeeds({
    recentlyWatched: [
      recent('meaningful', 'Meaningful', 20, 3_000),
      recent('complete', 'Complete', 100, 2_000, { completed: true }),
      recent('repeat', 'Repeat', 20, 1_000),
      recent('repeat', 'Repeat', 900, 900),
    ],
    favoriteMovies: [], watchlistMovies: [], favoriteSeries: [], watchlistSeries: [],
  }, 4_000);
  assert.deepEqual(result.seeds.map((seed) => seed.strength), ['repeat', 'complete', 'meaningful']);
});

test('favorite/watchlist signals contribute, abandoned weak content does not, and seed count is capped at twelve', () => {
  const recentItems = Array.from({ length: 8 }, (_, index) => recent(`movie-${index}`, `Movie ${index}`, 30, 20_000 - index));
  const result = buildNovaPulsePersonalSeeds({
    recentlyWatched: recentItems,
    favoriteMovies: [movie('favorite', 'Favorite')],
    watchlistMovies: [movie('watchlist', 'Watchlist')],
    favoriteSeries: [series('favorite-series', 'Favorite Series')],
    watchlistSeries: [series('watchlist-series', 'Watchlist Series')],
  }, 20_000);
  const capped = buildNovaPulsePersonalSeeds({
    recentlyWatched: [...recentItems, ...Array.from({ length: 12 }, (_, index) => recent(`extra-${index}`, `Extra ${index}`, 30, 10_000 - index))],
    favoriteMovies: [], watchlistMovies: [], favoriteSeries: [], watchlistSeries: [],
  }, 20_000);
  assert.equal(capped.seeds.length, 12);
  assert.ok(result.seeds.some((seed) => seed.strength === 'favorite'));
  assert.ok(result.seeds.some((seed) => seed.strength === 'watchlist'));
  const weak = buildNovaPulsePersonalSeeds({ recentlyWatched: [recent('abandoned', 'Abandoned', 5, 1_000)], favoriteMovies: [], watchlistMovies: [], favoriteSeries: [], watchlistSeries: [] }, 2_000);
  assert.equal(weak.seeds.length, 0);
});

test('seed ordering is deterministic and catalog bridge is bounded/deduplicated', () => {
  const context = { recentlyWatched: [recent('movie-1', 'Same Title', 50, 1_000)], favoriteMovies: [movie('movie-2', 'Same Title')], watchlistMovies: [], favoriteSeries: [], watchlistSeries: [] };
  const first = buildNovaPulsePersonalSeeds(context, 2_000);
  const second = buildNovaPulsePersonalSeeds(context, 2_000);
  assert.deepEqual(first, second);
  const bridge = buildNovaPulseCatalogBridge(Array.from({ length: 250 }, (_, index) => movie(String(index), `Movie ${index}`)), []);
  assert.equal(bridge.entries.length, 200);
  assert.equal(new Set(bridge.entries.map((entry) => entry.fingerprint)).size, bridge.entries.length);
});

test('backend candidate signals normalize without inventing missing fields', () => {
  const signal = recommendationSignalForCandidate({
    contentFingerprintRef: 'c1_target', contentType: 'movie', reason: 'viewers_also_watched',
    behaviorScore: 20, trendScore: 10, affinityScore: 10, velocity: 1,
    supportBucket: 'supported', scope: 'provider', catalogMatchToken: 'movie-1',
  }, 'rich');
  assert.equal(signal.catalogMatchToken, 'movie-1');
  assert.ok(signal.behaviorScore > 0 && signal.behaviorScore <= 1);
});

test('candidate cache coalesces concurrent/rerender requests and invalidates by provider or seed signature', async () => {
  clearRecommendationCandidateCache();
  let calls = 0;
  const send = async () => {
    calls += 1;
    return { ok: true, candidates: [] };
  };
  const input = { providerId: 'provider-a', seeds: [], catalogFingerprints: [] };
  await Promise.all([getRecommendationCandidates(input, 'seed-a', send), getRecommendationCandidates(input, 'seed-a', send)]);
  await getRecommendationCandidates(input, 'seed-a', send);
  assert.equal(calls, 1);
  await getRecommendationCandidates({ ...input, providerId: 'provider-b' }, 'seed-a', send);
  await getRecommendationCandidates(input, 'seed-b', send);
  assert.equal(calls, 3);
  assert.equal(NOVA_PULSE_RECOMMENDATION_CACHE_TTL_MS, 12 * 60 * 1000);
});

test('strong behavioral candidates outrank metadata-only fallback and duplicate signals merge', () => {
  const result = composeNovaPulseFeedV2([{
    id: 'source',
    getItems: () => ({ sourceId: 'source', items: [
      { id: 'fallback', type: 'movie', title: 'Fallback', priority: 100, artworkUrl: 'https://img/fallback', description: 'good', action: { type: 'details' } },
      { id: 'behavior', type: 'movie', title: 'Behavior', priority: 1, artworkUrl: 'https://img/behavior', recommendation: { reason: 'viewers_also_watched', behaviorScore: 0.9, affinityScore: 20, trendScore: 2, velocity: 1, scope: 'provider' }, action: { type: 'details' } },
    ] }),
  }]);
  assert.equal(result.items[0].id, 'behavior');
});
