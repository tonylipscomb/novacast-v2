import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildSeriesUpNextNativeFocusProps,
  getSeriesUpNextDefaultFocus,
  resolveSeriesUpNextFocusMove,
  shouldBlockPlayerChromeFocus,
} from '../src/features/playback/continuity/seriesUpNextFocus.ts';
import { shouldActivateVodFocusRouter } from '../src/features/playback/unified/vodSeek.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => readFileSync(join(root, relativePath), 'utf8').replace(/\r\n/g, '\n');
const overlay = read('src/features/playback/continuity/PlaybackUpNextOverlay.tsx');
const playerOverlay = read('src/features/playback/unified/UnifiedPlayerOverlay.tsx');
const controls = read('src/features/playback/unified/UnifiedPlayerControls.tsx');
const controller = read('src/features/playback/unified/UnifiedPlayerController.tsx');
const hiddenChrome = read('src/features/playback/unified/UnifiedPlayerHiddenChromeCapture.tsx');
const focusHelper = read('src/features/playback/continuity/seriesUpNextFocus.ts');

const backSlice = controller.slice(
  controller.indexOf('const handleBack'),
  controller.indexOf('const handleRetry'),
);
const playNextSlice = controller.slice(
  controller.indexOf('const playNextEpisode'),
  controller.indexOf('const cancelUpNext'),
);
const cancelSlice = controller.slice(controller.indexOf('const cancelUpNext'));

test('1. countdown overlay still appears as the Up Next modal', () => {
  assert.match(playerOverlay, /<PlaybackUpNextOverlay/);
  assert.match(overlay, /UP NEXT/);
  assert.match(overlay, /Playing in \$\{secondsLeft\}/);
});

test('2. Play Now is the default focused control', () => {
  assert.equal(getSeriesUpNextDefaultFocus(), 'play-now');
  assert.match(overlay, /hasTVPreferredFocus=\{!preferredConsumed\}/);
  assert.match(overlay, /accessibilityLabel="Play Now"/);
  assert.match(overlay, /focusedControl === 'play-now' && novaTvFocus\.active/);
  assert.match(overlay, /getSeriesUpNextDefaultFocus\(\)/);
});

test('3. RIGHT from Play Now moves to Cancel', () => {
  assert.equal(resolveSeriesUpNextFocusMove('play-now', 'right'), 'cancel');
  assert.deepEqual(
    buildSeriesUpNextNativeFocusProps('play-now', { playNow: 11, cancel: 22 }),
    {
      nextFocusLeft: 11,
      nextFocusUp: 11,
      nextFocusRight: 22,
      nextFocusDown: 11,
    },
  );
});

test('4. LEFT from Cancel moves to Play Now', () => {
  assert.equal(resolveSeriesUpNextFocusMove('cancel', 'left'), 'play-now');
  assert.deepEqual(
    buildSeriesUpNextNativeFocusProps('cancel', { playNow: 11, cancel: 22 }),
    {
      nextFocusLeft: 11,
      nextFocusUp: 22,
      nextFocusRight: 22,
      nextFocusDown: 22,
    },
  );
  assert.equal(resolveSeriesUpNextFocusMove('play-now', 'left'), 'play-now');
  assert.equal(resolveSeriesUpNextFocusMove('cancel', 'right'), 'cancel');
  assert.equal(resolveSeriesUpNextFocusMove('play-now', 'up'), 'play-now');
  assert.equal(resolveSeriesUpNextFocusMove('cancel', 'down'), 'cancel');
});

test('5. SELECT on Play Now starts the next episode', () => {
  assert.match(overlay, /onPress=\{onPlayNow\}/);
  assert.match(playerOverlay, /onPlayNow=\{\(\) => onPlayNextEpisode\?\.\(\)\}/);
  assert.match(controller, /onPlayNextEpisode=\{playNextEpisode\}/);
  assert.match(playNextSlice, /reason === 'play-now' \? 'play-now' : 'autoplay-start'/);
});

test('6. SELECT on Cancel suppresses autoplay', () => {
  assert.match(overlay, /onPress=\{onCancel\}/);
  assert.match(playerOverlay, /onCancel=\{\(\) => onCancelUpNext\?\.\(\)\}/);
  assert.match(controller, /onCancelUpNext=\{cancelUpNext\}/);
  assert.match(cancelSlice, /triggerReason: 'cancel-button'/);
  assert.match(cancelSlice, /setUpNext\(null\)/);
});

test('7. BACK dismisses the overlay only', () => {
  assert.match(backSlice, /if \(upNext\)/);
  assert.match(backSlice, /triggerReason: 'back'/);
  assert.match(backSlice, /setUpNext\(null\)/);
  assert.match(backSlice, /return;/);
  assert.doesNotMatch(backSlice.slice(backSlice.indexOf('if (upNext)'), backSlice.indexOf('const item')), /closeUnifiedPlayback/);
});

test('8. player chrome cannot take focus while the overlay is open', () => {
  assert.equal(shouldBlockPlayerChromeFocus(true), true);
  assert.equal(shouldBlockPlayerChromeFocus(false), false);
  assert.equal(
    shouldActivateVodFocusRouter({
      mediaType: 'episode',
      upNextActive: true,
      platformOs: 'android',
    }),
    false,
  );
  assert.equal(
    shouldActivateVodFocusRouter({
      mediaType: 'episode',
      upNextActive: false,
      platformOs: 'android',
    }),
    true,
  );
  assert.match(playerOverlay, /upNextActive=\{Boolean\(upNext\)\}/);
  assert.match(controls, /upNextActive,/);
  assert.match(playerOverlay, /visible=\{state\.controlsVisible && !upNext\}/);
  assert.match(controls, /focusable=\{visible\}/);
  assert.match(hiddenChrome, /hasTVPreferredFocus=\{!chromeVisible\}/);
  assert.match(controller, /enabled=\{playbackActive && !upNext\}/);
});

test('9. overlay can open again on the next episode', () => {
  assert.match(playerOverlay, /\{upNext \? \(/);
  assert.match(overlay, /focusRequestedRef = useRef\(false\)/);
  assert.match(controller, /upNextArmedForEpisodeIdRef/);
});

test('10. no duplicate focus requests or focus loops', () => {
  assert.match(overlay, /focusRequestedRef\.current = true/);
  assert.match(overlay, /requestAnimationFrame\(attempt\)/);
  assert.doesNotMatch(overlay, /setInterval/);
  assert.doesNotMatch(overlay, /setTimeout\(/);
  assert.match(overlay, /autoFocus: false/);
  assert.match(overlay, /Text focusable=\{false\}/);
  assert.match(overlay, /findNodeHandle/);
  assert.match(overlay, /nextFocusLeft/);
  assert.match(overlay, /nextFocusRight/);
  assert.match(overlay, /target\.focus\(\)/);
  assert.match(cancelSlice, /event: 'focus-restored'/);
  assert.match(backSlice, /event: 'focus-restored'/);
  assert.doesNotMatch(playNextSlice, /focus-restored/);
  assert.match(overlay, /logSeriesAutoplayFocus/);
  assert.match(focusHelper, /\[NovaCast Series Autoplay Focus\]/);
  assert.match(focusHelper, /overlay-focus-owned/);
  assert.match(focusHelper, /play-now-focus-requested/);
  assert.match(focusHelper, /background-focus-blocked/);
});
