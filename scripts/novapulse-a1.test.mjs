import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { formatNovaPulseCatalogMeta } from '../src/features/novapulse/novaPulseLogic.ts';
import { enrichNovaPulsePresentation } from '../src/features/novapulse/novaPulsePresentation.ts';

const sqliteSource = fs.readFileSync(new URL('../src/features/movies/data/SqliteMovieDataSource.ts', import.meta.url), 'utf8');
const feedSource = fs.readFileSync(new URL('../src/features/novapulse/useNovaPulseFeed.ts', import.meta.url), 'utf8');

function movieSummary(overrides = {}) {
  return {
    id: 'm1', categoryId: 'movies', title: 'Movie One', genres: [], posterStyleKey: 'ember',
    posterUrl: 'https://cdn.example/poster.jpg', backdropUrl: 'https://cdn.example/backdrop.jpg',
    ...overrides,
  };
}

function seriesSummary(overrides = {}) {
  return {
    id: 's1', seriesId: 's1', categoryId: 'series', title: 'Series One', genres: [], posterStyleKey: 'orbit',
    posterUrl: 'https://cdn.example/series-poster.jpg', backdropUrl: 'https://cdn.example/series-backdrop.jpg',
    ...overrides,
  };
}

test('Movie SQLite conversion carries the existing catalog backdrop without schema changes', () => {
  assert.match(sqliteSource, /backdropUrl:\s*item\.backdropUrl/);
  assert.match(fs.readFileSync(new URL('../src/features/movies/movieTypes.ts', import.meta.url), 'utf8'), /backdropUrl\?: string/);
});

test('Movie presentation prefers backdrop and keeps poster as fallback', () => {
  const enriched = enrichNovaPulsePresentation({
    items: [{ id: 'movie-1', type: 'movie', title: 'Movie One', sourceItemId: 'm1', priority: 1, artworkUrl: 'poster', posterUrl: 'poster', backdropUrl: 'backdrop', action: { type: 'details', target: '/movies' } }],
    movies: [movieSummary()],
  });
  assert.equal(enriched.items[0].artworkUrl, 'backdrop');
  assert.equal(enriched.items[0].posterUrl, 'poster');

  const posterOnly = enrichNovaPulsePresentation({
    items: [{ id: 'movie-1', type: 'movie', title: 'Movie One', sourceItemId: 'm1', priority: 1, artworkUrl: 'poster', posterUrl: 'poster', action: { type: 'details', target: '/movies' } }],
    movies: [movieSummary({ backdropUrl: undefined })],
  });
  assert.equal(posterOnly.items[0].artworkUrl, 'poster');
});

test('local Movie description wins and cached Movie synopsis is read without a fetch', () => {
  let cacheReads = 0;
  const local = enrichNovaPulsePresentation({
    items: [{ id: 'movie-1', type: 'movie', title: 'Movie One', sourceItemId: 'm1', priority: 1, action: { type: 'details', target: '/movies' }, description: 'Local synopsis' }],
    movies: [movieSummary({ description: 'Local synopsis' })],
    getCachedMovieDetail: () => { cacheReads += 1; return { id: 'm1', mediaType: 'movie', title: 'Movie One', synopsis: 'Cached synopsis', genres: ['Drama'], cast: [], seasons: [], episodes: [] }; },
  });
  assert.equal(local.items[0].description, 'Local synopsis');
  assert.equal(cacheReads, 1);
  assert.equal(local.diagnostics.cachedMovieDetailHits, 1);

  const cached = enrichNovaPulsePresentation({
    items: [{ id: 'movie-1', type: 'movie', title: 'Movie One', sourceItemId: 'm1', priority: 1, action: { type: 'details', target: '/movies' } }],
    movies: [movieSummary({ description: undefined })],
    getCachedMovieDetail: () => ({ id: 'm1', mediaType: 'movie', title: 'Movie One', synopsis: 'Cached synopsis', genres: ['Drama'], cast: [], seasons: [], episodes: [] }),
  });
  assert.equal(cached.items[0].description, 'Cached synopsis');
  assert.equal(cached.diagnostics.movieDescriptionsCached, 1);
});

test('cached Series metadata enriches presentation without invoking TMDB matching', () => {
  const enriched = enrichNovaPulsePresentation({
    items: [{ id: 'series-1', type: 'series', title: 'Series One', sourceItemId: 's1', priority: 1, artworkUrl: 'local-poster', posterUrl: 'local-poster', action: { type: 'details', target: '/series' } }],
    series: [seriesSummary({ description: undefined })],
    cachedSeriesMetadata: new Map([['s1', { providerId: 'provider-a', seriesId: 's1', providerTitle: 'Series One', normalizedTitle: 'series one', status: 'matched', updatedAt: Date.now(), metadata: { tmdbId: 1, title: 'Series One', overview: 'Cached overview', backdropPath: 'tmdb-backdrop', posterPath: 'tmdb-poster', genres: ['Drama'], runtimeMinutes: 45, year: 2024, rating: 8.2, network: 'Nova Network' } }]]),
  });
  assert.equal(enriched.items[0].artworkUrl, 'tmdb-backdrop');
  assert.equal(enriched.items[0].description, 'Cached overview');
  assert.deepEqual(enriched.items[0].genres, ['Drama']);
  assert.equal(enriched.items[0].runtimeMinutes, 45);
  assert.equal(enriched.items[0].network, 'Nova Network');
  assert.equal(enriched.diagnostics.cachedSeriesMetadataHits, 1);
  assert.doesNotMatch(feedSource, /matchSeriesMetadata|fetchTmdbSeriesDetails/);
});

test('missing description and metadata collapse cleanly without stray separators', () => {
  const enriched = enrichNovaPulsePresentation({
    items: [{ id: 'movie-1', type: 'movie', title: 'Movie One', sourceItemId: 'm1', priority: 1, action: { type: 'details', target: '/movies' } }],
    movies: [movieSummary({ description: undefined, backdropUrl: undefined, posterUrl: undefined })],
  });
  assert.equal(enriched.items[0].description, undefined);
  assert.equal(formatNovaPulseCatalogMeta(enriched.items[0]), '');
  assert.doesNotMatch(fs.readFileSync(new URL('../src/features/novapulse/NovaPulseCard.tsx', import.meta.url), 'utf8'), /Available in your NovaCast library|Curated for you/);
});

test('presentation enrichment preserves selected IDs and carousel timing', () => {
  const items = [
    { id: 'movie-1', type: 'movie', title: 'Movie One', sourceItemId: 'm1', priority: 1, action: { type: 'details', target: '/movies' } },
    { id: 'series-1', type: 'series', title: 'Series One', sourceItemId: 's1', priority: 1, action: { type: 'details', target: '/series' } },
  ];
  const enriched = enrichNovaPulsePresentation({ items, movies: [movieSummary()], series: [seriesSummary()] });
  assert.deepEqual(enriched.items.map((item) => item.id), items.map((item) => item.id));
  assert.match(fs.readFileSync(new URL('../src/features/novapulse/useNovaPulse.ts', import.meta.url), 'utf8'), /8_000/);
  assert.match(feedSource, /cachedSeriesMetadataState\.providerId === providerId/);
});

test('NovaPulse metadata enrichment adds no provider or TMDB request path', () => {
  assert.doesNotMatch(feedSource, /getSeriesInfo|searchTmdbSeries|fetchTmdbSeriesDetails/);
  assert.match(feedSource, /getCachedProviderMovieInfo/);
  assert.match(feedSource, /getSeriesMetadataCacheEntry/);
});
