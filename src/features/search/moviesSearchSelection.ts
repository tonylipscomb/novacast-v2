/**
 * Stage 3G.3 — Search result selection / detail lifecycle helpers.
 */

export type MoviesSearchPhase =
  | 'closed'
  | 'open-input'
  | 'open-results'
  | 'opening-detail'
  | 'detail-open'
  | 'returning';

export type MoviesDetailSource = 'browse' | 'search';

const MARKER = 'stage3g3-search-selection-lifecycle-v1';

export function isMoviesSearchOverlayVisible(phase: MoviesSearchPhase) {
  return phase === 'open-input' || phase === 'open-results' || phase === 'returning';
}

export function isMoviesSearchOverlayMounted(phase: MoviesSearchPhase) {
  return phase !== 'closed';
}

export function shouldBlockMoviesSearchToolbar(phase: MoviesSearchPhase) {
  return phase === 'opening-detail' || phase === 'detail-open';
}

export function shouldToggleCloseMoviesSearch(phase: MoviesSearchPhase) {
  return phase === 'open-input' || phase === 'open-results' || phase === 'returning';
}

export function logMoviesSearchSelection(payload: {
  requestId: number | null;
  query: string;
  movieId: string | null;
  action:
    | 'result-pressed'
    | 'movie-captured'
    | 'search-hiding'
    | 'detail-opening'
    | 'detail-opened'
    | 'detail-closed'
    | 'search-restoring'
    | 'search-restored'
    | 'search-reset';
  searchPhase: MoviesSearchPhase;
  detailSource: MoviesDetailSource;
  searchOpen: boolean;
  detailOpen: boolean;
  selectedMovieStored: boolean;
  overlayVisible: boolean;
}) {
  console.info(
    '[NovaCast Movies Search Selection] ' +
      JSON.stringify({
        ...payload,
        marker: MARKER,
      }),
  );
}

export function logMoviesSearchReopen(payload: {
  phase: MoviesSearchPhase;
  searchOpen: boolean;
  overlayMounted: boolean;
  toolbarPressAccepted: boolean;
  blockedReason: string | null;
}) {
  console.info(
    '[NovaCast Movies Search Reopen] ' +
      JSON.stringify({
        ...payload,
        marker: MARKER,
      }),
  );
}

export function movieSummaryFromSearchResult(input: {
  id: string;
  title: string;
  year?: number | string;
  rating?: string;
  genres?: string[];
  posterUrl?: string;
  categoryId?: string;
  containerExtension?: string;
  fallbackCategoryId: string;
}) {
  const year =
    typeof input.year === 'number'
      ? input.year
      : typeof input.year === 'string' && input.year.trim()
        ? Number(input.year)
        : undefined;
  return {
    id: input.id,
    categoryId: input.categoryId ?? input.fallbackCategoryId,
    title: input.title,
    year: Number.isFinite(year) ? year : undefined,
    rating: input.rating,
    genres: input.genres?.length ? input.genres : ['Movies'],
    posterUrl: input.posterUrl,
    posterStyleKey: 'ember' as const,
    description: 'Curated from your NovaCast movie library.',
    containerExtension: input.containerExtension?.trim() || undefined,
  };
}
