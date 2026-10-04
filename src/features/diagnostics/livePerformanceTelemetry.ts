import { sanitizeDiagnosticMetadata } from './diagnosticsSanitizer.ts';
import { isNovaCastTraceLoggingEnabled } from './novacastLogPolicy.ts';
import { isDiagnosticsEnabled } from './diagnosticsConfig.ts';
import type { DiagnosticEvent } from './diagnosticTypes.ts';

const LOG_PREFIX = '[NOVACAST_PERF]';
const MAX_HISTORY = 64;
const STALL_INTERVAL_MS = 250;
const STALL_THRESHOLD_MS = 100;

async function recordLivePerformanceDiagnostic(event: DiagnosticEvent) {
  const { recordDiagnostic } = await import('./diagnosticsClient.ts');
  recordDiagnostic(event);
}

type PerformanceSession = {
  kind: 'cold_start' | 'live_tv';
  id: string;
  startedAt: number;
  events: number;
  counters: Record<string, number>;
  lastEventAt: number;
};

let session: PerformanceSession | null = null;
let history: Array<{ event: string; at: number }> = [];
let stallTimer: ReturnType<typeof setInterval> | null = null;
let stallStopTimer: ReturnType<typeof setTimeout> | null = null;
let lastJsStallAt = 0;
let lastJsStallMs = 0;

function nowMs() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
}

function safeFields(fields: Record<string, unknown>) {
  return sanitizeDiagnosticMetadata(fields);
}

function isTelemetryAllowed() {
  return isDiagnosticsEnabled() !== false;
}

function shouldLogEveryEvent(event: string) {
  return isNovaCastTraceLoggingEnabled() || event === 'js_thread_stall' || event.includes('milestone') || event.startsWith('tune_');
}

export function recordLivePerformanceEvent(event: string, fields: Record<string, unknown> = {}) {
  if (!isTelemetryAllowed()) return;
  const at = nowMs();
  const sanitized = safeFields(fields);
  if (session) {
    session.events += 1;
    session.lastEventAt = at;
    session.counters[event] = (session.counters[event] ?? 0) + 1;
  }
  history.push({ event, at });
  if (history.length > MAX_HISTORY) history = history.slice(-MAX_HISTORY);
  if (shouldLogEveryEvent(event)) console.info(LOG_PREFIX, event, sanitized);
}

export function beginLivePerformanceSession(kind: PerformanceSession['kind'], fields: Record<string, unknown> = {}) {
  if (session?.kind === kind) return session.id;
  session = { kind, id: `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, startedAt: nowMs(), events: 0, counters: {}, lastEventAt: nowMs() };
  recordLivePerformanceEvent(`${kind}_session_started`, fields);
  return session.id;
}

export function completeLivePerformanceSummary(reason: string) {
  if (!session || !isTelemetryAllowed()) return null;
  const completed = session;
  const summary = {
    sessionId: completed.id,
    sessionKind: completed.kind,
    reason,
    durationMs: Math.max(0, Math.round(nowMs() - completed.startedAt)),
    eventCount: completed.events,
    counters: { ...completed.counters },
    retainedHistoryCount: history.length,
  };
  if (completed.kind === 'live_tv') {
    console.info(LOG_PREFIX, 'live_epg_perf_summary', { sessionId: completed.id, counters: Object.fromEntries(Object.entries(completed.counters).filter(([key]) => key.startsWith('epg_'))) });
    console.info(LOG_PREFIX, 'live_marquee_perf_summary', { sessionId: completed.id, counters: Object.fromEntries(Object.entries(completed.counters).filter(([key]) => key.startsWith('marquee_'))) });
  }
  console.info(LOG_PREFIX, completed.kind === 'cold_start' ? 'cold_start_summary' : 'live_performance_summary', summary);
  void recordLivePerformanceDiagnostic({ eventType: 'live_performance', durationMs: summary.durationMs, metadata: summary });
  session = null;
  return summary;
}

export function recordLivePerformanceSummary(name: string, fields: Record<string, unknown> = {}) {
  if (!isTelemetryAllowed()) return;
  const sanitized = safeFields(fields);
  console.info(LOG_PREFIX, name, sanitized);
  void recordLivePerformanceDiagnostic({ eventType: 'live_performance', metadata: { summary: name, ...sanitized } });
}

export function startLiveJsStallMonitor(scope: 'cold_start' | 'live_tv', durationMs = 60_000) {
  stopLiveJsStallMonitor();
  if (!isTelemetryAllowed()) return;
  let expected = nowMs() + STALL_INTERVAL_MS;
  stallTimer = setInterval(() => {
    const actual = nowMs();
    const drift = actual - expected;
    expected = actual + STALL_INTERVAL_MS;
    if (drift >= STALL_THRESHOLD_MS) {
      lastJsStallAt = actual;
      lastJsStallMs = Math.round(drift);
      recordLivePerformanceEvent('js_thread_stall', { scope, driftMs: Math.round(drift), thresholdMs: STALL_THRESHOLD_MS });
    }
  }, STALL_INTERVAL_MS);
  stallStopTimer = setTimeout(() => stopLiveJsStallMonitor(), durationMs);
}

export function stopLiveJsStallMonitor() {
  if (stallTimer) clearInterval(stallTimer);
  if (stallStopTimer) clearTimeout(stallStopTimer);
  stallTimer = null;
  stallStopTimer = null;
}

export function recordLiveRenderChurn(component: string) {
  if (!session || !isTelemetryAllowed()) return;
  session.counters.render_churn = (session.counters.render_churn ?? 0) + 1;
  session.counters[`render_${component}`] = (session.counters[`render_${component}`] ?? 0) + 1;
}

export function getLivePerformanceTelemetryForTests() {
  return { session, history: [...history] };
}

export function resetLivePerformanceTelemetryForTests() {
  stopLiveJsStallMonitor();
  session = null;
  history = [];
  lastJsStallAt = 0;
  lastJsStallMs = 0;
}

export function getRecentLiveJsStallMs(maxAgeMs = 2_000) {
  const age = nowMs() - lastJsStallAt;
  return lastJsStallAt > 0 && age <= maxAgeMs ? lastJsStallMs : 0;
}

export const livePerformanceTelemetryConstants = { maxHistory: MAX_HISTORY, stallIntervalMs: STALL_INTERVAL_MS, stallThresholdMs: STALL_THRESHOLD_MS };
