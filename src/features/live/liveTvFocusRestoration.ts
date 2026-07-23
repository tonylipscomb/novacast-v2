import type { LiveTvState } from './liveTvLogic';

/**
 * Which control launched the fullscreen player, so focus can be restored to
 * that exact control (not a guessed default) once fullscreen closes.
 */
export type FullscreenLaunchSource = 'channel' | 'button' | null;

/**
 * Mirrors the "second OK on the already-previewing, ready channel enters
 * fullscreen" branch in `chooseLiveChannel`. Used to decide, before the
 * state update runs, whether a channel-row press is about to launch
 * fullscreen (launch source = 'channel') so we can record it for later
 * focus restoration.
 */
export function isChannelPressEnteringFullscreen(state: LiveTvState | null, channelId: string): boolean {
  if (!state) {
    return false;
  }

  return (
    state.previewConfirmedChannelId === channelId &&
    state.previewChannelId === channelId &&
    state.previewStatus === 'ready' &&
    state.fullscreenChannelId === null
  );
}

/**
 * A channel OK should move focus to the preview action only when it produced
 * a real selection/preview transition. The second OK on a confirmed ready
 * channel is intentionally excluded because that transition opens fullscreen.
 */
export function shouldFocusPreviewActionAfterChannelOk(
  previousState: LiveTvState | null,
  nextState: LiveTvState | null,
  channelId: string,
): boolean {
  if (!previousState || !nextState || previousState === nextState) {
    return false;
  }

  return (
    !isChannelPressEnteringFullscreen(previousState, channelId) &&
    nextState.selectedChannelId === channelId &&
    nextState.previewChannelId === channelId &&
    nextState.fullscreenChannelId === null
  );
}

/**
 * True only on the exact transition where fullscreen just closed (was set,
 * now cleared). Used to gate the one-shot focus-restoration effect so it
 * never fires on unrelated re-renders.
 */
export function didFullscreenJustClose(
  previousFullscreenChannelId: string | null,
  currentFullscreenChannelId: string | null,
): boolean {
  return previousFullscreenChannelId !== null && currentFullscreenChannelId === null;
}

/**
 * True only on the exact transition where fullscreen just opened (was
 * cleared, now set). `hasTVPreferredFocus` on the close button is a
 * mount-time-only hint and is not reliable once the row/button that
 * launched fullscreen already holds real native focus, so opening also
 * needs an imperative restoration step (see LiveTvScreen).
 */
export function didFullscreenJustOpen(
  previousFullscreenChannelId: string | null,
  currentFullscreenChannelId: string | null,
): boolean {
  return previousFullscreenChannelId === null && currentFullscreenChannelId !== null;
}

/**
 * Hardware Back inside Live TV must do exactly one of: close fullscreen,
 * leave the screen (Content Hub), or be swallowed - never fall through to
 * leaving the screen while a just-closed fullscreen is still restoring real
 * native focus onto the control that launched it. Without this guard, a
 * stray/rapid second Back inside that brief restoration window would see
 * `fullscreenChannelId` already cleared and incorrectly leave Live TV.
 */
export type LiveTvBackAction = 'close-fullscreen' | 'leave-screen' | 'swallow';

export function decideLiveTvBackAction(
  fullscreenChannelId: string | null,
  isRestoringFullscreenFocus: boolean,
): LiveTvBackAction {
  if (fullscreenChannelId) {
    return 'close-fullscreen';
  }

  if (isRestoringFullscreenFocus) {
    return 'swallow';
  }

  return 'leave-screen';
}
