import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { getNextEpisode, getPreviousEpisode } from '../src/features/playback/continuity/playbackContinuity.ts';
import {
  resolveSeriesPreviousEpisode,
  resolveSeriesUpNextEpisode,
  shouldArmSeriesUpNext,
  shouldCommitSeriesUpNextTransition,
} from '../src/features/playback/continuity/seriesUpNext.ts';
import { createEpisodeNavigationTransitionId } from '../src/features/playback/continuity/episodeNavigation.ts';
import { resolveUnifiedControlFocusMove } from '../src/features/playback/unified/unifiedPlayerLogic.ts';
import { nativeTimelineFocusImpliesSeekDirection } from '../src/features/playback/unified/vodSeek.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => readFileSync(join(root, relativePath), 'utf8').replace(/\r\n/g, '\n');
const controls = read('src/features/playback/unified/UnifiedPlayerControls.tsx');
const controller = read('src/features/playback/unified/UnifiedPlayerController.tsx');
const overlay = read('src/features/playback/unified/UnifiedPlayerOverlay.tsx');
const seriesPlayback = read('src/features/series/seriesPlayback.ts');
const library = read('src/features/media-browser/mediaLibraryStore.ts');
const resumeGate = read('src/features/playback/continuity/playbackResumeGate.ts');
const vodSeek = read('src/features/playback/unified/vodSeek.ts');

const episodes = [
  { id: 's1e1', seasonNumber: '1', episodeNumber: '1' },
  { id: 's1e3', seasonNumber: '1', episodeNumber: '3' },
  { id: 's1e2', seasonNumber: '1', episodeNumber: '2' },
  { id: 's2e1', seasonNumber: '2', episodeNumber: '1' },
];

test('18. S1E2 Previous → S1E1', () => {
  assert.equal(getPreviousEpisode(episodes, { seasonNumber: '1', episodeNumber: '2' })?.id, 's1e1');
  assert.equal(resolveSeriesPreviousEpisode(episodes, { seasonNumber: '1', episodeNumber: '2' })?.id, 's1e1');
});

test('19. S1E1 Previous unavailable', () => {
  assert.equal(getPreviousEpisode(episodes, { seasonNumber: '1', episodeNumber: '1' }), null);
  assert.equal(resolveSeriesPreviousEpisode(episodes, { seasonNumber: '1', episodeNumber: '1' }), null);
});

test('20. final S1 → Next S2E1', () => {
  assert.equal(getNextEpisode(episodes, { seasonNumber: '1', episodeNumber: '3' })?.id, 's2e1');
  assert.equal(resolveSeriesUpNextEpisode(episodes, { seasonNumber: '1', episodeNumber: '3' })?.id, 's2e1');
});

test('21. S2E1 Previous → final valid S1 episode', () => {
  assert.equal(getPreviousEpisode(episodes, { seasonNumber: '2', episodeNumber: '1' })?.id, 's1e3');
  assert.equal(resolveSeriesPreviousEpisode(episodes, { seasonNumber: '2', episodeNumber: '1' })?.id, 's1e3');
});

test('22. final series episode Next unavailable', () => {
  assert.equal(getNextEpisode(episodes, { seasonNumber: '2', episodeNumber: '1' }), null);
  assert.equal(resolveSeriesUpNextEpisode(episodes, { seasonNumber: '2', episodeNumber: '1' }), null);
});

test('23. duplicate/malformed episodes handled by existing normalization rules', () => {
  const messy = [
    ...episodes,
    { id: 'dup', seasonNumber: '1', episodeNumber: '2' },
    { id: 'bad', seasonNumber: 'x', episodeNumber: 'y' },
    { id: 'special', seasonNumber: '0', episodeNumber: '1' },
  ];
  assert.equal(resolveSeriesUpNextEpisode(messy, { seasonNumber: '1', episodeNumber: '1' })?.id, 's1e2');
  assert.equal(resolveSeriesPreviousEpisode(messy, { seasonNumber: '1', episodeNumber: '2' })?.id, 's1e1');
  assert.equal(resolveSeriesUpNextEpisode(messy, { seasonNumber: '1', episodeNumber: '1' })?.seasonNumber, '1');
});

test('24. Previous button only appears for episode', () => {
  assert.match(controls, /const showEpisodeButtons = mediaType === 'episode'/);
  assert.match(controls, /accessibilityLabel="Previous Episode"/);
});

test('25. Next button only appears for episode', () => {
  assert.match(controls, /accessibilityLabel="Next Episode"/);
  assert.match(controls, /showEpisodeButtons \?/);
});

test('26. Movie has neither button', () => {
  assert.match(controls, /mediaType === 'episode'/);
  assert.doesNotMatch(controls, /showEpisodeButtons = mediaType === 'movie'/);
});

test('27. Live has neither button', () => {
  assert.doesNotMatch(controls, /showEpisodeButtons = mediaType === 'live'/);
  assert.match(controls, /allowSeek=\{state\.item\?\.mediaType !== 'live'\}|allowSeek = true/);
});

test('28. manual Next starts target at 0', () => {
  const start = controller.indexOf('const handleManualEpisodeNavigation');
  const block = controller.slice(start, controller.indexOf('const handlePreviousEpisode', start));
  assert.match(block, /resumePositionMs: 0/);
  assert.match(block, /direction > 0/);
});

test('29. manual Previous starts target at 0', () => {
  const start = controller.indexOf('const handleManualEpisodeNavigation');
  const block = controller.slice(start, controller.indexOf('const cancelUpNext', start));
  assert.match(block, /resumePositionMs: 0/);
  assert.match(block, /handleManualEpisodeNavigation\(-1\)/);
});

test('30. no Resume dialog', () => {
  const start = controller.indexOf('const handleManualEpisodeNavigation');
  const block = controller.slice(start, controller.indexOf('const handlePreviousEpisode', start));
  assert.doesNotMatch(block, /requestPlaybackResumeChoice/);
  assert.match(block, /resumePolicy: 'start'/);
  assert.match(resumeGate, /requestPlaybackResumeChoice/);
});

test('31. current actual progress saved before transition', () => {
  const start = controller.indexOf('const handleManualEpisodeNavigation');
  const block = controller.slice(start, controller.indexOf('const handlePreviousEpisode', start));
  assert.match(block, /persistProgress\(currentState\.positionMs, currentState\.durationMs, true\)/);
  assert.match(block, /current-progress-saved/);
});

test('32. pressing Next does not falsely force completion', () => {
  const start = controller.indexOf('const handleManualEpisodeNavigation');
  const block = controller.slice(start, controller.indexOf('const handlePreviousEpisode', start));
  assert.doesNotMatch(block, /completeMs/);
  assert.match(block, /persistProgress\(currentState\.positionMs/);
});

test('33. Series CW remains one row', () => {
  assert.match(controller, /handoffSeriesContinueWatchingToNextEpisode/);
  assert.match(library, /item\.seriesId !== input\.seriesId/);
});

test('34. Up Next visible + manual Next = exactly one transition', () => {
  const start = controller.indexOf('const handleManualEpisodeNavigation');
  const block = controller.slice(start, controller.indexOf('const handlePreviousEpisode', start));
  assert.match(block, /episodeTransitionInFlightRef/);
  assert.match(block, /duplicate-transition-blocked/);
  assert.match(block, /setUpNext\(null\)/);
  assert.match(block, /upNextCommittedTransitionIdRef\.current = upNextTransitionIdRef\.current/);
  assert.equal(
    shouldCommitSeriesUpNextTransition({
      transitionId: 'a',
      committedTransitionId: 'a',
      nextStreamUrlPresent: true,
    }),
    false,
  );
});

test('35. Up Next visible + Previous dismisses countdown', () => {
  const start = controller.indexOf('const handleManualEpisodeNavigation');
  const block = controller.slice(start, controller.indexOf('const cancelUpNext', start));
  assert.match(block, /setUpNext\(null\)/);
  assert.match(controls, /onPreviousEpisode/);
});

test('36. automatic Up Next still works', () => {
  assert.match(controller, /playNextEpisode\('auto-triggered'\)/);
  assert.equal(
    shouldArmSeriesUpNext({
      mediaType: 'episode',
      remainingMs: 8_000,
      durationMs: 600_000,
      nextEpisodePresent: true,
      alreadyArmed: false,
      dismissedForSession: false,
    }),
    true,
  );
});

test('37. VOD timeline LEFT/RIGHT seek remains unchanged', () => {
  assert.equal(resolveUnifiedControlFocusMove('seek', { key: 'ArrowLeft' }), null);
  assert.equal(resolveUnifiedControlFocusMove('seek', { key: 'ArrowRight' }), null);
  assert.match(controls, /nextFocusLeft: leftSentinel/);
  assert.match(controls, /nextFocusRight: rightSentinel/);
  assert.equal(nativeTimelineFocusImpliesSeekDirection(), false);
  assert.match(vodSeek, /hidden-focus-sentinel/);
});

test('38. timeline focus cannot move horizontally into episode buttons', () => {
  assert.equal(resolveUnifiedControlFocusMove('seek', { key: 'ArrowLeft' }), null);
  assert.equal(resolveUnifiedControlFocusMove('seek', { key: 'ArrowRight' }), null);
  assert.equal(resolveUnifiedControlFocusMove('seek', { key: 'ArrowDown' }), 'rewind');
  assert.notEqual(resolveUnifiedControlFocusMove('seek', { key: 'ArrowDown' }), 'previousEpisode');
  assert.notEqual(resolveUnifiedControlFocusMove('seek', { key: 'ArrowDown' }), 'nextEpisode');
  assert.equal(resolveUnifiedControlFocusMove('rewind', { key: 'ArrowLeft' }), null);
  assert.equal(
    resolveUnifiedControlFocusMove('rewind', { key: 'ArrowLeft' }, {
      episodeButtonsVisible: true,
      canGoPreviousEpisode: true,
    }),
    'previousEpisode',
  );
  assert.equal(resolveUnifiedControlFocusMove('forward', { key: 'ArrowRight' }), null);
  const seekCase = controls.slice(controls.indexOf("case 'seek':"), controls.indexOf("case 'seek':") + 700);
  assert.doesNotMatch(seekCase, /nextFocusLeft: previousEpisode/);
  assert.doesNotMatch(seekCase, /nextFocusRight: nextEpisode/);
});

test('episode navigation diagnostics exist', () => {
  assert.equal(createEpisodeNavigationTransitionId('a', 'b', 1).includes('next'), true);
  assert.match(controller, /\[NovaCast Episode Navigation\]|logEpisodeNavigation/);
  assert.match(seriesPlayback, /previousEpisode/);
  assert.match(overlay, /onPreviousEpisode=\{onPreviousEpisode\}/);
});
