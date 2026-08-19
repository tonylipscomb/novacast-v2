import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getNextEpisode, isPlaybackComplete, UP_NEXT_COUNTDOWN_SECONDS } from '../src/features/playback/continuity/playbackContinuity.ts';
import {
  createSeriesUpNextTransitionId,
  remainingPlaybackMs,
  resolveSeriesUpNextEpisode,
  shouldArmSeriesUpNext,
  shouldCloseSeriesEpisodeWithoutUpNext,
  shouldCommitSeriesUpNextTransition,
  sliceSeriesUpNextEpisodes,
} from '../src/features/playback/continuity/seriesUpNext.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const controller = readFileSync(join(root, 'src/features/playback/unified/UnifiedPlayerController.tsx'), 'utf8');
const overlay = readFileSync(join(root, 'src/features/playback/continuity/PlaybackUpNextOverlay.tsx'), 'utf8');
const playerOverlay = readFileSync(join(root, 'src/features/playback/unified/UnifiedPlayerOverlay.tsx'), 'utf8');
const seriesPlayback = readFileSync(join(root, 'src/features/series/seriesPlayback.ts'), 'utf8');
const library = readFileSync(join(root, 'src/features/media-browser/mediaLibraryStore.ts'), 'utf8');
const resumeGate = readFileSync(join(root, 'src/features/playback/continuity/playbackResumeGate.ts'), 'utf8');
const movies = readFileSync(join(root, 'src/features/movies/MoviesScreen.tsx'), 'utf8');
const homeCw = readFileSync(join(root, 'src/features/hub/homeContinueWatchingLaunch.ts'), 'utf8');

const episodes = [
  { id: 's1e1', seasonNumber: '1', episodeNumber: '1' },
  { id: 's1e3', seasonNumber: '1', episodeNumber: '3' },
  { id: 's1e2', seasonNumber: '1', episodeNumber: '2' },
  { id: 's2e1', seasonNumber: '2', episodeNumber: '1' },
];

test('1. S1E1 resolves S1E2', () => {
  assert.equal(resolveSeriesUpNextEpisode(episodes, { seasonNumber: '1', episodeNumber: '1' })?.id, 's1e2');
});

test('2. season final resolves next season E1', () => {
  assert.equal(resolveSeriesUpNextEpisode(episodes, { seasonNumber: '1', episodeNumber: '3' })?.id, 's2e1');
});

test('3. final series episode resolves no next item', () => {
  assert.equal(resolveSeriesUpNextEpisode(episodes, { seasonNumber: '2', episodeNumber: '1' }), null);
  assert.equal(
    shouldCloseSeriesEpisodeWithoutUpNext({
      nextEpisodePresent: false,
      dismissedForSession: false,
      naturallyFinished: true,
      upNextVisible: false,
    }),
    true,
  );
});

test('4. malformed/duplicate episodes do not produce unsafe guess', () => {
  const messy = [
    { id: 'special', seasonNumber: 'Special', episodeNumber: 'Pilot' },
    { id: 'dup-a', seasonNumber: '1', episodeNumber: '1' },
    { id: 'dup-b', seasonNumber: '1', episodeNumber: '1' },
    { id: 's1e2', seasonNumber: '1', episodeNumber: '2' },
    { id: 's0e1', seasonNumber: '0', episodeNumber: '1' },
  ];
  assert.equal(resolveSeriesUpNextEpisode(messy, { seasonNumber: 'Special', episodeNumber: 'Pilot' }), null);
  assert.equal(resolveSeriesUpNextEpisode(messy, { seasonNumber: '1', episodeNumber: '1' })?.id, 's1e2');
  assert.equal(resolveSeriesUpNextEpisode(messy, { seasonNumber: '1', episodeNumber: '1' })?.id !== 'dup-b', true);
  assert.equal(resolveSeriesUpNextEpisode(messy, { seasonNumber: '1', episodeNumber: '2' }), null);
});

test('5. Up Next arms once at <=10 sec', () => {
  assert.equal(UP_NEXT_COUNTDOWN_SECONDS, 10);
  assert.equal(remainingPlaybackMs(590_000, 600_000), 10_000);
  assert.equal(
    shouldArmSeriesUpNext({
      mediaType: 'episode',
      remainingMs: 10_000,
      durationMs: 600_000,
      nextEpisodePresent: true,
      alreadyArmed: false,
      dismissedForSession: false,
    }),
    true,
  );
  assert.equal(
    shouldArmSeriesUpNext({
      mediaType: 'episode',
      remainingMs: 9_000,
      durationMs: 600_000,
      nextEpisodePresent: true,
      alreadyArmed: true,
      dismissedForSession: false,
    }),
    false,
  );
  assert.match(controller, /shouldArmSeriesUpNext/);
  assert.doesNotMatch(controller, /setUnifiedPlayerPlaying\(false\)/);
});

test('6. countdown does not restart on progress ticks', () => {
  assert.match(controller, /upNextArmedForEpisodeIdRef/);
  assert.match(controller, /\[playNextEpisode, setUpNext, upNextActive\]/);
  assert.doesNotMatch(controller, /secondsLeft, upNextActive/);
});

test('7. Play Now launches exactly once', () => {
  assert.equal(
    shouldCommitSeriesUpNextTransition({
      transitionId: 't1',
      committedTransitionId: null,
      nextStreamUrlPresent: true,
    }),
    true,
  );
  assert.equal(
    shouldCommitSeriesUpNextTransition({
      transitionId: 't1',
      committedTransitionId: 't1',
      nextStreamUrlPresent: true,
    }),
    false,
  );
  assert.match(controller, /playNextEpisode\('play-now'\)|reason: 'play-now'|play-now/);
  assert.match(controller, /upNextCommittedTransitionIdRef/);
});

test('8. countdown zero launches exactly once', () => {
  assert.match(controller, /playNextEpisode\('auto-triggered'\)/);
  assert.equal(createSeriesUpNextTransitionId('ep1', 'sess1'), 'sess1:ep1:up-next');
});

test('9. Back cancels', () => {
  assert.match(controller, /triggerReason: 'back'/);
  assert.match(controller, /upNextDismissedForEpisodeIdRef\.current = snapshot\.item\?\.id/);
  const backSlice = controller.slice(controller.indexOf('const handleBack'), controller.indexOf('const handleRetry'));
  assert.match(backSlice, /if \(upNext\)/);
  assert.match(backSlice, /return;/);
});

test('10. Cancel button cancels', () => {
  assert.match(overlay, /Cancel/);
  assert.match(controller, /triggerReason: 'cancel-button'/);
  assert.match(controller, /const cancelUpNext/);
});

test('11. cancelled Up Next does not reopen in same episode session', () => {
  assert.equal(
    shouldArmSeriesUpNext({
      mediaType: 'episode',
      remainingMs: 5_000,
      durationMs: 600_000,
      nextEpisodePresent: true,
      alreadyArmed: false,
      dismissedForSession: true,
    }),
    false,
  );
  assert.match(controller, /dismissedForSession/);
});

test('12. current episode saved complete before next launch', () => {
  assert.ok(controller.indexOf('current-completion-saved') < controller.indexOf('next-session-created'));
  assert.match(controller, /await savePlaybackProgress/);
  assert.equal(isPlaybackComplete(600_000, 600_000), true);
});

test('13. next episode starts position 0', () => {
  assert.match(controller, /resumePositionMs: 0/);
  assert.doesNotMatch(controller, /isResumeEligible\(saved\.positionMs/);
});

test('14. autoplay next episode does not show Resume dialog', () => {
  assert.match(controller, /launchUnifiedPlayback\(/);
  const playNext = controller.slice(controller.indexOf('const playNextEpisode'), controller.indexOf('const cancelUpNext'));
  assert.doesNotMatch(playNext, /requestPlaybackResumeChoice/);
  assert.doesNotMatch(playNext, /resumePolicy: 'prompt'/);
  assert.match(resumeGate, /requestPlaybackResumeChoice/);
});

test('15. Continue Watching remains one row per series', () => {
  assert.match(library, /handoffSeriesContinueWatchingToNextEpisode/);
  assert.match(library, /item\.seriesId !== input\.seriesId/);
});

test('16. CW moves from current episode to next episode', () => {
  assert.match(library, /positionMs: 0/);
  assert.match(controller, /handoffSeriesContinueWatchingToNextEpisode/);
});

test('17. next episode uses fresh session\/request identity', () => {
  assert.match(controller, /event: 'next-session-created'/);
  assert.match(controller, /id: nextItem\.id/);
  assert.match(controller, /streamUrl: nextItem\.streamUrl/);
});

test('18. failed next-source resolution leaves current playback intact', () => {
  assert.equal(
    shouldCommitSeriesUpNextTransition({
      transitionId: 't1',
      committedTransitionId: null,
      nextStreamUrlPresent: false,
    }),
    false,
  );
  assert.match(controller, /Next episode unavailable/);
  assert.match(controller, /event: 'transition-failed'/);
  const playNext = controller.slice(controller.indexOf('const playNextEpisode'), controller.indexOf('const cancelUpNext'));
  assert.doesNotMatch(playNext, /closeUnifiedPlayback\(\)/);
});

test('19. normal manually-selected Series episode playback unchanged', () => {
  assert.match(seriesPlayback, /launchSeriesEpisodePlayback/);
  assert.match(seriesPlayback, /sliceSeriesUpNextEpisodes/);
  assert.equal(getNextEpisode(episodes, { seasonNumber: '1', episodeNumber: '1' })?.id, 's1e2');
});

test('20. Movie playback tests unchanged', () => {
  assert.match(movies, /buildMoviePlaybackUrlResolved/);
  assert.match(homeCw, /resolveHomeContinueWatchingMovieIdentity|canonical/);
  assert.doesNotMatch(movies, /shouldArmSeriesUpNext/);
});

test('season 0 specials are ignored unless currently watching season 0', () => {
  const withSpecials = [
    { id: 's0e1', seasonNumber: '0', episodeNumber: '1' },
    { id: 's1e1', seasonNumber: '1', episodeNumber: '1' },
    { id: 's1e2', seasonNumber: '1', episodeNumber: '2' },
  ];
  assert.equal(resolveSeriesUpNextEpisode(withSpecials, { seasonNumber: '1', episodeNumber: '1' })?.id, 's1e2');
  assert.equal(resolveSeriesUpNextEpisode(withSpecials, { seasonNumber: '0', episodeNumber: '1' })?.id, 's1e1');
});

test('upcoming slice follows season then episode', () => {
  assert.deepEqual(
    sliceSeriesUpNextEpisodes(episodes, { seasonNumber: '1', episodeNumber: '1' }).map((episode) => episode.id),
    ['s1e2', 's1e3', 's2e1'],
  );
});

test('overlay traps TV focus on Play Now', () => {
  assert.match(overlay, /TVFocusGuideView/);
  assert.match(overlay, /hasTVPreferredFocus=\{!preferredConsumed\}/);
  assert.match(overlay, /trapFocusLeft: true/);
  assert.match(playerOverlay, /visible=\{state\.controlsVisible && !upNext\}/);
});
