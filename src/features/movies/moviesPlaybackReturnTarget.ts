/**
 * Stage 4.2G — explicit playback return stack for Movies.
 * Pure helpers only. Does not own BackHandler registration.
 */

export type MoviesPlaybackDetailFocusTarget = 'play' | 'close' | 'favorite' | 'watchlist';

export type MoviesPlaybackReturnTarget =
  | {
      kind: 'movie-detail';
      movieId: string;
      categoryId: string;
      detailFocusTarget: MoviesPlaybackDetailFocusTarget;
    }
  | {
      kind: 'search-detail';
      movieId: string;
      searchQuery: string;
      detailFocusTarget: 'play' | 'close';
    }
  | {
      kind: 'browse';
      movieId: string | null;
      categoryId: string;
    };

export const MOVIES_FOCUS_STAGE4G_MARKER = 'stage4g-movies-natural-back-stack-v1';

export function createMoviesDetailPlaybackReturnTarget(input: {
  movieId: string;
  categoryId: string;
  detailFocusTarget?: MoviesPlaybackDetailFocusTarget;
}): MoviesPlaybackReturnTarget {
  return {
    kind: 'movie-detail',
    movieId: input.movieId,
    categoryId: input.categoryId,
    detailFocusTarget: input.detailFocusTarget ?? 'play',
  };
}

export function createMoviesSearchDetailPlaybackReturnTarget(input: {
  movieId: string;
  searchQuery: string;
  detailFocusTarget?: 'play' | 'close';
}): MoviesPlaybackReturnTarget {
  return {
    kind: 'search-detail',
    movieId: input.movieId,
    searchQuery: input.searchQuery,
    detailFocusTarget: input.detailFocusTarget ?? 'play',
  };
}

export function createMoviesBrowsePlaybackReturnTarget(input: {
  movieId: string | null;
  categoryId: string;
}): MoviesPlaybackReturnTarget {
  return {
    kind: 'browse',
    movieId: input.movieId,
    categoryId: input.categoryId,
  };
}

export function isMoviesPlaybackReturnToDetail(
  target: MoviesPlaybackReturnTarget | null | undefined,
): target is Extract<MoviesPlaybackReturnTarget, { kind: 'movie-detail' | 'search-detail' }> {
  return target?.kind === 'movie-detail' || target?.kind === 'search-detail';
}

/** Host screens must not close Detail for the same Back that the player consumed. */
export function shouldMoviesHostHandlePlaybackBack(input: {
  playbackActive: boolean;
  playbackClosing: boolean;
}): boolean {
  return !input.playbackActive && !input.playbackClosing;
}
