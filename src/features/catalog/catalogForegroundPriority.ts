import { getLiveTvWorkload } from '../live/liveTvWorkload.ts';

/**
 * Foreground catalog-read priority.
 * Background Movie/Series writers must yield while Live/Movies/Series UI is reading.
 */

export type CatalogUiSurface = 'live' | 'movies' | 'series' | 'other';

let catalogUiSurface: CatalogUiSurface = 'other';
let activeForegroundCatalogReads = 0;
export const CATALOG_INPUT_PRIORITY_WINDOW_MS = 300;
let lastCatalogInputAtMs = 0;
export const LIVE_CATALOG_TUNING_COOLDOWN_MS = 1_200;
let liveCatalogTuningUntilMs = 0;
let liveCatalogResumeLogged = false;
let liveCatalogGateBlockedLogged = false;
const foregroundCatalogReadDrainWaiters = new Set<() => void>();
const catalogUiSurfaceListeners = new Set<(surface: CatalogUiSurface) => void>();

export function setCatalogUiSurface(surface: CatalogUiSurface) {
  if (catalogUiSurface === surface) {
    return;
  }
  catalogUiSurface = surface;
  if (surface !== 'live' && liveCatalogTuningUntilMs > 0) {
    liveCatalogTuningUntilMs = 0;
    liveCatalogResumeLogged = false;
    liveCatalogGateBlockedLogged = false;
  }
  for (const listener of catalogUiSurfaceListeners) {
    listener(surface);
  }
}

export function subscribeCatalogUiSurface(listener: (surface: CatalogUiSurface) => void) {
  catalogUiSurfaceListeners.add(listener);
  return () => catalogUiSurfaceListeners.delete(listener);
}

export function getCatalogUiSurface(): CatalogUiSurface {
  return catalogUiSurface;
}

export function isCatalogUiBrowseActive() {
  return catalogUiSurface === 'live' || catalogUiSurface === 'movies' || catalogUiSurface === 'series';
}

/** Mark a physical D-pad interaction so background catalog writes yield briefly. */
export function noteCatalogForegroundInput(nowMs = Date.now()) {
  lastCatalogInputAtMs = nowMs;
}

export function isCatalogInputPriorityActive(nowMs = Date.now()) {
  return lastCatalogInputAtMs > 0 && nowMs - lastCatalogInputAtMs < CATALOG_INPUT_PRIORITY_WINDOW_MS;
}

export function beginCatalogForegroundRead(): () => void {
  activeForegroundCatalogReads += 1;
  let released = false;
  return () => {
    if (released) {
      return;
    }
    released = true;
    activeForegroundCatalogReads = Math.max(0, activeForegroundCatalogReads - 1);
    if (activeForegroundCatalogReads === 0) {
      const waiters = [...foregroundCatalogReadDrainWaiters];
      foregroundCatalogReadDrainWaiters.clear();
      for (const resolve of waiters) {
        resolve();
      }
    }
  };
}

export function getActiveCatalogForegroundReadCount() {
  return activeForegroundCatalogReads;
}

export function hasActiveCatalogForegroundRead() {
  return activeForegroundCatalogReads > 0;
}

export async function waitForForegroundCatalogReadsToDrain(): Promise<void> {
  if (activeForegroundCatalogReads === 0) {
    return;
  }
  await new Promise<void>((resolve) => {
    foregroundCatalogReadDrainWaiters.add(resolve);
  });
}

export function getCatalogBackgroundWriteYield(): { pauseMs: number; reason: string } {
  const liveWorkload = getLiveTvWorkload();
  if (isCatalogInputPriorityActive()) {
    return { pauseMs: 120, reason: 'input-priority' };
  }
  if (catalogUiSurface === 'live' && liveWorkload.searchOverlayVisible) {
    return { pauseMs: 300, reason: 'live-search-foreground' };
  }
  if (catalogUiSurface === 'live' && Date.now() < liveCatalogTuningUntilMs) {
    return { pauseMs: 250, reason: 'live-tuning' };
  }
  if (activeForegroundCatalogReads > 0) {
    return { pauseMs: 80, reason: 'foreground-read' };
  }
  if (isCatalogUiBrowseActive()) {
    return { pauseMs: catalogUiSurface === 'live' ? 96 : 48, reason: `ui-${catalogUiSurface}` };
  }
  return { pauseMs: 0, reason: 'none' };
}

/** Briefly yield catalog writes while a Live TV tune/surf transition settles. */
export function markLiveCatalogInteraction(reason = 'channel-change') {
  if (catalogUiSurface !== 'live') return;
  const wasTuning = Date.now() < liveCatalogTuningUntilMs;
  liveCatalogTuningUntilMs = Date.now() + LIVE_CATALOG_TUNING_COOLDOWN_MS;
  liveCatalogResumeLogged = false;
  console.info('[NovaCast Catalog Live Priority]', {
    state: 'live-tuning',
    catalogAction: wasTuning ? 'cooldown-extended' : 'suspend',
    reason,
    cooldownMs: LIVE_CATALOG_TUNING_COOLDOWN_MS,
  });
}

export function isLiveCatalogTuningActive() {
  return catalogUiSurface === 'live' && Date.now() < liveCatalogTuningUntilMs;
}

export function isCatalogLiveGateActive() {
  return catalogUiSurface === 'live';
}

/** Hard gate for new background work while the Live screen owns the foreground. */
export async function waitForCatalogLiveGate() {
  if (!isCatalogLiveGateActive()) return;
  if (!liveCatalogGateBlockedLogged) {
    liveCatalogGateBlockedLogged = true;
    console.info('[NovaCast Catalog Live Gate]', {
      state: 'blocked',
      reason: 'live-screen-active',
      pendingWork: true,
    });
  }
  while (isCatalogLiveGateActive()) {
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  }
  liveCatalogGateBlockedLogged = false;
  console.info('[NovaCast Catalog Live Gate]', {
    state: 'resumed',
    reason: 'left-live-screen',
  });
}

export async function waitForLiveCatalogTuningToSettle() {
  while (isLiveCatalogTuningActive()) {
    await new Promise<void>((resolve) => setTimeout(resolve, Math.min(100, Math.max(1, liveCatalogTuningUntilMs - Date.now()))));
  }
  if (catalogUiSurface === 'live' && !liveCatalogResumeLogged) {
    liveCatalogResumeLogged = true;
    console.info('[NovaCast Catalog Live Priority]', {
      state: 'live-idle',
      catalogAction: 'resume-throttled',
      pauseMs: 96,
    });
  }
}

export function resetCatalogForegroundPriorityForTests() {
  catalogUiSurface = 'other';
  activeForegroundCatalogReads = 0;
  lastCatalogInputAtMs = 0;
  foregroundCatalogReadDrainWaiters.clear();
  liveCatalogTuningUntilMs = 0;
  liveCatalogResumeLogged = false;
  liveCatalogGateBlockedLogged = false;
}
