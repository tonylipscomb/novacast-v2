const FOCUS_IDLE_MS = 500;

let lastFocusMoveAt = 0;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
const idleQueue: (() => void)[] = [];

export function notifyLiveTvChannelFocusMove() {
  lastFocusMoveAt = Date.now();
  if (idleTimer) {
    clearTimeout(idleTimer);
  }

  idleTimer = setTimeout(flushFocusIdleQueue, FOCUS_IDLE_MS);
}

function flushFocusIdleQueue() {
  idleTimer = null;
  const callbacks = idleQueue.splice(0);
  callbacks.forEach((callback) => callback());
}

/** Run a state update only after D-pad focus has been idle briefly. */
export function runAfterLiveTvFocusIdle(callback: () => void) {
  if (Date.now() - lastFocusMoveAt >= FOCUS_IDLE_MS) {
    callback();
    return;
  }

  idleQueue.push(callback);
  if (!idleTimer) {
    idleTimer = setTimeout(flushFocusIdleQueue, FOCUS_IDLE_MS);
  }
}

export function resetLiveTvFocusIdle() {
  lastFocusMoveAt = 0;
  idleQueue.length = 0;
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
}
