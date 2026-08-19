/**
 * Stage 3G.4 — Search-origin Movie Detail playback diagnostics / payload checks.
 */

import { novacastTrace } from '../diagnostics/novacastLogPolicy.ts';
import type { MovieSummary } from '../movies/movieTypes.ts';

import type { MoviesDetailSource } from './moviesSearchSelection.ts';
import type { MovieSearchResult } from './searchTypes.ts';

const MARKER = 'stage3g4-search-playback-v1';

export type MoviesSearchPlaybackAction =
  | 'play-pressed'
  | 'payload-validated'
  | 'resolver-invoked'
  | 'playback-started'
  | 'playback-rejected'
  | 'playback-returned';

export function logMoviesSearchPlayback(payload: {
  movieId: string | null;
  providerId: string | null;
  detailSource: MoviesDetailSource;
  action: MoviesSearchPlaybackAction;
  selectedMoviePresent: boolean;
  streamIdPresent: boolean;
  containerExtensionPresent: boolean;
  playbackContextPresent: boolean;
  resolverInvoked: boolean;
  playbackStarted: boolean;
  failureReason: string | null;
}) {
  novacastTrace(
    '[NovaCast Movies Search Playback] ' +
      JSON.stringify({
        ...payload,
        marker: MARKER,
      }),
  );
}

/** Normalize a Search result into the MovieSummary shape browse playback expects. */
export function movieSummaryFromSearchResultForPlayback(
  result: Pick<
    MovieSearchResult,
    'id' | 'title' | 'year' | 'rating' | 'genres' | 'posterUrl' | 'categoryId' | 'containerExtension' | 'providerId'
  > & {
    fallbackCategoryId: string;
  },
): MovieSummary {
  return {
    id: result.id,
    categoryId: result.categoryId ?? result.fallbackCategoryId,
    title: result.title,
    year: typeof result.year === 'number' && Number.isFinite(result.year) ? result.year : undefined,
    rating: result.rating,
    genres: result.genres?.length ? result.genres : ['Movies'],
    posterUrl: result.posterUrl,
    posterStyleKey: 'ember',
    description: 'Curated from your NovaCast movie library.',
    containerExtension: result.containerExtension?.trim() || undefined,
  };
}

export function validateSearchPlaybackMovie(movie: MovieSummary | null | undefined): {
  ok: boolean;
  failureReason: string | null;
  streamIdPresent: boolean;
  containerExtensionPresent: boolean;
} {
  if (!movie) {
    return {
      ok: false,
      failureReason: 'selected-movie-missing',
      streamIdPresent: false,
      containerExtensionPresent: false,
    };
  }

  const streamIdPresent = Boolean(String(movie.id ?? '').trim());
  const containerExtensionPresent = Boolean(String(movie.containerExtension ?? '').trim());

  if (!streamIdPresent) {
    return {
      ok: false,
      failureReason: 'missing-stream-id',
      streamIdPresent: false,
      containerExtensionPresent,
    };
  }

  return {
    ok: true,
    failureReason: null,
    streamIdPresent: true,
    containerExtensionPresent,
  };
}
