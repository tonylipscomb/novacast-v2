/**
 * Stage 3D / 3D.1 — Movies-only detail focus lifecycle.
 * Pure helpers + diagnostics. MoviesScreen is the sole coordinator.
 */

export type MoviesDetailFocusPhase =
  | 'browse'
  | 'detail-open'
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
};

export type MoviesDetailFocusToken = {
  token: string;
  source: 'detail-close' | 'playback-close';
  snapshot: MoviesBrowseFocusSnapshot;
};

export const MOVIES_DETAIL_FOCUS_CONFIRM_TIMEOUT_MS = 2200;
export const MOVIES_VIEWPORT_OFFSET_TOLERANCE_PX = 12;
export const MOVIES_FOCUS_SUPPRESSION_RELEASE_MS = 150;
export const MOVIES_MAX_VIEWPORT_RESTORES = 2;
export const MOVIES_MAX_FOCUS_REQUESTS = 2;

export function isMoviesDetailClosingPhase(phase: MoviesDetailFocusPhase): boolean {
  return (
    phase === 'closing-prepare' ||
    phase === 'closing-viewport' ||
    phase === 'closing-focus' ||
    phase === 'closing-confirm'
  );
}

/** Overlay stays mounted for open + every closing phase until exact confirm. */
export function isMoviesDetailOverlayMounted(phase: MoviesDetailFocusPhase): boolean {
  return phase === 'detail-open' || isMoviesDetailClosingPhase(phase);
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
}): MoviesBrowseFocusSnapshot {
  return {
    categoryId: input.categoryId,
    movieId: input.movieId,
    movieIndex: input.movieIndex,
    verticalOffset: input.verticalOffset,
    visibleFirstIndex: input.visibleFirstIndex,
    visibleLastIndex: input.visibleLastIndex,
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
  snapshotTargetWasVisible: boolean;
  viewportRestoreIssued: boolean;
  correctiveRestoreIssued: boolean;
  targetFocusConfirmed: boolean;
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
        snapshotTargetWasVisible: payload.snapshotTargetWasVisible,
        viewportRestoreIssued: payload.viewportRestoreIssued,
        correctiveRestoreIssued: payload.correctiveRestoreIssued,
        targetFocusConfirmed: payload.targetFocusConfirmed,
        viewportStable: payload.viewportStable,
        overlayMounted: payload.overlayMounted,
      }),
  );
}

export function logMoviesFocusSuppression(payload: {
  token: string | null;
  phase: MoviesDetailFocusPhase;
  searchPreferredAllowed: boolean;
  navbarPreferredAllowed: boolean;
  categoryPreferredAllowed: boolean;
  firstPosterPreferredAllowed: boolean;
}) {
  console.info(
    '[NovaCast Movies Focus Suppression] ' +
      JSON.stringify({
        token: payload.token,
        phase: payload.phase,
        searchPreferredAllowed: payload.searchPreferredAllowed,
        navbarPreferredAllowed: payload.navbarPreferredAllowed,
        categoryPreferredAllowed: payload.categoryPreferredAllowed,
        firstPosterPreferredAllowed: payload.firstPosterPreferredAllowed,
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
