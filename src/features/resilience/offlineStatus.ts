/**
 * Lightweight offline status without NetInfo dependency.
 * Callers report connectivity outcomes; UI reads a stable snapshot.
 */

type NetworkStatus = 'online' | 'offline' | 'unknown';

type OfflineSnapshot = {
  status: NetworkStatus;
  lastChangedAt: number | null;
  lastOutageNotifiedAt: number | null;
};

const OUTAGE_DEDUPE_MS = 60_000;

let snapshot: OfflineSnapshot = {
  status: 'unknown',
  lastChangedAt: null,
  lastOutageNotifiedAt: null,
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

export function reportNetworkOutcome(ok: boolean) {
  const next: NetworkStatus = ok ? 'online' : 'offline';
  if (snapshot.status === next) {
    return;
  }
  snapshot = {
    ...snapshot,
    status: next,
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
  };
}
