import { novacastTrace } from '../diagnostics/novacastLogPolicy.ts';

/**
 * Stage: Movies Search Performance Audit — diagnostics only.
 * Filter: adb logcat | findstr /i "Movies Search"
 */

export type MoviesSearchTimingSession = {
  requestId: number;
  query: string;
  normalizedQueryLength: number;
  inputAt: number;
  debounceStartedAt: number;
  debounceReleasedAt: number | null;
  queryStartedAt: number | null;
  queryFinishedAt: number | null;
  mappingFinishedAt: number | null;
  stateAppliedAt: number | null;
  firstRenderAt: number | null;
  firstPosterReadyAt: number | null;
  path: 'index' | 'sqlite' | 'provider' | 'none' | null;
  resultCount: number | null;
  renderedResultCount: number | null;
  cancelled: boolean;
  stale: boolean;
  applied: boolean;
  sqliteMs: number | null;
  indexScanMs: number | null;
  mappingMs: number | null;
  emitted: boolean;
};

export type MoviesSearchRenderCounters = {
  requestId: number;
  resultCount: number;
  firstBatchCount: number;
  mountedPosterCount: number;
  posterRenderCount: number;
  imageRequestCount: number;
  listRenderCount: number;
  focusRenderCount: number;
};

const MARKER = 'stage-movies-search-perf-audit-v1';
const sessions = new Map<number, MoviesSearchTimingSession>();
const renderCounters = new Map<number, MoviesSearchRenderCounters>();
let activeRequestId = 0;
let nextRequestId = 1;
let firstPosterLoggedForRequest = 0;

function now() {
  return Date.now();
}

export function allocateMoviesSearchRequestId() {
  const requestId = nextRequestId;
  nextRequestId += 1;
  return requestId;
}

export function getActiveMoviesSearchRequestId() {
  return activeRequestId;
}

export function beginMoviesSearchInput(input: {
  query: string;
  normalizedQueryLength: number;
  debounceMs: number;
  previousRequestCancelled: boolean;
}): number {
  const requestId = allocateMoviesSearchRequestId();
  const previous = activeRequestId;
  activeRequestId = requestId;
  const at = now();
  sessions.set(requestId, {
    requestId,
    query: input.query,
    normalizedQueryLength: input.normalizedQueryLength,
    inputAt: at,
    debounceStartedAt: at,
    debounceReleasedAt: null,
    queryStartedAt: null,
    queryFinishedAt: null,
    mappingFinishedAt: null,
    stateAppliedAt: null,
    firstRenderAt: null,
    firstPosterReadyAt: null,
    path: null,
    resultCount: null,
    renderedResultCount: null,
    cancelled: false,
    stale: false,
    applied: false,
    sqliteMs: null,
    indexScanMs: null,
    mappingMs: null,
    emitted: false,
  });

  novacastTrace(
    '[NovaCast Movies Search Input] ' +
      JSON.stringify({
        queryLength: input.normalizedQueryLength,
        debounceMs: input.debounceMs,
        requestCreated: true,
        previousRequestCancelled: input.previousRequestCancelled,
        previousRequestId: previous || null,
        activeRequestId: requestId,
        marker: MARKER,
      }),
  );

  return requestId;
}

export function markMoviesSearchDebounceReleased(requestId: number) {
  const session = sessions.get(requestId);
  if (!session) {
    return;
  }
  session.debounceReleasedAt = now();
  session.queryStartedAt = session.debounceReleasedAt;
}

export function markMoviesSearchPath(
  requestId: number,
  path: MoviesSearchTimingSession['path'],
  timings?: { sqliteMs?: number; indexScanMs?: number; mappingMs?: number },
) {
  const session = sessions.get(requestId);
  if (!session) {
    return;
  }
  // Do not downgrade a more specific sqlite/index path to generic provider.
  if (!(session.path === 'sqlite' && path === 'provider') && !(session.path === 'index' && path === 'provider')) {
    session.path = path;
  }
  if (timings?.sqliteMs != null) {
    session.sqliteMs = timings.sqliteMs;
  }
  if (timings?.indexScanMs != null) {
    session.indexScanMs = timings.indexScanMs;
  }
  if (timings?.mappingMs != null) {
    session.mappingMs = timings.mappingMs;
  }
}

export function markMoviesSearchQueryFinished(requestId: number, resultCount: number) {
  const session = sessions.get(requestId);
  if (!session) {
    return;
  }
  session.queryFinishedAt = now();
  session.mappingFinishedAt = session.queryFinishedAt;
  session.resultCount = resultCount;
}

export function markMoviesSearchStateApplied(requestId: number, renderedResultCount: number) {
  const session = sessions.get(requestId);
  if (!session) {
    return;
  }
  session.stateAppliedAt = now();
  session.renderedResultCount = renderedResultCount;
  session.applied = true;
  emitMoviesSearchTiming(requestId);
}

export function markMoviesSearchCancelled(requestId: number, reason: 'aborted' | 'stale') {
  const session = sessions.get(requestId);
  // Stage 3G: never relabel an already-applied completed request as cancelled.
  if (!session || session.emitted || session.applied || session.stateAppliedAt != null) {
    return;
  }
  session.cancelled = reason === 'aborted';
  session.stale = reason === 'stale';
  emitMoviesSearchTiming(requestId);
}

export function markMoviesSearchFirstRender(requestId: number, resultCount: number) {
  const session = sessions.get(requestId);
  if (!session || session.firstRenderAt != null) {
    return;
  }
  session.firstRenderAt = now();
  session.renderedResultCount = resultCount;
  ensureRenderCounters(requestId, resultCount).listRenderCount += 1;
  emitMoviesSearchTiming(requestId, { partial: true });
  emitMoviesSearchRender(requestId);
}

export function markMoviesSearchPosterReady(requestId: number) {
  if (firstPosterLoggedForRequest === requestId) {
    return;
  }
  const session = sessions.get(requestId);
  if (!session || session.firstPosterReadyAt != null) {
    return;
  }
  firstPosterLoggedForRequest = requestId;
  session.firstPosterReadyAt = now();
  ensureRenderCounters(requestId, session.resultCount ?? 0).imageRequestCount += 1;
  emitMoviesSearchTiming(requestId);
  emitMoviesSearchRender(requestId);
}

export function noteMoviesSearchPosterMount(requestId: number) {
  ensureRenderCounters(requestId, sessions.get(requestId)?.resultCount ?? 0).mountedPosterCount += 1;
}

export function noteMoviesSearchPosterRender(requestId: number) {
  ensureRenderCounters(requestId, sessions.get(requestId)?.resultCount ?? 0).posterRenderCount += 1;
}

export function noteMoviesSearchFocusRender(requestId: number) {
  ensureRenderCounters(requestId, sessions.get(requestId)?.resultCount ?? 0).focusRenderCount += 1;
  emitMoviesSearchRender(requestId);
}

function ensureRenderCounters(requestId: number, resultCount: number): MoviesSearchRenderCounters {
  let counters = renderCounters.get(requestId);
  if (!counters) {
    counters = {
      requestId,
      resultCount,
      firstBatchCount: 0,
      mountedPosterCount: 0,
      posterRenderCount: 0,
      imageRequestCount: 0,
      listRenderCount: 0,
      focusRenderCount: 0,
    };
    renderCounters.set(requestId, counters);
  }
  counters.resultCount = resultCount;
  return counters;
}

export function setMoviesSearchFirstBatchCount(requestId: number, firstBatchCount: number) {
  ensureRenderCounters(requestId, sessions.get(requestId)?.resultCount ?? 0).firstBatchCount =
    firstBatchCount;
}

function emitMoviesSearchRender(requestId: number) {
  const counters = renderCounters.get(requestId);
  if (!counters) {
    return;
  }
  novacastTrace(
    '[NovaCast Movies Search Render] ' +
      JSON.stringify({
        ...counters,
        marker: MARKER,
      }),
  );
}

export function emitMoviesSearchTiming(requestId: number, options?: { partial?: boolean }) {
  const session = sessions.get(requestId);
  if (!session) {
    return;
  }
  if (session.emitted && !options?.partial) {
    return;
  }

  const debounceMs =
    session.debounceReleasedAt != null
      ? Math.max(0, session.debounceReleasedAt - session.debounceStartedAt)
      : null;
  const sqliteMs = session.sqliteMs;
  const mappingMs = session.mappingMs;
  const stateApplyMs =
    session.stateAppliedAt != null && session.mappingFinishedAt != null
      ? Math.max(0, session.stateAppliedAt - session.mappingFinishedAt)
      : null;
  const firstRenderMs =
    session.firstRenderAt != null ? Math.max(0, session.firstRenderAt - session.inputAt) : null;
  const totalMs =
    session.stateAppliedAt != null
      ? Math.max(0, session.stateAppliedAt - session.inputAt)
      : session.queryFinishedAt != null
        ? Math.max(0, session.queryFinishedAt - session.inputAt)
        : null;

  const payload = {
    requestId: session.requestId,
    queryLength: session.normalizedQueryLength,
    inputAt: session.inputAt,
    debounceStartedAt: session.debounceStartedAt,
    debounceReleasedAt: session.debounceReleasedAt,
    queryStartedAt: session.queryStartedAt,
    queryFinishedAt: session.queryFinishedAt,
    mappingFinishedAt: session.mappingFinishedAt,
    stateAppliedAt: session.stateAppliedAt,
    firstRenderAt: session.firstRenderAt,
    firstPosterReadyAt: session.firstPosterReadyAt,
    path: session.path,
    debounceMs,
    sqliteMs,
    indexScanMs: session.indexScanMs,
    mappingMs,
    stateApplyMs,
    firstRenderMs,
    totalMs,
    resultCount: session.resultCount,
    renderedResultCount: session.renderedResultCount,
    cancelled: session.cancelled,
    stale: session.stale,
    marker: MARKER,
  };

  novacastTrace('[NovaCast Movies Search Timing] ' + JSON.stringify(payload));

  if (!options?.partial && (session.stateAppliedAt != null || session.cancelled || session.stale)) {
    session.emitted = true;
  }
}

/** Pure helper for tests / EXPLAIN assembly — no credentials. */
export function buildMoviesSearchSql(input: {
  table?: string;
  likePattern: string;
  limit: number;
  offset: number;
}) {
  const table = input.table ?? 'catalog_items_v2';
  const countSql = `SELECT COUNT(*) AS total FROM ${table} WHERE provider_id = ? AND media_type = ? AND sync_generation = ? AND normalized_title LIKE ?`;
  const pageSql = `SELECT * FROM ${table} WHERE provider_id = ? AND media_type = ? AND sync_generation = ? AND normalized_title LIKE ? ORDER BY normalized_title ASC, content_id ASC LIMIT ? OFFSET ?`;
  return {
    table,
    countSql,
    pageSql,
    likePattern: input.likePattern,
    explainSql: `EXPLAIN QUERY PLAN ${pageSql}`,
    usesLeadingWildcard: input.likePattern.startsWith('%'),
    marker: MARKER,
  };
}

export function moviesSearchDiagnosticsContainCredentials(payload: string) {
  return /password|passwd|username|token|http:\/\/|https:\/\/|get\.php/i.test(payload);
}

export function resetMoviesSearchPerfDiagnosticsForTests() {
  sessions.clear();
  renderCounters.clear();
  activeRequestId = 0;
  nextRequestId = 1;
  firstPosterLoggedForRequest = 0;
}
