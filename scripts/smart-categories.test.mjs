import assert from 'node:assert/strict';
import test from 'node:test';

import { MockMovieDataSource } from '../src/features/movies/data/MockMovieDataSource.ts';
import { resetMovieCatalogIndex } from '../src/features/movies/smart/movieCatalogIndex.ts';
import {
  inferGenreTags,
  parseAddedTimestamp,
  parseRatingNumber,
  parseYearFromTitle,
} from '../src/features/movies/smart/movieMetadata.ts';
import { createSmartMovieDataSource } from '../src/features/movies/smart/SmartMovieDataSource.ts';
import { countSmartCategory, resolveSmartCategoryDefinition } from '../src/features/movies/smart/smartCategoryDefinitions.ts';
import { clearMoviesSettingsCacheForTests } from '../src/features/movies/smart/moviesSettingsStore.ts';
import { createXtreamProviderRepositories } from '../src/features/providers/providerRepositories.ts';

test('movie metadata helpers parse title year, ratings, and genre tags', () => {
  assert.equal(parseYearFromTitle('Inception (2010)'), 2010);
  assert.equal(parseYearFromTitle('Blade Runner 2049'), 2049);
  assert.equal(parseRatingNumber('8.4'), 8.4);
  assert.equal(parseAddedTimestamp('1700000000'), 1700000000000);
  assert.equal(inferGenreTags('Avengers Endgame', ['Action']).includes('superhero'), true);
  assert.equal(inferGenreTags('Christmas With The Kranks', []).includes('christmas'), true);
});

test('Xtream mapVodStream enriches summaries with year, addedAt, and genre tags', async () => {
  const client = {
    baseUrl: 'https://example.com',
    async getVodCategories() {
      return [{ category_id: '1', category_name: 'Action' }];
    },
    async getVodStreams() {
      return [
        {
          stream_id: '101',
          name: 'Batman: The Dark Knight (2008)',
          category_id: '1',
          rating: '9.0',
          added: '1700000000',
        },
      ];
    },
  };

  const repositories = createXtreamProviderRepositories(client);
  const movies = await repositories.movies.listCategoryMovies('1');

  assert.equal(movies[0]?.year, 2008);
  assert.equal(movies[0]?.addedAt, 1700000000000);
  assert.equal(movies[0]?.genres.includes('superhero'), true);
});

test('Xtream mapVodStream strips provider title prefixes', async () => {
  const client = {
    baseUrl: 'https://example.com',
    async getVodCategories() {
      return [{ category_id: '1', category_name: 'Action' }];
    },
    async getVodStreams() {
      return [
        {
          stream_id: '202',
          name: 'nl | UFC 329: Toy Story',
          category_id: '1',
        },
      ];
    },
  };

  const repositories = createXtreamProviderRepositories(client);
  const movies = await repositories.movies.listCategoryMovies('1');

  assert.equal(movies[0]?.title, 'Toy Story');
});

test('Smart movie data source prepends Discover rows and keeps provider categories intact', async () => {
  clearMoviesSettingsCacheForTests();
  resetMovieCatalogIndex('demo-provider');

  const base = new MockMovieDataSource('demo-provider');
  const smart = createSmartMovieDataSource(base, 'demo-provider');
  const categories = await smart.getCategories();

  const discoverIndex = categories.findIndex((category) => category.id === 'section:discover');
  const providerIndex = categories.findIndex((category) => category.id === 'section:provider');
  const firstProvider = categories.find((category) => category.kind === 'provider');

  assert.ok(discoverIndex >= 0);
  assert.ok(providerIndex > discoverIndex);
  assert.ok(categories.some((category) => category.kind === 'smart'));
  assert.equal(firstProvider?.name, 'Action');
  assert.ok(categories.some((category) => category.kind === 'provider' && category.name === 'All Movies'));
  assert.equal(categories.filter((category) => category.kind === 'provider').length, 16);
});

test('Smart categories query ingested catalog entries without warmCatalogIndex', async () => {
  clearMoviesSettingsCacheForTests();
  resetMovieCatalogIndex('demo-provider');

  const base = new MockMovieDataSource('demo-provider');
  const smart = createSmartMovieDataSource(base, 'demo-provider');
  const providerIds = (await base.getCategories()).map((category) => category.id);
  const index = (await import('../src/features/movies/smart/movieCatalogIndex.ts')).getMovieCatalogIndex('demo-provider');

  for (const categoryId of providerIds) {
    index.ingest(await base.listCategoryMovies(categoryId));
  }

  const page = await smart.getMoviesPage({
    categoryId: 'smart:new-releases',
    offset: 0,
    limit: 10,
  });

  assert.ok(page.items.length > 0);

  const definition = resolveSmartCategoryDefinition('smart:new-releases');
  assert.ok(definition);
});

test('countSmartCategory for new releases returns curated total capped at 50', () => {
  const definition = resolveSmartCategoryDefinition('smart:new-releases');
  assert.ok(definition);

  const entries = Array.from({ length: 120 }, (_, index) => ({
    id: String(index + 1),
    title: `Film ${index + 1}`,
    categoryId: '1',
    rating: 8,
    added: 1_700_000_000_000 + index,
    releaseDate: '2024-01-01',
    posterStyleKey: 'ember',
    genreTags: ['action'],
  }));

  assert.equal(countSmartCategory(entries, definition, {
    providerId: 'demo',
    favorites: new Set(),
    watchlist: new Set(),
    continueWatching: [],
    recentlyWatched: [],
    lastWatchedGenres: [],
  }), 50);
});
