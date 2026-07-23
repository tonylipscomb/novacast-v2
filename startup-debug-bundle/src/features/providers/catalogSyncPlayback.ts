import { isPlaybackActivityActive, subscribePlaybackActivity } from '../playback/playbackActivityStore.ts';

export const CATALOG_SYNC_RESUME_IDLE_MS = 3000;
export const CATALOG_SYNC_PLAYBACK_POLL_MS = 500;
export const CATALOG_SYNC_IDLE_TIMEOUT_MS = 250;
const CATALOG_SYNC_IDLE_FALLBACK_MS = 40;

type IdleCallback = (callback: () => void, options?: { timeout: number }) => number;

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export function waitForCatalogSyncIdleSlot(timeoutMs = CATALOG_SYNC_IDLE_TIMEOUT_MS) {
  const requestIdleCallback = (globalThis as typeof globalThis & { requestIdleCallback?: IdleCallback })
    .requestIdleCallback;

  if (typeof requestIdleCallback === 'function') {
    return new Promise<void>((resolve) => {
      requestIdleCallback(() => resolve(), { timeout: timeoutMs });
    });
  }

  return sleep(Math.min(CATALOG_SYNC_IDLE_FALLBACK_MS, timeoutMs));
}

export async function waitUntilPlaybackIdleForCatalogSync(idleMs = CATALOG_SYNC_RESUME_IDLE_MS) {
  while (true) {
    while (isPlaybackActivityActive()) {
      await sleep(CATALOG_SYNC_PLAYBACK_POLL_MS);
    }

    await sleep(idleMs);

    if (!isPlaybackActivityActive()) {
      return;
    }
  }
}

export function shouldYieldCatalogSync() {
  return isPlaybackActivityActive();
}

let resumeTimer: ReturnType<typeof setTimeout> | null = null;
let resumeCallback: (() => void) | null = null;
let playbackListenerAttached = false;

export function scheduleCatalogSyncResume(callback: () => void, idleMs = CATALOG_SYNC_RESUME_IDLE_MS) {
  resumeCallback = callback;

  if (!playbackListenerAttached) {
    playbackListenerAttached = true;
    subscribePlaybackActivity(() => {
      if (isPlaybackActivityActive()) {
        return;
      }

      if (resumeTimer) {
        clearTimeout(resumeTimer);
      }

      resumeTimer = setTimeout(() => {
        resumeTimer = null;
        if (isPlaybackActivityActive()) {
          return;
        }
        resumeCallback?.();
      }, idleMs);
    });
  }

  if (!isPlaybackActivityActive()) {
    if (resumeTimer) {
      clearTimeout(resumeTimer);
    }
    resumeTimer = setTimeout(() => {
      resumeTimer = null;
      if (!isPlaybackActivityActive()) {
        resumeCallback?.();
      }
    }, idleMs);
  }
}

export function isCatalogSyncResumeScheduled() {
  return resumeTimer !== null;
}

export function clearCatalogSyncResumeForTests() {
  if (resumeTimer) {
    clearTimeout(resumeTimer);
    resumeTimer = null;
  }
  resumeCallback = null;
  playbackListenerAttached = false;
}
