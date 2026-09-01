/**
 * Foreground catalog-read priority.
 * Background Movie/Series writers must yield while Live/Movies/Series UI is reading.
 */

export type CatalogUiSurface = 'live' | 'movies' | 'series' | 'other';

let catalogUiSurface: CatalogUiSurface = 'other';
let activeForegroundCatalogReads = 0;
const foregroundCatalogReadDrainWaiters = new Set<() => void>();
const catalogUiSurfaceListeners = new Set<(surface: CatalogUiSurface) => void>();

export function setCatalogUiSurface(surface: CatalogUiSurface) {
  if (catalogUiSurface === surface) {
    return;
  }
  catalogUiSurface = surface;
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
  if (activeForegroundCatalogReads > 0) {
    return { pauseMs: 80, reason: 'foreground-read' };
  }
  if (isCatalogUiBrowseActive()) {
    return { pauseMs: 48, reason: `ui-${catalogUiSurface}` };
  }
  return { pauseMs: 0, reason: 'none' };
}

export function resetCatalogForegroundPriorityForTests() {
  catalogUiSurface = 'other';
  activeForegroundCatalogReads = 0;
  foregroundCatalogReadDrainWaiters.clear();
}
