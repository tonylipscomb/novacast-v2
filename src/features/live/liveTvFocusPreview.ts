/**
 * Pure helpers for Live TV focus → debounced preview scheduling.
 * Preview may follow focus after a short debounce; OK still tunes immediately.
 */

export const LIVE_TV_PREVIEW_FOCUS_DEBOUNCE_MS = 300;

export type LiveTvPendingPreview = {
  channelId: string;
  scheduledAt: number;
};

export function shouldMoveFocusToChannelsOnCategoryOk(): boolean {
  return true;
}

/** Focus must never start playback synchronously. */
export function shouldStartPreviewImmediatelyOnFocus(): boolean {
  return false;
}

/** Category D-pad focus must not load, tune, or preview. */
export function shouldLoadCategoryOnFocusAlone(): boolean {
  return false;
}

/**
 * Skip restarting preview when the focused channel is already the active preview
 * (loading or ready).
 */
export function shouldSkipPreviewRestart(input: {
  channelId: string;
  previewChannelId: string | null;
  previewStatus: 'idle' | 'loading' | 'ready' | 'error';
}): boolean {
  return (
    input.previewChannelId === input.channelId &&
    (input.previewStatus === 'loading' || input.previewStatus === 'ready')
  );
}

/**
 * After debounce, apply only if focus is still on the scheduled channel.
 */
export function shouldApplyDebouncedPreviewTune(
  scheduledChannelId: string,
  focusedChannelId: string | null,
): boolean {
  return focusedChannelId === scheduledChannelId;
}

export function isPendingPreviewCancelled(
  pending: LiveTvPendingPreview | null,
  focusedChannelId: string | null,
): boolean {
  if (!pending) {
    return true;
  }
  return pending.channelId !== focusedChannelId;
}
