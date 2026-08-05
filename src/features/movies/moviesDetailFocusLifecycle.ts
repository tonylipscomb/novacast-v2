/**
 * Stage 3D / 3D.1 / 4.2G — Movies-only detail focus lifecycle.
 * Pure helpers + diagnostics. MoviesScreen is the sole coordinator.
 *
 * Stage 4.2G/K natural return (mounted poster):
 *   detail-open → return-focus-arming → return-focus-requested → return-focus-confirmed → browse-restored → browse
 * Fallback (unmounted / generation change / etc.) retains closing-prepare → viewport → focus.
 */

export type MoviesDetailFocusPhase =
  | 'browse'
  | 'detail-open'
  /** Stage 4.2K: handoff armed; wait for native focus environment before request. */
  | 'return-focus-arming'
  | 'return-focus-requested'
  | 'return-focus-confirmed'
  | 'closing-prepare'
  | 'closing-viewport'
  | 'closing-focus'
  | 'closing-confirm'
  | 'browse-restored';

export type MoviesBrowseFocusSnapshot = {
  categoryId: string;
  movieId: string;
  movieIndex: number;
  verticalOffset: number;
  visibleFirstIndex: number | null;
  visibleLastIndex: number | null;
  /** Relative row within the visible window at detail-open (0 = first visible row). */
  targetRelativeRow: number | null;
  /** Column within the poster grid at detail-open. */
  targetRelativeColumn: number | null;
};

export type MoviesDetailFocusToken = {
  token: string;
  source: 'detail-close' | 'playback-close';
  snapshot: MoviesBrowseFocusSnapshot;
};

/**
 * Stage 4.2K: confirmation wait after a native-ready focus request.
 * (Legacy 2200 ms caused a visible 2.2s stall on ONN.)
 */
export const MOVIES_DETAIL_FOCUS_CONFIRM_TIMEOUT_MS = 350;
export const MOVIES_VIEWPORT_OFFSET_TOLERANCE_PX = 12;
/** Stage 3D.3: event-driven browse handoff — one frame, not a long settle timer. */
export const MOVIES_FOCUS_SUPPRESSION_RELEASE_MS = 32;
export const MOVIES_MAX_VIEWPORT_RESTORES = 2;
export const MOVIES_MAX_FOCUS_REQUESTS = 2;
/** Stage 3D.2: keep restored poster preferred ownership after overlay removal. */
export const MOVIES_POST_RESTORE_LATCH_MS = 750;
/** Stage 3D.3: mounted-target focus wait (frames). Offscreen keeps a higher budget. */
export const MOVIES_MOUNTED_FOCUS_MAX_FRAMES = 8;
export const MOVIES_OFFSCREEN_FOCUS_MAX_FRAMES = 24;
/** Typical native TV focus auto-align magnitude (~one poster row). */
export const MOVIES_NATIVE_FOCUS_ROW_ALIGN_MAX_PX = 140;

export type MoviesPostRestoreReleaseReason =
  | 'dpad-input'
  | 'focus-left-poster'
  | 'screen-change'
  | 'timeout'
  | 'unmount';

export type MoviesPostRestoreLatch = {
  token: string | null;
  restoredMovieId: string;
  restoredAt: number;
  postRestoreActive: boolean;
};

export function createMoviesPostRestoreLatch(input: {
  token: string | null;
  restoredMovieId: string;
  restoredAt?: number;
}): MoviesPostRestoreLatch {
  return {
    token: input.token,
    restoredMovieId: input.restoredMovieId,
    restoredAt: input.restoredAt ?? Date.now(),
    postRestoreActive: true,
  };
}

export function isMoviesPostRestoreLatchActive(latch: MoviesPostRestoreLatch | null | undefined): boolean {
  return Boolean(latch?.postRestoreActive && latch.restoredMovieId);
}

/** Preferred-focus lock only — does not affect normal focusability / D-pad. */
export function shouldSuppressPreferredFocusDuringPostRestore(
  latch: MoviesPostRestoreLatch | null | undefined,
): boolean {
  return isMoviesPostRestoreLatchActive(latch);
}

export function shouldMoviesPosterRetainPostRestorePreferredFocus(input: {
  latch: MoviesPostRestoreLatch | null | undefined;
  movieId: string;
}): boolean {
  return isMoviesPostRestoreLatchActive(input.latch) && input.latch!.restoredMovieId === input.movieId;
}

export function logMoviesPostRestoreFocus(payload: {
  token: string | null;
  restoredMovieId: string | null;
  phase: MoviesDetailFocusPhase | 'browse';
  postRestoreActive: boolean;
  searchPreferred: boolean;
  navbarPreferred: boolean;
  categoryPreferred: boolean;
  firstPosterPreferred: boolean;
  actualFocusedComponent: string | null;
  releaseReason: MoviesPostRestoreReleaseReason | null;
}) {
  console.info(
    '[NovaCast Movies Post Restore Focus] ' +
      JSON.stringify({
        token: payload.token,
        restoredMovieId: payload.restoredMovieId,
        phase: payload.phase,
        postRestoreActive: payload.postRestoreActive,
        searchPreferred: payload.searchPreferred,
        navbarPreferred: payload.navbarPreferred,
        categoryPreferred: payload.categoryPreferred,
        firstPosterPreferred: payload.firstPosterPreferred,
        actualFocusedComponent: payload.actualFocusedComponent,
        releaseReason: payload.releaseReason,
      }),
  );
}

export function logMoviesSearchFocusBlocked(payload: {
  token: string | null;
  reason: string;
  source: string;
}) {
  console.info(
    '[NovaCast Movies Search Focus Blocked] ' +
      JSON.stringify({
        token: payload.token,
        reason: payload.reason,
        source: payload.source,
      }),
  );
}

export type MoviesRestoreTimingState = {
  token: string | null;
  startedAt: number;
  viewportConfirmedAt: number | null;
  focusConfirmedAt: number | null;
  overlayRemovedAt: number | null;
  correctiveScrollUsed: boolean;
  searchFocusAttempted: boolean;
};

export function createMoviesRestoreTiming(token: string | null, startedAt = Date.now()): MoviesRestoreTimingState {
  return {
    token,
    startedAt,
    viewportConfirmedAt: null,
    focusConfirmedAt: null,
    overlayRemovedAt: null,
    correctiveScrollUsed: false,
    searchFocusAttempted: false,
  };
}

export function logMoviesRestoreTiming(payload: {
  token: string | null;
  startedAt: number;
  viewportConfirmedAt: number | null;
  focusConfirmedAt: number | null;
  overlayRemovedAt: number | null;
  totalMs: number | null;
  correctiveScrollUsed: boolean;
  searchFocusAttempted: boolean;
}) {
  console.info(
    '[NovaCast Movies Restore Timing] ' +
      JSON.stringify({
        token: payload.token,
        startedAt: payload.startedAt,
        viewportConfirmedAt: payload.viewportConfirmedAt,
        focusConfirmedAt: payload.focusConfirmedAt,
        overlayRemovedAt: payload.overlayRemovedAt,
        totalMs: payload.totalMs,
        correctiveScrollUsed: payload.correctiveScrollUsed,
        searchFocusAttempted: payload.searchFocusAttempted,
      }),
  );
}

/**
 * Stage 3D.3: native focus often nudges the list by roughly one row.
 * Detect that class of drift so we can prefer prevention / single corrective restore.
 */
export function isMoviesNativeFocusRowAlignmentDrift(input: {
  offsetDelta: number;
  rowHeightEstimate?: number | null;
}): boolean {
  const abs = Math.abs(input.offsetDelta);
  if (abs <= MOVIES_VIEWPORT_OFFSET_TOLERANCE_PX) {
    return false;
  }
  const row =
    input.rowHeightEstimate != null && input.rowHeightEstimate > 0
      ? input.rowHeightEstimate
      : MOVIES_NATIVE_FOCUS_ROW_ALIGN_MAX_PX;
  const upper = Math.max(row, MOVIES_NATIVE_FOCUS_ROW_ALIGN_MAX_PX) + MOVIES_VIEWPORT_OFFSET_TOLERANCE_PX;
  return abs <= upper;
}

/** After target onFocus confirms, do not issue another poster focus request. */
export function shouldReRequestMoviesPosterFocusAfterCorrective(input: {
  targetFocusConfirmed: boolean;
}): boolean {
  return !input.targetFocusConfirmed;
}

/**
 * Stage 4.2F — Evidence-driven detail return path selection.
 * Fast path: mounted poster + same grid/category/generation → focus under cover,
 * correct native drift once, then reveal. Fallback retains Stage 3D.1 restore.
 */
export type MoviesDetailReturnPath =
  | 'fast-mounted-target'
  | 'fallback-target-unmounted'
  | 'fallback-generation-changed'
  | 'fallback-category-changed'
  | 'fallback-grid-instance-changed'
  | 'fallback-movie-missing'
  | 'fallback-provider-changed';

export type MoviesDetailOpenContext = {
  providerId: string;
  readableGeneration: number | null;
  gridInstanceId: string | null;
  /** Stage 4.2J: browse list revision frozen at Detail open. */
  listRevision?: number;
};

export const MOVIES_FOCUS_STAGE4F_MARKER = 'stage4f-movies-detail-return-v1';
/** Fast path allows a single covered corrective restore (no initial scroll). */
export const MOVIES_FAST_PATH_MAX_VIEWPORT_RESTORES = 1;

export function selectMoviesDetailReturnPath(input: {
  hasSnapshot: boolean;
  snapshotCategoryId: string | null;
  selectedCategoryId: string;
  openProviderId: string | null;
  activeProviderId: string;
  openReadableGeneration: number | null;
  activeReadableGeneration: number | null;
  openGridInstanceId: string | null;
  activeGridInstanceId: string | null;
  targetMovieId: string | null;
  targetInVisibleMovies: boolean;
  targetNativeHandleExists: boolean;
  /** Stage 4.2J: immutable open-snapshot visibility (live indexes may be null). */
  snapshotTargetWasVisible?: boolean;
  /** Stage 4.2J: registered ref identity still matches snapshot. */
  targetRefIdentityValid?: boolean;
  /** Stage 4.2J: no list replacement since Detail opened. */
  listRevisionUnchanged?: boolean;
}): MoviesDetailReturnPath {
  if (!input.hasSnapshot || !input.targetMovieId) {
    return 'fallback-target-unmounted';
  }
  if (
    input.openProviderId != null &&
    input.openProviderId !== '' &&
    input.openProviderId !== input.activeProviderId
  ) {
    return 'fallback-provider-changed';
  }
  if (
    input.openReadableGeneration != null &&
    input.activeReadableGeneration != null &&
    input.openReadableGeneration !== input.activeReadableGeneration
  ) {
    return 'fallback-generation-changed';
  }
  if (
    input.snapshotCategoryId != null &&
    input.snapshotCategoryId !== '' &&
    input.snapshotCategoryId !== input.selectedCategoryId
  ) {
    return 'fallback-category-changed';
  }
  if (
    input.openGridInstanceId != null &&
    input.activeGridInstanceId != null &&
    input.openGridInstanceId !== input.activeGridInstanceId
  ) {
    return 'fallback-grid-instance-changed';
  }
  if (!input.targetInVisibleMovies) {
    return 'fallback-movie-missing';
  }
  if (!input.targetNativeHandleExists) {
    return 'fallback-target-unmounted';
  }
  // Stage 4.2J: a native handle alone is not a reliable mounted target.
  if (input.snapshotTargetWasVisible === false) {
    return 'fallback-target-unmounted';
  }
  if (input.targetRefIdentityValid === false) {
    return 'fallback-target-unmounted';
  }
  if (input.listRevisionUnchanged === false) {
    return 'fallback-target-unmounted';
  }
  return 'fast-mounted-target';
}

export function isMoviesDetailReturnFastPath(path: MoviesDetailReturnPath | null | undefined): boolean {
  return path === 'fast-mounted-target';
}

/**
 * Stage 4.2G natural mounted return: never emit initial-detail-restore or
 * enter closing-viewport. Corrective scroll only after measured native drift.
 */
export function shouldUseMoviesNaturalReturnPath(
  path: MoviesDetailReturnPath | null | undefined,
): boolean {
  return isMoviesDetailReturnFastPath(path);
}

/** Fast-path initial restore is a hard violation after Stage 4.2G. */
export function isMoviesFastPathInitialRestoreViolation(input: {
  returnPath: MoviesDetailReturnPath | null | undefined;
  reason: 'initial' | 'corrective' | string;
}): boolean {
  return isMoviesDetailReturnFastPath(input.returnPath) && input.reason === 'initial';
}

export function shouldIssueMoviesInitialDetailRestore(
  path: MoviesDetailReturnPath | null | undefined,
): boolean {
  return !isMoviesDetailReturnFastPath(path);
}

/** Skip no-op initial restore commands (ONN: duplicate delta-0 before focus). */
export function shouldSkipZeroDeltaInitialRestore(input: {
  requestedOffset: number;
  currentOffset: number;
  reason: 'initial' | 'corrective';
  tolerancePx?: number;
}): boolean {
  if (input.reason !== 'initial') {
    return false;
  }
  return isMoviesViewportOffsetStable({
    currentOffset: input.currentOffset,
    snapshotOffset: input.requestedOffset,
    tolerancePx: input.tolerancePx,
  });
}

export function resolveMoviesDetailReturnMaxViewportRestores(
  path: MoviesDetailReturnPath | null | undefined,
): number {
  return isMoviesDetailReturnFastPath(path)
    ? MOVIES_FAST_PATH_MAX_VIEWPORT_RESTORES
    : MOVIES_MAX_VIEWPORT_RESTORES;
}

export function isMoviesNaturalReturnPhase(phase: MoviesDetailFocusPhase): boolean {
  return (
    phase === 'return-focus-arming' ||
    phase === 'return-focus-requested' ||
    phase === 'return-focus-confirmed'
  );
}

export function isMoviesDetailClosingPhase(phase: MoviesDetailFocusPhase): boolean {
  return (
    isMoviesNaturalReturnPhase(phase) ||
    phase === 'closing-prepare' ||
    phase === 'closing-viewport' ||
    phase === 'closing-focus' ||
    phase === 'closing-confirm'
  );
}

/** Overlay stays mounted for open + every closing/return phase until exact confirm. */
export function isMoviesDetailOverlayMounted(phase: MoviesDetailFocusPhase): boolean {
  return phase === 'detail-open' || isMoviesDetailClosingPhase(phase);
}

/** Stage 4.2G: hold Detail fully opaque until focus + offset are confirmed. */
export function shouldHoldMoviesDetailVisual(phase: MoviesDetailFocusPhase): boolean {
  return isMoviesNaturalReturnPhase(phase) || phase === 'closing-confirm';
}

/**
 * Preferred-focus suppression window: all closing phases plus browse-restored
 * stabilization. Release only after delay once phase returns to browse.
 */
export function isMoviesFocusSuppressionActive(phase: MoviesDetailFocusPhase): boolean {
  return phase !== 'browse';
}

export function shouldSuppressMoviesNavbarFocus(phase: MoviesDetailFocusPhase): boolean {
  return isMoviesFocusSuppressionActive(phase);
}

export function shouldSuppressMoviesCategoryFocus(phase: MoviesDetailFocusPhase): boolean {
  return isMoviesFocusSuppressionActive(phase);
}

export function shouldSuppressMoviesSearchFocus(phase: MoviesDetailFocusPhase): boolean {
  return isMoviesFocusSuppressionActive(phase);
}

export function shouldSuppressMoviesFirstPosterPreferredFocus(phase: MoviesDetailFocusPhase): boolean {
  return isMoviesFocusSuppressionActive(phase);
}

/** Normal poster D-pad after confirm (browse + browse-restored). Closing uses target-only. */
export function areMoviesPostersNormallyFocusable(phase: MoviesDetailFocusPhase): boolean {
  return phase === 'browse' || phase === 'browse-restored';
}

/**
 * Stage 3D.2: Search/navbar/category may be focusable after overlay confirm.
 * Preferred focus remains gated separately by suppression + post-restore latch.
 */
export function areMoviesChromeNormallyFocusable(phase: MoviesDetailFocusPhase): boolean {
  return phase === 'browse' || phase === 'browse-restored';
}

/** During closing, only the snapshot target (or nearest-visible fallback) may be focusable. */
export function resolveMoviesClosingFocusableMovieId(input: {
  phase: MoviesDetailFocusPhase;
  targetMovieId: string | null;
}): string | null {
  if (!isMoviesDetailClosingPhase(input.phase)) {
    return null;
  }
  return input.targetMovieId;
}

export function isMoviesSnapshotTargetVisible(input: {
  movieIndex: number;
  visibleFirstIndex: number | null;
  visibleLastIndex: number | null;
}): boolean {
  const { movieIndex, visibleFirstIndex, visibleLastIndex } = input;
  if (movieIndex < 0 || visibleFirstIndex == null || visibleLastIndex == null) {
    return false;
  }
  return movieIndex >= visibleFirstIndex && movieIndex <= visibleLastIndex;
}

/**
 * Stage 3D.1: snapshot visibility at detail-open is authoritative while the
 * overlay owns focus. Live viewability can go stale during teardown.
 */
export function wasMoviesSnapshotTargetVisible(snapshot: MoviesBrowseFocusSnapshot): boolean {
  return isMoviesSnapshotTargetVisible({
    movieIndex: snapshot.movieIndex,
    visibleFirstIndex: snapshot.visibleFirstIndex,
    visibleLastIndex: snapshot.visibleLastIndex,
  });
}

export function isMoviesViewportOffsetStable(input: {
  currentOffset: number;
  snapshotOffset: number;
  tolerancePx?: number;
}): boolean {
  const tolerance = input.tolerancePx ?? MOVIES_VIEWPORT_OFFSET_TOLERANCE_PX;
  return Math.abs(input.currentOffset - input.snapshotOffset) <= tolerance;
}

/**
 * Nearest currently visible poster to the saved index.
 * Never prefers index 0 unless it truly is the nearest visible item.
 */
export function resolveNearestVisiblePoster(input: {
  targetIndex: number;
  visibleFirstIndex: number | null;
  visibleLastIndex: number | null;
  movies: ReadonlyArray<{ id: string }>;
}): { movieId: string; index: number; reason: 'nearest-visible' } | null {
  const { targetIndex, visibleFirstIndex, visibleLastIndex, movies } = input;
  if (visibleFirstIndex == null || visibleLastIndex == null || movies.length === 0) {
    return null;
  }

  const first = Math.max(0, Math.min(visibleFirstIndex, movies.length - 1));
  const last = Math.max(first, Math.min(visibleLastIndex, movies.length - 1));

  let bestIndex = first;
  let bestDistance = Math.abs(bestIndex - targetIndex);
  for (let index = first; index <= last; index += 1) {
    const distance = Math.abs(index - targetIndex);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }

  const movie = movies[bestIndex];
  if (!movie?.id) {
    return null;
  }
  return { movieId: movie.id, index: bestIndex, reason: 'nearest-visible' };
}

export function createMoviesBrowseFocusSnapshot(input: {
  categoryId: string;
  movieId: string;
  movieIndex: number;
  verticalOffset: number;
  visibleFirstIndex: number | null;
  visibleLastIndex: number | null;
  columns?: number;
}): MoviesBrowseFocusSnapshot {
  const columns = Math.max(1, input.columns ?? 1);
  const first = input.visibleFirstIndex;
  const relativeIndex =
    first != null && input.movieIndex >= 0 ? Math.max(0, input.movieIndex - first) : null;
  return {
    categoryId: input.categoryId,
    movieId: input.movieId,
    movieIndex: input.movieIndex,
    verticalOffset: input.verticalOffset,
    visibleFirstIndex: input.visibleFirstIndex,
    visibleLastIndex: input.visibleLastIndex,
    targetRelativeRow: relativeIndex == null ? null : Math.floor(relativeIndex / columns),
    targetRelativeColumn: relativeIndex == null ? null : relativeIndex % columns,
  };
}

export function isMoviesBrowseSnapshotImmutable(phase: MoviesDetailFocusPhase): boolean {
  return phase === 'detail-open' || isMoviesDetailClosingPhase(phase);
}

export function canBeginMoviesDetailClose(phase: MoviesDetailFocusPhase): boolean {
  return phase === 'detail-open';
}

export function logMoviesDetailFocusLifecycle(payload: {
  token: string | null;
  phase: MoviesDetailFocusPhase;
  targetMovieId: string | null;
  targetIndex: number | null;
  targetVisible: boolean | null;
  currentOffset: number | null;
  scrollIssued: boolean;
  focusIssued: boolean;
  actuallyFocusedMovieId: string | null;
  highlightVisible: boolean;
  overlayMounted: boolean;
}) {
  console.info(
    '[NovaCast Movies Detail Focus Lifecycle] ' +
      JSON.stringify({
        token: payload.token,
        phase: payload.phase,
        targetMovieId: payload.targetMovieId,
        targetIndex: payload.targetIndex,
        targetVisible: payload.targetVisible,
        currentOffset: payload.currentOffset,
        scrollIssued: payload.scrollIssued,
        focusIssued: payload.focusIssued,
        actuallyFocusedMovieId: payload.actuallyFocusedMovieId,
        highlightVisible: payload.highlightVisible,
        overlayMounted: payload.overlayMounted,
      }),
  );
}

export function logMoviesDetailFocusConflict(payload: {
  token: string | null;
  phase: MoviesDetailFocusPhase;
  winningComponent: string;
  targetMovieId: string | null;
  actuallyFocusedMovieId: string | null;
  reason: string;
}) {
  console.info(
    '[NovaCast Movies Detail Focus Conflict] ' +
      JSON.stringify({
        token: payload.token,
        phase: payload.phase,
        winningComponent: payload.winningComponent,
        targetMovieId: payload.targetMovieId,
        actuallyFocusedMovieId: payload.actuallyFocusedMovieId,
        reason: payload.reason,
      }),
  );
}

export function logMoviesViewportLock(payload: {
  token: string | null;
  phase: MoviesDetailFocusPhase;
  targetMovieId: string | null;
  targetIndex: number | null;
  snapshotOffset: number | null;
  currentOffset: number | null;
  offsetDelta: number | null;
  targetRelativeRow: number | null;
  snapshotTargetWasVisible: boolean;
  initialRestoreIssued: boolean;
  correctiveRestoreIssued: boolean;
  focusRequestCount: number;
  targetFocusConfirmed: boolean;
  highlightVisible: boolean;
  viewportStable: boolean;
  overlayMounted: boolean;
}) {
  console.info(
    '[NovaCast Movies Viewport Lock] ' +
      JSON.stringify({
        token: payload.token,
        phase: payload.phase,
        targetMovieId: payload.targetMovieId,
        targetIndex: payload.targetIndex,
        snapshotOffset: payload.snapshotOffset,
        currentOffset: payload.currentOffset,
        offsetDelta: payload.offsetDelta,
        targetRelativeRow: payload.targetRelativeRow,
        snapshotTargetWasVisible: payload.snapshotTargetWasVisible,
        initialRestoreIssued: payload.initialRestoreIssued,
        correctiveRestoreIssued: payload.correctiveRestoreIssued,
        focusRequestCount: payload.focusRequestCount,
        targetFocusConfirmed: payload.targetFocusConfirmed,
        highlightVisible: payload.highlightVisible,
        viewportStable: payload.viewportStable,
        overlayMounted: payload.overlayMounted,
      }),
  );
}

export function logMoviesFocusSuppression(payload: {
  token: string | null;
  phase: MoviesDetailFocusPhase;
  searchAllowed: boolean;
  navbarAllowed: boolean;
  categoryAllowed: boolean;
  firstPosterAllowed: boolean;
}) {
  console.info(
    '[NovaCast Movies Preferred Focus Suppression] ' +
      JSON.stringify({
        token: payload.token,
        phase: payload.phase,
        searchAllowed: payload.searchAllowed,
        navbarAllowed: payload.navbarAllowed,
        categoryAllowed: payload.categoryAllowed,
        firstPosterAllowed: payload.firstPosterAllowed,
      }),
  );
}

export function isMoviesDetailFocusConfirmed(input: {
  actuallyFocusedMovieId: string | null;
  targetMovieId: string;
  targetIndex: number;
  visibleFirstIndex: number | null;
  visibleLastIndex: number | null;
  highlightVisible: boolean;
  currentOffset: number;
  snapshotOffset: number;
  snapshotTargetWasVisible: boolean;
}): boolean {
  if (!input.highlightVisible) {
    return false;
  }
  if (input.actuallyFocusedMovieId !== input.targetMovieId) {
    return false;
  }
  if (
    !isMoviesViewportOffsetStable({
      currentOffset: input.currentOffset,
      snapshotOffset: input.snapshotOffset,
    })
  ) {
    return false;
  }
  // When the target was visible at open, snapshot window is authoritative.
  if (input.snapshotTargetWasVisible) {
    return true;
  }
  if (input.visibleFirstIndex == null || input.visibleLastIndex == null) {
    return true;
  }
  return isMoviesSnapshotTargetVisible({
    movieIndex: input.targetIndex,
    visibleFirstIndex: input.visibleFirstIndex,
    visibleLastIndex: input.visibleLastIndex,
  });
}
