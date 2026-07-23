import assert from 'node:assert/strict';
import test from 'node:test';

import {
  curateMovieNewReleases,
  curateSeriesNewReleases,
  MOVIE_NEW_RELEASES_LIMIT,
  SERIES_NEW_RELEASES_LIMIT,
  SMART_CATEGORY_KEY_NEW_RELEASES,
} from '../src/features/media-browser/newReleasesCuration.ts';
import {
  normalizeMovieReleaseTimestamp,
  normalizeProviderAddedTimestamp,
  normalizeSortableTimestamp,
} from '../src/features/media-browser/newReleasesDate.ts';
import { querySmartCategoryOnIndex, resolveSmartCategoryDefinition } from '../src/features/movies/smart/smartCategoryDefinitions.ts';
import { getMovieCatalogIndex, resetMovieCatalogIndex } from '../src/features/movies/smart/movieCatalogIndex.ts';
import {
  querySmartSeriesCategoryOnIndex,
  resolveSmartSeriesCategoryDefinition,
} from '../src/features/series/smart/smartSeriesCategoryDefinitions.ts';
import { getSeriesCatalogIndex, resetSeriesCatalogIndex } from '../src/features/series/smart/seriesCatalogIndex.ts';
import { createXtreamProviderRepositories } from '../src/features/providers/providerRepositories.ts';

const currentYear = new Date().getFullYear();

function movieEntry(overrides = {}) {
  return {
    id: overrides.id ?? 'movie-1',
    title: overrides.title ?? 'Movie',
    categoryId: '1',
    rating: overrides.rating ?? 6,
    added: overrides.added ?? 0,
    releaseDate: overrides.releaseDate,
    year: overrides.year,
    popularity: overrides.popularity,
    posterStyleKey: 'ember',
    genreTags: ['action'],
  };
}

function seriesEntry(overrides = {}) {
  return {
    id: overrides.id ?? 'series-1',
    seriesId: overrides.seriesId ?? 'series-1',
    title: overrides.title ?? 'Series',
    categoryId: '1',
    rating: overrides.rating ?? 6,
    addedAt: overrides.addedAt,
    releaseDate: overrides.releaseDate,
    latestEpisodeDate: overrides.latestEpisodeDate,
    popularity: overrides.popularity,
    year: overrides.year,
    posterStyleKey: 'signal',
    genreTags: ['drama'],
  };
}

test('date normalization handles seconds, milliseconds, ISO, and YYYY-MM-DD', () => {
  assert.equal(normalizeSortableTimestamp(1_700_000_000), 1_700_000_000_000);
  assert.equal(normalizeSortableTimestamp(1_700_000_000_000), 1_700_000_000_000);
  assert.equal(normalizeSortableTimestamp('2024-06-15'), Date.parse('2024-06-15'));
  assert.equal(normalizeSortableTimestamp('2024'), Date.UTC(2024, 0, 1));
  assert.equal(normalizeSortableTimestamp(''), null);
  assert.equal(normalizeSortableTimestamp('0'), null);
  assert.equal(normalizeSortableTimestamp(undefined), null);
});

test('invalid dates do not throw and normalize to null', () => {
  assert.doesNotThrow(() => normalizeSortableTimestamp('not-a-date'));
  assert.equal(normalizeSortableTimestamp('not-a-date'), null);
  assert.equal(normalizeSortableTimestamp('0000-00-00'), null);
});

test('series new releases returns no more than 50 diversified results', () => {
  const entries = Array.from({ length: 120 }, (_, index) =>
    seriesEntry({
      id: `series-${index + 1}`,
      seriesId: `series-${index + 1}`,
      title: `Series ${index + 1}`,
      latestEpisodeDate: `2025-${String((index % 12) + 1).padStart(2, '0')}-01`,
      addedAt: 1_700_000_000_000 + index,
    }),
  );

  const curated = curateSeriesNewReleases(entries);
  assert.ok(curated.length <= SERIES_NEW_RELEASES_LIMIT);
  assert.equal(new Set(curated.map((entry) => entry.seriesId)).size, curated.length);
});

test('series new releases keeps only the newest episode per series', () => {
  const curated = curateSeriesNewReleases([
    seriesEntry({ id: 'ep-1', seriesId: 'show-a', title: 'Show A', latestEpisodeDate: '2024-01-01' }),
    seriesEntry({ id: 'ep-2', seriesId: 'show-a', title: 'Show A', latestEpisodeDate: '2025-08-01' }),
    seriesEntry({ id: 'ep-3', seriesId: 'show-a', title: 'Show A', latestEpisodeDate: '2025-03-01' }),
    seriesEntry({ id: 'ep-4', seriesId: 'show-b', title: 'Show B', latestEpisodeDate: '2025-07-01' }),
  ]);

  assert.equal(curated.length, 2);
  assert.equal(curated.find((entry) => entry.seriesId === 'show-a')?.id, 'ep-2');
});

test('series new releases sorts by episode release date descending', () => {
  const curated = curateSeriesNewReleases([
    seriesEntry({ id: '1', seriesId: 's1', latestEpisodeDate: '2024-01-01' }),
    seriesEntry({ id: '2', seriesId: 's2', latestEpisodeDate: '2025-12-01' }),
    seriesEntry({ id: '3', seriesId: 's3', latestEpisodeDate: '2025-06-01' }),
  ]);

  assert.deepEqual(curated.map((entry) => entry.id), ['2', '3', '1']);
});

test('series new releases uses provider-added date when episode date is missing', () => {
  const now = Date.now();
  const curated = curateSeriesNewReleases([
    seriesEntry({ id: 'old', seriesId: 'old-series', addedAt: now - 86_400_000 }),
    seriesEntry({ id: 'new', seriesId: 'new-series', addedAt: now - 3_600_000 }),
  ]);

  assert.equal(curated[0]?.id, 'new');
});

test('series new releases fills remaining slots with recently added undated series', () => {
  const dated = Array.from({ length: 40 }, (_, index) =>
    seriesEntry({
      id: `dated-${index}`,
      seriesId: `dated-${index}`,
      latestEpisodeDate: `2025-01-${String((index % 28) + 1).padStart(2, '0')}`,
    }),
  );
  const undated = Array.from({ length: 20 }, (_, index) =>
    seriesEntry({
      id: `added-${index}`,
      seriesId: `added-${index}`,
      addedAt: 1_800_000_000_000 + index,
    }),
  );

  const curated = curateSeriesNewReleases([...dated, ...undated]);
  assert.equal(curated.length, SERIES_NEW_RELEASES_LIMIT);
  assert.ok(curated.some((entry) => entry.id.startsWith('added-')));
});

test('series fallback rows do not duplicate series already represented', () => {
  const curated = curateSeriesNewReleases([
    seriesEntry({ id: 'ep-1', seriesId: 'show-a', latestEpisodeDate: '2025-01-01' }),
    seriesEntry({ id: 'ep-dup', seriesId: 'show-a', addedAt: 1_900_000_000_000 }),
    seriesEntry({ id: 'fallback', seriesId: 'show-b', addedAt: 1_850_000_000_000 }),
  ]);

  assert.equal(curated.filter((entry) => entry.seriesId === 'show-a').length, 1);
  assert.ok(curated.some((entry) => entry.seriesId === 'show-b'));
});

test('series popularity breaks close ties without overriding clearly newer content', () => {
  const curated = curateSeriesNewReleases([
    seriesEntry({
      id: 'older-popular',
      seriesId: 'older-popular',
      latestEpisodeDate: '2025-01-01',
      popularity: 999,
    }),
    seriesEntry({
      id: 'newer-less-popular',
      seriesId: 'newer-less-popular',
      latestEpisodeDate: '2025-12-01',
      popularity: 1,
    }),
    seriesEntry({
      id: 'tie-a',
      seriesId: 'tie-a',
      latestEpisodeDate: '2025-06-01',
      popularity: 10,
    }),
    seriesEntry({
      id: 'tie-b',
      seriesId: 'tie-b',
      latestEpisodeDate: '2025-06-01',
      popularity: 50,
    }),
  ]);

  assert.equal(curated[0]?.id, 'newer-less-popular');
  assert.ok(curated.findIndex((entry) => entry.id === 'tie-b') < curated.findIndex((entry) => entry.id === 'tie-a'));
});

test('series grouping falls back to normalized title when ids are missing', () => {
  const curated = curateSeriesNewReleases([
    seriesEntry({ id: '', seriesId: '', title: 'Unique Show', latestEpisodeDate: '2024-01-01' }),
    seriesEntry({ id: '', seriesId: '', title: 'Unique Show', latestEpisodeDate: '2025-01-01' }),
    seriesEntry({ id: '', seriesId: '', title: 'Another Show', latestEpisodeDate: '2025-02-01' }),
  ]);

  assert.equal(curated.length, 2);
  assert.equal(curated.find((entry) => entry.title === 'Unique Show')?.latestEpisodeDate, '2025-01-01');
});

test('movie new releases returns no more than 50 titles', () => {
  const entries = Array.from({ length: 200 }, (_, index) =>
    movieEntry({
      id: `movie-${index}`,
      releaseDate: `${currentYear - (index % 5)}-01-01`,
      added: 1_700_000_000_000 + index,
    }),
  );

  const curated = curateMovieNewReleases(entries);
  assert.ok(curated.length <= MOVIE_NEW_RELEASES_LIMIT);
});

test('movie new releases sorts by valid release date descending', () => {
  const curated = curateMovieNewReleases([
    movieEntry({ id: '1', releaseDate: '2020-01-01' }),
    movieEntry({ id: '2', releaseDate: `${currentYear}-05-01` }),
    movieEntry({ id: '3', releaseDate: '2024-12-01' }),
  ]);

  assert.deepEqual(curated.map((entry) => entry.id), ['2', '3', '1']);
});

test('movie new releases uses provider-added date as fallback', () => {
  const now = Date.now();
  const curated = curateMovieNewReleases([
    movieEntry({ id: 'dated', releaseDate: '2024-01-01' }),
    movieEntry({ id: 'added-only', added: now - 3_600_000 }),
    movieEntry({ id: 'older-added', added: now - 86_400_000 }),
  ]);

  assert.equal(curated[0]?.id, 'dated');
  assert.equal(curated[1]?.id, 'added-only');
});

test('movie new releases rejects clearly impossible years', () => {
  assert.equal(normalizeMovieReleaseTimestamp('1800'), null);
  assert.equal(normalizeMovieReleaseTimestamp(`${currentYear + 20}-01-01`), null);
});

test('movie new releases still returns results when release dates are mostly missing', () => {
  const entries = Array.from({ length: 80 }, (_, index) =>
    movieEntry({
      id: `added-${index}`,
      added: 1_700_000_000_000 + index,
    }),
  );

  const curated = curateMovieNewReleases(entries);
  assert.equal(curated.length, MOVIE_NEW_RELEASES_LIMIT);
});

test('equal movie dates produce deterministic ordering', () => {
  const first = curateMovieNewReleases([
    movieEntry({ id: 'b', title: 'Bravo', releaseDate: '2024-01-01' }),
    movieEntry({ id: 'a', title: 'Alpha', releaseDate: '2024-01-01' }),
  ]);
  const second = curateMovieNewReleases([
    movieEntry({ id: 'b', title: 'Bravo', releaseDate: '2024-01-01' }),
    movieEntry({ id: 'a', title: 'Alpha', releaseDate: '2024-01-01' }),
  ]);

  assert.deepEqual(
    first.map((entry) => entry.id),
    second.map((entry) => entry.id),
  );
});

test('curation does not mutate the original input arrays', () => {
  const movies = [
    movieEntry({ id: '1', releaseDate: '2024-01-01' }),
    movieEntry({ id: '2', releaseDate: '2025-01-01' }),
  ];
  const series = [
    seriesEntry({ id: '1', seriesId: 's1', latestEpisodeDate: '2024-01-01' }),
    seriesEntry({ id: '2', seriesId: 's2', latestEpisodeDate: '2025-01-01' }),
  ];
  const moviesBefore = movies.map((entry) => ({ ...entry }));
  const seriesBefore = series.map((entry) => ({ ...entry }));

  curateMovieNewReleases(movies);
  curateSeriesNewReleases(series);

  assert.deepEqual(movies, moviesBefore);
  assert.deepEqual(series, seriesBefore);
});

test('smart new releases category key resolves through stable internal key', () => {
  assert.equal(resolveSmartCategoryDefinition('smart:new-releases')?.key, SMART_CATEGORY_KEY_NEW_RELEASES);
  assert.equal(resolveSmartSeriesCategoryDefinition('new-releases')?.key, SMART_CATEGORY_KEY_NEW_RELEASES);
});

test('discover smart new releases query caps at 50 while provider categories paginate beyond 50', async () => {
  resetMovieCatalogIndex('new-releases-provider');
  const index = getMovieCatalogIndex('new-releases-provider');
  index.beginSync();
  index.ingest(
    Array.from({ length: 300 }, (_, offset) => ({
      id: `movie-${offset}`,
      title: `Movie ${offset}`,
      categoryId: '1',
      releaseDate: `${currentYear}-01-01`,
      addedAt: 1_700_000_000_000 + offset,
      genres: ['Movies'],
      posterStyleKey: 'ember',
    })),
  );

  const definition = resolveSmartCategoryDefinition('smart:new-releases');
  assert.ok(definition);
  const smartPage = querySmartCategoryOnIndex(index, definition, {
    providerId: 'new-releases-provider',
    favorites: new Set(),
    watchlist: new Set(),
    continueWatching: [],
    recentlyWatched: [],
    lastWatchedGenres: [],
  }, 0, 100);

  assert.equal(smartPage.totalCount, MOVIE_NEW_RELEASES_LIMIT);
  assert.equal(smartPage.filtered.length, MOVIE_NEW_RELEASES_LIMIT);

  const streams = Array.from({ length: 300 }, (_, offset) => ({
    stream_id: String(offset + 1),
    name: `Provider Movie ${offset + 1}`,
    category_id: '1',
    releasedate: `${currentYear}-01-01`,
    added: String(1_700_000_000 + offset),
  }));

  const repositories = createXtreamProviderRepositories({
    async getVodCategories() {
      return [{ category_id: '1', category_name: 'All Movies' }];
    },
    async getVodStreams() {
      return streams;
    },
    async getSeriesCategories() {
      return [];
    },
    async getSeries() {
      return [];
    },
  });

  const providerPage = await repositories.movies.getMoviesPage({ categoryId: '1', offset: 50, limit: 50, sort: 'newest' });
  assert.equal(providerPage.items.length, 50);
  assert.ok(providerPage.totalCount > MOVIE_NEW_RELEASES_LIMIT);
  assert.equal(providerPage.hasMore, true);
});

test('discover category remains unchanged and series smart new releases index query caps at 50', () => {
  resetSeriesCatalogIndex('series-new-releases-provider');
  const index = getSeriesCatalogIndex('series-new-releases-provider');
  index.beginSync();
  index.ingest(
    Array.from({ length: 300 }, (_, offset) => ({
      id: `series-${offset}`,
      seriesId: `series-${offset}`,
      title: `Series ${offset}`,
      categoryId: '1',
      latestEpisodeDate: '2025-06-01',
      addedAt: 1_700_000_000_000 + offset,
      genres: ['Series'],
      posterStyleKey: 'signal',
    })),
  );

  const discover = resolveSmartSeriesCategoryDefinition('discover');
  assert.ok(discover);
  const discoverPage = querySmartSeriesCategoryOnIndex(index, discover, {
    providerId: 'series-new-releases-provider',
    favorites: new Set(),
    watchlist: new Set(),
    continueWatching: [],
    recentlyWatched: [],
  }, 0, 100);
  assert.equal(discoverPage.totalCount, 50);

  const newReleases = resolveSmartSeriesCategoryDefinition('new-releases');
  assert.ok(newReleases);
  const newReleasesPage = querySmartSeriesCategoryOnIndex(index, newReleases, {
    providerId: 'series-new-releases-provider',
    favorites: new Set(),
    watchlist: new Set(),
    continueWatching: [],
    recentlyWatched: [],
  }, 0, 100);
  assert.equal(newReleasesPage.totalCount, SERIES_NEW_RELEASES_LIMIT);
});

test('invalid series dates stay behind valid recent dates', () => {
  const curated = curateSeriesNewReleases([
    seriesEntry({ id: 'invalid', seriesId: 'invalid', latestEpisodeDate: '0000-00-00', addedAt: 1_900_000_000_000 }),
    seriesEntry({ id: 'valid', seriesId: 'valid', latestEpisodeDate: '2024-05-01' }),
  ]);

  assert.equal(curated[0]?.id, 'valid');
});

test('provider added timestamps normalize safely', () => {
  assert.equal(normalizeProviderAddedTimestamp('1700000000'), 1_700_000_000_000);
  assert.equal(normalizeProviderAddedTimestamp('not-a-number'), null);
});
