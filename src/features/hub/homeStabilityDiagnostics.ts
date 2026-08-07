/**
 * Stage 4.2R — Home + Navigation Stability diagnostics.
 *
 * Emits a small, bounded set of lifecycle/perf markers so we can measure where
 * Home startup, focus assignment, restoration, and any expensive work happen.
 *
 * Deliberately NOT a permanent firehose:
 * - Gated behind EXPO_PUBLIC_NOVACAST_CATALOG_AUDIT === '1' (same switch the
 *   existing catalog/focus-latency audits use).
 * - One-shot events log once per Home mount generation.
 * - nav_focus_changed / home_row_updated are coalesced to avoid per-frame spam.
 */

const LOG_TAG = '[NovaCast HomeStability]';

export type HomeStabilityEvent =
  | 'shell_mount_started'
  | 'shell_mount_ready'
  | 'home_mount_started'
  | 'home_data_snapshot_ready'
  | 'home_initial_focus_assigned'
  | 'home_interactive'
  | 'nav_focus_changed'
  | 'nav_route_activated'
  | 'home_focus_restored'
  | 'home_row_updated'
  | 'home_expensive_work_detected';

type EventDetail = Record<string, string | number | boolean | null | undefined>;

function envEnabled(): boolean {
  return (
    typeof process !== 'undefined' &&
    process.env?.EXPO_PUBLIC_NOVACAST_CATALOG_AUDIT === '1'
  );
}

let enabled = envEnabled();

/** Baseline timestamp (Home mount) used for elapsed timing. */
let homeMountAtMs: number | null = null;

/** One-shot guard so lifecycle events fire once per mount generation. */
const firedOnce = new Set<string>();

/** Coalescing counters so high-frequency events do not spam the log. */
let navFocusChanges = 0;
let rowUpdates = 0;

function nowMs(): number {
  return Date.now();
}

function elapsedMs(): number | null {
  return homeMountAtMs == null ? null : nowMs() - homeMountAtMs;
}

/** Call once when a fresh Home mount begins to reset per-mount state. */
export function beginHomeStabilityGeneration(): void {
  enabled = envEnabled();
  homeMountAtMs = nowMs();
  firedOnce.clear();
  navFocusChanges = 0;
  rowUpdates = 0;
}

export function recordHomeStabilityEvent(event: HomeStabilityEvent, detail?: EventDetail): void {
  if (!enabled) {
    return;
  }
  const payload: EventDetail = { ...detail };
  const elapsed = elapsedMs();
  if (elapsed != null) {
    payload.elapsedMs = elapsed;
  }
  console.info(LOG_TAG, event, payload);
}

/**
 * Fires a lifecycle event at most once per mount generation. Use for the
 * one-shot startup/handoff markers so repeated renders do not re-log.
 */
export function recordHomeStabilityOnce(event: HomeStabilityEvent, detail?: EventDetail): void {
  if (!enabled) {
    return;
  }
  if (firedOnce.has(event)) {
    return;
  }
  firedOnce.add(event);
  recordHomeStabilityEvent(event, detail);
}

/**
 * Coalesced nav-focus counter. Logs a summary every {@link flushEvery} changes
 * rather than once per D-pad move, keeping the signal useful without a firehose.
 */
export function noteNavFocusChanged(navId: string, flushEvery = 8): void {
  if (!enabled) {
    return;
  }
  navFocusChanges += 1;
  if (navFocusChanges % flushEvery === 0) {
    recordHomeStabilityEvent('nav_focus_changed', { navId, totalChanges: navFocusChanges });
  }
}

/** Coalesced Home-row update counter. */
export function noteHomeRowUpdated(reason: string, flushEvery = 4): void {
  if (!enabled) {
    return;
  }
  rowUpdates += 1;
  if (rowUpdates % flushEvery === 0) {
    recordHomeStabilityEvent('home_row_updated', { reason, totalUpdates: rowUpdates });
  }
}
