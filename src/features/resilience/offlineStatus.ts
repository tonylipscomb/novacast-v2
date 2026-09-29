/**
 * Lightweight offline status without NetInfo dependency.
 * Callers report connectivity outcomes; UI reads a stable snapshot.
 */

type NetworkStatus = 'online' | 'offline' | 'unknown';
type NetworkFailureKind = 'transport' | 'provider' | 'authorization' | 'unknown';

type OfflineSnapshot = {
  status: NetworkStatus;
  lastChangedAt: number | null;
  lastOutageNotifiedAt: number | null;
  consecutiveFailures: number;
};

const OUTAGE_DEDUPE_MS = 60_000;
const OFFLINE_FAILURE_THRESHOLD = 3;

let snapshot: OfflineSnapshot = {
  status: 'unknown',
  lastChangedAt: null,
  lastOutageNotifiedAt: null,
  consecutiveFailures: 0,
};

const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

export function getOfflineSnapshot(): OfflineSnapshot {
  return snapshot;
}

export function subscribeOfflineStatus(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function reportNetworkOutcome(ok: boolean, failureKind: NetworkFailureKind = 'transport') {
  if (!ok && (failureKind === 'provider' || failureKind === 'authorization')) {
    return;
  }
  if (ok) {
    const next: NetworkStatus = 'online';
    if (snapshot.status === next && snapshot.consecutiveFailures === 0) return;
    snapshot = { ...snapshot, status: next, consecutiveFailures: 0, lastChangedAt: Date.now() };
    emit();
    return;
  }
  const consecutiveFailures = snapshot.consecutiveFailures + 1;
  if (consecutiveFailures < OFFLINE_FAILURE_THRESHOLD) {
    snapshot = { ...snapshot, consecutiveFailures };
    return;
  }
  const next: NetworkStatus = 'offline';
  if (snapshot.status === next) {
    return;
  }
  snapshot = {
    ...snapshot,
    status: next,
    consecutiveFailures,
    lastChangedAt: Date.now(),
  };
  emit();
}

/** Returns true once per outage window so notifications are not spammed. */
export function shouldAnnounceOfflineOutage() {
  if (snapshot.status !== 'offline') {
    return false;
  }
  const now = Date.now();
  if (snapshot.lastOutageNotifiedAt && now - snapshot.lastOutageNotifiedAt < OUTAGE_DEDUPE_MS) {
    return false;
  }
  snapshot = { ...snapshot, lastOutageNotifiedAt: now };
  return true;
}

export function resetOfflineStatusForTests() {
  snapshot = {
    status: 'unknown',
    lastChangedAt: null,
    lastOutageNotifiedAt: null,
    consecutiveFailures: 0,
  };
}
