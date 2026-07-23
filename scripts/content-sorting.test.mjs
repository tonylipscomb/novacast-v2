import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildContentSortPageMetadata,
  categoryHasValidRatings,
  compareContentItems,
  DEFAULT_CONTENT_SORT,
  getVisibleSortOptions,
  normalizeReleaseDate,
  normalizeTitleForSort,
  paginateSortedItems,
  sortContentItems,
} from '../src/features/media-browser/contentSorting.ts';
import { buildContentSortRequestKey } from '../src/features/media-browser/contentSortRequest.ts';
import {
  isValidRating,
  normalizeRating,
  parseProviderRating,
} from '../src/features/media-browser/ratingNormalization.ts';
import {
  clearContentSortSessionForTests,
  getMovieSortOption,
  getSeriesSortOption,
  hydrateContentSortSessionFromSettings,
  setMovieSortOptionSession,
  setSeriesSortOptionSession,
} from '../src/features/media-browser/contentSortSessionStore.ts';
import { clearMoviesSettingsCacheForTests, getMoviesSettings } from '../src/features/movies/smart/moviesSettingsStore.ts';
import { createXtreamProviderRepositories } from '../src/features/providers/providerRepositories.ts';
import { createProviderSeriesDataSource } from '../src/features/series/data/ProviderSeriesDataSource.ts';

const LARGE_CATEGORY_SIZE = 12_500;
const MARKER_INDEX = 10_500;

function buildLargeMovieCategory() {
  return Array.from({ length: LARGE_CATEGORY_SIZE }, (_, index) => {
    const id = String(index + 1);
    const isMarker = index === MARKER_INDEX;
    return {
      stream_id: id,
      name: isMarker
        ? 'AAA Absolute First'
        : index === 0
          ? 'Movie Zero Oldest'
          : index === LARGE_CATEGORY_SIZE - 1
              ? 'ZZZ Last Alpha'
              : `Movie ${id.padStart(5, '0')}`,
      category_id: '1',
      releasedate: isMarker ? '2025-12-31' : index === 0 ? '1901-01-01' : `20${String(20 + (index % 5)).padStart(2, '0')}-06-15`,
      added: String(isMarker ? 1_700_000_000 + index + 50_000 : 1_700_000_000 + index),
      rating: isMarker ? '9.9' : index === 200 ? '3.0' : '6.0',
    };
  });
}

function makeLargeCategoryRepositories(streams) {
  return createXtreamProviderRepositories({
    async getVodCategories() {
      return [{ category_id: '1', category_name: 'Large', stream_count: streams.length }];
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
}

test('movies and series default to newest in session store', () => {
  clearContentSortSessionForTests();
  assert.equal(getMovieSortOption(), DEFAULT_CONTENT_SORT);
  assert.equal(getSeriesSortOption(), DEFAULT_CONTENT_SORT);
});

test('movies and series retain separate session sorts', () => {
  clearContentSortSessionForTests();
  setMovieSortOptionSession('title-asc');
  setSeriesSortOptionSession('title-desc');
  assert.equal(getMovieSortOption(), 'title-asc');
  assert.equal(getSeriesSortOption(), 'title-desc');
});

test('legacy persisted sort keys do not restore session sort', async () => {
  clearContentSortSessionForTests();
  clearMoviesSettingsCacheForTests();
  hydrateContentSortSessionFromSettings({ movieSortOption: 'title-desc', seriesSortOption: 'oldest' });
  assert.equal(getMovieSortOption(), 'title-desc');
  clearContentSortSessionForTests();
  const settings = await getMoviesSettings();
  assert.equal(settings.movieSortOption, DEFAULT_CONTENT_SORT);
  assert.equal(settings.seriesSortOption, DEFAULT_CONTENT_SORT);
});

test('large category newest surfaces marker beyond index 10000', async () => {
  const streams = buildLargeMovieCategory();
  const repositories = makeLargeCategoryRepositories(streams);
  const page = await repositories.movies.getMoviesPage({ categoryId: '1', offset: 0, limit: 30, sort: 'newest' });

  assert.equal(page.totalCount, LARGE_CATEGORY_SIZE);
  assert.equal(page.itemsConsideredForSort, LARGE_CATEGORY_SIZE);
  assert.equal(page.sortComplete, true);
  assert.equal(page.items[0]?.id, String(MARKER_INDEX + 1));
});

test('large category oldest surfaces oldest marker on page one', async () => {
  const streams = buildLargeMovieCategory();
  const repositories = makeLargeCategoryRepositories(streams);
  const page = await repositories.movies.getMoviesPage({ categoryId: '1', offset: 0, limit: 30, sort: 'oldest' });
  assert.equal(page.items[0]?.id, '1');
  assert.equal(page.sortComplete, true);
});

test('large category A-Z surfaces first alpha marker beyond filler titles', async () => {
  const streams = buildLargeMovieCategory();
  const repositories = makeLargeCategoryRepositories(streams);
  const page = await repositories.movies.getMoviesPage({ categoryId: '1', offset: 0, limit: 5, sort: 'title-asc' });
  assert.equal(page.items[0]?.id, String(MARKER_INDEX + 1));
});

test('large category Z-A surfaces last alpha title on page one', async () => {
  const streams = buildLargeMovieCategory();
  const repositories = makeLargeCategoryRepositories(streams);
  const page = await repositories.movies.getMoviesPage({ categoryId: '1', offset: 0, limit: 5, sort: 'title-desc' });
  assert.equal(page.items[0]?.id, String(LARGE_CATEGORY_SIZE));
});

test('large category rating surfaces highest rating marker on page one', async () => {
  const streams = buildLargeMovieCategory();
  const repositories = makeLargeCategoryRepositories(streams);
  const page = await repositories.movies.getMoviesPage({ categoryId: '1', offset: 0, limit: 5, sort: 'rating-desc' });
  assert.equal(page.items[0]?.id, String(MARKER_INDEX + 1));
  assert.equal(page.hasValidRatings, true);
});

test('large category recently added uses added timestamp not release date', async () => {
  const streams = buildLargeMovieCategory();
  const repositories = makeLargeCategoryRepositories(streams);
  const page = await repositories.movies.getMoviesPage({ categoryId: '1', offset: 0, limit: 5, sort: 'recently-added' });
  assert.equal(page.items[0]?.id, String(MARKER_INDEX + 1));
});

test('category count matches items considered for sorting', async () => {
  const streams = buildLargeMovieCategory();
  const repositories = makeLargeCategoryRepositories(streams);
  const count = await repositories.movies.getCategoryCount('1');
  const page = await repositories.movies.getMoviesPage({ categoryId: '1', offset: 0, limit: 10, sort: 'newest' });
  assert.equal(count, LARGE_CATEGORY_SIZE);
  assert.equal(page.knownCategoryTotal, LARGE_CATEGORY_SIZE);
  assert.equal(page.itemsConsideredForSort, LARGE_CATEGORY_SIZE);
});

test('page two continues global ordering without duplicates', async () => {
  const streams = buildLargeMovieCategory();
  const repositories = makeLargeCategoryRepositories(streams);
  const pageOne = await repositories.movies.getMoviesPage({ categoryId: '1', offset: 0, limit: 30, sort: 'title-asc' });
  const pageTwo = await repositories.movies.getMoviesPage({ categoryId: '1', offset: 30, limit: 30, sort: 'title-asc' });
  const ids = [...pageOne.items, ...pageTwo.items].map((item) => item.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(pageOne.hasMore);
});

test('pagination does not stop at 10000 for oversized categories', async () => {
  const streams = buildLargeMovieCategory();
  const repositories = makeLargeCategoryRepositories(streams);
  const page = await repositories.movies.getMoviesPage({
    categoryId: '1',
    offset: 10_000,
    limit: 100,
    sort: 'title-asc',
  });
  assert.equal(page.items.length, 100);
  assert.equal(page.totalCount, LARGE_CATEGORY_SIZE);
  assert.equal(page.hasMore, true);
});

test('rating scale normalization handles common provider formats', () => {
  assert.deepEqual(parseProviderRating('8.5/10'), { value: 8.5, sourceScale: '0-10' });
  assert.deepEqual(parseProviderRating('4/5'), { value: 8, sourceScale: '0-5' });
  assert.deepEqual(parseProviderRating('85%'), { value: 8.5, sourceScale: 'percent' });
  assert.deepEqual(parseProviderRating('85'), { value: 8.5, sourceScale: '0-100' });
  assert.equal(normalizeRating('4/5'), 8);
});

test('invalid and impossible ratings are rejected', () => {
  assert.equal(isValidRating('0'), false);
  assert.equal(isValidRating('1500 votes'), false);
  assert.equal(isValidRating('popularity 99'), false);
  assert.equal(isValidRating(NaN), false);
  assert.equal(isValidRating('Infinity'), false);
  assert.equal(isValidRating('-1'), false);
  assert.equal(isValidRating('8.4'), true);
});

test('series repository does not inject fake 7.8 ratings', async () => {
  const repositories = createXtreamProviderRepositories({
    async getSeriesCategories() {
      return [{ category_id: '20', category_name: 'Drama' }];
    },
    async getSeries() {
      return [{ series_id: '1', name: 'No Rating Show', category_id: '20' }];
    },
  });
  const posters = await repositories.series.getSeries('20');
  assert.equal(posters[0]?.rating, undefined);
});

test('title sort uses display title without article stripping', () => {
  assert.ok(normalizeTitleForSort('The Batman').startsWith('the batman'));
  const items = [
    { id: '1', title: 'The Batman' },
    { id: '2', title: 'Batman Begins' },
  ];
  const sorted = sortContentItems(items, 'title-asc', 'movie');
  assert.deepEqual(sorted.map((item) => item.id), ['2', '1']);
});

test('release dates after today are treated as invalid for released-content sorting', () => {
  assert.equal(normalizeReleaseDate('2099-01-01'), 0);
  assert.equal(normalizeReleaseDate('2030-06-01', { allowFuture: true }) > 0, true);
});

test('invalid dates remain after valid dated items in oldest sort', () => {
  const sorted = sortContentItems([
    { id: 'bad', title: 'Bad', releaseDate: '0000-00-00' },
    { id: 'good', title: 'Good', releaseDate: '1999-01-01' },
  ], 'oldest', 'movie');
  assert.deepEqual(sorted.map((item) => item.id), ['good', 'bad']);
});

test('request keys differ by sort provider category and generation', () => {
  const base = {
    providerId: 'p1',
    contentType: 'movie',
    categoryId: 'cat',
    offset: 0,
    generation: 1,
  };
  assert.notEqual(
    buildContentSortRequestKey({ ...base, sort: 'newest' }),
    buildContentSortRequestKey({ ...base, sort: 'title-asc' }),
  );
  assert.notEqual(
    buildContentSortRequestKey({ ...base, sort: 'newest', generation: 1 }),
    buildContentSortRequestKey({ ...base, sort: 'newest', generation: 2 }),
  );
});

test('provider series data source sorts complete cached category', async () => {
  const posters = Array.from({ length: LARGE_CATEGORY_SIZE }, (_, index) => ({
    id: String(index + 1),
    seriesId: String(index + 1),
    title: index === MARKER_INDEX ? 'ZZZ Newest Series' : `Series ${index + 1}`,
    rating: index === MARKER_INDEX ? '9.8' : undefined,
    latestEpisodeDate: index === MARKER_INDEX ? '2025-12-31' : '2020-01-01',
  }));
  const dataSource = createProviderSeriesDataSource({
    async getCategories() {
      return [];
    },
    async getSeries() {
      return posters;
    },
    async getSeriesInfo() {
      return null;
    },
  });
  const page = await dataSource.getSeriesPage({ categoryId: '20', offset: 0, limit: 10, sort: 'newest' });
  assert.equal(page.totalCount, LARGE_CATEGORY_SIZE);
  assert.equal(page.sortComplete, true);
  assert.equal(page.items[0]?.id, String(MARKER_INDEX + 1));
});

test('metadata builder flags incomplete sorts', () => {
  const meta = buildContentSortPageMetadata(12_500, 10_000, true);
  assert.equal(meta.sortComplete, false);
});

test('rating availability requires valid ratings in complete category', () => {
  assert.equal(categoryHasValidRatings([{ rating: undefined }, { rating: '0' }]), false);
  assert.equal(categoryHasValidRatings([{ rating: '8.2' }]), true);
  assert.equal(getVisibleSortOptions(false).some((option) => option.value === 'rating-desc'), false);
});

test('equal values remain stable via title and id tie-breakers', () => {
  const items = Array.from({ length: 3 }, (_, index) => ({
    id: String.fromCharCode(97 + index),
    title: 'Same',
    releaseDate: '2024-01-01',
  }));
  const first = sortContentItems(items, 'newest', 'movie');
  const second = sortContentItems(items, 'newest', 'movie');
  assert.deepEqual(first.map((item) => item.id), second.map((item) => item.id));
});

test('paginate helper preserves total count beyond first page', () => {
  const items = Array.from({ length: LARGE_CATEGORY_SIZE }, (_, index) => ({ id: String(index + 1) }));
  const sorted = items;
  const slice = paginateSortedItems(sorted, 12_400, 200);
  assert.equal(slice.items.length, 100);
  assert.equal(slice.totalCount, LARGE_CATEGORY_SIZE);
  assert.equal(slice.hasMore, false);
});
