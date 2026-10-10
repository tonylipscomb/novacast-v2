import type { LiveTvLoadStatus } from './liveTvLogic';

export const LIVE_TV_CHANNEL_LIST_REVEAL_MS = 120;
export const LIVE_TV_CHANNEL_LIST_REVEAL_START_OPACITY = 0.35;

export type LiveChannelPanelLoaderEvent =
  | 'category-loader-shown'
  | 'category-loader-hidden'
  | 'initial-loader-shown'
  | 'initial-loader-hidden';

export type LiveChannelPanelLoaderKind = 'initial' | 'category';

export type LiveCatalogCompletionStatus = 'loading' | 'ready' | 'empty';

/**
 * A zero-result read is not an empty catalog unless it came from a readable,
 * generation-pinned publication. During sync/bootstrap, keep the loader (or
 * the last known list) visible instead of replacing it with an empty state.
 */
export function resolveLiveCatalogCompletionStatus(input: {
  source: 'published-sqlite' | 'provider-fallback' | 'none';
  publishedReadable: boolean;
  publishedGeneration: number;
  publishedChannelCount: number;
  loadedChannelCount: number;
  hadReadyChannelList: boolean;
}): LiveCatalogCompletionStatus {
  if (input.loadedChannelCount > 0 || input.hadReadyChannelList) {
    return 'ready';
  }
  if (
    input.source === 'published-sqlite' &&
    input.publishedReadable &&
    input.publishedGeneration > 0 &&
    input.publishedChannelCount === 0
  ) {
    return 'empty';
  }
  return 'loading';
}

export function resolveLiveChannelPanelLoaderKind(input: {
  channelListPending: boolean;
  channelCount: number;
  hadReadyChannelList: boolean;
}): LiveChannelPanelLoaderKind {
  if (input.hadReadyChannelList || input.channelCount > 0) {
    return 'category';
  }
  return 'initial';
}

export function shouldShowLiveChannelPanelLoader(input: {
  channelListPending: boolean;
  loadStatus: LiveTvLoadStatus;
  channelCount: number;
  searchOverlayVisible: boolean;
  fullscreenActive: boolean;
}) {
  if (input.searchOverlayVisible || input.fullscreenActive) {
    return false;
  }

  if (input.loadStatus === 'error' || input.loadStatus === 'empty') {
    return false;
  }

  if (input.channelListPending) {
    return true;
  }

  return input.loadStatus === 'loading' && input.channelCount === 0;
}

export function logLiveChannelPanelLoader(fields: {
  event: LiveChannelPanelLoaderEvent;
  categoryIdPresent: boolean;
  channelCount: number | null;
  durationMs?: number;
}) {
  console.info('[NovaCast Live Loading]', {
    event: fields.event,
    categoryIdPresent: fields.categoryIdPresent,
    channelCount: fields.channelCount,
    ...(fields.durationMs != null ? { durationMs: fields.durationMs } : {}),
  });
}
