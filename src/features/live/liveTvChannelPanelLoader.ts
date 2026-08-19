import type { LiveTvLoadStatus } from './liveTvLogic';

export const LIVE_TV_CHANNEL_LIST_REVEAL_MS = 120;
export const LIVE_TV_CHANNEL_LIST_REVEAL_START_OPACITY = 0.35;

export type LiveChannelPanelLoaderEvent =
  | 'category-loader-shown'
  | 'category-loader-hidden'
  | 'initial-loader-shown'
  | 'initial-loader-hidden';

export type LiveChannelPanelLoaderKind = 'initial' | 'category';

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
