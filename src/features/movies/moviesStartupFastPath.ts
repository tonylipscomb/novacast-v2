/**
 * Stage 4.2L — Movies startup fast path.
 * Pure helpers + durable snapshot contracts. MoviesScreen / model / Sqlite DS coordinate.
 */

import type { MovieCategory } from './movieTypes.ts';

export const MOVIES_FOCUS_STAGE4L_MARKER = 'stage4l-movies-startup-fast-path-v1';
export const MOVIES_STARTUP_SNAPSHOT_SCHEMA_VERSION = 1;
export const MOVIES_STARTUP_SNAPSHOT_KEY_PREFIX = '@novacast/movies-startup-snapshot/v1/';

/** Target budgets (ms) from Movies route mount. */
export const MOVIES_STARTUP_CATEGORIES_TARGET_MS = 2000;
export const MOVIES_STARTUP_CATEGORIES_MAX_MS = 5000;
export const MOVIES_STARTUP_VIEWPORT_TARGET_MS = 4000;
export const MOVIES_STARTUP_VIEWPORT_MAX_MS = 10000;
export const MOVIES_STARTUP_INTERACTIVE_TARGET_MS = 5000;
export const MOVIES_STARTUP_INTERACTIVE_MAX_MS = 10000;

/** First viewport: enough for ~6 rows × ~5 cols + overscan (bounded; not full catalog). */
export const MOVIES_STARTUP_VIEWPORT_LIMIT = 36;

export type MoviesStartupReadinessLevel =
  | 'shell'
  | 'durable-categories'
  | 'first-viewport'
  | 'interactive'
  | 'background-refresh';

export type MoviesStartupQueryMode =
  | 'memory-cache'
  | 'durable-snapshot'
  | 'startup-metadata'
  | 'full-counts'
  | 'network-fallback'
  | 'unavailable';

export type MoviesStartupDurableSnapshot = {
  schemaVersion: number;
  providerId: string;
  generation: number;
  categories: MovieCategory[];
  totalMovieCount: number;
  selectedCategoryId: string | null;
  savedMovieId: string | null;
  savedOffset: number | null;
  itemRows: number;
  categoryRows: number;
  distinctItemCategoryIds: number;
  savedAt: number;
};

export type MoviesStartupGenerationSource =
  | 'memory-cache'
  | 'session-cache'
  | 'durable-snapshot'
  | 'active-pointer-fast'
  | 'full-integrity'
  | 'none';

export function moviesStartupSnapshotStorageKey(providerId: string): string {
  return `${MOVIES_STARTUP_SNAPSHOT_KEY_PREFIX}${providerId}`;
}

export function createMoviesStartupDurableSnapshot(input: {
  providerId: string;
  generation: number;
  categories: MovieCategory[];
  totalMovieCount: number;
  selectedCategoryId?: string | null;
  savedMovieId?: string | null;
  savedOffset?: number | null;
  itemRows?: number;
  categoryRows?: number;
  distinctItemCategoryIds?: number;
  savedAt?: number;
}): MoviesStartupDurableSnapshot {
  return {
    schemaVersion: MOVIES_STARTUP_SNAPSHOT_SCHEMA_VERSION,
    providerId: input.providerId,
    generation: input.generation,
    categories: input.categories,
    totalMovieCount: input.totalMovieCount,
    selectedCategoryId: input.selectedCategoryId ?? null,
    savedMovieId: input.savedMovieId ?? null,
    savedOffset: input.savedOffset ?? null,
    itemRows: input.itemRows ?? 0,
    categoryRows: input.categoryRows ?? input.categories.length,
    distinctItemCategoryIds: input.distinctItemCategoryIds ?? 0,
    savedAt: input.savedAt ?? Date.now(),
  };
}

export function parseMoviesStartupDurableSnapshot(
  raw: string | null | undefined,
): MoviesStartupDurableSnapshot | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<MoviesStartupDurableSnapshot>;
    if (
      parsed.schemaVersion !== MOVIES_STARTUP_SNAPSHOT_SCHEMA_VERSION ||
      typeof parsed.providerId !== 'string' ||
      !parsed.providerId ||
      typeof parsed.generation !== 'number' ||
      parsed.generation <= 0 ||
      !Array.isArray(parsed.categories) ||
      parsed.categories.length === 0
    ) {
      return null;
    }
    return parsed as MoviesStartupDurableSnapshot;
  } catch {
    return null;
  }
}

export function isMoviesStartupDurableSnapshotValidForProvider(input: {
  snapshot: MoviesStartupDurableSnapshot | null;
  providerId: string;
  readableItemCount: number;
}): boolean {
  if (!input.snapshot) {
    return false;
  }
  if (input.snapshot.providerId !== input.providerId) {
    return false;
  }
  if (input.snapshot.generation <= 0) {
    return false;
  }
  if (input.readableItemCount <= 0) {
    return false;
  }
  if (input.snapshot.categories.length <= 0) {
    return false;
  }
  return true;
}

export function shouldDeferMoviesBackgroundGenerationSwap(input: {
  detailOpen: boolean;
  detailClosing: boolean;
  restoringBrowseFocus: boolean;
  playbackActive: boolean;
  userNavigating: boolean;
  activeCategoryExistsInReplacement: boolean;
  focusedMovieExistsInReplacement: boolean;
}): { defer: boolean; reason: string } {
  if (input.detailOpen || input.detailClosing) {
    return { defer: true, reason: 'detail-active' };
  }
  if (input.restoringBrowseFocus) {
    return { defer: true, reason: 'restoring-browse-focus' };
  }
  if (input.playbackActive) {
    return { defer: true, reason: 'playback-active' };
  }
  if (input.userNavigating) {
    return { defer: true, reason: 'user-navigating' };
  }
  if (!input.activeCategoryExistsInReplacement) {
    return { defer: true, reason: 'active-category-missing' };
  }
  if (!input.focusedMovieExistsInReplacement) {
    return { defer: true, reason: 'focused-movie-missing' };
  }
  return { defer: false, reason: 'compatible-swap' };
}

export function resolveMoviesStartupFocusTarget(input: {
  savedMovieId: string | null;
  selectedMovieId: string | null;
  viewportMovieIds: string[];
  hasCategories: boolean;
}): {
  movieId: string | null;
  reason: 'saved-focused' | 'saved-selected' | 'first-viewport' | 'none';
  fallbackUsed: boolean;
} {
  if (input.savedMovieId && input.viewportMovieIds.includes(input.savedMovieId)) {
    return { movieId: input.savedMovieId, reason: 'saved-focused', fallbackUsed: false };
  }
  if (input.selectedMovieId && input.viewportMovieIds.includes(input.selectedMovieId)) {
    return { movieId: input.selectedMovieId, reason: 'saved-selected', fallbackUsed: false };
  }
  if (input.viewportMovieIds[0]) {
    return {
      movieId: input.viewportMovieIds[0],
      reason: 'first-viewport',
      fallbackUsed: Boolean(input.savedMovieId || input.selectedMovieId),
    };
  }
  return { movieId: null, reason: 'none', fallbackUsed: input.hasCategories };
}

export function evaluateMoviesStartupBudgets(input: {
  categoriesElapsedMs: number | null;
  firstViewportElapsedMs: number | null;
  interactiveElapsedMs: number | null;
  startupMode: MoviesStartupQueryMode;
  providerRefreshStillRunning: boolean;
}): {
  categoriesBudgetPassed: boolean;
  viewportBudgetPassed: boolean;
  interactiveBudgetPassed: boolean;
} {
  return {
    categoriesBudgetPassed:
      input.categoriesElapsedMs == null ||
      input.categoriesElapsedMs <= MOVIES_STARTUP_CATEGORIES_MAX_MS,
    viewportBudgetPassed:
      input.firstViewportElapsedMs == null ||
      input.firstViewportElapsedMs <= MOVIES_STARTUP_VIEWPORT_MAX_MS,
    interactiveBudgetPassed:
      input.interactiveElapsedMs == null ||
      input.interactiveElapsedMs <= MOVIES_STARTUP_INTERACTIVE_MAX_MS,
  };
}

export function shouldRunMoviesStartupBackgroundWork(input: {
  detailOpen: boolean;
  detailClosing: boolean;
}): boolean {
  return !input.detailOpen && !input.detailClosing;
}
