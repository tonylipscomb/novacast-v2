/**
 * Dev-only TV performance counters for the Performance HUD.
 * Never enabled in production builds (gated by __DEV__ + feature flag).
 */

export type TvPerfLatestFocusRequest = {
  source: string;
  region: string;
  itemId: string | null;
  reason: string;
  generation: number;
  status: string;
};

export type TvPerfSnapshot = {
  screen: string;
  focusedComponent: string;
  focusedItem: string;
  visiblePosters: number;
  posterRenders: number;
  posterRendersPerSec: number;
  guideCellRendersPerSec: number;
  focusRequests: number;
  focusRequestsPerSec: number;
  latestFocusRequest: TvPerfLatestFocusRequest | null;
  previewQueue: number;
  pendingImages: number;
  lastRenderMs: number;
  jsFrameBudgetMs: number;
};

type MutablePerf = {
  screen: string;
  focusedComponent: string;
  focusedItem: string;
  visiblePosters: number;
  posterRenders: number;
  focusRequests: number;
  previewQueue: number;
  pendingImages: number;
  lastRenderMs: number;
  posterRenderWindow: number[];
  guideCellRenderWindow: number[];
  focusRequestWindow: number[];
  latestFocusRequest: TvPerfLatestFocusRequest | null;
  listeners: Set<() => void>;
};

const EMPTY: TvPerfSnapshot = {
  screen: '—',
  focusedComponent: '—',
  focusedItem: '—',
  visiblePosters: 0,
  posterRenders: 0,
  posterRendersPerSec: 0,
  guideCellRendersPerSec: 0,
  focusRequests: 0,
  focusRequestsPerSec: 0,
  latestFocusRequest: null,
  previewQueue: 0,
  pendingImages: 0,
  lastRenderMs: 0,
  jsFrameBudgetMs: 16.7,
};

const state: MutablePerf = {
  screen: '—',
  focusedComponent: '—',
  focusedItem: '—',
  visiblePosters: 0,
  posterRenders: 0,
  focusRequests: 0,
  previewQueue: 0,
  pendingImages: 0,
  lastRenderMs: 0,
  posterRenderWindow: [],
  guideCellRenderWindow: [],
  focusRequestWindow: [],
  latestFocusRequest: null,
  listeners: new Set(),
};

function isPerfEnabled() {
  return (
    typeof __DEV__ !== 'undefined' &&
    __DEV__ &&
    process.env.EXPO_PUBLIC_TV_PERF_HUD === '1'
  );
}

let notifyTimer: ReturnType<typeof setTimeout> | null = null;

function notify() {
  if (!isPerfEnabled()) {
    return;
  }
  // Throttle HUD React updates so counters never flood the UI thread.
  if (notifyTimer) {
    return;
  }
  notifyTimer = setTimeout(() => {
    notifyTimer = null;
    state.listeners.forEach((listener) => listener());
  }, 250);
}

function pruneWindow(window: number[], now: number) {
  return window.filter((stamp) => now - stamp < 1000);
}

function prunePosterWindow(now: number) {
  state.posterRenderWindow = pruneWindow(state.posterRenderWindow, now);
}

export function tvPerfSetScreen(screen: string) {
  if (!isPerfEnabled() || state.screen === screen) {
    return;
  }
  state.screen = screen;
  notify();
}

export function tvPerfSetFocus(component: string, item: string) {
  if (!isPerfEnabled()) {
    return;
  }
  if (state.focusedComponent === component && state.focusedItem === item) {
    return;
  }
  state.focusedComponent = component;
  state.focusedItem = item;
  notify();
}

export function tvPerfSetVisiblePosters(count: number) {
  if (!isPerfEnabled() || state.visiblePosters === count) {
    return;
  }
  state.visiblePosters = count;
  notify();
}

export function tvPerfRecordPosterRender() {
  if (!isPerfEnabled()) {
    return;
  }
  const now = Date.now();
  state.posterRenders += 1;
  state.posterRenderWindow.push(now);
  prunePosterWindow(now);
  notify();
}

export function tvPerfRecordGuideCellRender() {
  if (!isPerfEnabled()) {
    return;
  }
  const now = Date.now();
  state.guideCellRenderWindow.push(now);
  state.guideCellRenderWindow = pruneWindow(state.guideCellRenderWindow, now);
  notify();
}

export function tvPerfRecordFocusRequest() {
  if (!isPerfEnabled()) {
    return;
  }
  const now = Date.now();
  state.focusRequests += 1;
  state.focusRequestWindow.push(now);
  state.focusRequestWindow = pruneWindow(state.focusRequestWindow, now);
  notify();
}

export function tvPerfSetLatestFocusRequest(request: TvPerfLatestFocusRequest) {
  if (!isPerfEnabled()) {
    return;
  }
  state.latestFocusRequest = request;
  notify();
}

export function tvPerfSetPreviewQueue(count: number) {
  if (!isPerfEnabled() || state.previewQueue === count) {
    return;
  }
  state.previewQueue = count;
  notify();
}

export function tvPerfSetPendingImages(count: number) {
  if (!isPerfEnabled() || state.pendingImages === count) {
    return;
  }
  state.pendingImages = count;
  notify();
}

export function tvPerfRecordRenderTime(ms: number) {
  if (!isPerfEnabled()) {
    return;
  }
  state.lastRenderMs = Math.round(ms * 10) / 10;
  notify();
}

export function getTvPerfSnapshot(): TvPerfSnapshot {
  if (!isPerfEnabled()) {
    return EMPTY;
  }
  const now = Date.now();
  prunePosterWindow(now);
  state.guideCellRenderWindow = pruneWindow(state.guideCellRenderWindow, now);
  state.focusRequestWindow = pruneWindow(state.focusRequestWindow, now);
  return {
    screen: state.screen,
    focusedComponent: state.focusedComponent,
    focusedItem: state.focusedItem,
    visiblePosters: state.visiblePosters,
    posterRenders: state.posterRenders,
    posterRendersPerSec: state.posterRenderWindow.length,
    guideCellRendersPerSec: state.guideCellRenderWindow.length,
    focusRequests: state.focusRequests,
    focusRequestsPerSec: state.focusRequestWindow.length,
    latestFocusRequest: state.latestFocusRequest,
    previewQueue: state.previewQueue,
    pendingImages: state.pendingImages,
    lastRenderMs: state.lastRenderMs,
    jsFrameBudgetMs: 16.7,
  };
}

export function subscribeTvPerf(listener: () => void) {
  if (!isPerfEnabled()) {
    return () => undefined;
  }
  state.listeners.add(listener);
  return () => {
    state.listeners.delete(listener);
  };
}

export function isTvPerfHudEnabled() {
  return isPerfEnabled();
}
