export type {
  LaunchPlaybackOptions,
  PlaybackItem,
  PlaybackLaunchSource,
  PlaybackMediaType,
  PlaybackMode,
  UnifiedPlayerMachineState,
  UnifiedPlayerState,
} from './types.ts';

export {
  buildProgressKey,
  computeProgressPercent,
  computeResumePositionMs,
  getResumePositionMs,
  PROGRESS_SAVE_INTERVAL_MS,
  savePlaybackProgress,
  shouldMarkComplete,
  shouldSaveProgress,
  WATCHED_THRESHOLD_PERCENT,
} from './playbackProgressStore.ts';

export {
  decideUnifiedBackAction,
  derivePlaybackActivityType,
  derivePlaybackMode,
  didUnifiedPlaybackJustClose,
  isUnifiedPlaybackActive,
  mapPlayerStatusToMachineState,
  resolveFocusLaunchSource,
  resolveUnifiedPlaybackNotification,
  sanitizePlaybackErrorMessage,
  SEEK_BACK_MS,
  SEEK_FORWARD_MS,
  shouldAutoHideUnifiedControls,
  shouldShowUnifiedErrorState,
  shouldShowUnifiedLoadingState,
  shouldShowUnifiedPlayerSurface,
  UNIFIED_PLAYER_CHROME_AUTO_HIDE_MS,
} from './unifiedPlayerLogic.ts';

export {
  closeUnifiedPlayback,
  finishUnifiedPlaybackClose,
  getUnifiedPlayerState,
  launchUnifiedPlayback,
  resetUnifiedPlayerForTests,
  setUnifiedPlayerControlsVisible,
  setUnifiedPlayerError,
  setUnifiedPlayerMachineState,
  subscribeUnifiedPlayer,
} from './unifiedPlayerStore.ts';

export { UnifiedPlayerController } from './UnifiedPlayerController.tsx';
export { UnifiedPlayerHost } from './UnifiedPlayerHost.tsx';
export { UnifiedPlayerOverlay } from './UnifiedPlayerOverlay.tsx';
export { UnifiedPlayerControls } from './UnifiedPlayerControls.tsx';
export { UnifiedPlayerErrorState } from './UnifiedPlayerErrorState.tsx';
export { UnifiedPlayerLoadingState } from './UnifiedPlayerLoadingState.tsx';
export { useUnifiedPlayer } from './useUnifiedPlayer.ts';
