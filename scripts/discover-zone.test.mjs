import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { resolveLiveSearchSurfQueue } from '../src/features/live/liveTvSearchSession.ts';
import { chooseLiveChannel, createLiveTvLandingState } from '../src/features/live/liveTvLogic.ts';
import {
  canOpenDiscoverZoneDetail,
  hydrateCanonicalMovies,
  isSafeDiscoverZoneArtworkUrl,
  isSafeDiscoverZoneTitle,
  resolveHydratedMovie,
  resolveHydratedSeries,
  shouldShowDiscoverToolbarHighlight,
} from '../src/features/personalization/discoverZoneHydration.ts';
import {
  discoverZoneRailTitle,
  discoverZoneRails,
  emptyDiscoverZoneSnapshot,
  loadDiscoverZoneSnapshot,
} from '../src/features/personalization/discoverZoneModel.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => readFileSync(join(root, relativePath), 'utf8');

const moviesScreen = read('src/features/movies/MoviesScreen.tsx');
const seriesScreen = read('src/features/series/SeriesScreen.tsx');
const liveScreen = read('src/features/live/LiveTvScreen.tsx');
const liveRouter = read('src/features/live/LiveTvFocusRouter.tsx');
const hub = read('src/features/hub/MainMenuScreen.tsx');
const toolbar = read('src/features/movies/components/MovieToolbar.tsx');
const overlay = read('src/features/personalization/DiscoverZoneOverlay.tsx');
const movieSmart = read('src/features/movies/smart/SmartMovieDataSource.ts');
const seriesSmart = read('src/features/series/smart/SmartSeriesDataSource.ts');

test('Discover Zone rails are populated-only and live has no watchlist', () => {
  const movies = {
    scope: 'movies',
    watchlist: [{ id: 'm-w', title: 'Watch', mediaType: 'movie' }],
    favorites: [{ id: 'm-f', title: 'Fav', mediaType: 'movie' }],
  };
  assert.deepEqual(
    discoverZoneRails(movies).map(([rail, items]) => [rail, items.map((item) => item.id)]),
    [
      ['watchlist', ['m-w']],
      ['favorites', ['m-f']],
    ],
  );
  assert.equal(discoverZoneRailTitle('movies', 'watchlist'), 'My Watchlist');
  assert.equal(discoverZoneRailTitle('movies', 'favorites'), 'Favorite Movies');
  assert.equal(discoverZoneRailTitle('series', 'favorites'), 'Favorite Series');
  assert.equal(discoverZoneRailTitle('live', 'favorites'), 'Favorite Channels');

  const liveEmptyWatchlist = {
    scope: 'live',
    watchlist: [{ id: 'should-hide', title: 'Hidden', mediaType: 'live' }],
    favorites: [{ id: 'cnn', title: 'CNN', mediaType: 'live' }],
  };
  assert.deepEqual(
    discoverZoneRails(liveEmptyWatchlist).map(([rail]) => rail),
    ['favorites'],
  );
  assert.deepEqual(discoverZoneRails(emptyDiscoverZoneSnapshot('live')), []);
});

test('Favorite Channels reuse the existing Live surf-queue override', () => {
  const favoriteIds = ['espn', 'cnn', 'hbo'];
  const categoryIds = ['cnn', 'fox', 'espn', 'nbc', 'hbo'];
  assert.deepEqual(resolveLiveSearchSurfQueue(favoriteIds, categoryIds), favoriteIds);
  assert.deepEqual(resolveLiveSearchSurfQueue(null, categoryIds), [...categoryIds]);

  const landing = createLiveTvLandingState('news', 'cnn');
  const fullscreen = chooseLiveChannel(landing, 'cnn', { origin: 'search' });
  assert.equal(fullscreen.fullscreenChannelId, 'cnn');
});

test('Movies, Series, and Live toolbars are Search then Discover Zone', () => {
  assert.match(toolbar, />Search</);
  assert.match(toolbar, />Discover Zone</);
  assert.ok(toolbar.indexOf('>Search<') < toolbar.indexOf('>Discover Zone<'));
  assert.match(toolbar, /hasTVPreferredFocus=\{false\}/);

  assert.match(moviesScreen, /onDiscoverPress=\{\(\) => \{/);
  assert.ok(moviesScreen.indexOf('onSearchPress={() =>') < moviesScreen.indexOf('onDiscoverPress={() => {'));
  assert.match(moviesScreen, /scope="movies"/);
  assert.match(moviesScreen, /handleSelectMovie\(item\.canonicalMovie, DISCOVERY_ZONE_ORIGIN\)/);

  assert.match(seriesScreen, /onDiscoverPress=\{\(\) => \{/);
  assert.match(seriesScreen, /scope="series"/);
  assert.match(seriesScreen, /handleSelectSeries\(item\.canonicalSeries, DISCOVERY_ZONE_ORIGIN\)/);

  assert.match(liveScreen, /accessibilityLabel="Search Live TV"/);
  assert.match(liveScreen, /onDiscoverPress=\{\(\) => \{/);
  assert.match(liveScreen, /scope="live"/);
  assert.match(liveScreen, /playFavoriteFromDiscoverZone/);
  assert.match(liveScreen, /liveSearchSurfQueueRef\.current = favoriteIds/);
  assert.match(liveScreen, /origin: 'search'/);
});

test('Discover Zone does not invent playback helpers or touch the Live focus router', () => {
  assert.doesNotMatch(moviesScreen, /discoverPlayback|favoritePlayback|watchlistPlayback/);
  assert.doesNotMatch(seriesScreen, /discoverPlayback|favoritePlayback|watchlistPlayback/);
  assert.doesNotMatch(liveScreen, /discoverPlayback|favoritePlayback|watchlistPlayback/);
  assert.doesNotMatch(overlay, /discoverPlayback|launchPlayback|UnifiedPlayer/);
  assert.doesNotMatch(liveRouter, /Discover Zone|playFavoriteFromDiscoverZone|liveSearchSurfQueueRef/);
  assert.match(liveScreen, /LiveTvFocusRouter/);
});

test('legacy Discover browse injection is retired; provider categories remain', () => {
  assert.match(movieSmart, /async function buildSmartCategories/);
  assert.doesNotMatch(movieSmart, /SECTION_DISCOVER_ID,/);
  assert.match(movieSmart, /kind: 'provider' as const/);
  assert.match(seriesSmart, /kind: 'provider' as const/);
  assert.doesNotMatch(moviesScreen, /discoverStatusMessage/);
  assert.doesNotMatch(seriesScreen, /discoverStatusMessage/);
});

test('Home personalization rails are populated-only Discover Zone lists plus Continue Watching', () => {
  assert.match(hub, /title="Continue Watching"/);
  assert.match(hub, /title="My Watchlist"/);
  assert.match(hub, /title="Favorite Channels"/);
  assert.match(hub, /title="My Favorites"/);
  assert.doesNotMatch(hub, /Recently Watched/);
  assert.doesNotMatch(hub, /Because You Watched/);
  assert.doesNotMatch(hub, /smart:your-favorites|smart:favorites/);
  assert.match(hub, /openDiscoverZone: true/);
});

const movieSummary = (id, title, posterUrl = 'https://cdn.test/movie.jpg') => ({
  id,
  categoryId: '1923',
  title,
  genres: ['Movies'],
  posterStyleKey: 'ember',
  posterUrl,
});

const seriesSummary = (id, title, posterUrl = 'https://cdn.test/series.jpg') => ({
  id,
  seriesId: id,
  categoryId: '88',
  title,
  genres: [],
  posterStyleKey: 'ember',
  posterUrl,
});

test('Movie Favorite and Watchlist hydrate to canonical Movie title and poster', async () => {
  const catalog = new Map([
    ['1490592', movieSummary('1490592', 'The Northman')],
    ['1847454', movieSummary('1847454', 'Dune')],
  ]);
  const snapshot = await loadDiscoverZoneSnapshot('provider-a', 'movies', {
    getMovieLibrary: async () => ({
      favorites: ['1490592'],
      watchlist: ['1847454'],
      watchHistory: [],
    }),
    getMovieFromIndex: () => undefined,
    getMovieFromCatalog: async (providerId, id) => {
      assert.equal(providerId, 'provider-a');
      return catalog.get(id) ?? null;
    },
  });

  assert.equal(snapshot.favorites[0]?.title, 'The Northman');
  assert.equal(snapshot.favorites[0]?.artworkUrl, 'https://cdn.test/movie.jpg');
  assert.equal(snapshot.favorites[0]?.canonicalMovie?.id, '1490592');
  assert.equal(snapshot.watchlist[0]?.title, 'Dune');
  assert.equal(canOpenDiscoverZoneDetail(snapshot.favorites[0]), true);
  assert.doesNotMatch(snapshot.favorites[0]?.title ?? '', /^\d+$/);
  assert.doesNotMatch(snapshot.watchlist[0]?.title ?? '', /^\d+$/);
});

test('Movie Discover selection requires a canonical Movie summary', () => {
  const hydrated = resolveHydratedMovie({
    providerId: 'provider-a',
    savedId: '1490592',
    catalogSummary: movieSummary('1490592', 'The Northman'),
  });
  assert.equal(hydrated.item?.canonicalMovie?.title, 'The Northman');
  assert.equal(canOpenDiscoverZoneDetail(hydrated.item), true);
  assert.match(moviesScreen, /if \(!item\.canonicalMovie\)/);
  assert.match(moviesScreen, /handleSelectMovie\(item\.canonicalMovie, DISCOVERY_ZONE_ORIGIN\)/);
  assert.doesNotMatch(moviesScreen, /title: item\.title/);
});

test('Series Favorite and Watchlist hydrate to canonical Series title and artwork', async () => {
  const snapshot = await loadDiscoverZoneSnapshot('provider-a', 'series', {
    getMediaLibrary: async () => ({
      favorites: ['1721'],
      favoriteRecords: [{ providerId: 'provider-a', mediaType: 'series', contentId: '1721', title: '1721', createdAt: 1 }],
      watchlist: ['398724'],
      watchHistory: [],
      continueWatching: [],
    }),
    getSeriesFromIndex: () => undefined,
    getSeriesFromCatalog: async (providerId, id) => {
      assert.equal(providerId, 'provider-a');
      if (id === '1721') {
        return seriesSummary('1721', 'Severance');
      }
      if (id === '398724') {
        return seriesSummary('398724', 'Shogun');
      }
      return null;
    },
  });

  assert.equal(snapshot.favorites[0]?.title, 'Severance');
  assert.equal(snapshot.favorites[0]?.artworkUrl, 'https://cdn.test/series.jpg');
  assert.equal(snapshot.watchlist[0]?.title, 'Shogun');
  assert.equal(canOpenDiscoverZoneDetail(snapshot.favorites[0]), true);
  assert.match(seriesScreen, /handleSelectSeries\(item\.canonicalSeries, DISCOVERY_ZONE_ORIGIN\)/);
  assert.match(seriesScreen, /toggleCanonicalSeriesWatchlist\(activeProviderId, series\)/);
});

test('provider-scoped identity does not cross-resolve', async () => {
  const calls = [];
  await loadDiscoverZoneSnapshot('provider-a', 'movies', {
    getMovieLibrary: async () => ({ favorites: ['1234'], watchlist: [], watchHistory: [] }),
    getMovieFromIndex: () => undefined,
    getMovieFromCatalog: async (providerId, id) => {
      calls.push([providerId, id]);
      if (providerId === 'provider-b') {
        return movieSummary(id, 'Wrong Provider Title');
      }
      return movieSummary(id, 'Provider A Title');
    },
  });
  assert.deepEqual(calls, [['provider-a', '1234']]);
});

test('stale Movie and Series entries never display numeric IDs or open Detail', () => {
  const staleMovie = resolveHydratedMovie({
    providerId: 'provider-a',
    savedId: '1490592',
    indexSummary: movieSummary('1490592', '1490592', '14'),
    catalogSummary: null,
    snapshot: { title: '1490592', artworkUrl: '14' },
  });
  assert.equal(staleMovie.item, null);
  assert.equal(staleMovie.summary, null);
  assert.equal(isSafeDiscoverZoneTitle('1490592', '1490592'), false);
  assert.equal(isSafeDiscoverZoneTitle('14', '1490592'), false);
  assert.equal(isSafeDiscoverZoneArtworkUrl('14'), false);

  const staleSeries = resolveHydratedSeries({
    providerId: 'provider-a',
    savedId: '1721',
    catalogSummary: null,
    snapshot: { title: '1721' },
  });
  assert.equal(staleSeries.item, null);
  assert.equal(canOpenDiscoverZoneDetail({ id: '1721', title: '1721', mediaType: 'series' }), false);
});

test('Home My Watchlist and My Favorites use the shared hydration selector', () => {
  const home = read('src/features/personalization/personalizationHome.ts');
  assert.match(home, /hydrateCanonicalMovies\(providerId, favoriteMovieIds\)/);
  assert.match(home, /hydrateCanonicalMovies\(providerId, watchlistMovieIds\)/);
  assert.match(home, /hydrateCanonicalSeriesList\(providerId, favoriteSeriesIds\)/);
  assert.match(home, /hydrateCanonicalSeriesList\(providerId, mediaLibrary\.watchlist\)/);
  const movies = hydrateCanonicalMovies;
  assert.equal(typeof movies, 'function');
});

test('Discover Zone highlight follows native focus and clears when overlay opens', () => {
  assert.equal(shouldShowDiscoverToolbarHighlight(true, false), true);
  assert.equal(shouldShowDiscoverToolbarHighlight(true, true), false);
  assert.equal(shouldShowDiscoverToolbarHighlight(false, false), false);
  assert.equal(shouldShowDiscoverToolbarHighlight(false, true), false);
  assert.match(toolbar, /shouldShowDiscoverToolbarHighlight\(discoverFocused, overlayOpen\)/);
  assert.match(toolbar, /event: 'native-focus-received'/);
  assert.match(toolbar, /event: 'native-focus-lost'/);
  assert.match(toolbar, /event: 'press-clear'/);
  assert.match(moviesScreen, /discoverZoneOpen=\{discoverZoneOpen\}/);
  assert.match(seriesScreen, /discoverZoneOpen=\{discoverZoneOpen\}/);
  assert.match(liveScreen, /discoverZoneOpen=\{discoverZoneOpen\}/);
});

test('Live Discover Zone and favorite surf queue remain unchanged', () => {
  assert.match(liveScreen, /playFavoriteFromDiscoverZone/);
  assert.match(liveScreen, /hydrateFavoriteLiveChannels/);
  assert.match(liveScreen, /liveSearchSurfQueueRef\.current = favoriteIds/);
  assert.match(liveScreen, /origin: 'search'/);
  assert.match(liveScreen, /LiveTvFocusRouter/);
  assert.doesNotMatch(liveScreen, /bundle\.live\.getChannel\(/);
  assert.doesNotMatch(liveRouter, /Discover Zone|playFavoriteFromDiscoverZone|canonicalMovie|hydrateCanonical/);
  assert.deepEqual(resolveLiveSearchSurfQueue(['espn', 'cnn', 'hbo'], ['cnn', 'fox', 'espn']), ['espn', 'cnn', 'hbo']);
});

test('Movie and Series Discover Zone keep overlay mounted and return on detail BACK', () => {
  assert.match(overlay, /retainMounted/);
  assert.match(moviesScreen, /retainMounted=\{discoverZoneOpen\}/);
  assert.match(seriesScreen, /retainMounted=\{discoverZoneOpen\}/);
  assert.match(moviesScreen, /DISCOVERY_ZONE_ORIGIN/);
  assert.match(seriesScreen, /DISCOVERY_ZONE_ORIGIN/);
  assert.match(moviesScreen, /logDiscoverZoneDetailOpen/);
  assert.match(seriesScreen, /logDiscoverZoneDetailOpen/);
  assert.match(moviesScreen, /logDiscoverZoneDetailBack/);
  assert.match(seriesScreen, /logDiscoverZoneDetailBack/);
  assert.doesNotMatch(moviesScreen, /setDiscoverZoneOpen\(false\);\s*\n\s*handleSelectMovie/);
  assert.doesNotMatch(seriesScreen, /setDiscoverZoneOpen\(false\);\s*\n\s*handleSelectSeries/);
});
