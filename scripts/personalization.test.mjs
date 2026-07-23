import assert from 'node:assert/strict';
import test from 'node:test';

import {
  COMPLETED_PROGRESS_PERCENT,
  dedupeRecentItems,
  getVisibleHomeRows,
  isContinueWatchingEligible,
  progressPercent,
} from '../src/features/personalization/personalizationModel.ts';
import {
  clearPersonalizationCacheForTests,
  getLiveFavoriteEntries,
  recordRecentItem,
  toggleLiveFavorite,
} from '../src/features/personalization/personalizationStore.ts';
import {
  clearMediaLibraryCacheForTests,
  getMediaLibraryState,
  recordEpisodeProgress,
  removeContinueWatching,
  toggleMediaFavorite,
} from '../src/features/media-browser/mediaLibraryStore.ts';
import {
  clearMovieLibraryCacheForTests,
  getMovieLibraryState,
  recordWatch,
  removeContinueWatching as removeMovieContinueWatching,
  toggleFavorite,
} from '../src/features/movies/smart/movieLibraryStore.ts';
import { buildProgressKey, getResumePositionMs, savePlaybackProgress } from '../src/features/playback/unified/playbackProgressStore.ts';

const channel = {
  id: 'channel-favorite-1',
  categoryId: 'news',
  number: 1,
  name: 'Nova News',
  shortName: 'NN',
  current: 'Evening Report',
  next: 'Late News',
  following: 'Morning Line',
  description: '',
  resolution: 'HD',
  audio: 'Stereo',
  remaining: '20 min',
  progress: 50,
  tone: '#173B67',
  currentStart: '8:00 PM',
  currentEnd: '9:00 PM',
  logoUrl: 'https://cdn.test/nova-news.png',
};

test('provider-scoped live favorites persist and stay isolated', async () => {
  clearPersonalizationCacheForTests();
  const providerA = `personalization-a-${Date.now()}`;
  const providerB = `${providerA}-b`;

  await toggleLiveFavorite(providerA, channel);

  assert.equal((await getLiveFavoriteEntries(providerA)).length, 1);
  assert.equal((await getLiveFavoriteEntries(providerB)).length, 0);
});

test('movie and series favorites remain provider-scoped', async () => {
  clearMovieLibraryCacheForTests();
  clearMediaLibraryCacheForTests();
  const providerA = `favorite-a-${Date.now()}`;
  const providerB = `${providerA}-b`;

  await toggleFavorite(providerA, 'movie-favorite');
  await toggleMediaFavorite(providerA, 'series-favorite', 'series', { title: 'Series Favorite' });
  await recordWatch(providerA, { movieId: 'movie-1', title: 'Movie 1', progressPercent: 0, durationMs: 600_000 });
  await recordEpisodeProgress({
    providerId: providerA,
    seriesId: 'series-1',
    seasonNumber: '1',
    episodeNumber: '1',
    episodeId: 'episode-1',
    title: 'Episode 1',
    positionMs: 120_000,
    durationMs: 600_000,
  });

  assert.equal((await getMovieLibraryState(providerA)).favorites.includes('movie-favorite'), true);
  assert.equal((await getMovieLibraryState(providerB)).favorites.length, 0);
  assert.equal((await getMediaLibraryState(providerA)).favorites.includes('series-favorite'), true);
  assert.equal((await getMediaLibraryState(providerB)).favorites.length, 0);
  assert.equal((await getMovieLibraryState(providerA)).watchHistory.length, 1);
  assert.equal((await getMovieLibraryState(providerB)).watchHistory.length, 0);
  assert.equal((await getMediaLibraryState(providerA)).continueWatching.length, 1);
  assert.equal((await getMediaLibraryState(providerB)).continueWatching.length, 0);
});

test('continue watching thresholds exclude short starts and completed items', () => {
  assert.equal(isContinueWatchingEligible(29_999, 600_000), false);
  assert.equal(isContinueWatchingEligible(30_000, 600_000), true);
  assert.equal(isContinueWatchingEligible(570_000, 600_000), false);
  assert.equal(isContinueWatchingEligible(540_000, 600_000), false);
  assert.equal(COMPLETED_PROGRESS_PERCENT, 95);
  assert.equal(progressPercent(300_000, 600_000), 50);
  assert.equal(progressPercent(0, 0), 0);
});

test('Home exposes only populated personalization rows', () => {
  assert.deepEqual(
    getVisibleHomeRows({
      continueWatching: [{ id: 'resume-1' }],
      favoriteChannels: [],
      favoriteMovies: [{ id: 'movie-1' }],
      favoriteSeries: [],
      recentlyWatched: [],
    }),
    ['continueWatching', 'favoriteMovies'],
  );
});

test('movie and episode progress use the existing resume path and can be removed', async () => {
  clearMovieLibraryCacheForTests();
  clearMediaLibraryCacheForTests();
  const providerId = `resume-${Date.now()}`;

  await savePlaybackProgress(buildProgressKey(providerId, 'movie', 'movie-resume'), {
    title: 'Resume Movie',
    positionMs: 120_000,
    durationMs: 600_000,
  });
  assert.equal(await getResumePositionMs(buildProgressKey(providerId, 'movie', 'movie-resume')), 120_000);

  await recordEpisodeProgress({
    providerId,
    seriesId: 'series-resume',
    seasonNumber: '1',
    episodeNumber: '2',
    episodeId: 'episode-resume',
    title: 'Resume Episode',
    positionMs: 90_000,
    durationMs: 600_000,
  });
  assert.equal(await getResumePositionMs(buildProgressKey(providerId, 'episode', 'episode-resume')), 90_000);

  await removeMovieContinueWatching(providerId, 'movie-resume');
  await removeContinueWatching(providerId, 'series-resume:1:2');
  assert.equal(await getResumePositionMs(buildProgressKey(providerId, 'movie', 'movie-resume')), 0);
  assert.equal(await getResumePositionMs(buildProgressKey(providerId, 'episode', 'episode-resume')), 0);
});

test('recent items are deduplicated newest first and provider scoped', async () => {
  clearPersonalizationCacheForTests();
  const providerId = `recent-${Date.now()}`;
  await recordRecentItem({ providerId, mediaType: 'movie', contentId: 'movie-1', title: 'Movie 1', lastOpenedAt: 10 });
  await recordRecentItem({ providerId, mediaType: 'movie', contentId: 'movie-1', title: 'Movie 1', lastOpenedAt: 20 });
  await recordRecentItem({ providerId, mediaType: 'episode', contentId: 'episode-1', title: 'Episode 1', lastOpenedAt: 15 });

  const items = dedupeRecentItems(await (await import('../src/features/personalization/personalizationStore.ts')).getRecentItems(providerId));
  assert.deepEqual(items.map((item) => item.contentId), ['movie-1', 'episode-1']);
});
