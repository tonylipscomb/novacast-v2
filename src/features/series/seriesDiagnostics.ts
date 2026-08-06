/**
 * Stage 4.2O — Series-specific perf/startup diagnostics.
 * Mirrors the shape of Movies' `logMoviesPerf` / `emitMoviesStartup` /
 * `traceOnnMoviesEvent` grid-instance helpers, scoped to Series. Always-on
 * (console.info), not gated behind an opt-in trace flag — matching the
 * unconditional Movies perf/startup logs used for physical acceptance.
 */

export const SERIES_DIAGNOSTICS_MARKER = 'stage4o-series-browse-rebuild-v1';

export function logSeriesPerf(action: string, payload: Record<string, unknown> = {}): void {
  console.info('[NovaCast Series]', { action, ...payload });
}

export function emitSeriesStartup(
  providerId: string,
  routeMountedAt: number,
  event: string,
  payload: Record<string, unknown> = {},
): void {
  const body = {
    event,
    marker: SERIES_DIAGNOSTICS_MARKER,
    providerId,
    elapsedMs: Date.now() - routeMountedAt,
    ...payload,
  };
  console.info('[NovaCast Series Startup] ' + JSON.stringify(body));
}

let gridInstanceSeq = 0;
let activeGridInstanceId: string | null = null;
let gridMounted = false;

export function nextOnnSeriesGridInstanceId(): string {
  gridInstanceSeq += 1;
  return `series-grid-${gridInstanceSeq}`;
}

export function setOnnSeriesGridMounted(mounted: boolean, instanceId: string | null): void {
  if (mounted) {
    gridMounted = true;
    activeGridInstanceId = instanceId;
    console.info('[NovaCast Series Trace] ' + JSON.stringify({ event: 'series_grid_mount', instanceId }));
    return;
  }
  gridMounted = false;
  console.info(
    '[NovaCast Series Trace] ' +
      JSON.stringify({ event: 'series_grid_unmount', instanceId: instanceId ?? activeGridInstanceId }),
  );
}

export function isOnnSeriesGridMounted(): boolean {
  return gridMounted;
}

export function getOnnSeriesGridInstanceId(): string | null {
  return activeGridInstanceId;
}

export function resetOnnSeriesGridDiagnosticsForTests(): void {
  gridInstanceSeq = 0;
  activeGridInstanceId = null;
  gridMounted = false;
}

/**
 * Stage 4.2O.2 — Series SQLite parity diagnostics.
 * Mirrors Movies' SQLite console.info event style (`[NovaCast Movies ...]`)
 * with a single `[NovaCast Series SQLite]` prefix so every event carries the
 * same providerId/generation/categoryId/rowCount/elapsedMs/requestId shape.
 */
export const SERIES_SQLITE_DIAGNOSTICS_MARKER = 'stage4o2-series-sqlite-parity-v1';

export type SeriesSqliteDiagnosticEvent =
  | 'series_sqlite_generation_pinned'
  | 'series_sqlite_categories_ready'
  | 'series_sqlite_first_viewport_ready'
  | 'series_sqlite_page_appended'
  | 'series_sqlite_search_completed'
  | 'series_sqlite_refresh_started'
  | 'series_sqlite_refresh_validated'
  | 'series_sqlite_generation_promoted'
  | 'series_sqlite_refresh_failed'
  | 'series_sqlite_offline_startup'
  | 'series_sqlite_stale_result_dropped'
  | 'series_sqlite_generation_mismatch_blocked';

export function emitSeriesSqliteEvent(
  event: SeriesSqliteDiagnosticEvent,
  payload: Record<string, unknown> = {},
): void {
  console.info(
    '[NovaCast Series SQLite] ' +
      JSON.stringify({
        event,
        marker: SERIES_SQLITE_DIAGNOSTICS_MARKER,
        ...payload,
      }),
  );
}
