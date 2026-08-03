/**
 * Stage 3E / 3E.1 / 3E.2 / 3E.3 — Movies visual-loader state.
 * Focus lifecycle, detail restore, catalog, and SQLite must not drive this.
 * Stage 3E.3: loader observes readiness only — it never mutates displayed movies/category.
 */

export type MoviesPrimaryLoaderMode = 'hidden' | 'initial' | 'category-blocking';
export type MoviesPaginationLoaderMode = 'hidden' | 'loading-more';

/** @deprecated Stage 3E name — prefer MoviesPrimaryLoaderMode. */
export type MoviesLoaderMode = MoviesPrimaryLoaderMode;

/** Stage 3E.2: hold primary loader briefly so fast loads do not flash. */
export const MOVIES_PRIMARY_LOADER_MIN_MS = 400;

export type MoviesFirstPageLoadGate = {
  loadingCategoryId: string | null;
  loadingRequestToken: string | null;
  firstPageResolvedCategoryId: string | null;
};

export function createMoviesFirstPageLoadGate(): MoviesFirstPageLoadGate {
  return {
    loadingCategoryId: null,
    loadingRequestToken: null,
    firstPageResolvedCategoryId: null,
  };
}

/** Strip leading decorative icons/emoji so loader labels never carry mojibake. */
export function sanitizeMoviesCategoryDisplayName(name: string | null | undefined): string {
  if (typeof name !== 'string') {
    return '';
  }
  const trimmed = name.trim();
  // Drop star/emoji prefixes and the common UTF-8→Latin-1 mojibake for ⭐ ("Γ¡É ").
  const withoutIcon = trimmed
    .replace(/^(?:⭐|🌟|✨|Γ¡É|â­|Ã¢Â­)\s*/u, '')
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .trim();
  return withoutIcon || trimmed;
}

/**
 * Stage 3E.2: primary loader stays up until the selected category's first page
 * is resolved for the active request token — not merely while a generic loading flag is true.
 */
export function isMoviesPrimaryLoaderGateVisible(input: {
  categoriesLoading: boolean;
  loadingCategoryId: string | null;
  firstPageResolvedCategoryId: string | null;
}): boolean {
  if (input.categoriesLoading) {
    return true;
  }
  if (input.loadingCategoryId == null) {
    return false;
  }
  return input.firstPageResolvedCategoryId !== input.loadingCategoryId;
}

export function deriveMoviesPrimaryLoaderModeFromGate(input: {
  categoriesLoading: boolean;
  loadingCategoryId: string | null;
  firstPageResolvedCategoryId: string | null;
  hasUsableItems: boolean;
}): MoviesPrimaryLoaderMode {
  if (!isMoviesPrimaryLoaderGateVisible(input)) {
    return 'hidden';
  }
  // Retained posters → blocking overlay. Empty → initial hero. Loader never owns display data.
  if (input.categoriesLoading || !input.hasUsableItems) {
    return 'initial';
  }
  return 'category-blocking';
}

/** Legacy derivation kept for Stage 3E tests; prefer gate-based helpers. */
export function deriveMoviesPrimaryLoaderMode(input: {
  hasCategories: boolean;
  hasUsableItems: boolean;
  categoryFirstPageLoading: boolean;
  categoriesLoading: boolean;
}): MoviesPrimaryLoaderMode {
  const waitingOnCategories = input.categoriesLoading || !input.hasCategories;
  const firstPageLoading = input.categoryFirstPageLoading;

  if (!waitingOnCategories && !firstPageLoading) {
    return 'hidden';
  }

  if (!input.hasUsableItems) {
    return 'initial';
  }

  if (firstPageLoading) {
    return 'category-blocking';
  }

  return 'initial';
}

/** @deprecated Stage 3E name — prefer deriveMoviesPrimaryLoaderMode. */
export const deriveMoviesLoaderMode = deriveMoviesPrimaryLoaderMode;

/**
 * Pagination loader is mutually exclusive with the primary loader.
 * Never show both.
 */
export function deriveMoviesPaginationLoaderMode(input: {
  primaryVisible: boolean;
  paginationLoading: boolean;
  hasUsableItems: boolean;
  detailBlocksBrowse?: boolean;
}): MoviesPaginationLoaderMode {
  if (input.primaryVisible || input.detailBlocksBrowse) {
    return 'hidden';
  }
  if (input.paginationLoading && input.hasUsableItems) {
    return 'loading-more';
  }
  return 'hidden';
}

export function resolveMoviesPrimaryLoaderLabel(input: {
  primaryMode: MoviesPrimaryLoaderMode;
  categoryDisplayName: string | null | undefined;
  hasCategories: boolean;
}): string {
  if (input.primaryMode === 'hidden') {
    return '';
  }

  const name = sanitizeMoviesCategoryDisplayName(input.categoryDisplayName);
  if (!input.hasCategories) {
    return 'Loading provider categories…';
  }
  if (!name) {
    return 'Loading Movies';
  }

  return `Loading ${name}`;
}

export const MOVIES_PAGINATION_LOADER_LABEL = 'Loading more movies…';

export type MoviesPrimaryLoaderHideReason =
  | null
  | 'first-page-ready'
  | 'minimum-duration'
  | 'categories-ready-idle'
  | 'unmount';

export function logMoviesPrimaryLoader(payload: {
  mode: MoviesPrimaryLoaderMode;
  selectedCategoryId: string | null;
  selectedCategoryName: string | null;
  loadingCategoryId: string | null;
  requestToken: string | null;
  firstPageReady: boolean;
  minimumDurationMet: boolean;
  visible: boolean;
  hideReason: MoviesPrimaryLoaderHideReason;
  hasUsableItems: boolean;
}) {
  console.info(
    '[NovaCast Movies Primary Loader] ' +
      JSON.stringify({
        mode: payload.mode,
        selectedCategoryId: payload.selectedCategoryId,
        selectedCategoryName: sanitizeMoviesCategoryDisplayName(payload.selectedCategoryName) || null,
        loadingCategoryId: payload.loadingCategoryId,
        requestToken: payload.requestToken,
        firstPageReady: payload.firstPageReady,
        minimumDurationMet: payload.minimumDurationMet,
        visible: payload.visible,
        hideReason: payload.hideReason,
        hasUsableItems: payload.hasUsableItems,
        marker: 'stage3e3-movies-loader-layout-v1',
      }),
  );
}

export function logMoviesPaginationLoader(payload: {
  mode: MoviesPaginationLoaderMode;
  visible: boolean;
  categoryId: string | null;
  currentItemCount: number;
  requestPending: boolean;
  hasNextPage: boolean;
  primaryLoaderVisible: boolean;
  placement: string;
}) {
  console.info(
    '[NovaCast Movies Pagination Loader] ' +
      JSON.stringify({
        mode: payload.mode,
        visible: payload.visible,
        categoryId: payload.categoryId,
        currentItemCount: payload.currentItemCount,
        requestPending: payload.requestPending,
        hasNextPage: payload.hasNextPage,
        primaryLoaderVisible: payload.primaryLoaderVisible,
        placement: payload.placement,
        marker: 'stage3e3-movies-loader-layout-v1',
      }),
  );
}

/** Kept for Stage 3E diagnostics compatibility during transition. */
export function logMoviesLoaderState(payload: {
  mode: MoviesPrimaryLoaderMode;
  selectedCategoryId: string | null;
  hasUsableItems: boolean;
  firstPageLoading: boolean;
  paginationLoading: boolean;
  visualLoaderVisible: boolean;
}) {
  console.info(
    '[NovaCast Movies Loader State] ' +
      JSON.stringify({
        mode: payload.mode,
        selectedCategoryId: payload.selectedCategoryId,
        hasUsableItems: payload.hasUsableItems,
        firstPageLoading: payload.firstPageLoading,
        paginationLoading: payload.paginationLoading,
        visualLoaderVisible: payload.visualLoaderVisible,
        marker: 'stage3e-movies-loader-cleanup-v1',
      }),
  );
}
