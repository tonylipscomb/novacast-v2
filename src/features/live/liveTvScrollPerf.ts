/**
 * Development-only counters for Live TV scroll/focus profiling.
 * No credentials or stream URLs are logged.
 */
type LiveTvScrollPerfSnapshot = {
  screenRenders: number;
  channelRowRenders: number;
  epgChildRenders: number;
  channelFocusEvents: number;
  channelTuneEvents: number;
  manualScrollCalls: number;
  memorySyncCalls: number;
};

const counters: LiveTvScrollPerfSnapshot = {
  screenRenders: 0,
  channelRowRenders: 0,
  epgChildRenders: 0,
  channelFocusEvents: 0,
  channelTuneEvents: 0,
  manualScrollCalls: 0,
  memorySyncCalls: 0,
};

let perfCountersForced = false;

export function enableLiveTvScrollPerfCountersForTests() {
  perfCountersForced = true;
}

export function isLiveTvScrollPerfEnabled(): boolean {
  if (perfCountersForced) {
    return true;
  }

  return typeof __DEV__ !== 'undefined' && __DEV__;
}

export function recordLiveTvScreenRender() {
  if (!isLiveTvScrollPerfEnabled()) {
    return;
  }

  counters.screenRenders += 1;
}

export function recordLiveTvChannelRowRender() {
  if (!isLiveTvScrollPerfEnabled()) {
    return;
  }

  counters.channelRowRenders += 1;
}

export function recordLiveTvEpgChildRender() {
  if (!isLiveTvScrollPerfEnabled()) {
    return;
  }

  counters.epgChildRenders += 1;
}

export function recordLiveTvChannelFocus() {
  if (!isLiveTvScrollPerfEnabled()) {
    return;
  }

  counters.channelFocusEvents += 1;
}

export function recordLiveTvChannelTune() {
  if (!isLiveTvScrollPerfEnabled()) {
    return;
  }

  counters.channelTuneEvents += 1;
}

export function recordLiveTvManualScroll() {
  if (!isLiveTvScrollPerfEnabled()) {
    return;
  }

  counters.manualScrollCalls += 1;
}

export function recordLiveTvMemorySync() {
  if (!isLiveTvScrollPerfEnabled()) {
    return;
  }

  counters.memorySyncCalls += 1;
}

export function getLiveTvScrollPerfSnapshot(): LiveTvScrollPerfSnapshot {
  return { ...counters };
}

export function resetLiveTvScrollPerf() {
  counters.screenRenders = 0;
  counters.channelRowRenders = 0;
  counters.epgChildRenders = 0;
  counters.channelFocusEvents = 0;
  counters.channelTuneEvents = 0;
  counters.manualScrollCalls = 0;
  counters.memorySyncCalls = 0;
}
