export type LivePreviewStatus = 'idle' | 'loading' | 'ready' | 'error';

export type LiveTvState = {
  selectedCategoryId: string;
  selectedChannelId: string;
  previewChannelId: string | null;
  previewStatus: LivePreviewStatus;
  previewRequestId: number;
  previewError: string | null;
  /** Channel that received a deliberate OK for preview; second OK may fullscreen. */
  previewConfirmedChannelId: string | null;
  fullscreenChannelId: string | null;
};

export function createInitialLiveTvState(
  selectedCategoryId = 'entertainment',
  selectedChannelId = 'entertainment-nova-one',
): LiveTvState {
  const hasChannel = Boolean(selectedChannelId);

  return {
    selectedCategoryId,
    selectedChannelId,
    // Fixture / search direct-play bootstrap: start preview for an already-chosen channel.
    // Normal Live TV open uses createLiveTvLandingState (idle, no autoplay).
    previewChannelId: hasChannel ? selectedChannelId : null,
    previewStatus: hasChannel ? 'loading' : 'idle',
    previewRequestId: hasChannel ? 1 : 0,
    previewError: null,
    previewConfirmedChannelId: hasChannel ? selectedChannelId : null,
    fullscreenChannelId: null,
  };
}

/** Open Live TV with restored selection/focus targets but no automatic preview. */
export function createLiveTvLandingState(
  selectedCategoryId = 'entertainment',
  selectedChannelId = 'entertainment-nova-one',
): LiveTvState {
  return {
    selectedCategoryId,
    selectedChannelId,
    previewChannelId: null,
    previewStatus: 'idle',
    previewRequestId: 0,
    previewError: null,
    previewConfirmedChannelId: null,
    fullscreenChannelId: null,
  };
}

export function selectLiveCategory(state: LiveTvState, categoryId: string, firstChannelId: string): LiveTvState {
  if (state.selectedCategoryId === categoryId && state.selectedChannelId === firstChannelId) {
    return state;
  }

  if (!firstChannelId) {
    return {
      ...state,
      selectedCategoryId: categoryId,
      selectedChannelId: '',
      fullscreenChannelId: null,
    };
  }

  return {
    ...state,
    selectedCategoryId: categoryId,
    selectedChannelId: firstChannelId,
    // Category browse must not start or switch the embedded preview.
    fullscreenChannelId: null,
  };
}

export function clearPreviewConfirmationOnFocus(state: LiveTvState, focusedChannelId: string): LiveTvState {
  if (!state.previewConfirmedChannelId || state.previewConfirmedChannelId === focusedChannelId) {
    return state;
  }

  return {
    ...state,
    previewConfirmedChannelId: null,
  };
}

/**
 * Record focus without changing selection, confirmation, or starting preview.
 * Focus must never mutate the active preview. Confirmation stays so a later
 * OK on the already-previewing channel can still enter fullscreen.
 */
export function focusLiveChannel(state: LiveTvState, channelId: string): LiveTvState {
  if (state.fullscreenChannelId && state.fullscreenChannelId !== channelId) {
    return {
      ...state,
      fullscreenChannelId: null,
    };
  }

  return state;
}

/**
 * Apply a focus-debounced preview without treating it as an OK selection.
 * Does not bump selectedChannelId or previewConfirmedChannelId.
 */
export function applyDebouncedPreview(state: LiveTvState, channelId: string): LiveTvState {
  if (
    state.previewChannelId === channelId &&
    (state.previewStatus === 'loading' || state.previewStatus === 'ready')
  ) {
    return state;
  }

  return {
    ...state,
    previewChannelId: channelId,
    previewStatus: 'loading',
    previewRequestId: state.previewRequestId + 1,
    previewError: null,
    fullscreenChannelId: null,
  };
}

export type ChooseLiveChannelOrigin = 'browse' | 'search';

export type ChooseLiveChannelOptions = {
  origin?: ChooseLiveChannelOrigin;
};

export function chooseLiveChannel(
  state: LiveTvState,
  channelId: string,
  options?: ChooseLiveChannelOptions,
): LiveTvState {
  if (options?.origin === 'search') {
    return surfLiveFullscreenChannel(state, channelId);
  }

  const canEnterFullscreen =
    state.previewConfirmedChannelId === channelId &&
    state.previewChannelId === channelId &&
    state.previewStatus === 'ready' &&
    state.fullscreenChannelId === null;

  if (canEnterFullscreen) {
    return {
      ...state,
      fullscreenChannelId: channelId,
    };
  }

  if (state.selectedChannelId === channelId && state.previewStatus === 'loading' && state.previewChannelId === channelId) {
    return state;
  }

  if (state.previewChannelId === channelId && state.previewStatus === 'ready') {
    return {
      ...state,
      selectedChannelId: channelId,
      previewConfirmedChannelId: channelId,
      fullscreenChannelId: null,
    };
  }

  return {
    ...state,
    selectedChannelId: channelId,
    previewChannelId: channelId,
    previewConfirmedChannelId: channelId,
    previewStatus: 'loading',
    previewRequestId: state.previewRequestId + 1,
    previewError: null,
    fullscreenChannelId: null,
  };
}

export function resolveLivePreview(
  state: LiveTvState,
  requestId: number,
  channelId: string,
  outcome: 'ready' | 'error',
  errorMessage?: string,
): LiveTvState {
  if (state.previewRequestId !== requestId || state.previewChannelId !== channelId) {
    return state;
  }

  return {
    ...state,
    previewStatus: outcome,
    previewError: outcome === 'error' ? errorMessage ?? 'This channel could not be loaded right now.' : null,
  };
}

export function surfLiveFullscreenChannel(state: LiveTvState, channelId: string): LiveTvState {
  if (
    state.previewChannelId === channelId &&
    (state.previewStatus === 'loading' || state.previewStatus === 'ready') &&
    state.fullscreenChannelId === channelId
  ) {
    return state;
  }

  if (state.previewChannelId === channelId && (state.previewStatus === 'loading' || state.previewStatus === 'ready')) {
    return {
      ...state,
      selectedChannelId: channelId,
      previewConfirmedChannelId: channelId,
      fullscreenChannelId: channelId,
    };
  }

  return {
    ...state,
    selectedChannelId: channelId,
    previewChannelId: channelId,
    previewConfirmedChannelId: channelId,
    previewStatus: 'loading',
    previewRequestId: state.previewRequestId + 1,
    previewError: null,
    fullscreenChannelId: channelId,
  };
}

export function closeLiveFullscreen(state: LiveTvState): LiveTvState {
  if (!state.fullscreenChannelId) {
    return state;
  }

  return {
    ...state,
    fullscreenChannelId: null,
  };
}

export type LiveTvLoadStatus = 'loading' | 'ready' | 'empty' | 'error';

/** Stable id so repeated load failures update the same Live TV toast in place. */
export const LIVE_TV_LOAD_NOTIFICATION_ID = 'live-tv-load-unavailable';
export const LIVE_TV_PREVIEW_NOTIFICATION_ID = 'live-tv-preview-unavailable';
export const LIVE_TV_NOTIFICATION_DURATION_MS = 7000;

export type LiveTvNotificationSpec = {
  title: string;
  message: string;
  persistent: boolean;
};

/**
 * Maps a Live TV load status to a corner-toast spec, or `null` when the status should stay
 * inline instead (`ready`, `empty`, `loading`). Only recoverable `error` states with
 * categories already on screen become toasts so the category rail stays usable.
 */
export function resolveLiveTvNotificationForStatus(
  status: LiveTvLoadStatus,
  retryAttemptedAndStillFailing: boolean,
  errorMessage?: string | null,
): LiveTvNotificationSpec | null {
  if (status !== 'error') {
    return null;
  }

  return {
    title: 'Live TV unavailable',
    message: errorMessage?.trim() || 'We could not load channels from your provider.',
    persistent: retryAttemptedAndStillFailing,
  };
}

export function resolveLiveTvPreviewNotification(
  retryAttemptedAndStillFailing: boolean,
  previewError?: string | null,
): LiveTvNotificationSpec {
  return {
    title: 'Preview unavailable',
    message: previewError?.trim() || 'This channel could not be loaded right now.',
    persistent: retryAttemptedAndStillFailing,
  };
}

/** Minimal interaction state when categories exist but the channel list failed to bootstrap. */
export function createLiveTvShellState(selectedCategoryId: string): LiveTvState {
  return {
    selectedCategoryId,
    selectedChannelId: '',
    previewChannelId: null,
    previewStatus: 'idle',
    previewRequestId: 0,
    previewError: null,
    previewConfirmedChannelId: null,
    fullscreenChannelId: null,
  };
}
