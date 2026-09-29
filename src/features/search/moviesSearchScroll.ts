import { novacastTrace } from '../diagnostics/novacastLogPolicy.ts';

/**
 * Stage 3G.1 — safe Movies Search FlatList scrolling.
 * With numColumns, VirtualizedList length is row-count; scrollToIndex must use row index.
 */

const MARKER = 'stage3g1-movies-search-scroll-v1';

export type MoviesSearchScrollLog = {
  requestId: number | null;
  queryRevision: number;
  requestedIndex: number;
  currentLength: number;
  executed: boolean;
  dropped: boolean;
  reason: string;
};

export type PendingMoviesSearchScroll = {
  requestId: number | null;
  queryRevision: number;
  rowIndex: number;
  reason: string;
};

/** FlatList+numColumns exposes row slots to scrollToIndex. */
export function getMoviesSearchScrollListLength(itemCount: number, columns: number) {
  const safeColumns = Math.max(1, columns);
  if (itemCount <= 0) {
    return 0;
  }
  return Math.ceil(itemCount / safeColumns);
}

export function itemIndexToMoviesSearchScrollRow(itemIndex: number, columns: number) {
  return Math.floor(Math.max(0, itemIndex) / Math.max(1, columns));
}

/**
 * Validate a programmatic scroll against the CURRENT rendered data.
 * Never returns ok for a row index outside [0, listLength).
 */
export function planMoviesSearchScroll(input: {
  rowIndex: number;
  itemCount: number;
  columns: number;
  requestId: number | null;
  activeRequestId: number | null;
  queryRevision: number;
  activeQueryRevision: number;
}): { ok: boolean; rowIndex: number; listLength: number; reason: string } {
  const listLength = getMoviesSearchScrollListLength(input.itemCount, input.columns);
  const rowIndex = input.rowIndex;

  if (input.requestId != null && input.activeRequestId != null && input.requestId !== input.activeRequestId) {
    return { ok: false, rowIndex, listLength, reason: 'request-id-changed' };
  }

  if (input.queryRevision !== input.activeQueryRevision) {
    return { ok: false, rowIndex, listLength, reason: 'query-revision-changed' };
  }

  if (listLength <= 0) {
    return { ok: false, rowIndex, listLength, reason: 'empty-results' };
  }

  if (rowIndex < 0 || rowIndex >= listLength) {
    return { ok: false, rowIndex, listLength, reason: 'index-out-of-range' };
  }

  return { ok: true, rowIndex, listLength, reason: 'ok' };
}

export function logMoviesSearchScroll(payload: MoviesSearchScrollLog) {
  novacastTrace(
    '[NovaCast Movies Search Scroll] ' +
      JSON.stringify({
        ...payload,
        marker: MARKER,
      }),
  );
}

export function shouldKeepPendingMoviesSearchScroll(
  pending: PendingMoviesSearchScroll | null,
  activeRequestId: number | null,
  activeQueryRevision: number,
): boolean {
  if (!pending) {
    return false;
  }
  if (pending.requestId != null && activeRequestId != null && pending.requestId !== activeRequestId) {
    return false;
  }
  if (pending.queryRevision !== activeQueryRevision) {
    return false;
  }
  return true;
}

/**
 * Pure decision helper for tests / scheduler.
 * - drop: never call FlatList (and never retry)
 * - wait: keep pending until cells are ready
 * - execute: safe to call scrollToIndex(rowIndex)
 */
export function decideMoviesSearchScrollExecution(input: {
  pending: PendingMoviesSearchScroll | null;
  activeRequestId: number | null;
  activeQueryRevision: number;
  itemCount: number;
  columns: number;
  /** Highest row index known mounted/viewable; null means unknown (allow execute if in range). */
  cellsReadyThroughRow: number | null;
}): { action: 'execute' | 'wait' | 'drop'; reason: string; rowIndex: number; listLength: number } {
  const pending = input.pending;
  if (!pending) {
    return { action: 'drop', reason: 'no-pending', rowIndex: -1, listLength: 0 };
  }

  if (!shouldKeepPendingMoviesSearchScroll(pending, input.activeRequestId, input.activeQueryRevision)) {
    return {
      action: 'drop',
      reason:
        pending.queryRevision !== input.activeQueryRevision
          ? 'query-revision-changed'
          : 'request-id-changed',
      rowIndex: pending.rowIndex,
      listLength: getMoviesSearchScrollListLength(input.itemCount, input.columns),
    };
  }

  const plan = planMoviesSearchScroll({
    rowIndex: pending.rowIndex,
    itemCount: input.itemCount,
    columns: input.columns,
    requestId: pending.requestId,
    activeRequestId: input.activeRequestId,
    queryRevision: pending.queryRevision,
    activeQueryRevision: input.activeQueryRevision,
  });

  if (!plan.ok) {
    return {
      action: 'drop',
      reason: plan.reason,
      rowIndex: pending.rowIndex,
      listLength: plan.listLength,
    };
  }

  if (input.cellsReadyThroughRow != null && pending.rowIndex > input.cellsReadyThroughRow) {
    return {
      action: 'wait',
      reason: 'cells-not-ready',
      rowIndex: pending.rowIndex,
      listLength: plan.listLength,
    };
  }

  return {
    action: 'execute',
    reason: 'ok',
    rowIndex: pending.rowIndex,
    listLength: plan.listLength,
  };
}
