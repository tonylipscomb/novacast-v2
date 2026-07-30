/* eslint-disable react-hooks/immutability -- expo-video requires imperative player control. */
import type { PlayingChangeEventPayload, StatusChangeEventPayload, TimeUpdateEventPayload } from 'expo-video';
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { BackHandler, Platform } from 'react-native';

import { useNovaStreamPlayer } from '@/features/playback/NovaStreamPlayer';
import { useAppNotification } from '@/features/notifications/useAppNotification';
import {
  registerPlaybackActivity,
  unregisterPlaybackActivity,
} from '@/features/playback/playbackActivityStore';

import {
  buildProgressKey,
  getResumePositionMs,
  savePlaybackProgress,
  shouldSaveProgress,
} from './playbackProgressStore.ts';
import type { PlaybackItem } from './types.ts';
import {
  clampUnifiedSeekTarget,
  derivePlaybackActivityType,
  isUnifiedPlaybackActive,
  mapPlayerStatusToMachineState,
  msToSeconds,
  PLAYBACK_NOTIFICATION_DURATION_MS,
  PLAYBACK_NOTIFICATION_ID,
  resolveUnifiedPlaybackNotification,
  sanitizePlaybackErrorMessage,
  secondsToMs,
  SEEK_BACK_MS,
  SEEK_FORWARD_MS,
  shouldAutoHideUnifiedControls,
  UNIFIED_CONTROL_ACTIVATE_DEBOUNCE_MS,
  UNIFIED_PLAYER_CHROME_AUTO_HIDE_MS,
  UNIFIED_PLAYER_BUFFERING_TIMEOUT_MS,
  UNIFIED_PLAYER_LOADING_TIMEOUT_MS,
  UNIFIED_SEEK_FLUSH_DEBOUNCE_MS,
  UNIFIED_SEEK_GUARD_MS,
  UNIFIED_SEEK_SETTLE_TOLERANCE_MS,
} from './unifiedPlayerLogic.ts';
import {
  clearUnifiedPlayerError,
  closeUnifiedPlayback,
  finishUnifiedPlaybackClose,
  getUnifiedPlayerState,
  launchUnifiedPlayback,
  setUnifiedPlayerControlsVisible,
  setUnifiedPlayerError,
  setUnifiedPlayerMachineState,
  setUnifiedPlayerPlaying,
  setUnifiedPlayerProgress,
  subscribeUnifiedPlayer,
} from './unifiedPlayerStore.ts';
import { UnifiedPlayerOverlay } from './UnifiedPlayerOverlay.tsx';
import { UnifiedPlayerRemoteHandlers } from './useUnifiedPlayerRemoteHandlers.tsx';
import { UnifiedRemoteDebugListeners } from './useUnifiedRemoteDebugListeners.tsx';
import {
  isUnifiedRemoteDebugEnabled,
  logUnifiedRemoteEvent,
} from './unifiedRemoteDebug.ts';
import { recordRecentItem } from '@/features/personalization/personalizationStore';
import { normalizePlaybackFailure, playbackAnalyticsTracker } from '@/features/analytics/playbackAnalytics';
import { endMoviePlaybackAttemptDiag } from '@/features/providers/playbackSourceDiagnostics';

function useUnifiedPlayerSnapshot() {
  return useSyncExternalStore(subscribeUnifiedPlayer, getUnifiedPlayerState, getUnifiedPlayerState);
}

export function UnifiedPlayerController() {
  const snapshot = useUnifiedPlayerSnapshot();
  const streamUrl = snapshot.item?.streamUrl ?? null;
  const chromeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playbackRetryAttemptedRef = useRef(false);
  const lastPlaybackRetryAtRef = useRef(0);
  const streamCallbacksRef = useRef({
    onError: (_message: string) => {},
    onReady: () => {},
  });
  const { showNotification, dismissNotification, clearScope } = useAppNotification();
  const lastProgressSaveRef = useRef(0);
  const lastToggleAtRef = useRef(0);
  const resumeAppliedRef = useRef<string | null>(null);
  const appliedPlayingRef = useRef<boolean | null>(null);
  const previousAnalyticsSnapshotRef = useRef(snapshot);
  const seekQueueRef = useRef<{
    inFlight: boolean;
    pendingMs: number | null;
    flushTimer: ReturnType<typeof setTimeout> | null;
  }>({
    inFlight: false,
    pendingMs: null,
    flushTimer: null,
  });
  const seekGuardRef = useRef<{
    targetMs: number | null;
    expiresAt: number;
  }>({
    targetMs: null,
    expiresAt: 0,
  });

  const clearChromeTimer = useCallback(() => {
    if (chromeTimerRef.current) {
      clearTimeout(chromeTimerRef.current);
      chromeTimerRef.current = null;
    }
  }, []);

  const scheduleChromeHide = useCallback(() => {
    clearChromeTimer();
    if (!shouldAutoHideUnifiedControls(snapshot.machineState)) {
      return;
    }
    chromeTimerRef.current = setTimeout(() => {
      setUnifiedPlayerControlsVisible(false);
    }, UNIFIED_PLAYER_CHROME_AUTO_HIDE_MS);
  }, [clearChromeTimer, snapshot.machineState]);

  const revealControls = useCallback(() => {
    setUnifiedPlayerControlsVisible(true);
    scheduleChromeHide();
  }, [scheduleChromeHide]);

  // Keep native player callbacks pointed at the latest store state without recreating the player.
  // eslint-disable-next-line react-hooks/refs
  streamCallbacksRef.current = {
    onError: (message) => {
      const current = getUnifiedPlayerState();
      if (!current.item) {
        return;
      }
      if (current.item.mediaType === 'movie') {
        endMoviePlaybackAttemptDiag({
          streamId: current.item.id,
          nativeStatus: 'error',
          errorCategory: normalizePlaybackFailure(message),
          outcome: 'error',
        });
      }
      playbackAnalyticsTracker.failure(message);
      setUnifiedPlayerError(sanitizePlaybackErrorMessage(message));
    },
    onReady: () => {
      const current = getUnifiedPlayerState();
      if (current.machineState === 'loading') {
        setUnifiedPlayerMachineState(mapPlayerStatusToMachineState(player.status, player.playing));
      }
      const durationMs = secondsToMs(player.duration);
      if (durationMs > 0) {
        setUnifiedPlayerProgress(
          Math.min(secondsToMs(player.currentTime), durationMs),
          durationMs,
        );
      }
    },
  };

  const { player, retry } = useNovaStreamPlayer(streamUrl, {
    onError: (message) => streamCallbacksRef.current.onError(message),
    onReady: () => streamCallbacksRef.current.onReady(),
  });

  const playbackActive = isUnifiedPlaybackActive(snapshot.machineState, snapshot.item);
  const applyNativeSeek = useCallback(
    (requestedMs: number, source: 'rewind' | 'forward' | 'scrubber' | 'resume') => {
      const current = getUnifiedPlayerState();
      const durationMs =
        current.durationMs > 0 ? current.durationMs : secondsToMs(player.duration);
      const clampedMs = clampUnifiedSeekTarget(requestedMs, durationMs);

      if (clampedMs == null) {
        return null;
      }

      seekGuardRef.current = {
        targetMs: clampedMs,
        expiresAt: Date.now() + UNIFIED_SEEK_GUARD_MS,
      };

      try {
        const nativeSeconds = msToSeconds(clampedMs);
        player.currentTime = nativeSeconds;
        setUnifiedPlayerProgress(clampedMs, durationMs);

        if (__DEV__) {
          console.info('[NovaCast Seek]', {
            source,
            requestedMs,
            clampedMs,
            nativeSeconds,
            durationMs,
            machineState: current.machineState,
          });
        }

        return clampedMs;
      } catch {
        seekGuardRef.current = { targetMs: null, expiresAt: 0 };
        return null;
      }
    },
    [player],
  );


  const handleFirstFrameRender = useCallback(() => {
    const current = getUnifiedPlayerState();
    if (!isUnifiedPlaybackActive(current.machineState, current.item)) {
      return;
    }

    if (current.item?.mediaType === 'movie') {
      endMoviePlaybackAttemptDiag({
        streamId: current.item.id,
        nativeStatus: 'readyToPlay',
        outcome: 'started',
      });
    }
    playbackAnalyticsTracker.firstFrame();
    if (current.machineState === 'loading' || current.machineState === 'buffering') {
      setUnifiedPlayerMachineState(mapPlayerStatusToMachineState(player.status, player.playing));
    }
  }, [player]);

  useEffect(() => {
    const previous = previousAnalyticsSnapshotRef.current;
    if (!previous.item && snapshot.item && snapshot.machineState === 'loading') {
      playbackAnalyticsTracker.request(snapshot.item, snapshot.launchSource);
    }
    if (snapshot.machineState !== previous.machineState) {
      playbackAnalyticsTracker.stateChanged(snapshot.machineState);
    }
    if (snapshot.machineState === 'error' && previous.machineState !== 'error') {
      playbackAnalyticsTracker.failure(snapshot.errorMessage);
    }
    if (snapshot.machineState === 'closing' && previous.machineState !== 'closing') {
      playbackAnalyticsTracker.stop('user_back');
    }
    previousAnalyticsSnapshotRef.current = snapshot;
  }, [snapshot]);

  useEffect(() => {
    if (!playbackActive || snapshot.machineState !== 'loading') {
      return;
    }

    const timer = setTimeout(() => {
      const current = getUnifiedPlayerState();
      if (current.machineState === 'loading' && current.item) {
        if (current.item.mediaType === 'movie') {
          endMoviePlaybackAttemptDiag({
            streamId: current.item.id,
            nativeStatus: 'loading',
            errorCategory: 'timeout',
            outcome: 'timeout',
          });
        }
        setUnifiedPlayerError('Playback timed out while loading.');
      }
    }, UNIFIED_PLAYER_LOADING_TIMEOUT_MS);

    return () => clearTimeout(timer);
  }, [playbackActive, snapshot.item?.id, snapshot.machineState]);

  useEffect(() => {
    if (!playbackActive || snapshot.machineState !== 'buffering') {
      return;
    }

    const timer = setTimeout(() => {
      const current = getUnifiedPlayerState();
      if (current.machineState === 'buffering' && current.item) {
        setUnifiedPlayerError('Playback stalled while buffering. Try again.');
      }
    }, UNIFIED_PLAYER_BUFFERING_TIMEOUT_MS);

    return () => clearTimeout(timer);
  }, [playbackActive, snapshot.item?.id, snapshot.machineState]);

  useEffect(() => {
    const queue = seekQueueRef.current;
    return () => {
      if (queue.flushTimer) {
        clearTimeout(queue.flushTimer);
        queue.flushTimer = null;
      }
      queue.pendingMs = null;
      queue.inFlight = false;
      seekGuardRef.current = { targetMs: null, expiresAt: 0 };
    };
  }, [playbackActive, snapshot.item?.id]);

  useEffect(() => {
    if (!playbackActive || !snapshot.item) {
      return;
    }
    registerPlaybackActivity(derivePlaybackActivityType(snapshot.item));
    return () => {
      unregisterPlaybackActivity();
    };
  }, [playbackActive, snapshot.item]);

  useEffect(() => {
    if (!playbackActive) {
      clearChromeTimer();
      resumeAppliedRef.current = null;
      return;
    }
    setUnifiedPlayerControlsVisible(true);
  }, [clearChromeTimer, playbackActive]);

  useEffect(() => {
    if (!playbackActive || !snapshot.controlsVisible) {
      return;
    }
    if (!shouldAutoHideUnifiedControls(snapshot.machineState)) {
      return;
    }
    scheduleChromeHide();
    return clearChromeTimer;
  }, [
    clearChromeTimer,
    playbackActive,
    scheduleChromeHide,
    snapshot.controlsVisible,
    snapshot.machineState,
  ]);

  useEffect(() => {
    const item = snapshot.item;
    if (!item?.providerId || item.mediaType === 'live') {
      return;
    }

    const resumeKey = `${item.providerId}:${item.mediaType}:${item.id}`;
    if (resumeAppliedRef.current === resumeKey) {
      return;
    }

    resumeAppliedRef.current = resumeKey;
    void getResumePositionMs(
      buildProgressKey(item.providerId, item.mediaType, item.id),
    ).then((resumePositionMs) => {
      if (resumePositionMs > 0) {
        try {
          applyNativeSeek(resumePositionMs, 'resume');
        } catch {
          // Player may not be ready yet; resume is best-effort.
        }
      }
    });
  }, [applyNativeSeek, snapshot.item]);

  useEffect(() => {
    const item = snapshot.item;
    if (!item?.providerId) {
      return;
    }

    void recordRecentItem({
      providerId: item.providerId,
      mediaType: item.mediaType,
      contentId: item.id,
      title: item.title,
      artworkUrl: item.artworkUrl,
      parentSeriesId: item.seriesId,
      seasonNumber: item.seasonNumber,
      episodeNumber: item.episodeNumber,
    });
  }, [snapshot.item]);

  useEffect(() => {
    try {
      player.timeUpdateEventInterval = 1;
    } catch {
      // Player may not be mounted yet.
    }
  }, [player]);

  const handleNativeStatusChange = useCallback(({ status }: StatusChangeEventPayload) => {
    const current = getUnifiedPlayerState();
    if (!isUnifiedPlaybackActive(current.machineState, current.item)) {
      return;
    }
    const nextState = mapPlayerStatusToMachineState(status, player.playing);
    if (current.machineState !== 'error' && current.machineState !== 'closing') {
      setUnifiedPlayerMachineState(nextState);
    }
    const durationMs = secondsToMs(player.duration);
    if (durationMs > 0) {
      setUnifiedPlayerProgress(
        Math.min(secondsToMs(player.currentTime), durationMs),
        durationMs,
      );
    }
  }, [player]);

  const handleNativePlayingChange = useCallback(({ isPlaying }: PlayingChangeEventPayload) => {
    const current = getUnifiedPlayerState();
    if (!isUnifiedPlaybackActive(current.machineState, current.item)) {
      return;
    }
    appliedPlayingRef.current = isPlaying;
    if (current.isPlaying !== isPlaying) {
      setUnifiedPlayerPlaying(isPlaying);
    }
    if (current.machineState !== 'error' && current.machineState !== 'closing') {
      setUnifiedPlayerMachineState(mapPlayerStatusToMachineState(player.status, isPlaying));
    }
    // expo-video's Android first-frame event can remain pending when the ONN
    // SurfaceView never reports a valid layout. Media3's isPlaying=true is the
    // earliest stable native transition after the player is ready and actually
    // advancing playback, so use it only as the fallback source.
    if (isPlaying && player.status === 'readyToPlay') {
      playbackAnalyticsTracker.firstFrame('playing_transition');
    }
  }, [player]);

  const handleNativeTimeUpdate = useCallback(({ currentTime }: TimeUpdateEventPayload) => {
    const current = getUnifiedPlayerState();
    if (!isUnifiedPlaybackActive(current.machineState, current.item)) {
      return;
    }
    const positionMs = secondsToMs(currentTime);
    const durationMs = secondsToMs(player.duration);
    const seekGuard = seekGuardRef.current;

    if (seekGuard.targetMs != null) {
      const reachedTarget =
        Math.abs(positionMs - seekGuard.targetMs) <= UNIFIED_SEEK_SETTLE_TOLERANCE_MS;
      const expired = Date.now() >= seekGuard.expiresAt;

      if (reachedTarget || expired) {
        seekGuardRef.current = { targetMs: null, expiresAt: 0 };
      } else {
        return;
      }
    }

    setUnifiedPlayerProgress(positionMs, durationMs);

    if (currentTime > 0 && player.status === 'readyToPlay' && player.playing) {
      playbackAnalyticsTracker.firstFrame('current_time_progress');
      if (current.machineState === 'loading' || current.machineState === 'buffering') {
        setUnifiedPlayerMachineState('playing');
      }
    }

    const item = current.item;
    if (!item?.providerId || item.mediaType === 'live') {
      return;
    }

    const now = Date.now();
    if (!shouldSaveProgress(lastProgressSaveRef.current, now)) {
      return;
    }
    lastProgressSaveRef.current = now;

    void savePlaybackProgress(buildProgressKey(item.providerId, item.mediaType, item.id), {
      title: item.title,
      positionMs,
      durationMs,
    }, item);
  }, [player]);

  useEffect(() => {
    if (!playbackActive) {
      appliedPlayingRef.current = null;
      return;
    }

    // While the stream is opening, keep the user's play intent and avoid pause/play churn.
    if (
      snapshot.machineState === 'loading' ||
      snapshot.machineState === 'buffering' ||
      snapshot.machineState === 'error'
    ) {
      return;
    }

    if (appliedPlayingRef.current === snapshot.isPlaying) {
      return;
    }
    appliedPlayingRef.current = snapshot.isPlaying;
    try {
      if (snapshot.isPlaying) {
        player.play();
      } else {
        player.pause();
      }
    } catch {
      // Player may be transitioning or released during close.
    }
  }, [playbackActive, player, snapshot.isPlaying, snapshot.machineState]);

  const handleTogglePlay = useCallback(() => {
    if (Date.now() - lastToggleAtRef.current < UNIFIED_CONTROL_ACTIVATE_DEBOUNCE_MS) {
      return;
    }
    lastToggleAtRef.current = Date.now();
    if (isUnifiedRemoteDebugEnabled()) {
      logUnifiedRemoteEvent({
        source: 'controls-onPress',
        eventType: 'handler-invoke',
        disposition: 'accepted',
        actionTaken: snapshot.isPlaying ? 'controller-pause-playback' : 'controller-start-playback',
        controlId: 'play',
      });
    }
    setUnifiedPlayerPlaying(!snapshot.isPlaying);
    revealControls();
  }, [revealControls, snapshot.isPlaying]);

    const handleRewind = useCallback(() => {
    const current = getUnifiedPlayerState();
    applyNativeSeek(current.positionMs - SEEK_BACK_MS, 'rewind');
    revealControls();
  }, [applyNativeSeek, revealControls]);


    const handleForward = useCallback(() => {
    const current = getUnifiedPlayerState();
    applyNativeSeek(current.positionMs + SEEK_FORWARD_MS, 'forward');
    revealControls();
  }, [applyNativeSeek, revealControls]);


  // This callback owns the bounded native seek flush and intentionally keeps its imperative queue stable.
  // eslint-disable-next-line react-hooks/preserve-manual-memoization
  const flushSeek = useCallback(() => {
    const queue = seekQueueRef.current;
    queue.flushTimer = null;
    const pendingMs = queue.pendingMs;
    queue.pendingMs = null;

    if (pendingMs == null) {
      queue.inFlight = false;
      return;
    }

    try {
      applyNativeSeek(pendingMs, 'scrubber');
      if (isUnifiedRemoteDebugEnabled()) {
        logUnifiedRemoteEvent({
          source: 'controls-onPress',
          eventType: 'seek-flush',
          disposition: 'accepted',
          actionTaken: 'native-seek',
          controlId: 'seek',
        });
      }
    } catch {
      // Seek is best-effort and should not break playback state.
    } finally {
      if (queue.pendingMs != null) {
        queue.flushTimer = setTimeout(flushSeek, UNIFIED_SEEK_FLUSH_DEBOUNCE_MS);
      } else {
        queue.inFlight = false;
      }
    }
  }, [player]);

  const handleSeek = useCallback(
    (nextPositionMs: number) => {
      if (isUnifiedRemoteDebugEnabled()) {
        logUnifiedRemoteEvent({
          source: 'controls-onPress',
          eventType: 'handler-invoke',
          disposition: 'accepted',
          actionTaken: 'controller-seek',
          controlId: 'seek',
        });
      }
      if (!Number.isFinite(snapshot.durationMs) || snapshot.durationMs <= 0) {
        return;
      }

      const clampedNextMs = Math.max(0, Math.min(nextPositionMs, snapshot.durationMs));
      setUnifiedPlayerProgress(clampedNextMs, snapshot.durationMs);
      const queue = seekQueueRef.current;
      queue.pendingMs = clampedNextMs;

      if (queue.inFlight) {
        revealControls();
        return;
      }

      queue.inFlight = true;
      queue.flushTimer = setTimeout(flushSeek, UNIFIED_SEEK_FLUSH_DEBOUNCE_MS);
      revealControls();
    },
    [flushSeek, revealControls, snapshot.durationMs],
  );

  const handleBack = useCallback(() => {
    if (isUnifiedRemoteDebugEnabled()) {
      logUnifiedRemoteEvent({
        source: 'controls-onPress',
        eventType: 'handler-invoke',
        disposition: 'accepted',
        actionTaken: 'controller-close-playback',
        controlId: 'back',
      });
    }
    const item = snapshot.item;
    if (item?.providerId && item.mediaType !== 'live') {
      void savePlaybackProgress(buildProgressKey(item.providerId, item.mediaType, item.id), {
        title: item.title,
        positionMs: snapshot.positionMs,
        durationMs: snapshot.durationMs,
      }, item);
    }
    closeUnifiedPlayback();
  }, [snapshot.durationMs, snapshot.item, snapshot.positionMs]);

  useEffect(() => {
    if (Platform.OS !== 'android' || (!playbackActive && snapshot.machineState !== 'closing')) {
      return;
    }

    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (snapshot.machineState === 'closing') {
        return true;
      }

      handleBack();
      return true;
    });

    return () => subscription.remove();
  }, [handleBack, playbackActive, snapshot.machineState]);

  useEffect(() => {
    if (snapshot.machineState !== 'closing') {
      return;
    }

    const timer = setTimeout(() => {
      finishUnifiedPlaybackClose();
    }, 350);

    return () => clearTimeout(timer);
  }, [snapshot.machineState]);

  const handleRetry = useCallback(() => {
    const now = Date.now();
    if (now - lastPlaybackRetryAtRef.current < 400) {
      return;
    }

    lastPlaybackRetryAtRef.current = now;
    playbackRetryAttemptedRef.current = true;
    const current = getUnifiedPlayerState();
    if (current.item) playbackAnalyticsTracker.request(current.item, current.launchSource, true);
    clearUnifiedPlayerError();
    retry();
    revealControls();
  }, [retry, revealControls]);

  useEffect(() => {
    if (snapshot.machineState === 'error') {
      setUnifiedPlayerControlsVisible(true);
    }
  }, [snapshot.machineState]);

  useEffect(() => {
    if (!playbackActive && snapshot.machineState === 'error') {
      clearUnifiedPlayerError();
    }
  }, [playbackActive, snapshot.machineState]);

  useEffect(() => {
    const spec = playbackActive
      ? resolveUnifiedPlaybackNotification(snapshot.machineState, playbackRetryAttemptedRef.current)
      : null;
    if (!spec) {
      dismissNotification(PLAYBACK_NOTIFICATION_ID);
      return;
    }

    showNotification({
      id: PLAYBACK_NOTIFICATION_ID,
      type: 'error',
      title: spec.title,
      message: spec.message,
      duration: PLAYBACK_NOTIFICATION_DURATION_MS,
      persistent: spec.persistent,
      position: 'bottom-right',
      scope: 'playback',
    });
  }, [dismissNotification, playbackActive, showNotification, snapshot.machineState]);

  useEffect(() => {
    if (snapshot.machineState === 'playing' || snapshot.machineState === 'ready' || snapshot.machineState === 'paused') {
      playbackRetryAttemptedRef.current = false;
    }
  }, [snapshot.machineState]);

  useEffect(() => {
    if (snapshot.machineState === 'idle' || snapshot.machineState === 'closing') {
      dismissNotification(PLAYBACK_NOTIFICATION_ID);
      clearScope('playback');
      playbackRetryAttemptedRef.current = false;
    }
  }, [clearScope, dismissNotification, snapshot.machineState]);

  if (!playbackActive && snapshot.machineState !== 'closing') {
    return null;
  }

  return (
    <>
      <UnifiedRemoteDebugListeners enabled={playbackActive || snapshot.machineState === 'closing'} />
      <UnifiedPlayerRemoteHandlers
        enabled={playbackActive}
        controlsVisible={snapshot.controlsVisible}
        onTogglePlay={handleTogglePlay}
        onRevealControls={revealControls}
      />
      <UnifiedPlayerOverlay
      player={player}
      state={snapshot}
      onFirstFrameRender={handleFirstFrameRender}
      onStatusChange={handleNativeStatusChange}
      onPlayingChange={handleNativePlayingChange}
      onTimeUpdate={handleNativeTimeUpdate}
      onTogglePlay={handleTogglePlay}
      onRewind={handleRewind}
      onForward={handleForward}
      onSeek={handleSeek}
      onBack={handleBack}
      onRetry={handleRetry}
      onRevealControls={revealControls}
    />
    </>
  );
}

export async function prepareUnifiedPlaybackLaunch(item: PlaybackItem) {
  if (!item.providerId || item.mediaType === 'live' || item.resumePositionMs !== undefined) {
    return item;
  }

  const resumePositionMs = await getResumePositionMs(
    buildProgressKey(item.providerId, item.mediaType, item.id),
  );

  return {
    ...item,
    resumePositionMs,
  };
}

export { launchUnifiedPlayback, closeUnifiedPlayback };
