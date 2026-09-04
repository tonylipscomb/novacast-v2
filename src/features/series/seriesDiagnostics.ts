import { isNovaCastTraceLoggingEnabled } from '../diagnostics/novacastLogPolicy.ts';

/**
 * Stage 4.2O — Series-specific perf/startup diagnostics.
 * High-frequency traces are gated; sqlite_refresh_failed stays in beta logcat.
 */

export const SERIES_DIAGNOSTICS_MARKER = 'stage4o-series-browse-rebuild-v1';

export function logSeriesPerf(action: string, payload: Record<string, unknown> = {}): void {
  if (!isNovaCastTraceLoggingEnabled()) {
    return;
  }
  console.info('[NovaCast Series]', { action, ...payload });
}

export function emitSeriesStartup(
  providerId: string,
  routeMountedAt: number,
  event: string,
  payload: Record<string, unknown> = {},
): void {
  if (!isNovaCastTraceLoggingEnabled()) {
    return;
  }
  const body = {
    event,
    marker: SERIES_DIAGNOSTICS_MARKER,
    providerId,
    elapsedMs: Date.now() - routeMountedAt,
    ...payload,
  };
  console.info('[NovaCast Series Startup] ' + JSON.stringify(body));
}

export const SERIES_STATE_HANDOFF_MARKER = 'series-state-handoff-audit-v1';

export type SeriesStateHandoffEvent =
  | 'initial-items-ready'
  | 'category-metadata-ready'
  | 'reconciliation-start'
  | 'reconciliation-preserved-selection'
  | 'reconciliation-replaced-selection'
  | 'visible-items-cleared'
  | 'visible-items-committed';

/**
 * Series Release Startup Regression audit trail.
 *
 * Intentionally RELEASE-SAFE (ungated — not behind isNovaCastTraceLoggingEnabled and
 * not __DEV__-only): this is the evidence trail for the startup state-handoff regression
 * where a valid selected-category + non-empty item screen was transiently blanked by a
 * background categories/metadata reconcile. It must survive in production logcat.
 * Never emits credentials or provider secrets.
 */
export function emitSeriesStateHandoff(
  event: SeriesStateHandoffEvent,
  fields: Record<string, unknown> = {},
): void {
  try {
    console.info(
      '[NovaCast Series State Handoff Audit] ' +
        JSON.stringify({ event, marker: SERIES_STATE_HANDOFF_MARKER, ...fields }),
    );
  } catch {
    // Telemetry must never throw into the render/data path.
  }
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
    if (isNovaCastTraceLoggingEnabled()) {
      console.info('[NovaCast Series Trace] ' + JSON.stringify({ event: 'series_grid_mount', instanceId }));
    }
    return;
  }
  gridMounted = false;
  if (isNovaCastTraceLoggingEnabled()) {
    console.info(
      '[NovaCast Series Trace] ' +
        JSON.stringify({ event: 'series_grid_unmount', instanceId: instanceId ?? activeGridInstanceId }),
    );
  }
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
  if (event !== 'series_sqlite_refresh_failed' && !isNovaCastTraceLoggingEnabled()) {
    return;
  }
  console.info(
    '[NovaCast Series SQLite] ' +
      JSON.stringify({
        event,
        marker: SERIES_SQLITE_DIAGNOSTICS_MARKER,
        ...payload,
      }),
  );
}
