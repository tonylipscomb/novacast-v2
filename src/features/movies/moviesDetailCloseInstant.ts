/**
 * Stage 4.2K / 4.2K.1 — Instant, fully covered Movie Detail close.
 * Pure helpers. MoviesScreen remains the sole coordinator.
 */

export const MOVIES_FOCUS_STAGE4K_MARKER = 'stage4k-movies-instant-covered-detail-close-v1';
export const MOVIES_FOCUS_STAGE4K1_MARKER = 'stage4k1-movies-category-rail-visibility-v1';

/** Confirmation wait after a native-ready focus request (replaces 2200 ms). */
export const MOVIES_DETAIL_FOCUS_CONFIRM_TIMEOUT_MS_V2 = 350;

/** At most one retry after confirmation timeout. */
export const MOVIES_DETAIL_FOCUS_MAX_RETRIES = 1;

/** Normal mounted close budget. */
export const MOVIES_DETAIL_CLOSE_TARGET_MS = 500;

/** Fallback / deep-row budget. */
export const MOVIES_DETAIL_CLOSE_FALLBACK_TARGET_MS = 750;

/** Stable Movies category rail width (layout invariant). */
export const MOVIES_CATEGORY_RAIL_WIDTH = 260;

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
  /** Stage 4.2K.1: browse shell layout restored (defaults true for Stage 4.2K callers). */
  browseLayoutConfirmed?: boolean;
  /** Stage 4.2K.1: category rail visual state confirmed (defaults true for Stage 4.2K callers). */
  railVisibleConfirmed?: boolean;
}): boolean {
  return (
    input.focusConfirmed &&
    input.movieIdConfirmed &&
    input.offsetConfirmed &&
    !input.correctiveScrollPending &&
    input.browseLayoutConfirmed !== false &&
    input.railVisibleConfirmed !== false
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

export function createMoviesCategoryRailInstanceId(now = Date.now()): string {
  return `movie-category-rail-${now}`;
}

/** Stage 4.2K.1: browse expects the category rail to be painted and focusable. */
export function isMoviesCategoryRailExpectedVisible(input: {
  moviesRouteActive: boolean;
  categoryCount: number;
  detailOpen: boolean;
  searchClosed: boolean;
  playbackInactive: boolean;
  playbackClosing: boolean;
  closeTransactionFinished: boolean;
  /** Isolation/hold cleanup finished — not mid-close cover. */
  visualCleanupFinished?: boolean;
}): boolean {
  return (
    input.moviesRouteActive &&
    input.categoryCount > 0 &&
    !input.detailOpen &&
    input.searchClosed &&
    input.playbackInactive &&
    !input.playbackClosing &&
    input.closeTransactionFinished &&
    input.visualCleanupFinished !== false
  );
}

/** Stage 4.2K.1: any residual overlay/isolation state that can hide the rail. */
export function isMoviesCategoryRailVisibilityViolation(input: {
  railExpectedVisible: boolean;
  visualIsolationActive: boolean;
  holdCoverActive: boolean;
  focusHandoffActive: boolean;
  overlayVisible: boolean;
  isolationCoverMounted: boolean;
  railContainerWidth: number;
  browseOpacity: number;
  overlayOpacity: number;
}): boolean {
  if (!input.railExpectedVisible) {
    return false;
  }
  if (input.visualIsolationActive || input.holdCoverActive || input.focusHandoffActive) {
    return true;
  }
  if (input.overlayVisible || input.isolationCoverMounted) {
    return true;
  }
  if (input.railContainerWidth <= 0) {
    return true;
  }
  if (input.browseOpacity < 1) {
    return true;
  }
  if (input.overlayOpacity > 0) {
    return true;
  }
  return false;
}

/** Stage 4.2K.1: closed overlay shell must not paint or own focus. */
export function isMoviesDetailOverlayClosedShellInert(input: {
  panelVisible: boolean;
  visualIsolationActive: boolean;
  pointerEvents: string;
  hasBackdrop: boolean;
  hasIsolationCover: boolean;
  hasBlur: boolean;
  hasCard: boolean;
  layoutWidth: number;
  layoutFlex: number | null;
}): boolean {
  if (input.panelVisible || input.visualIsolationActive) {
    return false;
  }
  return (
    input.pointerEvents === 'none' &&
    !input.hasBackdrop &&
    !input.hasIsolationCover &&
    !input.hasBlur &&
    !input.hasCard &&
    input.layoutWidth === 0 &&
    (input.layoutFlex == null || input.layoutFlex === 0)
  );
}

/**
 * Stage 4.2K.1: timeout callback must not schedule retry when confirmation
 * arrived on the same turn (before or after the timeout event emit).
 */
export function shouldScheduleMoviesDetailFocusRetry(input: {
  focusConfirmedForToken: boolean;
}): boolean {
  return !input.focusConfirmedForToken;
}

export type MoviesDetailCloseVisualState = {
  visualIsolationActive: boolean;
  holdCoverActive: boolean;
  focusHandoffActive: boolean;
  isolationToken: string | null;
  visualCoverToken: string | null;
};

export function createNeutralMoviesDetailCloseVisualState(): MoviesDetailCloseVisualState {
  return {
    visualIsolationActive: false,
    holdCoverActive: false,
    focusHandoffActive: false,
    isolationToken: null,
    visualCoverToken: null,
  };
}
