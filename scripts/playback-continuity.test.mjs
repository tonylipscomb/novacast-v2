import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clampSeekPosition,
  COMPLETED_PROGRESS_PERCENT,
  formatPlaybackClock,
  formatSeasonEpisode,
  getNextEpisode,
  sliceUpcomingEpisodes,
  sortEpisodesByNumber,
  getPlaybackPercentage,
  isContinueWatchingEligible,
  isPlaybackComplete,
  isPlaybackNaturallyFinished,
  isResumeEligible,
  MIN_CONTINUE_WATCHING_POSITION_MS,
  PROGRESS_SAVE_INTERVAL_MS,
  resolveAcceleratedSeekDelta,
  resolvePlaybackResumePolicy,
  resolveSurfedChannelId,
  shouldHandleLiveChannelSurf,
  shouldSaveProgress,
  UP_NEXT_COUNTDOWN_SECONDS,
} from '../src/features/playback/continuity/playbackContinuity.ts';

test('continue watching requires 60s and hides completed titles', () => {
  assert.equal(MIN_CONTINUE_WATCHING_POSITION_MS, 60_000);
  assert.equal(COMPLETED_PROGRESS_PERCENT, 92);
  assert.equal(isContinueWatchingEligible(59_999, 600_000), false);
  assert.equal(isResumeEligible(60_000, 600_000), true);
  assert.equal(isPlaybackComplete(552_000, 600_000), true);
  assert.equal(getPlaybackPercentage(300_000, 600_000), 50);
});

test('resume policy is silent only from continue/recent entry points', () => {
  assert.equal(resolvePlaybackResumePolicy('continue-watching', 120_000, 600_000), 'silent');
  assert.equal(resolvePlaybackResumePolicy('recent-resume', 120_000, 600_000), 'silent');
  assert.equal(resolvePlaybackResumePolicy('standard', 120_000, 600_000), 'prompt');
  assert.equal(resolvePlaybackResumePolicy('standard', 10_000, 600_000), 'start');
});

test('next episode follows season/episode numbers, not array order', () => {
  const episodes = [
    { id: 'e3', seasonNumber: '2', episodeNumber: '1' },
    { id: 'e1', seasonNumber: '1', episodeNumber: '2' },
    { id: 'e2', seasonNumber: '1', episodeNumber: '1' },
  ];
  assert.equal(getNextEpisode(episodes, { seasonNumber: '1', episodeNumber: '1' })?.id, 'e1');
  assert.equal(getNextEpisode(episodes, { seasonNumber: '1', episodeNumber: '2' })?.id, 'e3');
  assert.equal(getNextEpisode(episodes, { seasonNumber: '2', episodeNumber: '1' }), null);
  assert.deepEqual(
    sliceUpcomingEpisodes(episodes, { seasonNumber: '1', episodeNumber: '1' }).map((episode) => episode.id),
    ['e1', 'e3'],
  );
  assert.deepEqual(
    sortEpisodesByNumber(episodes).map((episode) => episode.id),
    ['e2', 'e1', 'e3'],
  );
});

test('seek helpers clamp and accelerate', () => {
  assert.equal(clampSeekPosition(-20, 100_000), 0);
  assert.equal(clampSeekPosition(140_000, 100_000), 100_000);
  assert.equal(resolveAcceleratedSeekDelta({ direction: 1, repeatCount: 0 }), 10_000);
  assert.equal(resolveAcceleratedSeekDelta({ direction: -1, repeatCount: 5 }), -30_000);
  assert.equal(resolveAcceleratedSeekDelta({ direction: 1, repeatCount: 12 }), 60_000);
});

test('live channel surfing wraps and yields to overlays', () => {
  assert.equal(resolveSurfedChannelId(['a', 'b', 'c'], 'c', 1), 'a');
  assert.equal(resolveSurfedChannelId(['a', 'b', 'c'], 'a', -1), 'c');
  assert.equal(resolveSurfedChannelId(['a', 'b', 'c'], 'b', 1), 'c');
  assert.equal(
    shouldHandleLiveChannelSurf({
      isLive: true,
      fullscreenActive: true,
      modalOpen: false,
      chromeVisible: false,
      controlsFocused: false,
    }),
    true,
  );
  assert.equal(
    shouldHandleLiveChannelSurf({
      isLive: true,
      fullscreenActive: true,
      modalOpen: false,
      chromeVisible: true,
      controlsFocused: true,
    }),
    true,
  );
  assert.equal(
    shouldHandleLiveChannelSurf({
      isLive: true,
      fullscreenActive: true,
      modalOpen: true,
      chromeVisible: false,
      controlsFocused: false,
    }),
    false,
  );
  assert.equal(
    shouldHandleLiveChannelSurf({
      isLive: false,
      fullscreenActive: true,
      modalOpen: false,
      chromeVisible: false,
      controlsFocused: false,
    }),
    false,
  );
});

test('progress save interval and up-next countdown stay centralized', () => {
  assert.equal(PROGRESS_SAVE_INTERVAL_MS, 12_000);
  assert.equal(shouldSaveProgress(0, 11_999), false);
  assert.equal(shouldSaveProgress(0, 12_000), true);
  assert.equal(UP_NEXT_COUNTDOWN_SECONDS, 10);
  assert.equal(formatPlaybackClock(42 * 60_000 + 18_000), '42:18');
  assert.equal(formatSeasonEpisode('2', '4'), 'S2:E4');
  assert.equal(isPlaybackNaturallyFinished(99_000, 100_000), true);
  assert.equal(isPlaybackNaturallyFinished(552_000, 600_000), false);
});
