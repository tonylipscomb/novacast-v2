/** Bundled startup video length (5s asset). */
export const STARTUP_VIDEO_DURATION_MS = 5_000;

/** Minimum branded animation duration before the launch screen may exit. */
export const STARTUP_ANIMATION_MIN_MS = STARTUP_VIDEO_DURATION_MS;

/** Maximum time to hold the launch screen while waiting for startup readiness. */
export const STARTUP_READY_TIMEOUT_MS = 6_000;

/** Final crossfade when leaving the launch screen. */
export const STARTUP_EXIT_FADE_MS = 300;

/** Reduced-motion / fallback intro before the splash may exit. */
export const STARTUP_REDUCED_MOTION_INTRO_MS = 600;

/** @deprecated Use STARTUP_ANIMATION_MIN_MS */
export const NOVACAST_MIN_SPLASH_DURATION_MS = STARTUP_ANIMATION_MIN_MS;

export const STARTUP_PHASE_BG_MS = 250;
export const STARTUP_PHASE_LOGO_MS = 600;
export const STARTUP_PHASE_SWEEP_MS = 450;
export const STARTUP_PHASE_STATUS_MS = 300;

export const STARTUP_ANIMATION_TOTAL_MS = STARTUP_VIDEO_DURATION_MS;

export function getStartupElapsedMs(startedAt: number, now = Date.now()) {
  return Math.max(0, now - startedAt);
}

export function getStartupSplashRemainingMs(
  startedAt: number,
  now = Date.now(),
  minimumDurationMs = STARTUP_ANIMATION_MIN_MS,
) {
  return Math.max(0, minimumDurationMs - getStartupElapsedMs(startedAt, now));
}

export function shouldForceStartupExit(
  startedAt: number,
  now = Date.now(),
  readyTimeoutMs = STARTUP_READY_TIMEOUT_MS,
) {
  return getStartupElapsedMs(startedAt, now) >= readyTimeoutMs;
}

export function canExitStartupSplash(
  startupReady: boolean,
  startedAt: number,
  now = Date.now(),
  minimumDurationMs = STARTUP_ANIMATION_MIN_MS,
  readyTimeoutMs = STARTUP_READY_TIMEOUT_MS,
  introComplete = true,
) {
  const elapsed = getStartupElapsedMs(startedAt, now);
  const animationComplete = elapsed >= minimumDurationMs && introComplete;
  const timedOut = elapsed >= readyTimeoutMs;
  return animationComplete && (startupReady || timedOut);
}

export function resolveStartupStatusLabel(startupReady: boolean, exitRequested: boolean) {
  return startupReady || exitRequested ? 'SIGNAL ONLINE' : 'INITIALIZING STREAM';
}
