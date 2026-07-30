/**
 * Stage 2.5 diagnostics: hardware key → native focus latency.
 * Pairs TV remote direction events with the next matching onFocus.
 */

const LOG_TAG = '[NovaCast FocusLatency]';

type FocusTargetKind = 'navbar' | 'home-card' | 'other';

type PendingKey = {
  id: number;
  atMs: number;
  eventType: string;
  expectedKind: FocusTargetKind | 'any';
  phase: string;
};

type LatencySample = {
  kind: FocusTargetKind;
  latencyMs: number;
  eventType: string;
  phase: string;
  focusSource: string;
};

let enabled = false;
let seq = 0;
let pending: PendingKey | null = null;
let superseded = 0;
let unmatchedKeys = 0;
let samples: LatencySample[] = [];
let currentPhase = 'boot';

function nowMs() {
  return Date.now();
}

function envEnabled() {
  return (
    typeof process !== 'undefined' &&
    process.env?.EXPO_PUBLIC_NOVACAST_CATALOG_AUDIT === '1'
  );
}

export function initializeFocusLatencyAudit() {
  if (enabled) {
    return;
  }
  enabled = envEnabled();
  if (!enabled) {
    return;
  }
  console.info(LOG_TAG, 'armed');
}

export function setFocusLatencyPhase(phase: string) {
  currentPhase = phase;
  if (enabled) {
    console.info(LOG_TAG, 'phase', { phase });
  }
}

function classifyEvent(eventType: string): FocusTargetKind | 'any' | null {
  const type = eventType.toLowerCase();
  if (type === 'up' || type === 'swipeUp') {
    return 'navbar';
  }
  if (type === 'down' || type === 'swipeDown') {
    return 'home-card';
  }
  if (type === 'left' || type === 'right' || type === 'swipeLeft' || type === 'swipeRight') {
    return 'any';
  }
  return null;
}

function classifyFocusSource(source: string): FocusTargetKind {
  if (source.startsWith('nav:')) {
    return 'navbar';
  }
  if (source === 'home-card' || source.startsWith('home-')) {
    return 'home-card';
  }
  return 'other';
}

export function noteFocusLatencyKeyEvent(eventType: string) {
  if (!enabled) {
    return;
  }
  const expectedKind = classifyEvent(eventType);
  if (!expectedKind) {
    return;
  }
  if (pending) {
    superseded += 1;
    unmatchedKeys += 1;
  }
  seq += 1;
  pending = {
    id: seq,
    atMs: nowMs(),
    eventType,
    expectedKind,
    phase: currentPhase,
  };
}

export function noteFocusLatencyFocus(source: string) {
  if (!enabled || !pending) {
    return;
  }
  const kind = classifyFocusSource(source);
  if (kind === 'other') {
    return;
  }
  if (pending.expectedKind !== 'any' && pending.expectedKind !== kind) {
    return;
  }

  const latencyMs = Math.max(0, nowMs() - pending.atMs);
  const sample: LatencySample = {
    kind,
    latencyMs,
    eventType: pending.eventType,
    phase: pending.phase,
    focusSource: source,
  };
  samples.push(sample);
  pending = null;

  console.info(LOG_TAG, 'sample', sample);

  if (samples.length >= 10 && samples.length % 10 === 0) {
    logFocusLatencySummary();
  }
}

function percentile(sorted: number[], p: number) {
  if (!sorted.length) {
    return 0;
  }
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

function summarize(kind: FocusTargetKind) {
  const values = samples.filter((sample) => sample.kind === kind).map((sample) => sample.latencyMs).sort((a, b) => a - b);
  if (!values.length) {
    return null;
  }
  const mid = Math.floor(values.length / 2);
  const median =
    values.length % 2 === 0 ? Math.round((values[mid - 1] + values[mid]) / 2) : values[mid];
  return {
    n: values.length,
    median,
    p95: percentile(values, 95),
    max: values[values.length - 1],
  };
}

export function logFocusLatencySummary() {
  if (!enabled) {
    return;
  }
  console.info(LOG_TAG, 'summary', {
    phase: currentPhase,
    navbar: summarize('navbar'),
    homeCard: summarize('home-card'),
    superseded,
    unmatchedKeys,
    pending: Boolean(pending),
    sampleCount: samples.length,
  });
}

export function resetFocusLatencySamplesForPhase(phase: string) {
  samples = samples.filter((sample) => sample.phase !== phase);
  setFocusLatencyPhase(phase);
}

export function getFocusLatencySnapshotForTests() {
  return {
    samples: [...samples],
    superseded,
    unmatchedKeys,
    pending,
    phase: currentPhase,
  };
}
