import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  evaluateSortMetadataUpgradeNeed,
  isUsableReleaseDate,
  orderByClauseCompatible,
  parseCatalogReleaseYear,
  resolveContentSortEffectivePrimary,
} from '../src/features/catalog/catalogSortOrder.ts';
import { paginateSortedItems, sortContentItems } from '../src/features/media-browser/contentSorting.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => readFileSync(join(root, relativePath), 'utf8').replace(/\r\n/g, '\n');

const kotlin = read(
  'modules/novacast-catalog-decode/android/src/main/java/expo/modules/novacastcatalogdecode/NovacastCatalogDecodeModule.kt',
);
const writer = read('src/features/catalog/catalogSqliteSyncWriter.ts');
const moviesModel = read('src/features/movies/useMoviesScreenModel.ts');
const seriesModel = read('src/features/series/useSeriesScreenModel.ts');
const moviesScreen = read('src/features/movies/MoviesScreen.tsx');
const seriesScreen = read('src/features/series/SeriesScreen.tsx');
const providerBundle = read('src/features/providers/providerBundle.ts');
const providerSync = read('src/features/providers/providerCatalogSync.ts');
const discoverOverlay = read('src/features/personalization/DiscoverZoneOverlay.tsx');
const liveRouter = read('src/features/live/LiveTvFocusRouter.tsx');

function titles(items) {
  return items.map((item) => item.id);
}

test('1. Newest with valid release_date ranks newest first', () => {
  const sorted = sortContentItems(
    [
      { id: 'old', title: 'Zebra', releaseDate: '1999-01-01' },
      { id: 'new', title: 'Apple', releaseDate: '2024-06-01' },
    ],
    'newest',
    'movie',
  );
  assert.deepEqual(titles(sorted), ['new', 'old']);
  assert.match(orderByClauseCompatible('newest'), /release_date DESC/);
});

test('2. Newest with release_year only uses the year', () => {
  const sorted = sortContentItems(
    [
      { id: 'y1999', title: 'Zebra', year: 1999 },
      { id: 'y2024', title: 'Apple', year: 2024 },
    ],
    'newest',
    'movie',
  );
  assert.deepEqual(titles(sorted), ['y2024', 'y1999']);
  assert.equal(parseCatalogReleaseYear('2024'), 2024);
  assert.equal(isUsableReleaseDate('0000-00-00'), false);
});

test('3. Newest with added_at only falls back to added time', () => {
  const sorted = sortContentItems(
    [
      { id: 'older-add', title: 'Zebra', addedAt: Date.now() - 20 * 86400000 },
      { id: 'newer-add', title: 'Apple', addedAt: Date.now() - 2 * 86400000 },
    ],
    'newest',
    'movie',
  );
  assert.deepEqual(titles(sorted), ['newer-add', 'older-add']);
  assert.match(orderByClauseCompatible('newest'), /WHEN \(added_at IS NOT NULL AND added_at > 0\) THEN 2/);
});

test('4. Newest with NO date metadata uses provider order then content_id', () => {
  const sorted = sortContentItems(
    [
      { id: '3', title: 'Apple', providerSortOrder: 2 },
      { id: '1', title: 'Mango', providerSortOrder: 0 },
      { id: '2', title: 'Zebra', providerSortOrder: 1 },
    ],
    'newest',
    'movie',
  );
  assert.deepEqual(titles(sorted), ['1', '2', '3']);
});

test('5. Newest no-date dataset does NOT become A-Z', () => {
  const items = [
    { id: 'z', title: 'Zebra', providerSortOrder: 0 },
    { id: 'a', title: 'Apple', providerSortOrder: 1 },
    { id: 'm', title: 'Mango', providerSortOrder: 2 },
  ];
  const newest = sortContentItems(items, 'newest', 'movie');
  const az = sortContentItems(items, 'title-asc', 'movie');
  assert.deepEqual(titles(newest), ['z', 'a', 'm']);
  assert.deepEqual(titles(az), ['a', 'm', 'z']);
  assert.notDeepEqual(titles(newest), titles(az));
  assert.match(orderByClauseCompatible('newest'), /provider_sort_order ASC, content_id ASC/);
  assert.doesNotMatch(orderByClauseCompatible('newest'), /normalized_title/);
});

test('6. Recently Added with valid added_at is newest-add first', () => {
  const sorted = sortContentItems(
    [
      { id: 'old', title: 'Zebra', addedAt: Date.now() - 20 * 86400000, releaseDate: '2025-01-01' },
      { id: 'new', title: 'Apple', addedAt: Date.now() - 2 * 86400000, releaseDate: '1990-01-01' },
    ],
    'recently-added',
    'movie',
  );
  assert.deepEqual(titles(sorted), ['new', 'old']);
});

test('7. Recently Added with all added_at NULL uses provider order', () => {
  const sorted = sortContentItems(
    [
      { id: '3', title: 'Apple', providerSortOrder: 2 },
      { id: '1', title: 'Mango', providerSortOrder: 0 },
      { id: '2', title: 'Zebra', providerSortOrder: 1 },
    ],
    'recently-added',
    'movie',
  );
  assert.deepEqual(titles(sorted), ['1', '2', '3']);
  assert.match(orderByClauseCompatible('recently-added'), /provider_sort_order ASC, content_id ASC/);
});

test('8. Recently Added no-added dataset does NOT become A-Z', () => {
  const items = [
    { id: 'z', title: 'Zebra', providerSortOrder: 0 },
    { id: 'a', title: 'Apple', providerSortOrder: 1 },
    { id: 'm', title: 'Mango', providerSortOrder: 2 },
  ];
  const added = sortContentItems(items, 'recently-added', 'movie');
  const az = sortContentItems(items, 'title-asc', 'movie');
  assert.notDeepEqual(titles(added), titles(az));
  assert.doesNotMatch(orderByClauseCompatible('recently-added'), /normalized_title/);
});

test('9. Oldest valid release dates are oldest first', () => {
  const sorted = sortContentItems(
    [
      { id: 'new', title: 'Apple', releaseDate: '2024-06-01' },
      { id: 'old', title: 'Zebra', releaseDate: '1999-01-01' },
    ],
    'oldest',
    'movie',
  );
  assert.deepEqual(titles(sorted), ['old', 'new']);
});

test('10. Oldest missing metadata uses provider-order fallback, not added_at', () => {
  const sorted = sortContentItems(
    [
      { id: 'later-add', title: 'Zebra', addedAt: 9_000, providerSortOrder: 1 },
      { id: 'earlier-add', title: 'Apple', addedAt: 1_000, providerSortOrder: 0 },
    ],
    'oldest',
    'movie',
  );
  assert.deepEqual(titles(sorted), ['earlier-add', 'later-add']);
  assert.doesNotMatch(orderByClauseCompatible('oldest'), /added_at/);
});

test('11. mixed valid + missing metadata keeps valid values first', () => {
  const newest = sortContentItems(
    [
      { id: 'missing', title: 'Apple' },
      { id: 'dated', title: 'Zebra', releaseDate: '2001-01-01' },
    ],
    'newest',
    'movie',
  );
  assert.deepEqual(titles(newest), ['dated', 'missing']);

  const added = sortContentItems(
    [
      { id: 'missing', title: 'Apple' },
      { id: 'added', title: 'Zebra', addedAt: Date.now() - 2 * 86400000 },
    ],
    'recently-added',
    'movie',
  );
  assert.deepEqual(titles(added), ['added', 'missing']);
});

test('12. A-Z remains true alphabetical', () => {
  const sorted = sortContentItems(
    [
      { id: '2', title: 'Zodiac', providerSortOrder: 0 },
      { id: '1', title: 'Amelie', providerSortOrder: 1 },
      { id: '3', title: 'batman', providerSortOrder: 2 },
    ],
    'title-asc',
    'movie',
  );
  assert.deepEqual(titles(sorted), ['1', '3', '2']);
  assert.equal(orderByClauseCompatible('title'), 'normalized_title ASC, content_id ASC');
});

test('13. Z-A remains true reverse alphabetical', () => {
  const sorted = sortContentItems(
    [
      { id: '2', title: 'Zodiac', providerSortOrder: 0 },
      { id: '1', title: 'Amelie', providerSortOrder: 1 },
      { id: '3', title: 'batman', providerSortOrder: 2 },
    ],
    'title-desc',
    'movie',
  );
  assert.deepEqual(titles(sorted), ['2', '3', '1']);
});

test('14. Highest Rated is unchanged numeric desc with missing last', () => {
  const sorted = sortContentItems(
    [
      { id: 'low', title: 'Low', rating: '8.8' },
      { id: 'missing', title: 'Missing' },
      { id: 'high', title: 'High', rating: '9.1' },
    ],
    'rating-desc',
    'movie',
  );
  assert.deepEqual(titles(sorted), ['high', 'low', 'missing']);
});

test('15. Most Popular is unchanged numeric desc with missing last', () => {
  const sorted = sortContentItems(
    [
      { id: 'quiet', title: 'Quiet', popularity: 80 },
      { id: 'missing', title: 'Missing' },
      { id: 'hot', title: 'Hot', popularity: 4500 },
    ],
    'popularity-desc',
    'movie',
  );
  assert.deepEqual(titles(sorted), ['hot', 'quiet', 'missing']);
});

test('16. pagination preserves one global Newest order', () => {
  const items = Array.from({ length: 80 }, (_, index) => ({
    id: String(index + 1),
    title: `Title ${String.fromCharCode(90 - (index % 26))}`,
    releaseDate: `20${String(10 + (index % 10)).padStart(2, '0')}-01-01`,
    providerSortOrder: index,
  }));
  const ordered = sortContentItems(items, 'newest', 'movie');
  const pageOne = paginateSortedItems(ordered, 0, 30);
  const pageTwo = paginateSortedItems(ordered, 30, 30);
  assert.deepEqual(
    [...pageOne.items, ...pageTwo.items].map((item) => item.id),
    ordered.slice(0, 60).map((item) => item.id),
  );
});

test('17. Movies and Series share the same SQL date fallback contract', () => {
  const movieNewest = sortContentItems(
    [
      { id: 'z', title: 'Zebra', year: 2024 },
      { id: 'a', title: 'Apple', year: 2001 },
    ],
    'newest',
    'movie',
  );
  const seriesNewest = sortContentItems(
    [
      { id: 'z', title: 'Zebra', year: 2024 },
      { id: 'a', title: 'Apple', year: 2001 },
    ],
    'newest',
    'series',
  );
  assert.deepEqual(titles(movieNewest), titles(seriesNewest));
  assert.equal(orderByClauseCompatible('newest'), orderByClauseCompatible('newest'));
  assert.match(moviesModel, /sort: sortOption/);
  assert.match(seriesModel, /sort: sortOption/);
});

test('18. Series no-date Newest is not A-Z and uses the same fallback', () => {
  const items = [
    { id: 'z', title: 'Zebra', providerSortOrder: 0 },
    { id: 'a', title: 'Apple', providerSortOrder: 1 },
  ];
  const newest = sortContentItems(items, 'newest', 'series');
  const az = sortContentItems(items, 'title-asc', 'series');
  assert.notDeepEqual(titles(newest), titles(az));
});

test('native decoder reads year and rejects invalid release dates', () => {
  assert.match(kotlin, /"releaseYear" to parseYear\(raw\)/);
  assert.match(kotlin, /raw\["year"\]/);
  assert.match(kotlin, /usableReleaseDate/);
  assert.match(kotlin, /raw < 1_000_000_000_000L\) raw \* 1000L else raw/);
  assert.match(writer, /parseReleaseYear\(record\.releaseYear \?\? record\.releaseDate\)/);
  assert.match(writer, /isUsableReleaseDate/);
});

test('v4 metadata upgrade is one-time and does not wipe a ready generation', () => {
  assert.equal(
    evaluateSortMetadataUpgradeNeed({
      rowCount: 200,
      releaseDatePresentCount: 0,
      releaseYearPresentCount: 0,
      addedAtPresentCount: 0,
      popularityPresentCount: 0,
    }),
    true,
  );
  assert.equal(
    evaluateSortMetadataUpgradeNeed({
      rowCount: 200,
      releaseDatePresentCount: 10,
      releaseYearPresentCount: 10,
      addedAtPresentCount: 180,
      popularityPresentCount: 0,
    }),
    false,
  );
  assert.match(providerBundle, /shouldRequestSortMetadataUpgrade/);
  assert.match(providerBundle, /durable-movie-ready-generation-present/);
  assert.match(providerSync, /movie-sync-resumed-sort-metadata-upgrade/);
  assert.match(providerSync, /series-sync-resumed-sort-metadata-upgrade/);
  assert.doesNotMatch(providerBundle, /DELETE FROM catalog_items/);
});

test('effective primary reports provider-order when date metadata is absent', () => {
  const empty = {
    rowCount: 440,
    releaseDatePresentCount: 0,
    releaseYearPresentCount: 0,
    addedAtPresentCount: 0,
    popularityPresentCount: 0,
  };
  assert.deepEqual(resolveContentSortEffectivePrimary('newest', empty), {
    effectivePrimary: 'provider-order',
    fallbackUsed: true,
  });
  assert.deepEqual(resolveContentSortEffectivePrimary('recently-added', empty), {
    effectivePrimary: 'provider-order',
    fallbackUsed: true,
  });
});

test('date-sort pass does not invent playback or touch Search\/Discover\/Live', () => {
  assert.doesNotMatch(moviesScreen, /filteredMoviePlayback/);
  assert.doesNotMatch(seriesScreen, /filteredSeriesPlayback/);
  assert.doesNotMatch(discoverOverlay, /orderByClauseCompatible|catalogSortOrder/);
  assert.doesNotMatch(liveRouter, /orderByClauseCompatible|catalogSortMetadataUpgrade/);
});
