import assert from 'node:assert/strict';
import test from 'node:test';

import { enrichNovaPulsePresentation } from '../src/features/novapulse/novaPulsePresentation.ts';
import {
  NOVA_PULSE_MOVIE_CONCURRENCY,
  NOVA_PULSE_MOVIE_ENRICHMENT_BUDGET,
  NOVA_PULSE_SERIES_CONCURRENCY,
  NOVA_PULSE_SERIES_ENRICHMENT_BUDGET,
  needsNovaPulseMovieEnrichment,
  resetNovaPulseEnrichmentForTests,
  runNovaPulseEnrichmentCycle,
} from '../src/features/novapulse/novaPulseEnrichment.ts';

function movieItem(id, overrides = {}) {
  return { id: `movie-${id}`, type: 'movie', title: `Movie ${id}`, sourceItemId: id, priority: 1, action: { type: 'details', target: '/movies' }, ...overrides };
}

function seriesItem(id, overrides = {}) {
  return { id: `series-${id}`, type: 'series', title: `Series ${id}`, sourceItemId: id, priority: 1, action: { type: 'details', target: '/series' }, ...overrides };
}

function movieDetail(id, overrides = {}) {
  return { id, mediaType: 'movie', title: `Movie ${id}`, genres: ['Drama'], cast: [], seasons: [], episodes: [], synopsis: `Synopsis ${id}`, backdropUrl: `backdrop-${id}`, runtime: '100m', ...overrides };
}

function seriesEntry(providerId, seriesId, status = 'matched') {
  return { providerId, seriesId, providerTitle: `Series ${seriesId}`, normalizedTitle: `series ${seriesId}`, status, updatedAt: Date.now(), metadata: status === 'matched' ? { tmdbId: Number(seriesId.replace(/\D/g, '')) || 1, title: `Series ${seriesId}`, overview: `Overview ${seriesId}`, backdropPath: `tmdb-${seriesId}`, genres: ['Drama'], runtimeMinutes: 45 } : undefined };
}

test('only selected weak cards are eligible and rich cards are skipped', async () => {
  resetNovaPulseEnrichmentForTests();
  const rich = movieItem('rich', { description: 'Real description', backdropUrl: 'backdrop' });
  assert.equal(needsNovaPulseMovieEnrichment(rich), false);
  let requests = 0;
  const result = await runNovaPulseEnrichmentCycle({
    providerId: 'p1',
    items: [rich],
    fetchMovieDetail: async () => { requests += 1; return movieDetail('rich'); },
  });
  assert.equal(requests, 0);
  assert.equal(result.diagnostics.movieEligible, 0);
});

test('Movie budget is four and concurrency is two', async () => {
  resetNovaPulseEnrichmentForTests();
  let requests = 0;
  let active = 0;
  let maxActive = 0;
  const result = await runNovaPulseEnrichmentCycle({
    providerId: 'p2',
    items: Array.from({ length: 8 }, (_, index) => movieItem(String(index))),
    fetchMovieDetail: async (id) => {
      requests += 1;
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active -= 1;
      return movieDetail(id);
    },
  });
  assert.equal(NOVA_PULSE_MOVIE_ENRICHMENT_BUDGET, 4);
  assert.equal(NOVA_PULSE_MOVIE_CONCURRENCY, 2);
  assert.equal(requests, 4);
  assert.equal(maxActive, 2);
  assert.equal(result.diagnostics.movieSkippedBudget, 4);
});

test('Series budget is two and concurrency is one', async () => {
  resetNovaPulseEnrichmentForTests();
  let requests = 0;
  let active = 0;
  let maxActive = 0;
  const result = await runNovaPulseEnrichmentCycle({
    providerId: 'p3',
    items: Array.from({ length: 5 }, (_, index) => seriesItem(String(index))),
    readSeriesCache: async () => null,
    matchSeries: async ({ providerId, seriesId }) => {
      requests += 1;
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active -= 1;
      return { cacheEntry: seriesEntry(providerId, seriesId) };
    },
  });
  assert.equal(NOVA_PULSE_SERIES_ENRICHMENT_BUDGET, 2);
  assert.equal(NOVA_PULSE_SERIES_CONCURRENCY, 1);
  assert.equal(requests, 2);
  assert.equal(maxActive, 1);
  assert.equal(result.diagnostics.seriesSkippedBudget, 3);
});

test('same item is single-flight and repeated stable feed uses the cache', async () => {
  resetNovaPulseEnrichmentForTests();
  let requests = 0;
  const fetchMovieDetail = async (id) => {
    requests += 1;
    await new Promise((resolve) => setTimeout(resolve, 3));
    return movieDetail(id);
  };
  const first = runNovaPulseEnrichmentCycle({ providerId: 'p4', items: [movieItem('same')], fetchMovieDetail });
  const second = runNovaPulseEnrichmentCycle({ providerId: 'p4', items: [movieItem('same')], fetchMovieDetail });
  await Promise.all([first, second]);
  const repeated = await runNovaPulseEnrichmentCycle({ providerId: 'p4', items: [movieItem('same')], fetchMovieDetail });
  assert.equal(requests, 1);
  assert.equal(repeated.diagnostics.movieCacheHits, 1);
});

test('failure is silent and does not poison the current presentation', async () => {
  resetNovaPulseEnrichmentForTests();
  const result = await runNovaPulseEnrichmentCycle({
    providerId: 'p5',
    items: [movieItem('offline', { description: 'Local description', backdropUrl: 'local-backdrop' })],
    fetchMovieDetail: async () => { throw new Error('offline'); },
  });
  assert.equal(result.diagnostics.movieFailed, 0);
  const presentation = enrichNovaPulsePresentation({
    items: [movieItem('offline', { description: 'Local description', backdropUrl: 'local-backdrop' })],
    movies: [{ id: 'offline', title: 'Movie offline', genres: [], posterStyleKey: 'ember', description: 'Local description', backdropUrl: 'local-backdrop' }],
    movieEnrichments: result.movies,
  });
  assert.equal(presentation.items[0].description, 'Local description');
  assert.equal(presentation.items[0].artworkUrl, 'local-backdrop');
});

test('enriched Movie and Series metadata merge into presentation without changing IDs', () => {
  const movie = movieItem('m1');
  const series = seriesItem('s1');
  const presentation = enrichNovaPulsePresentation({
    items: [movie, series],
    movies: [{ id: 'm1', title: 'Movie m1', genres: [], posterStyleKey: 'ember' }],
    series: [{ id: 's1', seriesId: 's1', title: 'Series s1', genres: [], posterStyleKey: 'orbit' }],
    movieEnrichments: new Map([['m1', { providerId: 'p6', movieId: 'm1', status: 'matched', updatedAt: Date.now(), synopsis: 'Enriched synopsis', backdropUrl: 'enriched-backdrop', genres: ['Drama'], runtime: '90m', year: '2024' }]]),
    cachedSeriesMetadata: new Map([['s1', seriesEntry('p6', 's1')]]),
  });
  assert.deepEqual(presentation.items.map((item) => item.id), [movie.id, series.id]);
  assert.equal(presentation.items[0].description, 'Enriched synopsis');
  assert.equal(presentation.items[0].artworkUrl, 'enriched-backdrop');
  assert.equal(presentation.items[1].description, 'Overview s1');
  assert.equal(presentation.items[1].artworkUrl, 'tmdb-s1');
});

test('coordinator source is selected-feed-only and does not add recommendation requests', async () => {
  resetNovaPulseEnrichmentForTests();
  let requests = 0;
  await runNovaPulseEnrichmentCycle({ providerId: 'p7', items: [movieItem('selected')], fetchMovieDetail: async (id) => { requests += 1; return movieDetail(id); } });
  assert.equal(requests, 1);
});

test('provider switch ignores a stale enrichment result', async () => {
  resetNovaPulseEnrichmentForTests();
  let current = true;
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const cycle = runNovaPulseEnrichmentCycle({
    providerId: 'old-provider',
    items: [movieItem('stale')],
    fetchMovieDetail: async () => { await pending; return movieDetail('stale'); },
    isCurrent: () => current,
  });
  current = false;
  release();
  const result = await cycle;
  assert.equal(result.movies.size, 0);
  assert.equal(result.diagnostics.staleProviderResultsIgnored, 1);
});
