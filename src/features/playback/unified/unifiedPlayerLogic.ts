import type { PlaybackActivityType } from '../playbackActivityStore.ts';
import type { PlaybackItem, PlaybackLaunchSource, PlaybackMode, UnifiedPlayerMachineState } from './types.ts';
import {
  isDevicePerformanceRiskMessage,
  isUnsupportedVideoFormatMessage,
  isVideoDecoderInitFailure,
  UNSUPPORTED_VIDEO_FORMAT_CATEGORY,
  UNSUPPORTED_VIDEO_FORMAT_ERROR,
} from './moviePlaybackCompatibility.ts';
import { resolveVodSeekDirection, VOD_SEEK_STEP_MS } from './vodSeek.ts';

export const UNIFIED_PLAYER_CHROME_AUTO_HIDE_MS = 4000;
export const UNIFIED_PLAYER_LOADING_TIMEOUT_MS = 20_000;
export const UNIFIED_PLAYER_BUFFERING_TIMEOUT_MS = 30_000;
export const SEEK_BACK_MS = 10_000;
export const SEEK_FORWARD_MS = 10_000;

export type UnifiedBackAction = 'close-playback' | 'leave-screen' | 'swallow';

export function derivePlaybackActivityType(item: PlaybackItem): PlaybackActivityType {
  if (item.mediaType === 'movie') {
    return 'movie';
  }
  if (item.mediaType === 'episode') {
    return 'episode';
  }
  // TODO(stage-live): distinguish live-preview vs live-fullscreen from launch context.
  return item.isLive ? 'live-fullscreen' : 'live-preview';
}

export function derivePlaybackMode(item: PlaybackItem): PlaybackMode {
  if (item.mediaType === 'movie') {
    return 'movie';
  }
  if (item.mediaType === 'episode') {
    return 'episode';
  }
  return item.isLive ? 'live-fullscreen' : 'live-preview';
}

export function mapPlayerStatusToMachineState(
  status: string,
  isPlaying: boolean,
  isBuffering = false,
): UnifiedPlayerMachineState {
  if (status === 'error') {
    return 'error';
  }
  if (status === 'loading' || status === 'idle') {
    return 'loading';
  }
  if (isBuffering) {
    return 'buffering';
  }
  if (status === 'readyToPlay') {
    return isPlaying ? 'playing' : 'paused';
  }
  return 'loading';
}

export function isUnifiedPlaybackActive(
  machineState: UnifiedPlayerMachineState,
  item: PlaybackItem | null,
): boolean {
  return Boolean(item?.streamUrl) && machineState !== 'idle' && machineState !== 'closing';
}

export function didUnifiedPlaybackJustClose(previousActive: boolean, currentActive: boolean): boolean {
  return previousActive && !currentActive;
}

export function decideUnifiedBackAction(
  playbackActive: boolean,
  isRestoringPlaybackFocus: boolean,
): UnifiedBackAction {
  if (playbackActive) {
    return 'close-playback';
  }
  if (isRestoringPlaybackFocus) {
    return 'swallow';
  }
  return 'leave-screen';
}

/** Ignore duplicate Back → close signals within one physical key press window. */
export const UNIFIED_PLAYBACK_CLOSE_DEDUPE_MS = 400;

export function shouldAcceptUnifiedPlaybackClose(input: {
  machineState: UnifiedPlayerMachineState;
  lastCloseAtMs: number;
  nowMs: number;
}): boolean {
  if (input.machineState === 'idle' || input.machineState === 'closing') {
    return false;
  }
  if (input.nowMs - input.lastCloseAtMs < UNIFIED_PLAYBACK_CLOSE_DEDUPE_MS) {
    return false;
  }
  return true;
}

export function shouldShowUnifiedPlayerSurface(machineState: UnifiedPlayerMachineState): boolean {
  return machineState !== 'idle';
}

export function shouldShowUnifiedLoadingState(machineState: UnifiedPlayerMachineState): boolean {
  return machineState === 'loading' || machineState === 'buffering';
}

export function shouldShowUnifiedErrorState(machineState: UnifiedPlayerMachineState): boolean {
  return machineState === 'error';
}

export function shouldAutoHideUnifiedControls(machineState: UnifiedPlayerMachineState): boolean {
  return (
    machineState === 'playing' ||
    machineState === 'paused' ||
    machineState === 'ready' ||
    machineState === 'buffering'
  );
}

/**
 * Chrome may appear for a real playback transition (session start, pause, error).
 * It must not reappear merely because auto-hide set controlsVisible=false.
 */
export function shouldRevealChromeFromPlaybackState(input: {
  playbackActive: boolean;
  previousPlaybackActive: boolean;
  machineState: UnifiedPlayerMachineState;
  previousMachineState: UnifiedPlayerMachineState | null;
  isPlaying: boolean;
  previousIsPlaying: boolean;
  itemId?: string | null;
  previousItemId?: string | null;
}): boolean {
  if (!input.playbackActive) {
    return false;
  }
  if (!input.previousPlaybackActive) {
    return true;
  }
  if (input.itemId && input.itemId !== input.previousItemId) {
    return true;
  }
  if (input.machineState === 'error' && input.previousMachineState !== 'error') {
    return true;
  }
  if (!input.isPlaying && input.previousIsPlaying) {
    return true;
  }
  return false;
}

export const UNIFIED_CONTROL_ACTIVATE_DEBOUNCE_MS = 120;
export const UNIFIED_SEEK_STEP_MS = 10_000;
export const UNIFIED_SEEK_FLUSH_DEBOUNCE_MS = 120;
export const UNIFIED_SEEK_GUARD_MS = 1500;
export const UNIFIED_SEEK_SETTLE_TOLERANCE_MS = 1750;

export function isUnifiedControlActivateKey(key: string, keyCode?: number | null): boolean {
  return (
    key === 'Enter' ||
    key === 'Select' ||
    key === ' ' ||
    keyCode === 23 ||
    keyCode === 66 ||
    keyCode === 85
  );
}

export function isUnifiedTvSelectEvent(eventType?: string | null): boolean {
  return eventType === 'select' || eventType === 'playPause';
}

export function isUnifiedDpadNavigationKey(key: string, keyCode?: number | null): boolean {
  if (
    key === 'ArrowUp' ||
    key === 'ArrowDown' ||
    key === 'ArrowLeft' ||
    key === 'ArrowRight' ||
    key === 'up' ||
    key === 'down' ||
    key === 'left' ||
    key === 'right'
  ) {
    return true;
  }

  if (keyCode == null) {
    return false;
  }

  // Android TV d-pad arrows only.
  return keyCode === 19 || keyCode === 20 || keyCode === 21 || keyCode === 22;
}

export function shouldRevealUnifiedControlsFromKeyEvent(key: string, keyCode?: number | null): boolean {
  if (isUnifiedControlActivateKey(key, keyCode)) {
    return true;
  }

  return isUnifiedDpadNavigationKey(key, keyCode);
}

export type UnifiedOverlayKeyAction = 'toggle-play' | 'reveal';

export function resolveUnifiedOverlayKeyAction(
  controlsVisible: boolean,
  showError: boolean,
  key: string,
  keyCode?: number | null,
): UnifiedOverlayKeyAction | null {
  if (showError || controlsVisible) {
    return null;
  }

  if (isUnifiedControlActivateKey(key, keyCode) || isUnifiedDpadNavigationKey(key, keyCode)) {
    return 'reveal';
  }

  return null;
}

export type UnifiedControlFocusId = 'back' | 'rewind' | 'play' | 'forward' | 'seek' | 'previousEpisode' | 'nextEpisode';

type UnifiedKeyEvent = {
  key?: string;
  code?: string;
  keyCode?: number | null;
};

function isArrowLeft(event: UnifiedKeyEvent): boolean {
  return event.key === 'ArrowLeft' || event.code === 'ArrowLeft' || event.keyCode === 21;
}

function isArrowRight(event: UnifiedKeyEvent): boolean {
  return event.key === 'ArrowRight' || event.code === 'ArrowRight' || event.keyCode === 22;
}

function isArrowUp(event: UnifiedKeyEvent): boolean {
  return event.key === 'ArrowUp' || event.code === 'ArrowUp' || event.keyCode === 19;
}

function isArrowDown(event: UnifiedKeyEvent): boolean {
  return event.key === 'ArrowDown' || event.code === 'ArrowDown' || event.keyCode === 20;
}

export function resolveUnifiedControlFocusMove(
  current: UnifiedControlFocusId,
  event: UnifiedKeyEvent,
  options?: {
    episodeButtonsVisible?: boolean;
    canGoPreviousEpisode?: boolean;
    canGoNextEpisode?: boolean;
  },
): UnifiedControlFocusId | null {
  const episodeButtonsVisible = Boolean(options?.episodeButtonsVisible);
  const canGoPreviousEpisode = Boolean(options?.canGoPreviousEpisode);
  const canGoNextEpisode = Boolean(options?.canGoNextEpisode);

  if (current === 'seek') {
    if (isArrowUp(event)) {
      return 'play';
    }
    if (isArrowDown(event)) {
      return 'rewind';
    }
    return null;
  }

  if (isArrowLeft(event)) {
    if (current === 'nextEpisode') {
      return 'forward';
    }
    if (current === 'forward') {
      return 'play';
    }
    if (current === 'play') {
      return 'rewind';
    }
    if (current === 'rewind') {
      return episodeButtonsVisible && canGoPreviousEpisode ? 'previousEpisode' : null;
    }
    return null;
  }

  if (isArrowRight(event)) {
    if (current === 'previousEpisode') {
      return 'rewind';
    }
    if (current === 'rewind') {
      return 'play';
    }
    if (current === 'play') {
      return 'forward';
    }
    if (current === 'forward') {
      return episodeButtonsVisible && canGoNextEpisode ? 'nextEpisode' : null;
    }
    return null;
  }

  if (isArrowUp(event)) {
    if (current === 'play') {
      return 'seek';
    }
    if (current === 'rewind' || current === 'forward' || current === 'previousEpisode' || current === 'nextEpisode') {
      return 'back';
    }
    return null;
  }

  if (isArrowDown(event)) {
    if (current === 'back') {
      return 'seek';
    }
    if (current === 'play') {
      return 'seek';
    }
    if (current === 'rewind' || current === 'forward' || current === 'previousEpisode' || current === 'nextEpisode') {
      return 'seek';
    }
    return null;
  }

  return null;
}

export function clampUnifiedSeekTarget(
  requestedMs: number,
  durationMs: number,
): number | null {
  if (!Number.isFinite(requestedMs) || !Number.isFinite(durationMs) || durationMs <= 0) {
    return null;
  }

  return Math.max(0, Math.min(requestedMs, durationMs));
}

export function resolveUnifiedSeekPosition(
  positionMs: number,
  durationMs: number,
  deltaMs: number,
): number | null {
  if (!Number.isFinite(positionMs) || !Number.isFinite(durationMs) || !Number.isFinite(deltaMs)) {
    return null;
  }

  if (durationMs <= 0) {
    return null;
  }

  return Math.max(0, Math.min(positionMs + deltaMs, durationMs));
}

export function resolveUnifiedSeekDelta(eventType?: string | null): number | null {
  const direction = resolveVodSeekDirection({ eventType });
  return direction == null ? null : direction * VOD_SEEK_STEP_MS;
}

export function shouldHandleUnifiedSeekRemoteEvent(input: {
  visible: boolean;
  focusedControl: UnifiedControlFocusId | null;
  durationMs: number;
  eventType?: string | null;
  eventKeyAction?: number;
}): boolean {
  if (!input.visible || input.focusedControl !== 'seek') {
    return false;
  }

  if (!Number.isFinite(input.durationMs) || input.durationMs <= 0) {
    return false;
  }

  if (input.eventKeyAction === 1) {
    return false;
  }

  return resolveUnifiedSeekDelta(input.eventType) != null;
}

export function shouldAssignUnifiedPlayerInitialFocus(input: {
  visible: boolean;
  initialFocusAssigned: boolean;
  focusedControl: UnifiedControlFocusId | null;
}): boolean {
  return input.visible && !input.initialFocusAssigned && input.focusedControl == null;
}

export function sanitizePlaybackErrorMessage(
  raw?: string | null,
  mediaType?: string | null,
): string {
  if (mediaType === 'movie' && isDevicePerformanceRiskMessage(raw)) {
    return raw ?? UNSUPPORTED_VIDEO_FORMAT_ERROR;
  }
  if (mediaType === 'movie' && (isUnsupportedVideoFormatMessage(raw) || isVideoDecoderInitFailure(raw))) {
    return UNSUPPORTED_VIDEO_FORMAT_ERROR;
  }
  return 'Playback unavailable';
}

/** Stable id so repeated playback failures update the same toast in place. */
export const PLAYBACK_NOTIFICATION_ID = 'playback-unavailable';
export const PLAYBACK_NOTIFICATION_DURATION_MS = 7000;

export type PlaybackNotificationSpec = {
  title: string;
  message: string;
  persistent: boolean;
};

/** Recoverable playback failures become toasts; the player chrome stays usable for Back. */
export function resolveUnifiedPlaybackNotification(
  machineState: UnifiedPlayerMachineState,
  retryAttemptedAndStillFailing: boolean,
  errorCategory?: string | null,
): PlaybackNotificationSpec | null {
  if (machineState !== 'error') {
    return null;
  }
  if (errorCategory === UNSUPPORTED_VIDEO_FORMAT_CATEGORY) {
    return null;
  }

  return {
    title: 'Playback unavailable',
    message: 'This stream could not be played right now. Try again or go back.',
    persistent: retryAttemptedAndStillFailing,
  };
}

export function resolveFocusLaunchSource(
  launchSource: PlaybackLaunchSource,
): 'play' | 'poster' | null {
  if (launchSource === 'play' || launchSource === 'poster') {
    return launchSource;
  }
  return null;
}

export function secondsToMs(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return 0;
  }
  return Math.round(seconds * 1000);
}

export function msToSeconds(ms: number): number {
  return Math.max(0, ms / 1000);
}
