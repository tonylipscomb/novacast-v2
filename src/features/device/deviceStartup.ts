import {
  getDeviceState,
  hydrateCachedDeviceState,
  initializeDevice,
} from './deviceActivation';
import type { DeviceState } from './deviceTypes';

export type DeviceStartupPhase = 'idle' | 'hydrating' | 'ready' | 'failed';

export type DeviceStartupSnapshot = {
  phase: DeviceStartupPhase;
  error: unknown | null;
};

let snapshot: DeviceStartupSnapshot = { phase: 'idle', error: null };
let startupPromise: Promise<DeviceState> | null = null;
const listeners = new Set<() => void>();

function publish(next: DeviceStartupSnapshot) {
  snapshot = next;
  listeners.forEach((listener) => listener());
}

export function getDeviceStartupSnapshot() {
  return snapshot;
}

export function subscribeDeviceStartup(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Hydrates persisted device state before the public shell makes any routing
 * decision. The promise is shared for the process so remounts cannot start a
 * second registration/status request while the first one is still running.
 */
export function startDeviceStartup(): Promise<DeviceState> {
  if (startupPromise) {
    return startupPromise;
  }

  if (snapshot.phase === 'ready') {
    return Promise.resolve(getDeviceState());
  }

  publish({ phase: 'hydrating', error: null });
  startupPromise = hydrateCachedDeviceState()
    .then(() => initializeDevice())
    .then((state) => {
      publish({ phase: 'ready', error: null });
      return state;
    })
    .catch((error) => {
      // A failure is not authorization. Leave the gate blocked and allow a
      // later remount/retry to make a fresh attempt.
      publish({ phase: 'failed', error });
      startupPromise = null;
      throw error;
    });

  return startupPromise;
}

export function resetDeviceStartupForTests() {
  startupPromise = null;
  snapshot = { phase: 'idle', error: null };
  listeners.clear();
}
