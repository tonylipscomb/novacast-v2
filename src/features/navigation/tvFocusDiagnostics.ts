import { tvPerfRecordFocusRequest, tvPerfSetLatestFocusRequest } from '../perf/tvPerfStore.ts';
import { isAppForegroundActive } from '../resilience/appForegroundGate.ts';
import { recordFocusAudit } from './focusRequestAudit.ts';

/**
 * Development-only TV focus request ledger + guarded focus helper.
 * Production builds still run the guarded focus path; recording is DEV-only.
 */

export type TvFocusRequestStatus = 'executed' | 'cancelled' | 'ignored' | 'timeout';

export type TvFocusCancelReason =
  | 'superseded'
  | 'caller'
  | 'inactive'
  | 'timeout'
  | null;

export type TvFocusRequestRecord = {
  id: string;
  generation: number;
  timestamp: number;
  screen: string;
  source: string;
  region: string;
  itemId: string | null;
  reason: string;
  status: TvFocusRequestStatus;
  cancelReason: TvFocusCancelReason;
};

export type RequestTvFocusInput = {
  screen: string;
  source: string;
  region: string;
  itemId?: string | null;
  reason: string;
  /** Return the native focusable target, or null while layout is still settling. */
  getTarget: () => { focus: () => void } | null | undefined;
  /** When false, the request is ignored (screen/overlay no longer active). */
  isActive?: () => boolean;
  /** Max animation frames to wait for a mountable target. */
  maxFrames?: number;
  /** Invoked once when the request executes, is ignored, or is cancelled. */
  onSettled?: (status: TvFocusRequestStatus) => void;
};

const DEFAULT_MAX_FRAMES = 3;

type PendingEntry = {
  id: string;
  cancel: (reason?: Exclude<TvFocusCancelReason, null>) => void;
};

declare const __DEV__: boolean | undefined;

let requestCounter = 0;
const records: TvFocusRequestRecord[] = [];
const pendingByKey = new Map<string, PendingEntry>();

function isDevEnvironment(): boolean {
  if (typeof __DEV__ !== 'undefined') {
    return Boolean(__DEV__);
  }
  return process.env.NODE_ENV !== 'production';
}

function regionKey(screen: string, region: string): string {
  return `${screen}::${region}`;
}

function pushRecord(record: TvFocusRequestRecord) {
  if (!isDevEnvironment()) {
    return;
  }
  records.push(record);
  if (records.length > 200) {
    records.splice(0, records.length - 200);
  }
  tvPerfSetLatestFocusRequest({
    source: record.source,
    region: record.region,
    itemId: record.itemId,
    reason: record.reason,
    generation: record.generation,
    status: record.status,
  });
}

function markStatus(id: string, status: TvFocusRequestStatus, cancelReason: TvFocusCancelReason = null) {
  if (!isDevEnvironment()) {
    return;
  }
  const existing = records.find((entry) => entry.id === id);
  if (existing) {
    existing.status = status;
    existing.cancelReason = cancelReason;
    tvPerfSetLatestFocusRequest({
      source: existing.source,
      region: existing.region,
      itemId: existing.itemId,
      reason: existing.reason,
      generation: existing.generation,
      status,
    });
  }
}

/**
 * Request a single programmatic focus move.
 * Cancels any older pending request for the same screen/region.
 * Performs at most one `.focus()` call when the target is ready.
 */
export function requestTvFocus(input: RequestTvFocusInput): () => void {
  recordFocusAudit({
    component: input.source,
    action: 'requestTvFocus',
    itemId: input.itemId ?? null,
    reason: input.reason,
    detail: { screen: input.screen, region: input.region },
  });
  if (!isAppForegroundActive()) {
    pushRecord({
      id: `tv-focus-${Date.now()}-${++requestCounter}`,
      generation: requestCounter,
      timestamp: Date.now(),
      screen: input.screen,
      source: input.source,
      region: input.region,
      itemId: input.itemId ?? null,
      reason: input.reason,
      status: 'ignored',
      cancelReason: 'inactive',
    });
    input.onSettled?.('ignored');
    return () => undefined;
  }
  tvPerfRecordFocusRequest();
  const generation = ++requestCounter;
  const id = `tv-focus-${Date.now()}-${generation}`;
  const key = regionKey(input.screen, input.region);
  const maxFrames = input.maxFrames ?? DEFAULT_MAX_FRAMES;
  const itemId = input.itemId ?? null;

  const previous = pendingByKey.get(key);
  if (previous) {
    previous.cancel('superseded');
    pendingByKey.delete(key);
  }

  pushRecord({
    id,
    generation,
    timestamp: Date.now(),
    screen: input.screen,
    source: input.source,
    region: input.region,
    itemId,
    reason: input.reason,
    status: 'ignored',
    cancelReason: null,
  });

  let cancelled = false;
  let settled = false;
  let frameHandle: ReturnType<typeof requestAnimationFrame> | null = null;
  let attemptsLeft = maxFrames;

  const settle = (status: TvFocusRequestStatus, cancelReason: TvFocusCancelReason = null) => {
    if (settled) {
      return;
    }
    settled = true;
    markStatus(id, status, cancelReason);
    input.onSettled?.(status);
  };

  const cleanup = () => {
    if (pendingByKey.get(key)?.id === id) {
      pendingByKey.delete(key);
    }
    if (frameHandle != null) {
      cancelAnimationFrame(frameHandle);
      frameHandle = null;
    }
  };

  const cancel = (reason: Exclude<TvFocusCancelReason, null> = 'caller') => {
    if (cancelled) {
      return;
    }
    cancelled = true;
    cleanup();
    settle('cancelled', reason);
  };

  pendingByKey.set(key, { id, cancel });

  const attempt = () => {
    if (cancelled) {
      return;
    }

    if (input.isActive && !input.isActive()) {
      cleanup();
      settle('ignored', 'inactive');
      return;
    }

    const target = input.getTarget();
    if (target) {
      recordFocusAudit({
        component: input.source,
        action: 'native-focus',
        itemId,
        reason: input.reason,
        detail: { screen: input.screen, region: input.region },
      });
      target.focus();
      cleanup();
      settle('executed');
      return;
    }

    if (attemptsLeft <= 0) {
      cleanup();
      settle('timeout', 'timeout');
      return;
    }

    attemptsLeft -= 1;
    frameHandle = requestAnimationFrame(attempt);
  };

  attempt();
  return () => cancel('caller');
}

export function cancelAllPendingTvFocus(reason: Exclude<TvFocusCancelReason, null> = 'inactive') {
  const pending = [...pendingByKey.values()];
  pendingByKey.clear();
  pending.forEach((entry) => entry.cancel(reason));
}

export function getTvFocusDiagnosticsForTests(): TvFocusRequestRecord[] {
  return records.map((entry) => ({ ...entry }));
}

export function getPendingTvFocusRegionKeysForTests(): string[] {
  return [...pendingByKey.keys()];
}

export function resetTvFocusDiagnosticsForTests() {
  pendingByKey.forEach((entry) => entry.cancel('caller'));
  pendingByKey.clear();
  records.length = 0;
  requestCounter = 0;
}
