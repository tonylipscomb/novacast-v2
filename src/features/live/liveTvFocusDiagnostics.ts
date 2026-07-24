/**
 * Development-only Live TV focus/render diagnostics.
 * Disabled unless explicitly enabled for tests or __DEV__ + EXPO_PUBLIC_LIVE_TV_FOCUS_DIAG=1.
 */
type LiveTvFocusDiagSnapshot = {
  visibleRowRenderCount: number;
  channelRowRerenders: number;
  previewStarts: number;
  previewCancellations: number;
  programmaticScrollRequests: number;
  focusEvents: number;
};

const counters: LiveTvFocusDiagSnapshot = {
  visibleRowRenderCount: 0,
  channelRowRerenders: 0,
  previewStarts: 0,
  previewCancellations: 0,
  programmaticScrollRequests: 0,
  focusEvents: 0,
};

let forced = false;

declare const __DEV__: boolean | undefined;

function isEnabled(): boolean {
  if (forced) {
    return true;
  }
  if (typeof __DEV__ === 'undefined' || !__DEV__) {
    return false;
  }
  return process.env.EXPO_PUBLIC_LIVE_TV_FOCUS_DIAG === '1';
}

export function enableLiveTvFocusDiagnosticsForTests() {
  forced = true;
}

export function recordLiveTvVisibleRowRender() {
  if (!isEnabled()) return;
  counters.visibleRowRenderCount += 1;
}

export function recordLiveTvChannelRowRerender() {
  if (!isEnabled()) return;
  counters.channelRowRerenders += 1;
}

export function recordLiveTvPreviewStart(channelId: string) {
  if (!isEnabled()) return;
  void channelId;
  counters.previewStarts += 1;
}

export function recordLiveTvPreviewCancel(channelId: string) {
  if (!isEnabled()) return;
  void channelId;
  counters.previewCancellations += 1;
}

export function recordLiveTvProgrammaticScroll(reason: string) {
  if (!isEnabled()) return;
  void reason;
  counters.programmaticScrollRequests += 1;
}

export function recordLiveTvFocusEvent(channelId: string) {
  if (!isEnabled()) return;
  void channelId;
  counters.focusEvents += 1;
}

export function getLiveTvFocusDiagnosticsSnapshot(): LiveTvFocusDiagSnapshot {
  return { ...counters };
}

export function resetLiveTvFocusDiagnostics() {
  counters.visibleRowRenderCount = 0;
  counters.channelRowRerenders = 0;
  counters.previewStarts = 0;
  counters.previewCancellations = 0;
  counters.programmaticScrollRequests = 0;
  counters.focusEvents = 0;
}
