import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  getPlayerChromeDefaultFocusControl,
  resolvePlayerChromeWakeKey,
  shouldConsumePlayerChromeWake,
  shouldRouteVisiblePlayerChromeInput,
} from '../src/features/playback/unified/playerChromeWake.ts';
import { resolveVodDirectionalSeekEntry } from '../src/features/playback/unified/vodSeek.ts';
import { resolveUnifiedControlFocusMove } from '../src/features/playback/unified/unifiedPlayerLogic.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => readFileSync(join(root, relativePath), 'utf8').replace(/\r\n/g, '\n');
const remoteHandlers = read('src/features/playback/unified/useUnifiedPlayerRemoteHandlers.tsx');
const controls = read('src/features/playback/unified/UnifiedPlayerControls.tsx');
const controller = read('src/features/playback/unified/UnifiedPlayerController.tsx');
const router = read('src/features/playback/unified/UnifiedPlayerHiddenChromeCapture.tsx');
const liveScreen = read('src/features/live/LiveTvScreen.tsx');
const liveRouter = read('src/features/live/LiveTvFocusRouter.tsx');
const seriesAutoplay = read('src/features/playback/continuity/seriesUpNext.ts');

const hiddenMovie = {
  controlsVisible: false,
  upNextActive: false,
  mediaType: 'movie',
};

test('1. Movie controls hidden + LEFT -> reveal only', () => {
  assert.equal(resolvePlayerChromeWakeKey({ eventType: 'left' }), 'left');
  assert.equal(shouldConsumePlayerChromeWake({ ...hiddenMovie, key: 'left' }), true);
  assert.equal(
    resolveVodDirectionalSeekEntry({
      direction: -1,
      controlsVisible: false,
      mediaType: 'movie',
      durationMs: 600_000,
    }),
    'reveal-only',
  );
});

test('2. Movie controls hidden + RIGHT -> reveal only', () => {
  assert.equal(resolvePlayerChromeWakeKey({ eventType: 'right' }), 'right');
  assert.equal(shouldConsumePlayerChromeWake({ ...hiddenMovie, key: 'right' }), true);
  assert.equal(
    resolveVodDirectionalSeekEntry({
      direction: 1,
      controlsVisible: false,
      mediaType: 'movie',
      durationMs: 600_000,
    }),
    'reveal-only',
  );
});

test('3. Movie controls hidden + UP -> reveal only', () => {
  assert.equal(resolvePlayerChromeWakeKey({ eventType: 'up' }), 'up');
  assert.equal(shouldConsumePlayerChromeWake({ ...hiddenMovie, key: 'up' }), true);
  assert.match(router, /handleVerticalWake\('up'\)/);
});

test('4. Movie controls hidden + DOWN -> reveal only', () => {
  assert.equal(resolvePlayerChromeWakeKey({ eventType: 'down' }), 'down');
  assert.equal(shouldConsumePlayerChromeWake({ ...hiddenMovie, key: 'down' }), true);
  assert.match(router, /handleVerticalWake\('down'\)/);
});

test('5. Movie controls hidden + SELECT -> reveal only, no pause', () => {
  assert.equal(resolvePlayerChromeWakeKey({ eventType: 'select' }), 'select');
  assert.equal(shouldConsumePlayerChromeWake({ ...hiddenMovie, key: 'select' }), true);
  assert.match(remoteHandlers, /shouldConsumePlayerChromeWake/);
  assert.doesNotMatch(remoteHandlers, /onTogglePlayRef\.current\(\)/);
  assert.match(remoteHandlers, /event: 'wake-consumed'/);
});

test('6. Second SELECT activates Play/Pause', () => {
  assert.equal(
    shouldConsumePlayerChromeWake({
      controlsVisible: true,
      upNextActive: false,
      mediaType: 'movie',
      key: 'select',
    }),
    false,
  );
  assert.equal(
    shouldRouteVisiblePlayerChromeInput({
      controlsVisible: true,
      upNextActive: false,
      mediaType: 'movie',
      key: 'select',
    }),
    true,
  );
  assert.match(controls, /onPress=\{\(\) => handleControlPress\('play'/);
});

test('7. Controls visible -> existing DPAD navigation unchanged', () => {
  assert.equal(resolveUnifiedControlFocusMove('play', { key: 'ArrowLeft' }), 'rewind');
  assert.equal(resolveUnifiedControlFocusMove('play', { key: 'ArrowRight' }), 'forward');
  assert.equal(resolveUnifiedControlFocusMove('play', { key: 'ArrowUp' }), 'seek');
  assert.equal(resolveUnifiedControlFocusMove('play', { key: 'ArrowDown' }), 'seek');
});

test('8. Controls visible -> existing seek behavior unchanged', () => {
  assert.equal(
    resolveVodDirectionalSeekEntry({
      direction: 1,
      controlsVisible: true,
      mediaType: 'movie',
      durationMs: 600_000,
    }),
    'begin-preview',
  );
  assert.match(controls, /onVodDirectionalSeek\(direction, 'hidden-focus-sentinel'\)/);
  assert.match(controls, /if \(!visible\) \{\s*return;/);
});

test('9. Episode autoplay E1 -> E2 -> controls hidden -> DPAD wakes controls', () => {
  assert.equal(
    shouldConsumePlayerChromeWake({
      controlsVisible: false,
      upNextActive: false,
      mediaType: 'episode',
      key: 'right',
    }),
    true,
  );
  assert.match(controls, /event: 'stale-focus-cleared'/);
  assert.match(seriesAutoplay, /playNextEpisode|createSeriesUpNextTransitionId/);
  assert.doesNotMatch(controller, /UP_NEXT_COUNTDOWN_SECONDS = /);
});

test('10. After source replacement, default visible control receives focus', () => {
  assert.equal(getPlayerChromeDefaultFocusControl(), 'play');
  assert.match(controls, /requestDefaultChromeFocus/);
  assert.match(controls, /event: 'default-focus-requested'/);
  assert.match(controls, /event: 'default-focused'/);
  assert.match(controls, /previousContentIdRef\.current !== contentId/);
});

test('11. Up Next visible -> player chrome wake gate does not steal focus', () => {
  assert.equal(
    shouldConsumePlayerChromeWake({
      controlsVisible: false,
      upNextActive: true,
      mediaType: 'episode',
      key: 'select',
    }),
    false,
  );
  assert.match(controller, /enabled=\{playbackActive && !upNext\}/);
  assert.match(controls, /if \(visible \|\| upNextActive\)/);
});

test('12. Cancel Up Next -> normal VOD chrome wake behavior returns', () => {
  assert.equal(
    shouldConsumePlayerChromeWake({
      controlsVisible: false,
      upNextActive: false,
      mediaType: 'episode',
      key: 'select',
    }),
    true,
  );
  assert.match(controller, /onCancelUpNext=\{cancelUpNext\}/);
  assert.match(controller, /upNextActive=\{Boolean\(upNext\)\}/);
});

test('13. No focus loop / no repeated focus timers', () => {
  assert.match(controls, /requestAnimationFrame\(attempt\)/);
  assert.doesNotMatch(controls, /setInterval/);
  assert.doesNotMatch(remoteHandlers, /setInterval/);
  assert.match(controls, /if \(!retried\)/);
  assert.match(router, /focusNativeViewWhenReady\(\(\) => anchorRef\.current, \(\) => \{\}, 2\)/);
});

test('14. Live TV behavior untouched', () => {
  assert.equal(
    shouldConsumePlayerChromeWake({
      controlsVisible: false,
      upNextActive: false,
      mediaType: 'live',
      key: 'left',
    }),
    false,
  );
  assert.match(liveRouter, /Live fullscreen LEFT\/RIGHT channel surfing/);
  assert.match(liveScreen, /onSentinelFocus=\{handleLiveSurfSentinelFocus\}/);
  assert.doesNotMatch(liveScreen, /shouldConsumePlayerChromeWake/);
});
