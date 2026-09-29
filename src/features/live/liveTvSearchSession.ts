import type { ProviderLiveChannel } from '@/features/providers/providerRepositories';

import type { LiveSearchResult } from '@/features/search/searchTypes';

import type { LiveTvState } from './liveTvLogic';

export type LiveSearchBrowseSnapshot = {
  categoryId: string;
  channelId: string;
};

export type LiveSearchPlaybackChannel = ProviderLiveChannel;

export function createLiveSearchBrowseSnapshot(input: {
  categoryId?: string | null;
  channelId?: string | null;
}): LiveSearchBrowseSnapshot {
  return {
    categoryId: input.categoryId?.trim() || '',
    channelId: input.channelId?.trim() || '',
  };
}

export function shouldRestoreLiveBrowseFocusAfterFullscreen(searchSessionOpen: boolean) {
  return !searchSessionOpen;
}

export function shouldShowLiveSearchOverlay(input: {
  searchSessionOpen: boolean;
  fullscreenChannelId?: string | null;
}) {
  return input.searchSessionOpen && !input.fullscreenChannelId;
}

export function shouldKeepLiveSearchMounted(searchSessionOpen: boolean) {
  return searchSessionOpen;
}

export function isLiveSearchUiBlockingSurf(searchOverlayVisible: boolean) {
  return searchOverlayVisible;
}

export function resolveLiveSearchSurfQueue(
  searchResultIds: readonly string[] | null | undefined,
  categoryChannelIds: readonly string[],
) {
  if (searchResultIds && searchResultIds.length > 0) {
    return [...searchResultIds];
  }

  return [...categoryChannelIds];
}

export function toLiveSearchPlaybackChannel(result: LiveSearchResult): LiveSearchPlaybackChannel {
  const name = result.title?.trim() || `Channel ${result.id}`;
  return {
    id: result.id,
    categoryId: result.categoryId?.trim() || 'search',
    number: result.channelNumber ?? 0,
    name,
    shortName: name.slice(0, 2).toUpperCase(),
    current: result.currentProgram ?? result.subtitle ?? '',
    next: '',
    following: '',
    description: '',
    resolution: '',
    audio: '',
    remaining: '',
    progress: 0,
    tone: result.tone ?? '#173B67',
    currentStart: '',
    currentEnd: '',
    logoUrl: result.logoUrl,
    containerExtension: result.containerExtension,
    streamUrl: result.streamUrl,
  };
}

export function resolveLivePlaybackChannel<T extends { id: string }>(
  channelId: string | null | undefined,
  categoryChannels: readonly T[],
  searchChannels: ReadonlyMap<string, T>,
): T | null {
  if (!channelId) {
    return null;
  }

  return categoryChannels.find((channel) => channel.id === channelId) ?? searchChannels.get(channelId) ?? null;
}

export function mergeLiveSearchPlaybackChannels(
  current: Map<string, LiveSearchPlaybackChannel>,
  results: readonly LiveSearchResult[],
  replace: boolean,
) {
  const next = replace ? new Map<string, LiveSearchPlaybackChannel>() : new Map(current);
  for (const result of results) {
    if (result.type !== 'live') {
      continue;
    }
    next.set(result.id, toLiveSearchPlaybackChannel(result));
  }
  return next;
}

export function buildLiveSearchResultIds(results: readonly LiveSearchResult[], previousIds: readonly string[], append: boolean) {
  const nextIds = results.filter((result) => result.type === 'live').map((result) => result.id);
  if (!append) {
    return nextIds;
  }

  const seen = new Set(previousIds);
  const merged = [...previousIds];
  for (const id of nextIds) {
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    merged.push(id);
  }
  return merged;
}

export function restoreLiveSearchBrowseState(
  state: LiveTvState | null,
  snapshot: LiveSearchBrowseSnapshot | null,
): LiveTvState | null {
  if (!state || !snapshot) {
    return state;
  }

  const categoryId = snapshot.categoryId || state.selectedCategoryId;
  const channelId = snapshot.channelId || state.selectedChannelId;
  const previewIsSearchChannel = Boolean(state.previewChannelId && state.previewChannelId !== channelId);

  return {
    ...state,
    selectedCategoryId: categoryId,
    selectedChannelId: channelId,
    previewConfirmedChannelId: previewIsSearchChannel ? null : state.previewConfirmedChannelId,
    previewChannelId: previewIsSearchChannel ? null : state.previewChannelId,
    previewStatus: previewIsSearchChannel ? 'idle' : state.previewStatus,
    fullscreenChannelId: null,
  };
}

export const LIVE_SEARCH_BACK_DEDUPE_MS = 80;

export type LiveSearchOverlayBackAction = 'dismiss-ime' | 'close-overlay' | 'suppress-duplicate' | 'ignore';
export type LiveSearchScreenBackAction = 'let-live-handle' | 'swallow-leave-screen' | 'suppress-duplicate';

let liveSearchOverlayCloseSuppressedUntilMs = 0;
let lastLiveSearchBackConsumedAtMs = 0;

export function resetLiveSearchBackDiagnostics() {
  liveSearchOverlayCloseSuppressedUntilMs = 0;
  lastLiveSearchBackConsumedAtMs = 0;
}

export function suppressLiveSearchOverlayClose(nowMs = Date.now(), windowMs = LIVE_SEARCH_BACK_DEDUPE_MS) {
  liveSearchOverlayCloseSuppressedUntilMs = Math.max(liveSearchOverlayCloseSuppressedUntilMs, nowMs + windowMs);
}

export function markLiveSearchBackConsumed(nowMs = Date.now()) {
  lastLiveSearchBackConsumedAtMs = nowMs;
}

export function getLiveSearchOverlayCloseSuppressedUntilMs() {
  return liveSearchOverlayCloseSuppressedUntilMs;
}

export function getLastLiveSearchBackConsumedAtMs() {
  return lastLiveSearchBackConsumedAtMs;
}

export function wasLiveSearchBackRecentlyConsumed(nowMs = Date.now(), windowMs = LIVE_SEARCH_BACK_DEDUPE_MS) {
  return lastLiveSearchBackConsumedAtMs > 0 && nowMs - lastLiveSearchBackConsumedAtMs <= windowMs;
}

export function decideLiveSearchOverlayBack(input: {
  keyboardActive: boolean;
  overlayVisible: boolean;
  nowMs: number;
  lastConsumedAtMs: number | null;
  suppressOverlayCloseUntilMs: number | null;
}): { action: LiveSearchOverlayBackAction } {
  if (!input.overlayVisible) {
    return { action: 'ignore' };
  }

  if (
    input.lastConsumedAtMs != null &&
    input.lastConsumedAtMs > 0 &&
    input.nowMs - input.lastConsumedAtMs <= LIVE_SEARCH_BACK_DEDUPE_MS
  ) {
    return { action: 'suppress-duplicate' };
  }

  if (input.suppressOverlayCloseUntilMs != null && input.nowMs < input.suppressOverlayCloseUntilMs) {
    return { action: 'suppress-duplicate' };
  }

  if (input.keyboardActive) {
    return { action: 'dismiss-ime' };
  }

  return { action: 'close-overlay' };
}

export function decideLiveSearchScreenBack(input: {
  searchSessionOpen: boolean;
  overlayVisible: boolean;
  fullscreenActive: boolean;
  nowMs: number;
  lastConsumedAtMs: number | null;
}): { action: LiveSearchScreenBackAction } {
  if (
    input.lastConsumedAtMs != null &&
    input.lastConsumedAtMs > 0 &&
    input.nowMs - input.lastConsumedAtMs <= LIVE_SEARCH_BACK_DEDUPE_MS
  ) {
    return { action: 'suppress-duplicate' };
  }

  if (input.fullscreenActive || !input.searchSessionOpen) {
    return { action: 'let-live-handle' };
  }

  return { action: 'swallow-leave-screen' };
}

export function shouldLiveSearchBlockBackgroundFocus(overlayVisible: boolean, closeFocusHold = false) {
  return overlayVisible || closeFocusHold;
}

export function shouldLiveSearchNavbarAcceptFocus(overlayVisible: boolean, closeFocusHold = false) {
  return !shouldLiveSearchBlockBackgroundFocus(overlayVisible, closeFocusHold);
}

export function shouldLiveSearchContentAcceptFocus(overlayVisible: boolean, closeFocusHold = false) {
  return !shouldLiveSearchBlockBackgroundFocus(overlayVisible, closeFocusHold);
}

export function logLiveSearchBack(fields: {
  event:
    | 'back-received'
    | 'ime-back-consumed'
    | 'overlay-back-consumed'
    | 'overlay-close-requested'
    | 'overlay-close-complete'
    | 'live-back-received'
    | 'back-suppressed-duplicate';
  keyboardActive?: boolean;
  overlayVisible?: boolean;
  fullscreenActive?: boolean;
  searchQueryPresent?: boolean;
  focusedRegion?: string | null;
  restoreFocusLiveChannelId?: string | null;
  timestampDeltaMs?: number | null;
  source?: string;
}) {
  console.info(
    '[NovaCast Live Search Back] ' +
      JSON.stringify({
        event: fields.event,
        keyboardActive: fields.keyboardActive ?? null,
        overlayVisible: fields.overlayVisible ?? null,
        fullscreenActive: fields.fullscreenActive ?? null,
        searchQueryPresent: fields.searchQueryPresent ?? null,
        focusedRegion: fields.focusedRegion ?? null,
        restoreFocusLiveChannelId: fields.restoreFocusLiveChannelId ?? null,
        timestampDeltaMs: fields.timestampDeltaMs ?? null,
        source: fields.source ?? null,
      }),
  );
}
