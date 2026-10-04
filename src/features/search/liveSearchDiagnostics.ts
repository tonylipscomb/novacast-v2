import { getLiveTvWorkload } from '../live/liveTvWorkload.ts';
import { hasAnyActiveCatalogSqliteWriter } from '../catalog/catalogSyncWriterRegistry.ts';
import { getRecentLiveJsStallMs } from '../diagnostics/livePerformanceTelemetry.ts';

export type LiveSearchDiagnosticEvent =
  | 'search-open'
  | 'input-received'
  | 'query-state-updated'
  | 'filter-start'
  | 'filter-complete'
  | 'results-render-start'
  | 'results-render-complete'
  | 'first-result-focus'
  | 'search-close';

type LiveSearchTrace = {
  openedAt: number;
  inputAt: number | null;
  filterStartedAt: number | null;
  resultsAt: number | null;
  firstFocusLogged: boolean;
};

let trace: LiveSearchTrace | null = null;

function nowMs() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
}

function boundedNumber(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.max(0, Math.round(value));
}

function snapshotFields(fields: Record<string, unknown>) {
  const workload = getLiveTvWorkload();
  const catalogWriterActive = hasAnyActiveCatalogSqliteWriter();
  return {
    queryLength: boundedNumber(fields.queryLength),
    sourceChannelCount: boundedNumber(fields.sourceChannelCount),
    resultCount: boundedNumber(fields.resultCount),
    filterMs: boundedNumber(fields.filterMs),
    renderMs: boundedNumber(fields.renderMs),
    inputToFilterStartMs: trace?.inputAt != null && trace.filterStartedAt != null
      ? boundedNumber(trace.filterStartedAt - trace.inputAt)
      : null,
    inputToResultsMs: trace?.inputAt != null && trace.resultsAt != null
      ? boundedNumber(trace.resultsAt - trace.inputAt)
      : null,
    inputToFirstFocusMs: trace?.inputAt != null && fields.firstFocusAt != null
      ? boundedNumber(Number(fields.firstFocusAt) - trace.inputAt)
      : null,
    eventLoopLagMs: boundedNumber(fields.eventLoopLagMs) ?? getRecentLiveJsStallMs(),
    liveIndexReady: fields.liveIndexReady === true,
    liveIndexBuildInProgress: workload.searchIndexBuildActive,
    catalogWriterActive,
    backgroundCatalogActive: catalogWriterActive || workload.searchIndexBuildActive,
  };
}

export function recordLiveSearchDiagnostic(
  event: LiveSearchDiagnosticEvent,
  fields: Record<string, unknown> = {},
) {
  const now = nowMs();
  if (event === 'search-open') {
    trace = { openedAt: now, inputAt: null, filterStartedAt: null, resultsAt: null, firstFocusLogged: false };
  } else if (!trace) {
    trace = { openedAt: now, inputAt: null, filterStartedAt: null, resultsAt: null, firstFocusLogged: false };
  }

  if (event === 'input-received') {
    trace.inputAt = now;
    trace.filterStartedAt = null;
    trace.resultsAt = null;
    trace.firstFocusLogged = false;
  } else if (event === 'filter-start') {
    trace.filterStartedAt = now;
  } else if (event === 'results-render-start') {
    trace.resultsAt = now;
  } else if (event === 'first-result-focus') {
    if (trace.firstFocusLogged) return;
    trace.firstFocusLogged = true;
    fields = { ...fields, firstFocusAt: now };
  }

  console.info('[NOVACAST_LIVE_SEARCH]', event, snapshotFields(fields));
  if (event === 'search-close') trace = null;
}

export function resetLiveSearchDiagnosticsForTests() {
  trace = null;
}
