import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  decideHomeContinueWatchingLaunch,
  describeHomeContinueWatchingShape,
  resolveHomeContinueWatchingContainerExtension,
  resolveHomeContinueWatchingMovieIdentity,
  shouldHomeContinueWatchingOpenMovies,
  shouldRetryHomeContinueWatchingFallbackExtension,
} from '../src/features/hub/homeContinueWatchingLaunch.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const hub = readFileSync(join(root, 'src/features/hub/MainMenuScreen.tsx'), 'utf8');
const movies = readFileSync(join(root, 'src/features/movies/MoviesScreen.tsx'), 'utf8');
const gate = readFileSync(join(root, 'src/features/playback/continuity/playbackResumeGate.ts'), 'utf8');

const movieItem = {
  providerId: 'p1',
  mediaType: 'movie',
  contentId: 'movie-1',
  title: 'Nova One',
  artworkUrl: 'https://cdn.test/poster.png',
  positionMs: 120_000,
  durationMs: 600_000,
  progressPercent: 20,
  updatedAt: 1,
};

const episodeItem = {
  providerId: 'p1',
  mediaType: 'episode',
  contentId: 'ep-1',
  title: 'Pilot',
  parentSeriesId: 'series-1',
  episodeId: 'ep-1',
  positionMs: 90_000,
  durationMs: 240_000,
  progressPercent: 37,
  updatedAt: 2,
};

test('movie CW OK decides direct silent playback, not Movies navigation', () => {
  const decision = decideHomeContinueWatchingLaunch({
    item: movieItem,
    catalogMovie: { id: 'movie-1', title: 'Nova One', containerExtension: 'mkv' },
  });
  assert.equal(decision.kind, 'launch-movie');
  assert.equal(decision.resumePolicy, 'silent');
  assert.equal(decision.origin, 'home-continue-watching');
  assert.equal(shouldHomeContinueWatchingOpenMovies(), false);
  assert.match(hub, /decideHomeContinueWatchingLaunch/);
  assert.match(hub, /resumePolicy: 'silent'/);
  const continueSlice = hub.slice(hub.indexOf('const openContinueItem'), hub.indexOf('const openRecentItem'));
  assert.doesNotMatch(continueSlice, /navigateTo\('\/movies'\)/);
});

test('movie CW launch uses saved identity without requiring Movies UI', () => {
  const decision = decideHomeContinueWatchingLaunch({ item: movieItem, catalogMovie: null });
  assert.equal(decision.kind, 'launch-movie');
  if (decision.kind === 'launch-movie') {
    assert.equal(decision.movieId, 'movie-1');
    assert.equal(decision.positionMs, 120_000);
  }
  assert.match(hub, /buildMoviePlaybackUrlResolved/);
});

test('movie CW Back return target stays Home', () => {
  assert.match(hub, /origin: 'home-continue-watching'/);
  assert.doesNotMatch(hub.slice(hub.indexOf('const openContinueItem'), hub.indexOf('const openRecentItem')), /createMoviesDetailPlaybackReturnTarget/);
});

test('unresolved movie CW remains Home with error', () => {
  const decision = decideHomeContinueWatchingLaunch({
    item: { ...movieItem, contentId: '' },
    catalogMovie: null,
  });
  assert.equal(decision.kind, 'error');
  if (decision.kind === 'error') {
    assert.equal(decision.remainOnHome, true);
  }
  assert.match(hub, /scope: 'home'/);
});

test('episode CW decides direct silent playback', () => {
  const decision = decideHomeContinueWatchingLaunch({ item: episodeItem });
  assert.equal(decision.kind, 'launch-episode');
  if (decision.kind === 'launch-episode') {
    assert.equal(decision.resumePolicy, 'silent');
    assert.equal(decision.seriesId, 'series-1');
    assert.equal(decision.episodeId, 'ep-1');
  }
  assert.match(hub, /launchSeriesEpisodePlayback/);
});

test('episode CW Back return target stays Home', () => {
  const decision = decideHomeContinueWatchingLaunch({ item: episodeItem });
  assert.equal(decision.origin, 'home-continue-watching');
  assert.equal(shouldHomeContinueWatchingOpenMovies(), false);
});

test('Movie Detail launch still uses prompted Resume/Restart', () => {
  assert.match(movies, /await launchPlayback\(/);
  assert.doesNotMatch(movies, /resumePolicy: 'silent'/);
  assert.match(gate, /requestPlaybackResumeChoice/);
});

test('Home CW preferred focus is the continue row, not later personalization rails', () => {
  assert.match(hub, /continue-\$\{personalization\.continueWatching\[0\]\.contentId\}/);
  const focusBlock = hub.slice(hub.indexOf('const firstHomeFocusId'), hub.indexOf('useEffect(() => {', hub.indexOf('const firstHomeFocusId')));
  assert.ok(focusBlock.indexOf('continueWatching.length') < focusBlock.indexOf('watchlistItems.length'));
  assert.doesNotMatch(hub, /Recently Watched/);
});

test('safe CW shape has no URL fields', () => {
  const shape = describeHomeContinueWatchingShape(movieItem);
  assert.equal(shape.mediaType, 'movie');
  assert.equal(shape.contentIdPresent, true);
  assert.equal(shape.movieIdPresent, true);
  assert.equal(shape.savedPositionPresent, true);
  assert.equal(JSON.stringify(shape).includes('https://'), false);
});

const runtimeCwItem = {
  providerId: 'p1',
  mediaType: 'movie',
  contentId: '1490594',
  title: 'Runtime Movie',
  positionMs: 180_000,
  durationMs: 720_000,
  progressPercent: 25,
  updatedAt: 3,
};

test('1. CW missing extension + catalog MKV → launches MKV', () => {
  const decision = decideHomeContinueWatchingLaunch({
    item: runtimeCwItem,
    sqliteCatalogMovie: { id: '1490594', title: 'Runtime Movie', containerExtension: 'mkv' },
  });
  assert.equal(decision.kind, 'launch-movie');
  if (decision.kind === 'launch-movie') {
    assert.equal(decision.containerExtension, 'mkv');
    assert.equal(decision.extensionSource, 'canonical');
    assert.notEqual(decision.containerExtension, 'mp4');
  }
});

test('2. CW missing extension + catalog MP4 → launches MP4', () => {
  const decision = decideHomeContinueWatchingLaunch({
    item: runtimeCwItem,
    sqliteCatalogMovie: { id: '1490594', title: 'Runtime Movie', containerExtension: 'mp4' },
  });
  assert.equal(decision.kind, 'launch-movie');
  if (decision.kind === 'launch-movie') {
    assert.equal(decision.containerExtension, 'mp4');
    assert.equal(decision.extensionSource, 'canonical');
  }
});

test('3. CW stale extension MP4 + authoritative catalog MKV → catalog wins', () => {
  const decision = decideHomeContinueWatchingLaunch({
    item: { ...runtimeCwItem, containerExtension: 'mp4' },
    sqliteCatalogMovie: { id: '1490594', title: 'Runtime Movie', containerExtension: 'mkv' },
  });
  assert.equal(decision.kind, 'launch-movie');
  if (decision.kind === 'launch-movie') {
    assert.equal(decision.containerExtension, 'mkv');
    assert.equal(decision.extensionSource, 'canonical');
  }
});

test('4. CW extension MKV + catalog lookup hit MKV → MKV', () => {
  const decision = decideHomeContinueWatchingLaunch({
    item: { ...runtimeCwItem, containerExtension: 'mkv' },
    catalogMovie: { id: '1490594', title: 'Runtime Movie', containerExtension: 'mkv' },
  });
  assert.equal(decision.kind, 'launch-movie');
  if (decision.kind === 'launch-movie') {
    assert.equal(decision.containerExtension, 'mkv');
    assert.ok(decision.extensionSource === 'catalog' || decision.extensionSource === 'canonical');
  }
});

test('5. old history row with no extension self-heals', () => {
  const identity = resolveHomeContinueWatchingMovieIdentity({
    item: runtimeCwItem,
    catalogMovie: null,
    sqliteCatalogMovie: { id: '1490594', title: 'Runtime Movie', containerExtension: 'mkv' },
  });
  assert.equal(identity.savedExtensionPresent, false);
  assert.equal(identity.canonicalMovieFound, true);
  assert.equal(identity.containerExtension, 'mkv');
  assert.equal(identity.extensionSource, 'canonical');
});

test('6. saved resume position preserved during canonical merge', () => {
  const decision = decideHomeContinueWatchingLaunch({
    item: runtimeCwItem,
    sqliteCatalogMovie: { id: '1490594', title: 'Canonical Title', containerExtension: 'mkv' },
  });
  assert.equal(decision.kind, 'launch-movie');
  if (decision.kind === 'launch-movie') {
    assert.equal(decision.positionMs, 180_000);
    assert.equal(decision.title, 'Canonical Title');
  }
});

test('7. resumePolicy remains silent', () => {
  const decision = decideHomeContinueWatchingLaunch({
    item: runtimeCwItem,
    sqliteCatalogMovie: { id: '1490594', title: 'Runtime Movie', containerExtension: 'mkv' },
  });
  assert.equal(decision.kind, 'launch-movie');
  if (decision.kind === 'launch-movie') {
    assert.equal(decision.resumePolicy, 'silent');
  }
});

test('8. no Resume/Restart dialog from Home', () => {
  const continueSlice = hub.slice(hub.indexOf('const openContinueItem'), hub.indexOf('const openRecentItem'));
  assert.match(continueSlice, /resumePolicy: 'silent'/);
  assert.doesNotMatch(continueSlice, /requestPlaybackResumeChoice/);
  assert.doesNotMatch(continueSlice, /PlaybackResumeDialog/);
});

test('9. Back returns Home', () => {
  const continueSlice = hub.slice(hub.indexOf('const openContinueItem'), hub.indexOf('const openRecentItem'));
  assert.doesNotMatch(continueSlice, /createMoviesDetailPlaybackReturnTarget/);
  assert.match(hub, /origin: 'home-continue-watching'/);
});

test('10. normal Movie Detail playback unchanged', () => {
  assert.match(movies, /buildMoviePlaybackUrlResolved/);
  assert.match(movies, /matchingDetail\?\.containerExtension/);
  assert.doesNotMatch(movies, /resumePolicy: 'silent'/);
});

test('11. Movie Detail Resume unchanged', () => {
  assert.match(gate, /requestPlaybackResumeChoice/);
  assert.match(movies, /launchSource: 'play'/);
});

test('12. Movie Detail Restart unchanged', () => {
  assert.match(gate, /requestPlaybackResumeChoice/);
  assert.doesNotMatch(movies, /resumePolicy: 'start'/);
});

test('13. Series CW unchanged', () => {
  const decision = decideHomeContinueWatchingLaunch({ item: episodeItem });
  assert.equal(decision.kind, 'launch-episode');
  if (decision.kind === 'launch-episode') {
    assert.equal(decision.seriesId, 'series-1');
    assert.equal(decision.episodeId, 'ep-1');
    assert.equal(decision.resumePolicy, 'silent');
  }
  assert.match(hub, /launchSeriesEpisodePlayback/);
});

test('14. no provider/catalog sync triggered', () => {
  const continueSlice = hub.slice(hub.indexOf('const openContinueItem'), hub.indexOf('const openRecentItem'));
  assert.match(continueSlice, /getCatalogMovieItem/);
  assert.doesNotMatch(continueSlice, /beginCatalogSync/);
  assert.doesNotMatch(continueSlice, /syncProviderCatalog/);
  assert.doesNotMatch(continueSlice, /startCatalogSync/);
});

test('15. optional fallback HTTP retry is max once', () => {
  assert.equal(
    shouldRetryHomeContinueWatchingFallbackExtension({
      mediaType: 'movie',
      extensionSource: 'fallback',
      httpResponseCode: 551,
      attemptedExtension: 'mp4',
      canonicalExtension: 'mkv',
      alreadyRetried: false,
    }),
    true,
  );
  assert.equal(
    shouldRetryHomeContinueWatchingFallbackExtension({
      mediaType: 'movie',
      extensionSource: 'fallback',
      httpResponseCode: 551,
      attemptedExtension: 'mp4',
      canonicalExtension: 'mkv',
      alreadyRetried: true,
    }),
    false,
  );
  assert.equal(
    shouldRetryHomeContinueWatchingFallbackExtension({
      mediaType: 'movie',
      extensionSource: 'canonical',
      httpResponseCode: 551,
      attemptedExtension: 'mkv',
      canonicalExtension: 'mkv',
      alreadyRetried: false,
    }),
    false,
  );
  assert.match(hub, /armHomeContinueWatchingFallbackRecovery/);
});

test('runtime 1490594 never falls back to mp4 when catalog has mkv', () => {
  const resolved = resolveHomeContinueWatchingContainerExtension({
    sqliteCatalogExtension: 'mkv',
    memoryCatalogExtension: undefined,
    savedHistoryExtension: undefined,
  });
  assert.equal(resolved.containerExtension, 'mkv');
  assert.equal(resolved.extensionSource, 'canonical');
  assert.notEqual(resolved.extensionSource, 'fallback');
});
