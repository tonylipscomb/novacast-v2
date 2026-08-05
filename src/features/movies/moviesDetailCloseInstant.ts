/**
 * Stage 4.2K — Instant, fully covered Movie Detail close.
 * Pure helpers. MoviesScreen remains the sole coordinator.
 */

export const MOVIES_FOCUS_STAGE4K_MARKER = 'stage4k-movies-instant-covered-detail-close-v1';

/** Confirmation wait after a native-ready focus request (replaces 2200 ms). */
export const MOVIES_DETAIL_FOCUS_CONFIRM_TIMEOUT_MS_V2 = 350;

/** At most one retry after confirmation timeout. */
export const MOVIES_DETAIL_FOCUS_MAX_RETRIES = 1;

/** Normal mounted close budget. */
export const MOVIES_DETAIL_CLOSE_TARGET_MS = 500;

/** Fallback / deep-row budget. */
export const MOVIES_DETAIL_CLOSE_FALLBACK_TARGET_MS = 750;

export function shouldIssueMoviesDetailCloseFocusRequest(input: {
  phase: string;
  nativeEnvironmentReady: boolean;
  focusAlreadyIssued: boolean;
  focusRequestCount: number;
  maxFocusRequests: number;
}): boolean {
  if (!input.nativeEnvironmentReady) {
    return false;
  }
  if (input.focusAlreadyIssued) {
    return false;
  }
  if (input.focusRequestCount >= input.maxFocusRequests) {
    return false;
  }
  return input.phase === 'return-focus-requested' || input.phase === 'closing-focus';
}

export function shouldAcceptMoviesDetailCloseFocusConfirmation(input: {
  token: string;
  confirmedToken: string | null;
  movieId: string;
  targetMovieId: string | null;
}): boolean {
  if (!input.targetMovieId || input.movieId !== input.targetMovieId) {
    return false;
  }
  if (input.confirmedToken === input.token) {
    return false;
  }
  return true;
}

export function shouldReleaseMoviesDetailVisualIsolation(input: {
  focusConfirmed: boolean;
  movieIdConfirmed: boolean;
  offsetConfirmed: boolean;
  correctiveScrollPending: boolean;
}): boolean {
  return (
    input.focusConfirmed &&
    input.movieIdConfirmed &&
    input.offsetConfirmed &&
    !input.correctiveScrollPending
  );
}

export function isMoviesDetailCloseCorrectionUncovered(input: {
  visualIsolationActive: boolean;
  visualHoldActive: boolean;
}): boolean {
  return !input.visualIsolationActive && !input.visualHoldActive;
}

export function createMoviesDetailOverlayInstanceId(now = Date.now()): string {
  return `movie-detail-overlay-${now}`;
}
