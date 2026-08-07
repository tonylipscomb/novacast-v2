/**
 * Stage 4.2O — Series startup fast path.
 * Pure helpers + durable snapshot contracts, mirroring the shape of
 * `moviesStartupFastPath.ts` (Movies) but scoped to Series-specific types.
 * Series has no local SQLite catalog, so "generation" here is a simple
 * monotonically increasing session/durable-snapshot freshness counter,
 * not a SQLite catalog generation.
 */

import type { MediaCategory } from '../media-browser/mediaTypes.ts';
import type { SeriesSummary } from '../media-browser/mediaTypes.ts';

export const SERIES_FOCUS_STAGE4O_MARKER = 'stage4o-series-startup-fast-path-v1';
export const SERIES_STARTUP_SNAPSHOT_SCHEMA_VERSION = 1;
export const SERIES_STARTUP_SNAPSHOT_KEY_PREFIX = '@novacast/series-startup-snapshot/v1/';

/** Target budgets (ms) from Series route mount — mirrors Movies Stage 4.2L windows. */
export const SERIES_STARTUP_CATEGORIES_TARGET_MS = 2000;
export const SERIES_STARTUP_CATEGORIES_MAX_MS = 5000;
export const SERIES_STARTUP_VIEWPORT_TARGET_MS = 4000;
export const SERIES_STARTUP_VIEWPORT_MAX_MS = 10000;
export const SERIES_STARTUP_INTERACTIVE_TARGET_MS = 5000;
export const SERIES_STARTUP_INTERACTIVE_MAX_MS = 10000;

/** First viewport: enough for a few rows + overscan (bounded; never full catalog). */
export const SERIES_STARTUP_VIEWPORT_LIMIT = 32;

/**
 * Stage 4.2P #8 — defensive maximum for caller-supplied browse/pagination
 * limits at the Series data-source boundary (mirrors
 * `MOVIES_STARTUP_VIEWPORT_LIMIT`'s clamp pattern in `SqliteMovieDataSource.ts`,
 * but scoped to *all* `getSeriesPage` calls, not just the startup viewport).
 * Legitimate callers only ever request 32 (startup viewport) or 48 (runtime
 * pagination) rows per page; 200 leaves generous headroom above both while
 * still preventing an accidental/malformed multi-thousand-row request from
 * reaching SQLite. Search has its own limit semantics and is not affected —
 * this only clamps `getSeriesPageImpl`'s `input.limit`.
 */
export const SERIES_BROWSE_PAGE_LIMIT_MAX = 200;

export type SeriesStartupReadinessLevel =
  | 'shell'
  | 'durable-categories'
  | 'first-viewport'
  | 'interactive'
  | 'background-refresh';

export type SeriesStartupQueryMode =
  | 'memory-cache'
  | 'durable-snapshot'
  | 'network-fallback'
  | 'unavailable';

export type SeriesStartupDurableSnapshot = {
  schemaVersion: number;
  providerId: string;
  generation: number;
  categories: MediaCategory[];
  selectedCategoryId: string | null;
  savedSeriesId: string | null;
  savedOffset: number | null;
  categoryRows: number;
  readableRowCount: number;
  savedAt: number;
};

export function seriesStartupSnapshotStorageKey(providerId: string): string {
  return `${SERIES_STARTUP_SNAPSHOT_KEY_PREFIX}${providerId}`;
}

export function createSeriesStartupDurableSnapshot(input: {
  providerId: string;
  generation: number;
  categories: MediaCategory[];
  selectedCategoryId?: string | null;
  savedSeriesId?: string | null;
  savedOffset?: number | null;
  readableRowCount?: number;
  savedAt?: number;
}): SeriesStartupDurableSnapshot {
  return {
    schemaVersion: SERIES_STARTUP_SNAPSHOT_SCHEMA_VERSION,
    providerId: input.providerId,
    generation: input.generation,
    categories: input.categories,
    selectedCategoryId: input.selectedCategoryId ?? null,
    savedSeriesId: input.savedSeriesId ?? null,
    savedOffset: input.savedOffset ?? null,
    categoryRows: input.categories.length,
    readableRowCount: input.readableRowCount ?? 0,
    savedAt: input.savedAt ?? Date.now(),
  };
}

export function parseSeriesStartupDurableSnapshot(
  raw: string | null | undefined,
): SeriesStartupDurableSnapshot | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<SeriesStartupDurableSnapshot>;
    if (
      parsed.schemaVersion !== SERIES_STARTUP_SNAPSHOT_SCHEMA_VERSION ||
      typeof parsed.providerId !== 'string' ||
      !parsed.providerId ||
      typeof parsed.generation !== 'number' ||
      parsed.generation <= 0 ||
      !Array.isArray(parsed.categories) ||
      parsed.categories.length === 0
    ) {
      return null;
    }
    return parsed as SeriesStartupDurableSnapshot;
  } catch {
    return null;
  }
}

/**
 * Reject only for: provider mismatch, unreadable generation, incompatible
 * schema, empty/corrupt data. Explicit reset is handled by the caller
 * clearing the snapshot store directly.
 */
export function isSeriesStartupDurableSnapshotValidForProvider(input: {
  snapshot: SeriesStartupDurableSnapshot | null;
  providerId: string;
}): boolean {
  if (!input.snapshot) {
    return false;
  }
  if (input.snapshot.schemaVersion !== SERIES_STARTUP_SNAPSHOT_SCHEMA_VERSION) {
    return false;
  }
  if (input.snapshot.providerId !== input.providerId) {
    return false;
  }
  if (input.snapshot.generation <= 0) {
    return false;
  }
  if (!Array.isArray(input.snapshot.categories) || input.snapshot.categories.length <= 0) {
    return false;
  }
  return true;
}

/**
 * Stage 4.2P #1/#3 — cheap warm-reconcile short-circuit validation.
 * Mirrors Movies' actual short-circuit mechanism (`SqliteMovieDataSource.ts`
 * `getCategoriesImpl`'s memory/durable-snapshot fast path: provider match +
 * schema version + a readable-generation check) rather than inventing a new
 * validation scheme. Pure function — the caller supplies the (already cheap)
 * current-readable-generation probe so this stays independently testable
 * without any SQLite/AsyncStorage dependency.
 *
 * Safe against: provider changes, generation changes, invalid category ids,
 * stale/corrupt snapshots, and schema-version mismatches — any of these
 * yields `valid: false` and the caller must fall back to the existing full
 * `getCategories()` reconciliation path (never removed, never weakened).
 */
export type SeriesWarmSnapshotValidationResult =
  | { valid: true; generation: number }
  | {
      valid: false;
      reason:
        | 'invalid-snapshot'
        | 'provider-mismatch'
        | 'generation-unreadable'
        | 'generation-mismatch'
        | 'category-missing'
        | 'probe-unavailable'
        | 'probe-error';
    };

export async function validateSeriesWarmStartupSnapshot(input: {
  providerId: string;
  snapshot: SeriesStartupDurableSnapshot | null;
  selectedCategoryId: string | null;
  /** Cheap current-readable-generation probe (SqliteSeriesDataSource#getReadableGeneration). */
  resolveReadableGeneration: (() => Promise<number>) | null | undefined;
}): Promise<SeriesWarmSnapshotValidationResult> {
  if (!isSeriesStartupDurableSnapshotValidForProvider({ snapshot: input.snapshot, providerId: input.providerId })) {
    return { valid: false, reason: 'invalid-snapshot' };
  }
  const snapshot = input.snapshot as SeriesStartupDurableSnapshot;
  if (snapshot.providerId !== input.providerId) {
    return { valid: false, reason: 'provider-mismatch' };
  }
  if (typeof input.resolveReadableGeneration !== 'function') {
    // Non-SQLite data sources (demo/mock/pure-network) have no cheap
    // generation probe — fail closed to the existing reconciliation path.
    return { valid: false, reason: 'probe-unavailable' };
  }

  let currentGeneration: number;
  try {
    currentGeneration = await input.resolveReadableGeneration();
  } catch {
    return { valid: false, reason: 'probe-error' };
  }

  if (!(currentGeneration > 0)) {
    return { valid: false, reason: 'generation-unreadable' };
  }
  if (currentGeneration !== snapshot.generation) {
    return { valid: false, reason: 'generation-mismatch' };
  }
  if (
    input.selectedCategoryId &&
    !input.selectedCategoryId.startsWith('section:') &&
    !input.selectedCategoryId.startsWith('smart:') &&
    !snapshot.categories.some((category) => category.id === input.selectedCategoryId)
  ) {
    return { valid: false, reason: 'category-missing' };
  }

  return { valid: true, generation: currentGeneration };
}

export function resolveSeriesStartupFocusTarget(input: {
  savedSeriesId: string | null;
  selectedSeriesId: string | null;
  viewportSeriesIds: string[];
  hasCategories: boolean;
}): {
  seriesId: string | null;
  reason: 'saved-focused' | 'saved-selected' | 'first-viewport' | 'none';
  fallbackUsed: boolean;
} {
  if (input.savedSeriesId && input.viewportSeriesIds.includes(input.savedSeriesId)) {
    return { seriesId: input.savedSeriesId, reason: 'saved-focused', fallbackUsed: false };
  }
  if (input.selectedSeriesId && input.viewportSeriesIds.includes(input.selectedSeriesId)) {
    return { seriesId: input.selectedSeriesId, reason: 'saved-selected', fallbackUsed: false };
  }
  if (input.viewportSeriesIds[0]) {
    return {
      seriesId: input.viewportSeriesIds[0],
      reason: 'first-viewport',
      fallbackUsed: Boolean(input.savedSeriesId || input.selectedSeriesId),
    };
  }
  return { seriesId: null, reason: 'none', fallbackUsed: input.hasCategories };
}

export function shouldDeferSeriesBackgroundCategoriesSwap(input: {
  detailOpen: boolean;
  detailClosing: boolean;
  restoringBrowseFocus: boolean;
  playbackActive: boolean;
  userNavigating: boolean;
  activeCategoryExistsInReplacement: boolean;
  focusedSeriesExistsInReplacement: boolean;
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
  if (!input.focusedSeriesExistsInReplacement) {
    return { defer: true, reason: 'focused-series-missing' };
  }
  return { defer: false, reason: 'compatible-swap' };
}

export function evaluateSeriesStartupBudgets(input: {
  categoriesElapsedMs: number | null;
  firstViewportElapsedMs: number | null;
  interactiveElapsedMs: number | null;
  startupMode: SeriesStartupQueryMode;
  providerRefreshStillRunning: boolean;
}): {
  categoriesBudgetPassed: boolean;
  viewportBudgetPassed: boolean;
  interactiveBudgetPassed: boolean;
} {
  return {
    categoriesBudgetPassed:
      input.categoriesElapsedMs == null ||
      input.categoriesElapsedMs <= SERIES_STARTUP_CATEGORIES_MAX_MS,
    viewportBudgetPassed:
      input.firstViewportElapsedMs == null ||
      input.firstViewportElapsedMs <= SERIES_STARTUP_VIEWPORT_MAX_MS,
    interactiveBudgetPassed:
      input.interactiveElapsedMs == null ||
      input.interactiveElapsedMs <= SERIES_STARTUP_INTERACTIVE_MAX_MS,
  };
}

export function shouldRunSeriesStartupBackgroundWork(input: {
  detailOpen: boolean;
  detailClosing: boolean;
}): boolean {
  return !input.detailOpen && !input.detailClosing;
}

/**
 * Merge a freshly-loaded category list on top of the previously-shown one
 * without ever collapsing a healthy rail down to (near-)zero on a bad refresh.
 * Mirrors Movies' `mergeCategoriesPreservingCounts` rejection heuristics.
 */
export function mergeSeriesCategoriesPreservingCounts(
  previous: MediaCategory[],
  next: MediaCategory[],
): MediaCategory[] {
  if (!next.length && previous.length) {
    return previous;
  }
  if (!previous.length) {
    return next;
  }

  const previousSelectable = previous.filter((category) => category.kind !== 'section');
  const nextSelectable = next.filter((category) => category.kind !== 'section');

  const looksCollapsed =
    previousSelectable.length >= 6 &&
    nextSelectable.length > 0 &&
    nextSelectable.length <= 2 &&
    nextSelectable.length < previousSelectable.length * 0.25;

  if ((previousSelectable.length > 0 && nextSelectable.length === 0) || looksCollapsed) {
    return previous;
  }

  const previousById = new Map(previous.map((category) => [category.id, category]));
  return next.map((category) => {
    const prior = previousById.get(category.id);
    if (!prior) {
      return category;
    }
    if (prior.countKnown && !category.countKnown) {
      return { ...category, count: prior.count, countKnown: true };
    }
    return category;
  });
}

/** Series cards initially need only lightweight browse fields — never season/episode data. */
export function isSeriesBrowseSummaryLightweight(series: SeriesSummary): boolean {
  return !('seasons' in (series as unknown as Record<string, unknown>)) &&
    !('episodesBySeason' in (series as unknown as Record<string, unknown>));
}
