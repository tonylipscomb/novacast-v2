import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  canExitStartupSplash,
  getStartupSplashRemainingMs,
  resolveStartupStatusLabel,
  shouldForceStartupExit,
  STARTUP_ANIMATION_MIN_MS,
  STARTUP_ANIMATION_TOTAL_MS,
  STARTUP_EXIT_FADE_MS,
  STARTUP_REDUCED_MOTION_INTRO_MS,
  STARTUP_READY_TIMEOUT_MS,
  STARTUP_VIDEO_DURATION_MS,
} from '../src/features/startup/startupLogic.ts';
import {
  beginStartupTiming,
  getStartupTimingAnchor,
  markLaunchExitRequested,
  markLaunchTransitionComplete,
  markNativeSplashHidden,
  markProviderReady,
  resetStartupTimingForTests,
} from '../src/features/startup/startupDiagnostics.ts';
import {
  isStartupReady,
  markStartupReady,
  resetStartupReadinessForTests,
} from '../src/features/startup/startupReadiness.ts';

const launchSource = readFileSync(new URL('../src/features/startup/NovaCastLaunchSequence.tsx', import.meta.url), 'utf8');
const layoutSource = readFileSync(new URL('../src/app/_layout.tsx', import.meta.url), 'utf8');

test('startup animation minimum duration matches bundled video length', () => {
  const startedAt = 1000;

  assert.equal(STARTUP_ANIMATION_MIN_MS, STARTUP_VIDEO_DURATION_MS);
  assert.equal(STARTUP_ANIMATION_MIN_MS, 5000);
  assert.equal(STARTUP_ANIMATION_TOTAL_MS, STARTUP_VIDEO_DURATION_MS);
  assert.equal(getStartupSplashRemainingMs(startedAt, startedAt), 5000);
  assert.equal(getStartupSplashRemainingMs(startedAt, startedAt + 900), 4100);
  assert.equal(getStartupSplashRemainingMs(startedAt, startedAt + 5200), 0);
});

test('startup splash waits for intro completion even when readiness is early', () => {
  const startedAt = 1000;

  assert.equal(canExitStartupSplash(true, startedAt, startedAt + 2500, undefined, undefined, false), false);
  assert.equal(canExitStartupSplash(true, startedAt, startedAt + 2500, undefined, undefined, true), false);
  assert.equal(canExitStartupSplash(true, startedAt, startedAt + 5000, undefined, undefined, true), true);
});

test('readiness completing before animation minimum waits for the visual sequence', () => {
  const startedAt = 1000;

  assert.equal(canExitStartupSplash(true, startedAt, startedAt + 4500, undefined, undefined, true), false);
  assert.equal(getStartupSplashRemainingMs(startedAt, startedAt + 4500), 500);
  assert.equal(canExitStartupSplash(true, startedAt, startedAt + 5000, undefined, undefined, true), true);
});

test('readiness completing after animation minimum exits immediately', () => {
  const startedAt = 1000;

  assert.equal(canExitStartupSplash(true, startedAt, startedAt + 3200, undefined, undefined, true), false);
  assert.equal(canExitStartupSplash(true, startedAt, startedAt + 5200, undefined, undefined, true), true);
  assert.equal(getStartupSplashRemainingMs(startedAt, startedAt + 5200), 0);
});

test('startup timeout fallback exits even when readiness never completes', () => {
  const startedAt = 1000;

  assert.equal(canExitStartupSplash(false, startedAt, startedAt + 5000, undefined, undefined, true), false);
  assert.equal(shouldForceStartupExit(startedAt, startedAt + 6000), true);
  assert.equal(canExitStartupSplash(false, startedAt, startedAt + 6000, undefined, undefined, true), true);
});

test('resolveStartupStatusLabel switches to SIGNAL ONLINE when ready or exiting', () => {
  assert.equal(resolveStartupStatusLabel(false, false), 'INITIALIZING STREAM');
  assert.equal(resolveStartupStatusLabel(true, false), 'SIGNAL ONLINE');
  assert.equal(resolveStartupStatusLabel(false, true), 'SIGNAL ONLINE');
});

test('launch sequence uses bundled startup video with reduced-motion fallback', () => {
  assert.match(launchSource, /novacast-startup\.mp4/);
  assert.match(launchSource, /VideoView/);
  assert.match(launchSource, /useVideoPlayer/);
  assert.match(launchSource, /onFirstFrameRender/);
  assert.match(launchSource, /startup video first frame timeout/);
  assert.match(launchSource, /logStartupPhase/);
  assert.match(layoutSource, /if \(showBrandSplash\)/);
  assert.doesNotMatch(layoutSource, /surfaceView/);
  assert.match(launchSource, /SIGNAL ONLINE|resolveStartupStatusLabel/);
  assert.doesNotMatch(launchSource, /starField|LaunchStar|setInterval/);
  assert.equal(STARTUP_REDUCED_MOTION_INTRO_MS, 600);
});

test('native splash handoff is driven by the branded launch layout', () => {
  assert.match(layoutSource, /hideNativeSplash/);
  assert.match(layoutSource, /hideNativeSplash[\s\S]*hideAsync/);
  assert.match(layoutSource, /onVideoReady=\{handleLaunchLayout\}/);
  assert.match(layoutSource, /native splash hide fallback/);
  assert.match(layoutSource, /showBrandSplash/);
  assert.doesNotMatch(layoutSource, /requestAnimationFrame/);
  assert.match(layoutSource, /onIntroComplete/);
  assert.match(layoutSource, /introComplete/);
  assert.match(layoutSource, /STARTUP_READY_TIMEOUT_MS/);
  assert.match(layoutSource, /startup ready timeout fallback/);
  assert.doesNotMatch(layoutSource, /canExitStartupSplash/);
  const readinessEffect = layoutSource.slice(layoutSource.indexOf('useEffect(() => {'), layoutSource.indexOf('const hideNativeSplash'));
  assert.doesNotMatch(readinessEffect, /hideAsync/);
});

test('startup diagnostics record safe phase timestamps once', () => {
  resetStartupTimingForTests();
  resetStartupReadinessForTests();

  beginStartupTiming(1000);
  markNativeSplashHidden(1320);
  markProviderReady(2180);
  markLaunchExitRequested(1690);
  markLaunchTransitionComplete(1990);

  markNativeSplashHidden(1500);
  markProviderReady(2400);

  const anchor = getStartupTimingAnchor();
  assert.equal(anchor?.startedAt, 1000);
  assert.equal(anchor?.nativeSplashHiddenAt, 1320);
  assert.equal(anchor?.providerReadyAt, 2180);
  assert.equal(anchor?.exitRequestedAt, 1690);
  assert.equal(anchor?.transitionCompleteAt, 1990);

  assert.equal(isStartupReady(), false);
  markStartupReady();
  assert.equal(isStartupReady(), true);
  assert.equal(STARTUP_EXIT_FADE_MS, 300);
});
