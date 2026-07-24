import { AppState, type AppStateStatus } from 'react-native';

import { isAppForegroundActive, setAppForegroundActive } from './appForegroundGate';
import { recordSanitizedDiagnostic } from './sanitizedDiagnostics';

type LifecycleListener = (status: AppStateStatus) => void;

let current: AppStateStatus = AppState.currentState;
const listeners = new Set<LifecycleListener>();
let attached = false;
let generation = 0;

function emit(status: AppStateStatus) {
  current = status;
  generation += 1;
  setAppForegroundActive(status === 'active');
  listeners.forEach((listener) => listener(status));
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    recordSanitizedDiagnostic({
      operation: 'app_lifecycle',
      screen: 'app',
      errorType: status,
      outcome: 'lifecycle_change',
      lifecycle: status,
    });
  }
}

export function ensureAppLifecycleMonitor() {
  if (attached) {
    return;
  }
  attached = true;
  setAppForegroundActive(AppState.currentState === 'active');
  AppState.addEventListener('change', (next) => {
    emit(next);
  });
}

export function getAppLifecycleState(): AppStateStatus {
  return current;
}

export function getAppLifecycleGeneration() {
  return generation;
}

export { isAppForegroundActive };

export function subscribeAppLifecycle(listener: LifecycleListener) {
  ensureAppLifecycleMonitor();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Cancel expensive/focus work while backgrounded. */
export function shouldRunForegroundOnlyWork() {
  return isAppForegroundActive();
}
