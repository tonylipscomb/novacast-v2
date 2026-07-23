type StartupReadinessListener = () => void;

let startupReady = false;
const listeners = new Set<StartupReadinessListener>();

export function isStartupReady() {
  return startupReady;
}

export function markStartupReady() {
  if (startupReady) {
    return;
  }

  startupReady = true;
  listeners.forEach((listener) => listener());
}

export function subscribeStartupReadiness(listener: StartupReadinessListener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function resetStartupReadinessForTests() {
  startupReady = false;
  listeners.clear();
}
