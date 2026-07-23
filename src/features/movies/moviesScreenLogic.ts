import type { MovieSummary } from './movieTypes';

/**
 * The movie whose detail panel and Play action are locked until the user
 * explicitly selects another poster with OK/Select.
 */
export function resolveSelectedMovie(
  selectedMovieId: string | null,
  movies: MovieSummary[],
): MovieSummary | null {
  if (!selectedMovieId) {
    return null;
  }

  return movies.find((movie) => movie.id === selectedMovieId) ?? null;
}

/**
 * Play must always use the committed selection, never the poster that last
 * received transient grid focus while the user moved toward the detail panel.
 */
export function resolvePlaybackMovieId(
  selectedMovieId: string | null,
  _focusedMovieId: string | null,
): string | null {
  return selectedMovieId;
}

/**
 * True when a poster press/OK should commit a new selectedMovie. Focus-only
 * movement must never call this.
 */
export function shouldCommitMovieSelection(_previousSelectedMovieId: string | null, nextMovieId: string): boolean {
  return Boolean(nextMovieId);
}

export type MoviesLoadStatus = 'loading' | 'ready' | 'empty' | 'error';

export const MOVIES_LOAD_NOTIFICATION_ID = 'movies-load-unavailable';
export const MOVIES_DETAIL_NOTIFICATION_ID = 'movies-detail-unavailable';
export const MOVIES_NOTIFICATION_DURATION_MS = 7000;

export type MoviesNotificationSpec = {
  title: string;
  message: string;
  persistent: boolean;
};

/** Recoverable category/page failures become toasts; ready/empty/loading stay inline. */
export function resolveMoviesNotificationForStatus(
  status: MoviesLoadStatus,
  retryAttemptedAndStillFailing: boolean,
  errorMessage?: string | null,
): MoviesNotificationSpec | null {
  if (status !== 'error') {
    return null;
  }

  return {
    title: 'Movies unavailable',
    message: errorMessage?.trim() || 'We could not load movies from your provider.',
    persistent: retryAttemptedAndStillFailing,
  };
}

export function resolveMoviesDetailNotification(
  retryAttemptedAndStillFailing: boolean,
  detailError?: string | null,
): MoviesNotificationSpec {
  return {
    title: 'Movie details unavailable',
    message: detailError?.trim() || 'Detailed movie information could not be loaded.',
    persistent: retryAttemptedAndStillFailing,
  };
}
