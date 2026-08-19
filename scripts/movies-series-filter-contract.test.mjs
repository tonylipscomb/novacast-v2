import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  CONTENT_SORT_OPTIONS,
  compareContentItems,
  DEFAULT_CONTENT_SORT,
  getVisibleSortOptions,
  normalizePopularity,
  paginateSortedItems,
  sortContentItems,
} from '../src/features/media-browser/contentSorting.ts';
import {
  contentSortOptionContracts,
  mapContentSortToCatalogSort,
} from '../src/features/media-browser/contentSortMapping.ts';
import { buildContentSortRequestKey } from '../src/features/media-browser/contentSortRequest.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => readFileSync(join(root, relativePath), 'utf8').replace(/\r\n/g, '\n');

const sortControl = read('src/features/media-browser/ContentSortControl.tsx');
const moviesModel = read('src/features/movies/useMoviesScreenModel.ts');
const seriesModel = read('src/features/series/useSeriesScreenModel.ts');
const moviesScreen = read('src/features/movies/MoviesScreen.tsx');
const seriesScreen = read('src/features/series/SeriesScreen.tsx');
const sqliteMovies = read('src/features/movies/data/SqliteMovieDataSource.ts');
const sqliteSeries = read('src/features/series/data/SqliteSeriesDataSource.ts');
const catalogRepo = read('src/features/catalog/catalogRepository.ts');
const catalogSortOrder = read('src/features/catalog/catalogSortOrder.ts');
const discoverOverlay = read('src/features/personalization/DiscoverZoneOverlay.tsx');
const liveRouter = read('src/features/live/LiveTvFocusRouter.tsx');

const EXPECTED_OPTIONS = [
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'title-asc', label: 'A-Z' },
  { value: 'title-desc', label: 'Z-A' },
  { value: 'rating-desc', label: 'Highest Rated' },
  { value: 'popularity-desc', label: 'Most Popular' },
  { value: 'recently-added', label: 'Recently Added' },
];

test('1. every Movie Filter option has a distinct catalog query contract', () => {
  assert.deepEqual(CONTENT_SORT_OPTIONS, EXPECTED_OPTIONS);
  const contracts = contentSortOptionContracts();
  const unique = new Set(Object.values(contracts));
  assert.equal(unique.size, EXPECTED_OPTIONS.length);
  assert.equal(contracts.newest, 'newest');
  assert.equal(contracts.oldest, 'oldest');
  assert.equal(contracts['title-asc'], 'title');
  assert.equal(contracts['title-desc'], 'title-desc');
  assert.equal(contracts['rating-desc'], 'rating');
  assert.equal(contracts['popularity-desc'], 'popularity');
  assert.equal(contracts['recently-added'], 'recently-added');
  assert.match(sqliteMovies, /mapContentSortToCatalogSort\(sort\)/);
});

test('2. every Series Filter option has the same distinct catalog query contract', () => {
  const contracts = contentSortOptionContracts();
  assert.equal(mapContentSortToCatalogSort('popularity-desc'), 'popularity');
  assert.equal(mapContentSortToCatalogSort('recently-added'), 'recently-added');
  assert.notEqual(contracts['popularity-desc'], contracts['recently-added']);
  assert.notEqual(contracts['recently-added'], contracts.newest);
  assert.match(sqliteSeries, /mapContentSortToCatalogSort\(sort\)/);
});

test('3. no visible option maps to provider-order no-op', () => {
  for (const option of CONTENT_SORT_OPTIONS) {
    assert.notEqual(mapContentSortToCatalogSort(option.value), 'provider', option.label);
  }
});

test('4. no two options resolve to identical catalog behavior', () => {
  const seen = new Map();
  for (const option of CONTENT_SORT_OPTIONS) {
    const catalogSort = mapContentSortToCatalogSort(option.value);
    assert.equal(seen.has(catalogSort), false, `${option.label} collided with ${seen.get(catalogSort)}`);
    seen.set(catalogSort, option.label);
  }
});

test('5. A-Z is genuinely ascending by normalized title', () => {
  const sorted = sortContentItems(
    [
      { id: '2', title: 'Zodiac' },
      { id: '1', title: 'Amelie' },
      { id: '3', title: 'batman' },
    ],
    'title-asc',
    'movie',
  );
  assert.deepEqual(sorted.map((item) => item.id), ['1', '3', '2']);
});

test('6. Z-A is genuinely descending by normalized title', () => {
  const sorted = sortContentItems(
    [
      { id: '2', title: 'Zodiac' },
      { id: '1', title: 'Amelie' },
      { id: '3', title: 'batman' },
    ],
    'title-desc',
    'movie',
  );
  assert.deepEqual(sorted.map((item) => item.id), ['2', '3', '1']);
});

test('7. date year and rating semantics match labels', () => {
  const newest = sortContentItems(
    [
      { id: 'old', title: 'Old', releaseDate: '1999-01-01', year: 1999 },
      { id: 'new', title: 'New', releaseDate: '2024-06-01', year: 2024 },
    ],
    'newest',
    'movie',
  );
  assert.deepEqual(newest.map((item) => item.id), ['new', 'old']);

  const oldest = sortContentItems(
    [
      { id: 'old', title: 'Old', releaseDate: '1999-01-01', year: 1999 },
      { id: 'new', title: 'New', releaseDate: '2024-06-01', year: 2024 },
    ],
    'oldest',
    'movie',
  );
  assert.deepEqual(oldest.map((item) => item.id), ['old', 'new']);

  const rated = sortContentItems(
    [
      { id: 'low', title: 'Low', rating: '8.8' },
      { id: 'high', title: 'High', rating: '9.1' },
    ],
    'rating-desc',
    'movie',
  );
  assert.deepEqual(rated.map((item) => item.id), ['high', 'low']);

  const added = sortContentItems(
    [
      { id: 'older-add', title: 'Older Add', addedAt: Date.now() - 20 * 86400000, releaseDate: '2025-01-01' },
      { id: 'newer-add', title: 'Newer Add', addedAt: Date.now() - 2 * 86400000, releaseDate: '1990-01-01' },
    ],
    'recently-added',
    'movie',
  );
  assert.deepEqual(added.map((item) => item.id), ['newer-add', 'older-add']);

  assert.ok(normalizePopularity(4321) > normalizePopularity(99));
  const popular = sortContentItems(
    [
      { id: 'quiet', title: 'Quiet', popularity: 80 },
      { id: 'hot', title: 'Hot', popularity: 4500 },
    ],
    'popularity-desc',
    'movie',
  );
  assert.deepEqual(popular.map((item) => item.id), ['hot', 'quiet']);
});

test('8. missing metadata sorts deterministically last', () => {
  const sorted = sortContentItems(
    [
      { id: 'missing', title: 'Missing' },
      { id: 'dated', title: 'Dated', releaseDate: '2001-01-01' },
    ],
    'newest',
    'movie',
  );
  assert.deepEqual(sorted.map((item) => item.id), ['dated', 'missing']);
  assert.equal(compareContentItems({ id: 'a', title: 'A' }, { id: 'b', title: 'B' }, 'rating-desc', 'movie') < 0, true);
});

test('9. page 1 and page 2 preserve one global ordering contract', () => {
  const items = Array.from({ length: 80 }, (_, index) => ({
    id: String(index + 1),
    title: `Movie ${String.fromCharCode(90 - (index % 26))}${String(index).padStart(2, '0')}`,
    releaseDate: `20${String(10 + (index % 10)).padStart(2, '0')}-01-01`,
  }));
  const ordered = sortContentItems(items, 'title-asc', 'movie');
  const pageOne = paginateSortedItems(ordered, 0, 30);
  const pageTwo = paginateSortedItems(ordered, 30, 30);
  const ids = [...pageOne.items, ...pageTwo.items].map((item) => item.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(ids, ordered.slice(0, 60).map((item) => item.id));
  assert.match(catalogRepo, /ORDER BY \$\{orderByClauseCompatible\(query\.sort\)\}/);
  assert.match(catalogSortOrder, /case 'recently-added':/);
  assert.match(catalogSortOrder, /case 'popularity':/);
  assert.match(sqliteMovies, /sort: mapSort\(input\.sort\)/);
  assert.match(sqliteSeries, /sort: mapSort\(input\.sort\)/);
});

test('10. category switch preserves the active session filter', () => {
  assert.match(moviesModel, /sort: sortOption/);
  assert.match(seriesModel, /sort: sortOption/);
  assert.match(moviesModel, /buildContentSortRequestKey\(\{/);
  assert.doesNotMatch(moviesModel, /setMovieSortOption\('newest'\)\s*;\s*\}\s*,\s*\[selectedCategoryId/);
  assert.doesNotMatch(seriesModel, /setSeriesSortOption\('newest'\)\s*;\s*\}\s*,\s*\[selectedCategoryId/);
});

test('11. rapid Filter changes reject stale result commits', () => {
  const first = buildContentSortRequestKey({
    providerId: 'p',
    contentType: 'movie',
    categoryId: '10',
    sort: 'newest',
    offset: 0,
    generation: 1,
  });
  const second = buildContentSortRequestKey({
    providerId: 'p',
    contentType: 'movie',
    categoryId: '10',
    sort: 'title-asc',
    offset: 0,
    generation: 2,
  });
  assert.notEqual(first, second);
  assert.match(moviesModel, /currentRequestTokenMatches/);
  assert.match(seriesModel, /buildContentSortRequestKey\(\{/);
});

test('12. filtered Movie opens canonical Movie Detail', () => {
  assert.match(moviesScreen, /const handleSelectMovie = useCallback/);
  assert.match(moviesScreen, /loadMovieDetail\(movie, \{ origin: 'browse' \}\)/);
  assert.doesNotMatch(moviesScreen, /filteredMoviePlayback|filteredMovieDetail/);
});

test('13. filtered Series opens canonical Series Detail', () => {
  assert.match(seriesScreen, /onSelectSeries=\{handleSelectSeries\}/);
  assert.doesNotMatch(seriesScreen, /filteredSeriesPlayback|filteredSeriesDetail/);
});

test('14. Search does not consume the browse Filter', () => {
  assert.match(moviesModel, /searchMovies\(\{\s*query: queryMode,/);
  assert.doesNotMatch(moviesModel, /searchMovies\(\{[^}]*sort:/);
  assert.match(seriesModel, /searchSeries\(\{\s*query: queryMode,/);
  assert.doesNotMatch(seriesModel, /searchSeries\(\{[^}]*sort:/);
});

test('15. Discover Zone remains unchanged by browse Filter', () => {
  assert.doesNotMatch(discoverOverlay, /ContentSortControl|movieSortOption|seriesSortOption/);
});

test('16. Continue Watching and playback helpers stay out of Filter', () => {
  assert.doesNotMatch(sortControl, /continueWatching|UnifiedPlayer|vodSeek/);
  assert.doesNotMatch(liveRouter, /ContentSortControl|mapContentSortToCatalogSort/);
});

test('17. Movie\/Series playback remains the existing detail path', () => {
  assert.match(moviesScreen, /startPlayback/);
  assert.match(seriesScreen, /handleSelectSeries/);
  assert.doesNotMatch(moviesScreen, /filteredMoviePlayback/);
  assert.doesNotMatch(seriesScreen, /filteredSeriesPlayback/);
});

test('18. Filter BACK closes Filter before leaving the screen', () => {
  assert.match(sortControl, /hardwareBackPress/);
  assert.match(sortControl, /close\(\);/);
  assert.match(sortControl, /return true;/);
  assert.match(sortControl, /screen: 'ContentSortControl'/);
});

test('19. TV focus returns to the Sort trigger after Filter close', () => {
  assert.match(sortControl, /openerRef\.current\?\.focus\(\)/);
  assert.match(sortControl, /visibleOptions\.length - 1/);
});

test('20. no provider-wide network scan is introduced for Filter', () => {
  assert.match(sqliteMovies, /getCatalogItemsPage\(\{/);
  assert.match(sqliteSeries, /getCatalogItemsPage\(\{/);
  assert.doesNotMatch(sqliteMovies, /getVodStreams\(undefined/);
  assert.doesNotMatch(sqliteSeries, /getSeries\(undefined/);
});

test('default remains Newest and Highest Rated can hide without ratings', () => {
  assert.equal(DEFAULT_CONTENT_SORT, 'newest');
  assert.equal(getVisibleSortOptions(false).some((option) => option.value === 'rating-desc'), false);
  assert.equal(getVisibleSortOptions(true).length, CONTENT_SORT_OPTIONS.length);
});

test('SQLite ORDER BY clauses stay distinct for every mapped sort', () => {
  const newest = catalogSortOrder.indexOf("case 'newest':");
  const oldest = catalogSortOrder.indexOf("case 'oldest':");
  const recently = catalogSortOrder.indexOf("case 'recently-added':");
  const popularity = catalogSortOrder.indexOf("case 'popularity':");
  assert.ok(newest > 0 && oldest > 0 && recently > 0 && popularity > 0);
  assert.match(catalogSortOrder, /added_at DESC/);
  assert.match(catalogSortOrder, /popularity DESC/);
  assert.match(catalogSortOrder, /release_date DESC, release_year DESC/);
});
