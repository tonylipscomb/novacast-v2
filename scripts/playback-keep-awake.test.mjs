import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  isPlaybackActivityActive,
  registerPlaybackActivity,
  resetPlaybackActivityForTests,
  unregisterPlaybackActivity,
} from '../src/features/playback/playbackActivityStore.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => readFileSync(join(root, relativePath), 'utf8');

const packageJson = JSON.parse(read('package.json'));
const keepAwakeComponent = read('src/features/playback/PlaybackKeepAwake.tsx');
const playerHost = read('src/features/playback/unified/UnifiedPlayerHost.tsx');
const appLayout = read('src/app/_layout.tsx');
const liveScreen = read('src/features/live/LiveTvScreen.tsx');
const unifiedController = read('src/features/playback/unified/UnifiedPlayerController.tsx');

test('expo-keep-awake is declared as a runtime dependency', () => {
  assert.ok(
    packageJson.dependencies && packageJson.dependencies['expo-keep-awake'],
    'expo-keep-awake must be a direct dependency',
  );
});

test('the shared playback host owns PlaybackKeepAwake', () => {
  assert.match(playerHost, /import\s*\{\s*PlaybackKeepAwake\s*\}\s*from\s*'\.\.\/PlaybackKeepAwake/);
  assert.match(playerHost, /<PlaybackKeepAwake\s*\/>/);
});

test('useKeepAwake is used with a NovaCast-specific tag', () => {
  assert.match(keepAwakeComponent, /import\s*\{\s*useKeepAwake\s*\}\s*from\s*'expo-keep-awake'/);
  assert.match(keepAwakeComponent, /useKeepAwake\(\s*NOVACAST_PLAYBACK_KEEP_AWAKE_TAG/);
  assert.match(keepAwakeComponent, /NOVACAST_PLAYBACK_KEEP_AWAKE_TAG\s*=\s*'novacast-playback'/);
});

test('keep-awake is conditionally rendered from actual playback session state', () => {
  // The gate must derive its mount decision from the shared session store, not a constant.
  assert.match(keepAwakeComponent, /isPlaybackActivityActive/);
  assert.match(keepAwakeComponent, /subscribePlaybackActivity/);
  assert.match(keepAwakeComponent, /playbackSessionActive\s*\?\s*<PlaybackKeepAwakeLease\s*\/>\s*:\s*null/);
});

test('no App-root/global always-awake implementation was introduced', () => {
  // App root must not hold the screen awake globally.
  assert.doesNotMatch(appLayout, /useKeepAwake|activateKeepAwake|KeepAwake/);
  // The leaf lease must be the only keep-awake call, and it lives behind the session gate.
  const useKeepAwakeCalls = keepAwakeComponent.match(/useKeepAwake\(/g) ?? [];
  assert.equal(useKeepAwakeCalls.length, 1, 'exactly one useKeepAwake owner expected');
  assert.doesNotMatch(keepAwakeComponent, /activateKeepAwakeAsync|activateKeepAwake\(/);
});

test('Live, Movies, and Series converge through the shared playback session store', () => {
  // Live preview + fullscreen register through the shared activity store.
  assert.match(liveScreen, /usePlaybackActivity\('live-fullscreen'/);
  assert.match(liveScreen, /usePlaybackActivity\('live-preview'/);
  // Movies + series (episodes) register through the same shared store.
  assert.match(unifiedController, /registerPlaybackActivity\(/);
  assert.match(unifiedController, /unregisterPlaybackActivity\(\)/);
});

test('no manual WakeLock / FLAG_KEEP_SCREEN_ON implementation was introduced', () => {
  for (const source of [keepAwakeComponent, playerHost, appLayout]) {
    assert.doesNotMatch(source, /FLAG_KEEP_SCREEN_ON|setKeepScreenOn|WakeLock|WAKE_LOCK/);
  }
});

test('session store drives keep-awake activation and release (mount/unmount semantics)', () => {
  resetPlaybackActivityForTests();
  assert.equal(isPlaybackActivityActive(), false, 'idle: screensaver allowed');

  registerPlaybackActivity('movie');
  assert.equal(isPlaybackActivityActive(), true, 'playback open: keep awake');

  // Preview -> fullscreen style handoff: an extra owner registers before the old one releases.
  registerPlaybackActivity('live-fullscreen');
  unregisterPlaybackActivity();
  assert.equal(isPlaybackActivityActive(), true, 'handoff keeps a single continuous lease');

  unregisterPlaybackActivity();
  assert.equal(isPlaybackActivityActive(), false, 'player closed: normal screensaver returns');

  resetPlaybackActivityForTests();
});
