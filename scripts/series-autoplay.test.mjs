import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  isPlaybackNaturallyFinished,
  UP_NEXT_COUNTDOWN_SECONDS,
} from '../src/features/playback/continuity/playbackContinuity.ts';
import {
  formatSeriesContinuePlayLabel,
  getSeriesAutoplayQueue,
  pickPlayableNextEpisode,
  remainingPlaybackMs,
  resolveSeriesAutoplayDecision,
  resolveSeriesContinuePlayTarget,
  resolveSeriesUpNextEpisode,
  shouldArmSeriesUpNext,
  shouldCloseSeriesEpisodeWithoutUpNext,
  shouldStartSeriesAutoplayOnNaturalEnd,
  shouldTreatPlayerStatusAsSeriesEpisodeEnd,
} from '../src/features/playback/continuity/seriesUpNext.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => readFileSync(join(root, relativePath), 'utf8').replace(/\r\n/g, '\n');
const controller = read('src/features/playback/unified/UnifiedPlayerController.tsx');
const overlay = read('src/features/playback/continuity/PlaybackUpNextOverlay.tsx');
const seriesPlayback = read('src/features/series/seriesPlayback.ts');
const movies = read('src/features/movies/MoviesScreen.tsx');
const liveScreen = read('src/features/live/LiveTvScreen.tsx');

const episodes = [
  { id: 's1e1', seasonNumber: '1', episodeNumber: '1', streamUrl: 'https://cdn/s1e1' },
  { id: 's1e2', seasonNumber: '1', episodeNumber: '2', streamUrl: 'https://cdn/s1e2' },
  { id: 's1e3', seasonNumber: '1', episodeNumber: '3', streamUrl: 'https://cdn/s1e3' },
  { id: 's2e1', seasonNumber: '2', episodeNumber: '1', streamUrl: 'https://cdn/s2e1' },
];

test('A. same-season autoplay resolves S1E1 → S1E2', () => {
  assert.equal(resolveSeriesUpNextEpisode(episodes, { seasonNumber: '1', episodeNumber: '1' })?.id, 's1e2');
  assert.equal(
    resolveSeriesAutoplayDecision({
      mediaType: 'episode',
      remainingMs: 10_000,
      durationMs: 600_000,
      positionMs: 590_000,
      nextEpisodePresent: true,
      alreadyArmed: false,
      dismissedForSession: false,
      autoplayEnabled: true,
    }).action,
    'arm',
  );
});

test('B. season boundary S1Efinal → S2E1', () => {
  assert.equal(resolveSeriesUpNextEpisode(episodes, { seasonNumber: '1', episodeNumber: '3' })?.id, 's2e1');
});

test('C. final series episode has no next and closes normally', () => {
  assert.equal(resolveSeriesUpNextEpisode(episodes, { seasonNumber: '2', episodeNumber: '1' }), null);
  assert.equal(
    resolveSeriesAutoplayDecision({
      mediaType: 'episode',
      remainingMs: 400,
      durationMs: 600_000,
      positionMs: 599_700,
      nextEpisodePresent: false,
      alreadyArmed: false,
      dismissedForSession: false,
      autoplayEnabled: true,
    }).action,
    'close',
  );
  assert.equal(isPlaybackNaturallyFinished(599_700, 600_000), true);
  assert.equal(isPlaybackNaturallyFinished(552_000, 600_000), false);
});

test('D. cancel suppresses autoplay for this completion only', () => {
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
  assert.equal(
    resolveSeriesAutoplayDecision({
      mediaType: 'episode',
      remainingMs: 400,
      durationMs: 600_000,
      positionMs: 599_700,
      nextEpisodePresent: true,
      alreadyArmed: true,
      dismissedForSession: true,
      autoplayEnabled: true,
    }).action,
    'close',
  );
  assert.match(controller, /triggerReason: 'cancel-button'/);
  assert.match(controller, /event: 'cancelled'/);
});

test('E. Play Now starts the next episode immediately', () => {
  assert.match(controller, /event: reason === 'play-now' \? 'play-now' : 'autoplay-start'|event: 'play-now'/);
  assert.match(overlay, /Play Now/);
  assert.match(controller, /playNextEpisode\('play-now'\)|reason: 'play-now'|play-now/);
});

test('F. first BACK cancels overlay only', () => {
  const backSlice = controller.slice(controller.indexOf('const handleBack'), controller.indexOf('const handleRetry'));
  assert.match(backSlice, /if \(upNext\)/);
  assert.match(backSlice, /return;/);
  assert.match(backSlice, /triggerReason: 'back'/);
  assert.doesNotMatch(backSlice.slice(backSlice.indexOf('if (upNext)'), backSlice.indexOf('return;')), /closeUnifiedPlayback/);
});

test('G. playback error before completion does not autoplay', () => {
  assert.equal(
    resolveSeriesAutoplayDecision({
      mediaType: 'episode',
      remainingMs: 400,
      durationMs: 600_000,
      positionMs: 599_700,
      nextEpisodePresent: true,
      alreadyArmed: false,
      dismissedForSession: false,
      autoplayEnabled: true,
      machineState: 'error',
      playerStatus: 'error',
    }).action,
    'none',
  );
});

test('H. movies and live never arm series autoplay', () => {
  assert.equal(
    shouldArmSeriesUpNext({
      mediaType: 'movie',
      remainingMs: 5_000,
      durationMs: 600_000,
      nextEpisodePresent: true,
      alreadyArmed: false,
      dismissedForSession: false,
    }),
    false,
  );
  assert.equal(
    shouldArmSeriesUpNext({
      mediaType: 'live',
      remainingMs: 5_000,
      durationMs: 600_000,
      nextEpisodePresent: true,
      alreadyArmed: false,
      dismissedForSession: false,
    }),
    false,
  );
  assert.doesNotMatch(movies, /shouldArmSeriesUpNext/);
  assert.doesNotMatch(liveScreen, /resolveSeriesAutoplayDecision/);
});

test('I. Continue Watching after E1 complete points at resumable E2', () => {
  const catalog = [
    { id: 's1e1', seasonNumber: '1', episodeNumber: '1' },
    { id: 's1e2', seasonNumber: '1', episodeNumber: '2' },
  ];
  const afterComplete = resolveSeriesContinuePlayTarget({
    episodes: catalog,
    continueWatching: {
      episodeId: 's1e1',
      seasonNumber: '1',
      episodeNumber: '1',
      positionMs: 590_000,
      durationMs: 600_000,
    },
  });
  assert.equal(afterComplete.mode, 'play-next');
  assert.equal(afterComplete.episode?.id, 's1e2');
  assert.equal(formatSeriesContinuePlayLabel(afterComplete), 'Play S1:E2');

  const midNext = resolveSeriesContinuePlayTarget({
    episodes: catalog,
    continueWatching: {
      episodeId: 's1e2',
      seasonNumber: '1',
      episodeNumber: '2',
      positionMs: 240_000,
      durationMs: 600_000,
    },
  });
  assert.equal(midNext.mode, 'continue');
  assert.equal(midNext.episode?.id, 's1e2');
  assert.equal(formatSeriesContinuePlayLabel(midNext), 'Continue S1:E2');
  assert.match(controller, /handoffSeriesContinueWatchingToNextEpisode/);
});

test('J. completed last episode does not keep Continue on that episode', () => {
  const catalog = [
    { id: 's1e1', seasonNumber: '1', episodeNumber: '1' },
    { id: 's1e2', seasonNumber: '1', episodeNumber: '2' },
  ];
  const done = resolveSeriesContinuePlayTarget({
    episodes: catalog,
    continueWatching: {
      episodeId: 's1e2',
      seasonNumber: '1',
      episodeNumber: '2',
      positionMs: 590_000,
      durationMs: 600_000,
    },
  });
  assert.equal(done.mode, 'play');
  assert.equal(done.episode?.id, 's1e1');
  assert.equal(formatSeriesContinuePlayLabel(done), 'Play');
});

test('K. malformed/missing/unplayable episodes are skipped', () => {
  const messy = [
    { id: 'special', seasonNumber: 'Special', episodeNumber: 'Pilot' },
    { id: 's1e1', seasonNumber: '1', episodeNumber: '1', streamUrl: 'https://cdn/s1e1' },
    { id: 's2e1-missing', seasonNumber: '2', episodeNumber: '1', streamUrl: '' },
    { id: 's2e2', seasonNumber: '2', episodeNumber: '2', streamUrl: 'https://cdn/s2e2' },
    { id: 's0e1', seasonNumber: '0', episodeNumber: '1', streamUrl: 'https://cdn/s0e1' },
  ];
  assert.equal(resolveSeriesUpNextEpisode(messy, { seasonNumber: '1', episodeNumber: '1' })?.id, 's2e2');
  const picked = pickPlayableNextEpisode(getSeriesAutoplayQueue({
    upcomingEpisodes: [
      { id: 'bad', streamUrl: '' },
      { id: 'ok', streamUrl: 'https://cdn/ok' },
    ],
  }));
  assert.equal(picked.next?.id, 'ok');
});

test('native idle at end starts autoplay when countdown never armed', () => {
  assert.equal(
    shouldTreatPlayerStatusAsSeriesEpisodeEnd({
      mediaType: 'episode',
      status: 'idle',
      machineState: 'playing',
      livePositionMs: 600_000,
      liveDurationMs: 600_000,
      lastPlayingPositionMs: 599_000,
    }),
    true,
  );
  assert.equal(
    shouldStartSeriesAutoplayOnNaturalEnd({
      mediaType: 'episode',
      nextEpisodePresent: true,
      dismissedForSession: false,
      autoplayEnabled: true,
      naturallyFinished: true,
    }),
    true,
  );
  assert.equal(
    resolveSeriesAutoplayDecision({
      mediaType: 'episode',
      remainingMs: 0,
      durationMs: 600_000,
      positionMs: 600_000,
      nextEpisodePresent: true,
      alreadyArmed: false,
      dismissedForSession: false,
      autoplayEnabled: true,
      machineState: 'playing',
      playerStatus: 'idle',
      lastPlayingPositionMs: 599_000,
    }).action,
    'autoplay',
  );
});

test('countdown overlay stays lightweight and does not remount the player', () => {
  assert.equal(UP_NEXT_COUNTDOWN_SECONDS, 10);
  assert.equal(remainingPlaybackMs(590_000, 600_000), 10_000);
  assert.match(overlay, /Playing in \$\{secondsLeft\}/);
  assert.doesNotMatch(overlay, /Lottie|BlurView|setInterval/);
  assert.match(controller, /launchUnifiedPlayback\(/);
  assert.match(seriesPlayback, /sliceSeriesUpNextEpisodes/);
  assert.match(controller, /logSeriesAutoplay/);
  assert.match(read('src/features/playback/continuity/seriesUpNext.ts'), /\[NovaCast Series Autoplay\]/);
});

test('manual BACK before completion does not autoplay', () => {
  assert.equal(
    shouldCloseSeriesEpisodeWithoutUpNext({
      nextEpisodePresent: true,
      dismissedForSession: false,
      naturallyFinished: false,
      upNextVisible: false,
      autoplayEnabled: true,
    }),
    false,
  );
  const backSlice = controller.slice(controller.indexOf('const handleBack'), controller.indexOf('const handleRetry'));
  assert.match(backSlice, /closeUnifiedPlayback\(\)/);
});
