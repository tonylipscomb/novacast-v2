import assert from 'node:assert/strict';
import test from 'node:test';

import {
  compareContentItems,
  normalizeReleaseDate,
  sortContentItems,
} from '../src/features/media-browser/contentSorting.ts';
import {
  countSmartCategory,
  querySmartCategoryOnIndex,
  resolveSmartCategoryDefinition,
} from '../src/features/movies/smart/smartCategoryDefinitions.ts';
import {
  countSmartSeriesCategory,
  querySmartSeriesCategoryOnIndex,
  resolveSmartSeriesCategoryDefinition,
} from '../src/features/series/smart/smartSeriesCategoryDefinitions.ts';
import { clearMoviesSettingsCacheForTests, getMoviesSettings, setMovieSortOption, setSeriesSortOption } from '../src/features/movies/smart/moviesSettingsStore.ts';

function movie(id, overrides = {}) {
  return { id, title: `Movie ${id}`, categoryId: 'all', rating: 5, added: 0, year: 2020, posterStyleKey: 'orbit', genreTags: [], ...overrides };
}

function series(id, overrides = {}) {
  return { id, seriesId: id, title: `Series ${id}`, categoryId: 'all', rating: 5, year: 2020, posterStyleKey: 'orbit', genreTags: [], ...overrides };
}

test('content sorting normalizes dates and keeps missing newest dates last', () => {
  assert.equal(normalizeReleaseDate('1700000000'), 1700000000000);
  const ordered = sortContentItems([
    movie('missing', { releaseDate: undefined, year: undefined }),
    movie('old', { releaseDate: '2020-01-01' }),
    movie('new', { releaseDate: '2025-01-01' }),
  ], 'newest', 'movie');
  assert.deepEqual(ordered.map((item) => item.id), ['new', 'old', 'missing']);
});

test('movie New Releases is virtual and capped at 50', () => {
  const definition = resolveSmartCategoryDefinition('smart:new-releases');
  assert.ok(definition);
  const entries = Array.from({ length: 75 }, (_, index) => movie(String(index), { added: 1700000000000 + index }));
  const index = { forEachEntry(callback) { entries.forEach(callback); }, getEntry(id) { return entries.find((entry) => entry.id === id); } };
  const result = querySmartCategoryOnIndex(index, definition, { providerId: 'p', favorites: new Set(), watchlist: new Set(), continueWatching: [], recentlyWatched: [], lastWatchedGenres: [] }, 0, 100);
  assert.equal(result.items.length, 50);
  assert.equal(result.totalCount, 50);
});

test('series New Releases deduplicates series and caps at 50', () => {
  const definition = resolveSmartSeriesCategoryDefinition('new-releases');
  assert.ok(definition);
  const entries = Array.from({ length: 80 }, (_, index) => series(String(Math.floor(index / 2)), {
    id: `episode-${index}`,
    latestEpisodeDate: `2025-01-${String((index % 28) + 1).padStart(2, '0')}`,
  }));
  const index = { forEachEntry(callback) { entries.forEach(callback); } };
  const result = querySmartSeriesCategoryOnIndex(index, definition, { providerId: 'p', favorites: new Set(), watchlist: new Set(), continueWatching: [], recentlyWatched: [] }, 0, 100);
  assert.equal(result.items.length, 40);
  assert.equal(new Set(result.items.map((item) => item.seriesId)).size, result.items.length);
  assert.equal(countSmartSeriesCategory(entries, definition, { providerId: 'p', favorites: new Set(), watchlist: new Set(), continueWatching: [], recentlyWatched: [] }), 40);
});

test('Discover results are deduplicated and capped', () => {
  const definition = resolveSmartSeriesCategoryDefinition('discover');
  assert.ok(definition);
  const entries = Array.from({ length: 90 }, (_, index) => series(String(Math.floor(index / 2)), { id: `item-${index}`, rating: index }));
  const result = querySmartSeriesCategoryOnIndex({ forEachEntry(callback) { entries.forEach(callback); } }, definition, { providerId: 'p', favorites: new Set(), watchlist: new Set(), continueWatching: [], recentlyWatched: [] }, 0, 100);
  assert.equal(result.items.length, 40);
});

test('movie and series sort preferences persist separately', async () => {
  clearMoviesSettingsCacheForTests();
  await setMovieSortOption('title-asc');
  await setSeriesSortOption('rating-desc');
  const settings = await getMoviesSettings();
  assert.equal(settings.movieSortOption, 'title-asc');
  assert.equal(settings.seriesSortOption, 'rating-desc');
});

test('title and rating sorts are deterministic', () => {
  const entries = [movie('2', { title: 'Bravo', rating: 8 }), movie('1', { title: 'Alpha', rating: 8 })];
  assert.deepEqual(sortContentItems(entries, 'title-asc', 'movie').map((item) => item.id), ['1', '2']);
  assert.equal(compareContentItems(entries[0], entries[1], 'rating-desc', 'movie') > 0, true);
});

