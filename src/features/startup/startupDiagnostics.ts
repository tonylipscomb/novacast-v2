type StartupTimingAnchor = {
  startedAt: number;
  nativeSplashHiddenAt?: number;
  providerReadyAt?: number;
  exitRequestedAt?: number;
  transitionCompleteAt?: number;
};

let anchor: StartupTimingAnchor | null = null;

export function beginStartupTiming(startedAt = Date.now()) {
  anchor = { startedAt };
  return anchor;
}

export function getStartupTimingAnchor() {
  return anchor;
}

export function resetStartupTimingForTests() {
  anchor = null;
}

function elapsedMs(at = Date.now()) {
  if (!anchor) {
    return 0;
  }

  return Math.max(0, at - anchor.startedAt);
}

export function logStartupPhase(phase: string, at = Date.now()) {
  if (typeof __DEV__ === 'undefined' || !__DEV__) {
    return;
  }

  console.log(`[Startup] ${phase}: ${elapsedMs(at)}ms`);
}

export function markNativeSplashHidden(at = Date.now()) {
  if (!anchor || anchor.nativeSplashHiddenAt) {
    return;
  }

  anchor.nativeSplashHiddenAt = at;
  logStartupPhase('native splash hidden', at);
}

export function markProviderReady(at = Date.now()) {
  if (!anchor || anchor.providerReadyAt) {
    return;
  }

  anchor.providerReadyAt = at;
  logStartupPhase('provider state ready', at);
}

export function markLaunchExitRequested(at = Date.now()) {
  if (!anchor || anchor.exitRequestedAt) {
    return;
  }

  anchor.exitRequestedAt = at;
  logStartupPhase('launch exit requested', at);
}

export function markLaunchTransitionComplete(at = Date.now()) {
  if (!anchor) {
    return;
  }

  anchor.transitionCompleteAt = at;
  logStartupPhase('launch transition complete', at);
}
