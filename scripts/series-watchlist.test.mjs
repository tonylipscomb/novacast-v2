import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  clearMediaLibraryCacheForTests,
  getMediaLibraryState,
  recordEpisodeProgress,
} from '../src/features/media-browser/mediaLibraryStore.ts';
import {
  isSeriesWatchlisted,
  logSeriesWatchlist,
  resolveSeriesWatchlistContentId,
  SERIES_WATCHLIST_MARKER,
  seriesWatchlistLookupIds,
  toggleCanonicalSeriesWatchlist,
} from '../src/features/series/seriesWatchlist.ts';
import {
  decideHomeWatchlistSeriesLaunch,
  WATCHLIST_LAUNCH_MARKER,
} from '../src/features/hub/homeWatchlistLaunch.ts';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

test('Series Watchlist canonical ID prefers catalog content id, not a second store', () => {
  assert.equal(resolveSeriesWatchlistContentId({ id: '398724', seriesId: '398724' }), '398724');
  assert.equal(resolveSeriesWatchlistContentId({ id: 'content-1', seriesId: 'xtream-9' }), 'content-1');
  assert.equal(resolveSeriesWatchlistContentId({ seriesId: 'xtream-9' }), 'xtream-9');
  assert.deepEqual(seriesWatchlistLookupIds({ id: 'content-1', seriesId: 'xtream-9' }), ['content-1', 'xtream-9']);
  assert.equal(SERIES_WATCHLIST_MARKER, 'rc-series-watchlist-canonical');
});

test('saved-state selector recognizes either content id or seriesId', () => {
  assert.equal(isSeriesWatchlisted(['content-1'], { id: 'content-1', seriesId: 'xtream-9' }), true);
  assert.equal(isSeriesWatchlisted(['xtream-9'], { id: 'content-1', seriesId: 'xtream-9' }), true);
  assert.equal(isSeriesWatchlisted(['other'], { id: 'content-1', seriesId: 'xtream-9' }), false);
});

test('Series Watchlist add/remove uses shared @novacast/media-library contract', async () => {
  clearMediaLibraryCacheForTests();
  const providerId = `series-watchlist-${Date.now()}`;
  const series = { id: '398724', seriesId: '398724' };

  const added = await toggleCanonicalSeriesWatchlist(providerId, series);
  assert.equal(added, true);
  const afterAdd = await getMediaLibraryState(providerId);
  assert.equal(afterAdd.watchlist.includes('398724'), true);
  assert.equal(isSeriesWatchlisted(afterAdd.watchlist, series), true);

  const removed = await toggleCanonicalSeriesWatchlist(providerId, series);
  assert.equal(removed, false);
  const afterRemove = await getMediaLibraryState(providerId);
  assert.equal(afterRemove.watchlist.includes('398724'), false);
});

test('watching an episode does not remove Series Watchlist', async () => {
  clearMediaLibraryCacheForTests();
  const providerId = `series-watchlist-progress-${Date.now()}`;
  const series = { id: 'shogun', seriesId: 'shogun' };

  await toggleCanonicalSeriesWatchlist(providerId, series);
  await recordEpisodeProgress({
    providerId,
    seriesId: 'shogun',
    seasonNumber: '1',
    episodeNumber: '1',
    episodeId: 'ep-1',
    title: 'Episode 1',
    seriesTitle: 'Shogun',
    positionMs: 120_000,
    durationMs: 600_000,
  });

  const state = await getMediaLibraryState(providerId);
  assert.equal(state.watchlist.includes('shogun'), true);
});

test('Series detail wires Watchlist from the popup series, matching Movies', () => {
  const seriesScreen = read('src/features/series/SeriesScreen.tsx');
  const moviesScreen = read('src/features/movies/MoviesScreen.tsx');
  const popup = read('src/features/series/components/SeriesDetailPopupV2.tsx');
  const helper = read('src/features/series/seriesWatchlist.ts');

  assert.match(moviesScreen, /onToggleWatchlist=\{\s*detailPopup\.movie/);
  assert.match(seriesScreen, /onToggleWatchlist=\{\s*seriesDetailPopup\.series/);
  assert.match(seriesScreen, /toggleCanonicalSeriesWatchlist\(activeProviderId, series\)/);
  assert.doesNotMatch(seriesScreen, /toggleMediaWatchlist\(activeProviderId, seriesDetail\.seriesId\)/);
  assert.match(seriesScreen, /isSeriesWatchlisted\(library\.state\.watchlist, seriesDetailPopup\.series\)/);
  assert.match(helper, /toggleMediaWatchlist/);
  assert.match(helper, /\[NovaCast Series Watchlist\]/);
  assert.match(popup, /onPress=\{activate\}/);
  assert.match(popup, /Platform\.isTV \? \{ onClick: activate \}/);
  assert.match(popup, /id: 'watchlist'/);
  assert.equal(typeof logSeriesWatchlist, 'function');

  const actionsIdx = popup.indexOf('<View style={styles.actionsRow}>');
  const seasonsIdx = popup.indexOf('{seasons.length > 0 ? (');
  assert.ok(actionsIdx > 0 && seasonsIdx > actionsIdx, 'Watchlist actions must stay above season/episode chips');
});

test('Fire TV / Android TV banner packaging uses existing NovaCast assets', () => {
  const appJson = JSON.parse(read('app.json'));
  const plugin = read('plugins/withNovacastTvManifest.js');
  const android = appJson.expo.android;

  assert.equal(appJson.expo.icon, './assets/images/icon.png');
  assert.equal(android.icon, './assets/images/icon.png');
  assert.equal(android.adaptiveIcon.foregroundImage, './assets/images/android-icon-foreground.png');
  assert.equal(android.adaptiveIcon.backgroundImage, './assets/images/android-icon-background.png');
  assert.match(plugin, /android:banner/);
  assert.match(plugin, /ensureActivityBanner/);
  assert.match(plugin, /LEANBACK_LAUNCHER/);
  assert.match(plugin, /drawable\/banner\.png/);
  assert.match(plugin, /tv-banner-mdpi\.png/);
  assert.equal(fs.existsSync(path.join(root, 'assets/images/tv-banner-mdpi.png')), true);
  assert.equal(fs.existsSync(path.join(root, 'assets/images/tv-banner-xhdpi.png')), true);
  assert.equal(fs.existsSync(path.join(root, 'assets/images/icon.png')), true);
});

test('Home My Watchlist Series launches canonical Series detail, not Discover Zone', () => {
  const hub = read('src/features/hub/MainMenuScreen.tsx');
  const seriesScreen = read('src/features/series/SeriesScreen.tsx');
  const memory = read('src/features/series/seriesScreenMemory.ts');
  const watchlistBlock = hub.slice(hub.indexOf('title="My Watchlist"'), hub.indexOf('title="Favorite Channels"'));

  const actionable = decideHomeWatchlistSeriesLaunch({
    id: '398724',
    seriesId: '398724',
    categoryId: '88',
    title: 'Shogun',
    genres: [],
    posterStyleKey: 'ember',
    posterUrl: 'https://cdn.test/series.jpg',
  });
  assert.equal(actionable.kind, 'open-series-detail');
  if (actionable.kind === 'open-series-detail') {
    assert.equal(actionable.series.id, '398724');
    assert.equal(actionable.series.seriesId, '398724');
    assert.equal(actionable.series.title, 'Shogun');
  }
  assert.equal(decideHomeWatchlistSeriesLaunch({ id: '398724', seriesId: '398724', title: '', genres: [], posterStyleKey: 'ember', categoryId: '' }).kind, 'resolution-failed');

  assert.match(watchlistBlock, /decideHomeWatchlistSeriesLaunch\(entry\.item\)/);
  assert.match(watchlistBlock, /pendingSeriesDetail: decision\.series/);
  assert.match(watchlistBlock, /openDiscoverZone: false/);
  assert.doesNotMatch(watchlistBlock, /openDiscoverZone: true, selectedSeriesId/);
  assert.match(seriesScreen, /pendingSeriesDetail/);
  assert.match(seriesScreen, /handleSelectSeries\(pending\)/);
  assert.match(seriesScreen, /logWatchlistLaunch/);
  assert.match(read('src/features/hub/homeWatchlistLaunch.ts'), /\[NovaCast Watchlist Launch\]/);
  assert.match(memory, /pendingSeriesDetail/);
  assert.equal(WATCHLIST_LAUNCH_MARKER, 'rc-watchlist-launch-series-detail');
});
