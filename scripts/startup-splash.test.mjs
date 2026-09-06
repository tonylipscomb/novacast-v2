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
const introSource = readFileSync(new URL('../src/features/startup/NovaCastIntroScreen.tsx', import.meta.url), 'utf8');
const layoutSource = readFileSync(new URL('../src/app/_layout.tsx', import.meta.url), 'utf8');
const shellSource = readFileSync(new URL('../src/components/nova/NovaTvShell.tsx', import.meta.url), 'utf8');
const visualGateSource = readFileSync(new URL('../src/features/startup/startupVisualGate.tsx', import.meta.url), 'utf8');

test('cold intro trusts sourceLoad duration and rejects an early playToEnd', () => {
  assert.match(introSource, /confirmedDurationRef = useRef<number \| null>\(null\)/);
  assert.match(introSource, /sourceLoadedRef = useRef\(false\)/);
  assert.match(introSource, /INTRO_UNKNOWN_DURATION_FALLBACK_MS = 15_000/);
  assert.match(introSource, /armFallback\(\);/);
  assert.doesNotMatch(introSource, /armFallback\(player\.duration\)/);
  assert.match(introSource, /sourceLoadedRef\.current = true/);
  assert.match(introSource, /confirmedDurationRef\.current = duration/);
  assert.match(introSource, /currentTime < confirmedDuration - INTRO_DURATION_TOLERANCE_MS \/ 1000/);
  assert.match(introSource, /logIntro\('early-play-to-end'/);
  assert.match(introSource, /earlyPlayToEndResumeAttemptedRef/);
  assert.match(introSource, /logIntro\('source-load'/);
  assert.match(introSource, /logIntro\('ready-to-play'/);
  assert.match(introSource, /logIntro\('fallback-timeout'/);
  assert.match(introSource, /logIntro\('player-error'/);
});

test('native splash handoff uses validated media readiness, not first-frame delivery', () => {
  assert.match(introSource, /const reportMediaReadyForSplashHandoff = useCallback/);
  assert.match(introSource, /sourceLoadedRef\.current &&[\s\S]*acceptsReadyDuration/);
  assert.match(introSource, /acceptsReadyDuration\)[\s\S]*reportMediaReadyForSplashHandoff\(\)/);
  assert.match(introSource, /logIntro\('native-splash-handoff-ready'/);
  assert.match(introSource, /const reportFirstFrame = useCallback/);
  assert.match(introSource, /onFirstFrameRender=\{reportFirstFrame\}/);
  assert.doesNotMatch(introSource, /onFirstFrameRender=\{reportMediaReadyForSplashHandoff\}/);
  assert.match(introSource, /status === 'readyToPlay'/);
  assert.match(introSource, /sourceLoaded: sourceLoadedRef\.current/);
});

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

test('cold intro is the only visible startup screen', () => {
  assert.match(launchSource, /novacast-startup\.mp4/);
  assert.match(launchSource, /VideoView/);
  assert.match(launchSource, /useVideoPlayer/);
  assert.match(launchSource, /onFirstFrameRender/);
  assert.match(launchSource, /startup video first frame timeout/);
  assert.match(launchSource, /logStartupPhase/);
  assert.doesNotMatch(layoutSource, /if \(showBrandSplash\)/);
  assert.doesNotMatch(layoutSource, /surfaceView/);
  assert.match(introSource, /SIGNAL INITIALIZING\.\.\./);
  assert.match(introSource, /appStartupReady/);
  assert.match(introSource, /videoCompleted/);
  assert.doesNotMatch(launchSource, /starField|LaunchStar|setInterval/);
  assert.equal(STARTUP_REDUCED_MOTION_INTRO_MS, 600);
});

test('intro remains above the app until video completion and startup readiness', () => {
  assert.match(layoutSource, /hideNativeSplash/);
  assert.match(layoutSource, /hideNativeSplash[\s\S]*hideAsync/);
  assert.match(layoutSource, /appStartupReady=\{startupReady\}/);
  assert.match(layoutSource, /native splash hide fallback/);
  assert.match(layoutSource, /showColdIntro \?/);
  assert.match(layoutSource, /visualsVisible=\{!showColdIntro\}/);
  assert.match(layoutSource, /appContentHidden/);
  assert.match(layoutSource, /display: 'none'/);
  assert.match(layoutSource, /pointerEvents=\{visualsVisible \? 'auto' : 'none'\}/);
  assert.doesNotMatch(layoutSource, /requestAnimationFrame/);
  assert.match(introSource, /if \(!videoCompleted \|\| !appStartupReady \|\| !initializingMinimumElapsed\)/);
  assert.match(introSource, /INTRO_INITIALIZING_MINIMUM_MS = 1_000/);
  assert.match(introSource, /setInitializingMinimumElapsed\(true\)/);
  assert.match(introSource, /!initializingMinimumElapsed/);
  assert.match(introSource, /finish\('video-complete-and-startup-ready'\)/);
  assert.match(introSource, /setVideoCompleted\(true\)/);
  assert.doesNotMatch(introSource, /useEffect\(\(\) => \{\s*markNovaCastIntroPlayed\(\);/);
  assert.doesNotMatch(layoutSource, /<NovaCastLaunchSequence[\s\S]*onIntroComplete=\{\(\) => setIntroComplete\(true\)\}/);
  assert.doesNotMatch(layoutSource, /canExitStartupSplash/);
  const readinessEffect = layoutSource.slice(layoutSource.indexOf('useEffect(() => {'), layoutSource.indexOf('const hideNativeSplash'));
  assert.doesNotMatch(readinessEffect, /hideAsync/);
});

test('startup keeps bootstrap mounted but withholds the visible app scene', () => {
  assert.match(layoutSource, /styles\.appSceneHidden/);
  assert.match(layoutSource, /appSceneHidden:\s*\{\s*display: 'none'/);
  assert.match(layoutSource, /<ThemedAppRoot[\s\S]*visualsVisible=\{!showColdIntro\}/);
  assert.match(layoutSource, /<View[\s\S]*styles\.appScene[\s\S]*<ThemedAppRoot/);
  assert.match(introSource, /videoCompleted \? \(/);
  assert.match(introSource, /SIGNAL INITIALIZING\.\.\./);
});

test('intro owns a normal flex scene while the global app background is hidden', () => {
  assert.match(layoutSource, /<View style=\{styles\.introScene\}>[\s\S]*<NovaCastIntroScreen/);
  assert.match(layoutSource, /introScene:\s*\{\s*flex: 1,\s*backgroundColor: '#000000'/);
  assert.doesNotMatch(layoutSource, /coldIntroLayer/);
  assert.doesNotMatch(layoutSource, /zIndex: 2000/);
  assert.doesNotMatch(layoutSource, /elevation: Platform\.OS === 'android' \? 200 : 100/);
  assert.match(layoutSource, /<ImageBackground[\s\S]*style=\{styles\.root\}/);
  assert.match(layoutSource, /<View style=\{\[styles\.appScene, showColdIntro && styles\.appSceneHidden\]\}>/);
});

test('startup disables the focusable TV shell until the complete phase', () => {
  assert.match(layoutSource, /<StartupVisualGateProvider interactive=\{visualsVisible\}>/);
  assert.match(layoutSource, /<StartupVisualGateProvider[\s\S]*<Stack[\s\S]*\/>[\s\S]*<\/StartupVisualGateProvider>/);
  assert.match(visualGateSource, /createContext\(true\)/);
  assert.match(visualGateSource, /interactive: boolean/);
  assert.match(shellSource, /useStartupVisualInteractive/);
  assert.match(shellSource, /const navigationFocusable = navigationFocusableProp && startupInteractive/);
  assert.match(shellSource, /focusable=\{navigationFocusable\}/);
  assert.match(shellSource, /hasTVPreferredFocus=\{shouldArmNavbarPreferredFocus\([\s\S]*navigationFocusable/);
});

test('accepted intro completion cancels the fallback before entering initializing', () => {
  assert.match(introSource, /videoCompletedRef = useRef\(false\)/);
  assert.match(introSource, /if \(videoCompletedRef\.current\) \{/);
  assert.match(introSource, /logIntro\('play-to-end'[\s\S]*clearTimeout\(fallbackTimerRef\.current\)/);
  assert.match(introSource, /videoCompletedRef\.current = true[\s\S]*setVideoCompleted\(true\)/);
  assert.match(introSource, /INTRO_INITIALIZING_MINIMUM_MS = 1_000/);
  assert.match(introSource, /setInitializingMinimumElapsed\(true\)/);
});

test('only the startup intro opts into Expo Video TextureView composition', () => {
  assert.match(introSource, /<VideoView[\s\S]*surfaceType="textureView"/);
  assert.doesNotMatch(launchSource, /surfaceType="textureView"/);
  const playbackSources = [
    readFileSync(new URL('../src/features/playback/NovaStreamPlayer.tsx', import.meta.url), 'utf8'),
    readFileSync(new URL('../src/features/playback/unified/UnifiedPlayerOverlay.tsx', import.meta.url), 'utf8'),
  ];
  for (const source of playbackSources) {
    assert.doesNotMatch(source, /surfaceType="textureView"/);
  }
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
