/**
 * Stage 4.2S.1 — Live TV category/provider switch + left-boundary focus instrumentation.
 *
 * Pure, dependency-free, and behavior-preserving: this module only *records* what the
 * Live TV screen is already doing so we can measure the exact freeze window and the
 * left-boundary focus resolution on-device. It never changes focus or loading behavior.
 *
 * Logging is disabled unless explicitly enabled for tests, or in __DEV__ with
 * EXPO_PUBLIC_LIVE_TV_SWITCH_DIAG=1. When enabled it emits `[NovaCast Live Switch]`
 * console lines so ONN logcat captures the phase timings.
 */

export type LiveTvSwitchKind = 'category' | 'provider';

export type LiveTvSwitchEvent =
  | 'category_switch_started'
  | 'provider_switch_started'
  | 'current_rows_retained'
  | 'channel_query_started'
  | 'channel_query_finished'
  | 'epg_refresh_started'
  | 'row_pool_rebuilt'
  | 'content_ready'
  | 'focus_restore_started'
  | 'focus_restore_finished';

export type LiveTvSwitchMark = {
  event: LiveTvSwitchEvent;
  /** Milliseconds since the trace started (monotonic where available). */
  atMs: number;
  extra?: Record<string, string | number | boolean | null>;
};

export type LiveTvSwitchTrace = {
  id: number;
  kind: LiveTvSwitchKind;
  categoryId: string | null;
  providerId: string | null;
  startedAtMs: number;
  endedAtMs: number | null;
  marks: LiveTvSwitchMark[];
};

export type LiveTvSwitchSummary = {
  id: number;
  kind: LiveTvSwitchKind;
  categoryId: string | null;
  providerId: string | null;
  /** Total wall time from start to the terminating mark (content_ready or end). */
  totalMs: number;
  /** channel_query_started → channel_query_finished. */
  channelQueryMs: number | null;
  /** channel_query_finished → row_pool_rebuilt (the synchronous commit/re-render window). */
  rowRebuildMs: number | null;
  /** start → content_ready (perceived freeze until new content is visible). */
  contentReadyMs: number | null;
  /** focus_restore_started → focus_restore_finished. */
  focusRestoreMs: number | null;
  marks: LiveTvSwitchMark[];
};

export type LiveTvLeftBoundaryResolution = {
  /** The item that currently owns focus when LEFT is pressed. */
  currentFocusId: string | null;
  /** The intended nextFocusLeft target (selected category / favorites id). */
  intendedTargetId: string | null;
  /** Whether a native handle resolved for the intended target. */
  resolvedHandle: boolean;
  /** Whether the intended target row was mounted at resolution time. */
  targetMounted: boolean;
  /** Whether we fell back to another target (e.g. favorites/first category). */
  fallbackUsed: boolean;
  /** The target actually used after fallback (if any). */
  fallbackTargetId: string | null;
  providerId: string | null;
  selectedCategoryId: string | null;
};

type ClockFn = () => number;

const defaultClock: ClockFn = () => {
  const perf = (globalThis as { performance?: { now?: () => number } }).performance;
  if (perf && typeof perf.now === 'function') {
    return perf.now();
  }
  return Date.now();
};

let clock: ClockFn = defaultClock;
let forced = false;
let nextTraceId = 1;
const activeTraces = new Map<number, LiveTvSwitchTrace>();
const completedSummaries: LiveTvSwitchSummary[] = [];
const boundaryResolutions: LiveTvLeftBoundaryResolution[] = [];

const MAX_HISTORY = 50;

function isEnabled(): boolean {
  if (forced) {
    return true;
  }
  // Purely opt-in via an EXPO_PUBLIC flag so it can be enabled on a release ONN build for
  // on-device acceptance timings. Default (flag unset) is a total no-op in every build.
  return process.env.EXPO_PUBLIC_LIVE_TV_SWITCH_DIAG === '1';
}

function emit(line: string, payload: Record<string, unknown>): void {
  if (!isEnabled()) {
    return;
  }
  // eslint-disable-next-line no-console -- diagnostics are opt-in via env flag.
  console.log(`[NovaCast Live Switch] ${line}`, JSON.stringify(payload));
}

/** Inject a deterministic clock for tests. Pass no argument to restore the default. */
export function setLiveTvSwitchClockForTests(fn?: ClockFn): void {
  clock = fn ?? defaultClock;
}

export function enableLiveTvSwitchDiagnosticsForTests(): void {
  forced = true;
}

/**
 * Begin a switch trace. Returns a trace id (or -1 when disabled, which every other
 * function treats as a no-op) so callers never branch on the enabled flag themselves.
 */
export function beginSwitchTrace(
  kind: LiveTvSwitchKind,
  context: { categoryId?: string | null; providerId?: string | null } = {},
): number {
  if (!isEnabled()) {
    return -1;
  }

  const id = nextTraceId++;
  const startedAtMs = clock();
  const trace: LiveTvSwitchTrace = {
    id,
    kind,
    categoryId: context.categoryId ?? null,
    providerId: context.providerId ?? null,
    startedAtMs,
    endedAtMs: null,
    marks: [],
  };
  activeTraces.set(id, trace);
  markSwitchEvent(id, kind === 'provider' ? 'provider_switch_started' : 'category_switch_started', {
    categoryId: trace.categoryId,
    providerId: trace.providerId,
  });
  return id;
}

export function markSwitchEvent(
  traceId: number,
  event: LiveTvSwitchEvent,
  extra?: Record<string, string | number | boolean | null>,
): void {
  if (traceId < 0) {
    return;
  }
  const trace = activeTraces.get(traceId);
  if (!trace) {
    return;
  }

  const atMs = clock() - trace.startedAtMs;
  trace.marks.push({ event, atMs, extra });
  emit(event, { id: traceId, kind: trace.kind, atMs: round(atMs), ...(extra ?? {}) });
}

export function endSwitchTrace(traceId: number): LiveTvSwitchSummary | null {
  if (traceId < 0) {
    return null;
  }
  const trace = activeTraces.get(traceId);
  if (!trace) {
    return null;
  }

  trace.endedAtMs = clock();
  activeTraces.delete(traceId);

  const summary = summarize(trace);
  completedSummaries.push(summary);
  if (completedSummaries.length > MAX_HISTORY) {
    completedSummaries.shift();
  }
  emit('switch_complete', {
    id: traceId,
    kind: trace.kind,
    totalMs: round(summary.totalMs),
    channelQueryMs: roundOrNull(summary.channelQueryMs),
    rowRebuildMs: roundOrNull(summary.rowRebuildMs),
    contentReadyMs: roundOrNull(summary.contentReadyMs),
    focusRestoreMs: roundOrNull(summary.focusRestoreMs),
  });
  return summary;
}

/** Pure summarizer — exported for unit tests without touching module state. */
export function summarizeSwitchTrace(trace: LiveTvSwitchTrace): LiveTvSwitchSummary {
  return summarize(trace);
}

function summarize(trace: LiveTvSwitchTrace): LiveTvSwitchSummary {
  const at = (event: LiveTvSwitchEvent): number | null => {
    const mark = trace.marks.find((entry) => entry.event === event);
    return mark ? mark.atMs : null;
  };

  const queryStart = at('channel_query_started');
  const queryEnd = at('channel_query_finished');
  const rowRebuilt = at('row_pool_rebuilt');
  const contentReady = at('content_ready');
  const focusStart = at('focus_restore_started');
  const focusEnd = at('focus_restore_finished');

  const endRelative =
    trace.endedAtMs != null ? trace.endedAtMs - trace.startedAtMs : contentReady ?? lastMarkAt(trace) ?? 0;

  return {
    id: trace.id,
    kind: trace.kind,
    categoryId: trace.categoryId,
    providerId: trace.providerId,
    totalMs: endRelative,
    channelQueryMs: diff(queryStart, queryEnd),
    rowRebuildMs: diff(queryEnd, rowRebuilt),
    contentReadyMs: contentReady,
    focusRestoreMs: diff(focusStart, focusEnd),
    marks: trace.marks,
  };
}

function lastMarkAt(trace: LiveTvSwitchTrace): number | null {
  if (!trace.marks.length) {
    return null;
  }
  return trace.marks[trace.marks.length - 1].atMs;
}

function diff(from: number | null, to: number | null): number | null {
  if (from == null || to == null) {
    return null;
  }
  return to - from;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function roundOrNull(value: number | null): number | null {
  return value == null ? null : round(value);
}

export function recordLeftBoundaryResolution(resolution: LiveTvLeftBoundaryResolution): void {
  if (!isEnabled()) {
    return;
  }
  boundaryResolutions.push(resolution);
  if (boundaryResolutions.length > MAX_HISTORY) {
    boundaryResolutions.shift();
  }
  emit('left_boundary_resolution', { ...resolution });
}

export function getSwitchDiagnosticsSnapshot(): {
  summaries: LiveTvSwitchSummary[];
  boundaryResolutions: LiveTvLeftBoundaryResolution[];
  activeTraceCount: number;
} {
  return {
    summaries: [...completedSummaries],
    boundaryResolutions: [...boundaryResolutions],
    activeTraceCount: activeTraces.size,
  };
}

export function resetLiveTvSwitchDiagnostics(): void {
  activeTraces.clear();
  completedSummaries.length = 0;
  boundaryResolutions.length = 0;
  nextTraceId = 1;
}
