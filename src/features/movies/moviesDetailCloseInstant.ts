/**
 * Stage 4.2K / 4.2K.1 / 4.2K.2 — Instant, fully covered Movie Detail close.
 * Pure helpers. MoviesScreen remains the sole coordinator.
 */

export const MOVIES_FOCUS_STAGE4K_MARKER = 'stage4k-movies-instant-covered-detail-close-v1';
export const MOVIES_FOCUS_STAGE4K1_MARKER = 'stage4k1-movies-category-rail-visibility-v1';
export const MOVIES_FOCUS_STAGE4K2_MARKER = 'stage4k2-movies-fallback-target-lock-v1';

/** Confirmation wait after a native-ready focus request (replaces 2200 ms). */
export const MOVIES_DETAIL_FOCUS_CONFIRM_TIMEOUT_MS_V2 = 350;

/** At most one retry after confirmation timeout. */
export const MOVIES_DETAIL_FOCUS_MAX_RETRIES = 1;

/** Normal mounted close budget. */
export const MOVIES_DETAIL_CLOSE_TARGET_MS = 500;

/** Fallback / deep-row budget. */
export const MOVIES_DETAIL_CLOSE_FALLBACK_TARGET_MS = 750;

/**
 * Stage 4.2K.2: hard ceiling for a single close transaction.
 * Prevents permanent closing-focus / isolation deadlock.
 */
export const MOVIES_DETAIL_CLOSE_WATCHDOG_MS = 1400;

/** Stable Movies category rail width (layout invariant). */
export const MOVIES_CATEGORY_RAIL_WIDTH = 260;

/** Stage 4.2K.2: immutable close target locked at transaction start. */
export type MoviesDetailCloseImmutableTarget = {
  token: string;
  source: string;
  origin: string;
  movieId: string;
  categoryId: string;
  renderedIndex: number;
  nativeHandle: number | null;
  gridInstanceId: string | null;
  listRevision: number;
  originalOffset: number;
  firstVisibleIndex: number | null;
  lastVisibleIndex: number | null;
  targetVisible: boolean;
};

/** Stage 4.2K.2: currently executing focus request attempt (mutable). */
export type MoviesDetailCloseFocusAttempt = {
  attemptId: string;
  attemptNumber: number;
  token: string;
  targetMovieId: string;
  requestStartedAt: number | null;
  requestSettledAt: number | null;
  confirmationDeadline: number | null;
  retryRafId: number | null;
};

/** Stage 4.2K.2: accepted focus confirmation (separate from attempt). */
export type MoviesDetailCloseFocusConfirmation = {
  token: string;
  movieId: string;
  acceptedAt: number;
  late: boolean;
};

export function createMoviesDetailCloseImmutableTarget(input: {
  token: string;
  source: string;
  origin: string;
  movieId: string;
  categoryId: string;
  renderedIndex: number;
  nativeHandle?: number | null;
  gridInstanceId?: string | null;
  listRevision?: number;
  originalOffset: number;
  firstVisibleIndex?: number | null;
  lastVisibleIndex?: number | null;
  targetVisible: boolean;
}): MoviesDetailCloseImmutableTarget {
  return {
    token: input.token,
    source: input.source,
    origin: input.origin,
    movieId: input.movieId,
    categoryId: input.categoryId,
    renderedIndex: input.renderedIndex,
    nativeHandle: input.nativeHandle ?? null,
    gridInstanceId: input.gridInstanceId ?? null,
    listRevision: input.listRevision ?? 0,
    originalOffset: input.originalOffset,
    firstVisibleIndex: input.firstVisibleIndex ?? null,
    lastVisibleIndex: input.lastVisibleIndex ?? null,
    targetVisible: input.targetVisible,
  };
}

export function createMoviesDetailCloseFocusAttempt(input: {
  token: string;
  targetMovieId: string;
  attemptNumber: number;
  now?: number;
}): MoviesDetailCloseFocusAttempt {
  const now = input.now ?? Date.now();
  return {
    attemptId: `${input.token}:attempt-${input.attemptNumber}-${now}`,
    attemptNumber: input.attemptNumber,
    token: input.token,
    targetMovieId: input.targetMovieId,
    requestStartedAt: null,
    requestSettledAt: null,
    confirmationDeadline: null,
    retryRafId: null,
  };
}

export function isMoviesDetailCloseTargetMutation(input: {
  immutableMovieId: string;
  requestMovieId: string;
}): boolean {
  return input.requestMovieId !== input.immutableMovieId;
}

/** Confirmation timer starts only after the focus request has settled. */
export function shouldStartMoviesDetailFocusConfirmTimer(input: {
  token: string;
  activeToken: string | null;
  attemptId: string;
  currentAttemptId: string | null;
  focusConfirmed: boolean;
  requestSettled: boolean;
}): boolean {
  return (
    input.requestSettled &&
    input.activeToken === input.token &&
    input.currentAttemptId === input.attemptId &&
    !input.focusConfirmed
  );
}

export function shouldAcceptMoviesDetailCloseLateFocus(input: {
  token: string;
  activeToken: string | null;
  movieId: string;
  immutableMovieId: string | null;
  gridInstanceId: string | null;
  activeGridInstanceId: string | null;
  revealCommitted: boolean;
  cancelled: boolean;
}): boolean {
  if (input.cancelled || input.revealCommitted) {
    return false;
  }
  if (!input.activeToken || input.activeToken !== input.token) {
    return false;
  }
  if (!input.immutableMovieId || input.movieId !== input.immutableMovieId) {
    return false;
  }
  if (
    input.gridInstanceId &&
    input.activeGridInstanceId &&
    input.gridInstanceId !== input.activeGridInstanceId
  ) {
    return false;
  }
  return true;
}

export function resolveMoviesDetailCloseRetryTarget(input: {
  immutableMovieId: string;
  resolvedMovieId: string | null;
  nativeHandle: number | null;
  refMatched: boolean;
  gridInstanceMatched: boolean;
  listRevisionMatched: boolean;
}): {
  ok: boolean;
  immutableMovieId: string;
  resolvedMovieId: string | null;
  nativeHandle: number | null;
  refMatched: boolean;
  gridInstanceMatched: boolean;
  listRevisionMatched: boolean;
} {
  const resolvedMatches =
    Boolean(input.resolvedMovieId) && input.resolvedMovieId === input.immutableMovieId;
  return {
    ok:
      resolvedMatches &&
      input.refMatched &&
      input.gridInstanceMatched &&
      input.listRevisionMatched &&
      input.nativeHandle != null,
    immutableMovieId: input.immutableMovieId,
    resolvedMovieId: input.resolvedMovieId,
    nativeHandle: input.nativeHandle,
    refMatched: input.refMatched,
    gridInstanceMatched: input.gridInstanceMatched,
    listRevisionMatched: input.listRevisionMatched,
  };
}

export function shouldAbortMoviesDetailCloseAfterFailedAttempts(input: {
  focusRequestCount: number;
  maxFocusRequests: number;
  focusConfirmed: boolean;
}): boolean {
  return !input.focusConfirmed && input.focusRequestCount >= input.maxFocusRequests;
}

export function shouldFireMoviesDetailCloseWatchdog(input: {
  startedAt: number;
  now: number;
  watchdogMs: number;
  revealCommitted: boolean;
  cancelled: boolean;
}): boolean {
  if (input.revealCommitted || input.cancelled) {
    return false;
  }
  return input.now - input.startedAt >= input.watchdogMs;
}

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
