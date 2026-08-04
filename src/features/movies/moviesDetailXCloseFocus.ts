/**
 * Stage 4.2H — Movie Detail X close focus ownership.
 * Pure helpers. MoviesScreen + MovieDetailOverlay remain the coordinators.
 */

export const MOVIES_FOCUS_STAGE4H_MARKER = 'stage4h-movies-x-close-focus-v1';

export type MoviesDetailCloseSource = 'back' | 'x' | 'other';

/** X owns focus at close start — keep the Close Pressable native-focusable. */
export function shouldPreserveMoviesDetailCloseButtonFocus(input: {
  closeSource: MoviesDetailCloseSource | null | undefined;
  handoffActive: boolean;
}): boolean {
  return input.closeSource === 'x' && input.handoffActive;
}

/** Hidden handoff sentinel must not be focused on the X path. */
export function shouldFocusMoviesDetailHiddenHandoffTarget(input: {
  closeSource: MoviesDetailCloseSource | null | undefined;
}): boolean {
  return input.closeSource !== 'x';
}

/** Mount the hidden Pressable only when Back/other needs a focus park. */
export function shouldMountMoviesDetailHiddenHandoffTarget(input: {
  closeSource: MoviesDetailCloseSource | null | undefined;
  handoffActive: boolean;
}): boolean {
  return input.handoffActive && shouldFocusMoviesDetailHiddenHandoffTarget(input);
}

export type MoviesDetailXCloseActivationLock = {
  locked: boolean;
  movieId: string | null;
  lockedAt: number;
};

export function createMoviesDetailXCloseActivationLock(
  movieId: string | null = null,
): MoviesDetailXCloseActivationLock {
  return {
    locked: false,
    movieId,
    lockedAt: 0,
  };
}

export function tryAcquireMoviesDetailXCloseActivation(input: {
  lock: MoviesDetailXCloseActivationLock;
  movieId: string | null;
  now?: number;
}): { acquired: boolean; lock: MoviesDetailXCloseActivationLock } {
  if (input.lock.locked && input.lock.movieId === input.movieId) {
    return { acquired: false, lock: input.lock };
  }
  return {
    acquired: true,
    lock: {
      locked: true,
      movieId: input.movieId,
      lockedAt: input.now ?? Date.now(),
    },
  };
}

export function resetMoviesDetailXCloseActivationLock(
  movieId: string | null = null,
): MoviesDetailXCloseActivationLock {
  return createMoviesDetailXCloseActivationLock(movieId);
}

/** Reset when a different Detail movie opens. */
export function shouldResetMoviesDetailXCloseActivationLock(input: {
  lock: MoviesDetailXCloseActivationLock;
  openMovieId: string | null;
}): boolean {
  if (!input.lock.locked) {
    return false;
  }
  if (input.openMovieId == null) {
    return true;
  }
  return input.lock.movieId != null && input.lock.movieId !== input.openMovieId;
}

export type MoviesDetailCloseFinalState = {
  movieId: string;
  categoryId: string;
  offset: number;
  gridInstanceId: string | null;
  detailPhase: 'browse-restored' | 'browse';
  actualFocusedComponent: 'MoviePosterCard';
  hiddenHandoffFocused: false;
};

/** Final-state parity contract for X vs hardware Back. */
export function buildMoviesDetailCloseFinalState(input: {
  movieId: string;
  categoryId: string;
  offset: number;
  gridInstanceId: string | null;
  detailPhase?: 'browse-restored' | 'browse';
}): MoviesDetailCloseFinalState {
  return {
    movieId: input.movieId,
    categoryId: input.categoryId,
    offset: input.offset,
    gridInstanceId: input.gridInstanceId,
    detailPhase: input.detailPhase ?? 'browse-restored',
    actualFocusedComponent: 'MoviePosterCard',
    hiddenHandoffFocused: false,
  };
}

export function areMoviesDetailCloseFinalStatesEqual(
  a: MoviesDetailCloseFinalState,
  b: MoviesDetailCloseFinalState,
): boolean {
  return (
    a.movieId === b.movieId &&
    a.categoryId === b.categoryId &&
    a.offset === b.offset &&
    a.gridInstanceId === b.gridInstanceId &&
    a.detailPhase === b.detailPhase &&
    a.actualFocusedComponent === b.actualFocusedComponent &&
    a.hiddenHandoffFocused === b.hiddenHandoffFocused
  );
}
