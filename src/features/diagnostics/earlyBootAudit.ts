/**
 * Stage 2.5/2.95 diagnostics: early-boot phase timing.
 * Logs operations over 50 ms during the first 15 s after launch.
 */

const LOG_TAG = '[NovaCast EarlyBoot]';
const WINDOW_MS = 15_000;
const REPORT_THRESHOLD_MS = 50;

let bootAt = 0;
let enabled = false;

type SlowOp = {
  name: string;
  startMs: number;
  endMs: number;
  elapsedMs: number;
  sync: boolean;
  meta?: Record<string, unknown>;
};

const slowOps: SlowOp[] = [];
let lastMarkName = '';
let lastMarkAt = 0;

function nowMs() {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

function wallMs() {
  return Date.now();
}

export function initializeEarlyBootAudit() {
  if (enabled) {
    return;
  }
  enabled =
    typeof process !== 'undefined' &&
    process.env?.EXPO_PUBLIC_NOVACAST_CATALOG_AUDIT === '1';
  if (!enabled) {
    return;
  }
  bootAt = wallMs();
  console.info(LOG_TAG, 'armed', { windowMs: WINDOW_MS, thresholdMs: REPORT_THRESHOLD_MS });
}

export function isEarlyBootWindowOpen() {
  return enabled && bootAt > 0 && wallMs() - bootAt < WINDOW_MS;
}

function recordSlowOp(op: SlowOp) {
  slowOps.push(op);
  console.info(LOG_TAG, 'slow_op', {
    name: op.name,
    startMs: op.startMs,
    endMs: op.endMs,
    elapsedMs: op.elapsedMs,
    sync: op.sync,
    blockedJsLikely: true,
    ...(op.meta ?? {}),
  });
}

export async function earlyBootTimed<T>(
  name: string,
  work: () => Promise<T>,
  meta: Record<string, unknown> = {},
): Promise<T> {
  if (!enabled) {
    return work();
  }
  const startWall = wallMs();
  const startPerf = nowMs();
  const withinWindow = isEarlyBootWindowOpen();
  try {
    return await work();
  } finally {
    const elapsedMs = Math.round(nowMs() - startPerf);
    if (withinWindow && elapsedMs >= REPORT_THRESHOLD_MS) {
      recordSlowOp({
        name,
        startMs: startWall - bootAt,
        endMs: wallMs() - bootAt,
        elapsedMs,
        sync: false,
        meta: { ...meta, blockedJsLikely: false, note: 'async-wall-time-includes-awaits' },
      });
    }
  }
}

export function earlyBootTimedSync<T>(
  name: string,
  work: () => T,
  meta: Record<string, unknown> = {},
): T {
  if (!enabled) {
    return work();
  }
  const startWall = wallMs();
  const startPerf = nowMs();
  const withinWindow = isEarlyBootWindowOpen();
  try {
    return work();
  } finally {
    const elapsedMs = Math.round(nowMs() - startPerf);
    if (withinWindow && elapsedMs >= REPORT_THRESHOLD_MS) {
      recordSlowOp({
        name,
        startMs: startWall - bootAt,
        endMs: wallMs() - bootAt,
        elapsedMs,
        sync: true,
        meta,
      });
    }
  }
}

export function earlyBootMark(name: string, meta: Record<string, unknown> = {}) {
  if (!enabled || !isEarlyBootWindowOpen()) {
    return;
  }
  lastMarkName = name;
  lastMarkAt = wallMs() - bootAt;
  console.info(LOG_TAG, 'mark', { name, t: lastMarkAt, ...meta });
}

export function getLastEarlyBootMark() {
  return { name: lastMarkName, t: lastMarkAt };
}

export function getEarlyBootSlowOpsForTests() {
  return [...slowOps];
}

export function resetEarlyBootAuditForTests() {
  slowOps.length = 0;
  bootAt = 0;
  enabled = false;
  lastMarkName = '';
  lastMarkAt = 0;
}
