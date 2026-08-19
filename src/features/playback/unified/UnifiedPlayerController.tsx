/* eslint-disable react-hooks/immutability -- expo-video requires imperative player control. */
import type { PlayingChangeEventPayload, StatusChangeEventPayload, TimeUpdateEventPayload } from 'expo-video';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { BackHandler, Dimensions, Platform } from 'react-native';
import * as Device from 'expo-device';

import { wrapOnnMoviesBackHandler } from '@/features/diagnostics/onnMoviesTrace';
import { useNovaStreamPlayer } from '@/features/playback/NovaStreamPlayer';
import { useAppNotification } from '@/features/notifications/useAppNotification';
import {
  registerPlaybackActivity,
  unregisterPlaybackActivity,
} from '@/features/playback/playbackActivityStore';

import {
  buildProgressKey,
  savePlaybackProgress,
  shouldSaveProgress,
} from './playbackProgressStore.ts';
import {
  UP_NEXT_COUNTDOWN_SECONDS,
} from '../continuity/playbackContinuity.ts';
import {
  createSeriesUpNextTransitionId,
  getSeriesAutoplayQueue,
  logSeriesAutoplay,
  logSeriesUpNext,
  pickPlayableNextEpisode,
  remainingPlaybackMs,
  resolveSeriesAutoplayDecision,
  shouldArmSeriesUpNext,
  shouldCloseSeriesEpisodeWithoutUpNext,
  shouldCommitSeriesUpNextTransition,
  shouldResetSeriesUpNextAfterCommittedSeek,
} from '../continuity/seriesUpNext.ts';
import { logSeriesAutoplayFocus } from '../continuity/seriesUpNextFocus.ts';
import {
  createEpisodeNavigationTransitionId,
  logEpisodeNavigation,
} from '../continuity/episodeNavigation.ts';
import type { NextEpisodeRef, PlaybackItem } from './types.ts';
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
  shouldRevealChromeFromPlaybackState,
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
  getUnifiedPlayerCloseCallback,
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
import { logPlayerChromeFocus } from './playerChromeWake.ts';
import {
  consumeVodDirectionalSeek,
  logPlayerChrome,
  logVodSeek,
  resolveVodDirectionalSeekEntry,
  type PlayerChromeRevealSource,
  type VodDirectionalSeekSource,
} from './vodSeek.ts';
import { recordRecentItem } from '@/features/personalization/personalizationStore';
import { handoffSeriesContinueWatchingToNextEpisode } from '../../media-browser/mediaLibraryStore.ts';
import { getAppSettingsSync } from '@/features/settings/appSettingsStore.ts';
import {
  extractPlaybackHttpStatus,
  normalizePlaybackFailure,
  playbackAnalyticsTracker,
} from '@/features/analytics/playbackAnalytics';
import { buildSanitizedPlaybackSourceSnapshot } from '@/features/movies/moviesStartupRuntimeIsolation';
import { noteMoviePlaybackFailed, noteMoviePlaybackStarted } from '@/features/movies/moviesPlaybackAudit';
import { endMoviePlaybackAttemptDiag } from '@/features/providers/playbackSourceDiagnostics';
import { tryHomeContinueWatchingFallbackRecovery } from '@/features/hub/homeContinueWatchingLaunch';
import {
  DEVICE_PERFORMANCE_RISK_ERROR,
  DEVICE_PERFORMANCE_RISK_REASON,
  inspectMoviePlaybackSource,
  isMovieCodecRisk,
  isMovieResolutionRisk,
  isVideoDecoderInitFailure,
  logMoviePlaybackCompatibility,
  MAX_MOVIE_COMPATIBILITY_FALLBACK_ATTEMPTS,
  resolveDevicePlaybackProfile,
  resolveMovieCompatibilityErrorDecision,
  resolveMoviePreplayCompatibilityDecision,
  shouldRecordMovieProgressAfterPlayback,
  shouldRetryMovieUnsupportedFormat,
  shouldRunMovieHttpSourceRecovery,
  type DevicePlaybackSignals,
  UNSUPPORTED_VIDEO_FORMAT_CATEGORY,
  UNSUPPORTED_VIDEO_FORMAT_ERROR,
} from './moviePlaybackCompatibility.ts';

function collectDevicePlaybackSignals(): DevicePlaybackSignals {
  const screen = Dimensions.get('screen');
  const constants = Platform.OS === 'android' ? (Platform.constants as Record<string, unknown>) : {};
  return {
    displayWidth: screen?.width ?? null,
    displayHeight: screen?.height ?? null,
    os: Platform.OS,
    isTv: Platform.isTV === true,
    manufacturer: Device.manufacturer ?? Device.brand ?? null,
    model: Device.modelName ?? (typeof constants.Model === 'string' ? constants.Model : null),
    brand: Device.brand ?? null,
    apiLevel:
      Device.platformApiLevel ?? (typeof constants.Version === 'number' ? constants.Version : null),
    deviceType: Device.deviceType === Device.DeviceType.TV ? 'tv' : null,
  };
}

function toEpisodeRefFromPlaybackItem(item: PlaybackItem): NextEpisodeRef | null {
  if (!item.seriesId || !item.seasonNumber || !item.episodeNumber) {
    return null;
  }
  return {
    id: item.id,
    seriesId: item.seriesId,
    seasonNumber: item.seasonNumber,
    episodeNumber: item.episodeNumber,
    title: item.title,
    streamUrl: item.streamUrl,
  };
}

function useUnifiedPlayerSnapshot() {
  return useSyncExternalStore(subscribeUnifiedPlayer, getUnifiedPlayerState, getUnifiedPlayerState);
}

export function UnifiedPlayerController() {
  const snapshot = useUnifiedPlayerSnapshot();
  const devicePlaybackProfile = useMemo(() => resolveDevicePlaybackProfile(collectDevicePlaybackSignals()), []);
  const movieCompatSessionRef = useRef<{
    movieId: string | null;
    fallbackAttempted: boolean;
    firstFrameSeen: boolean;
    preplayBlocked: boolean;
    streamOverride: string | null;
  }>({
    movieId: null,
    fallbackAttempted: false,
    firstFrameSeen: false,
    preplayBlocked: false,
    streamOverride: null,
  });
  const movieSourceProbe =
    snapshot.item?.mediaType === 'movie'
      ? inspectMoviePlaybackSource({
          containerExtension: snapshot.item.containerExtension,
          videoCodec: snapshot.item.videoCodec,
          width: snapshot.item.videoWidth,
          height: snapshot.item.videoHeight,
          directSource: snapshot.item.directSourceUrl,
        })
      : null;
  const moviePreplayDecision =
    snapshot.item?.mediaType === 'movie' && movieSourceProbe
      ? resolveMoviePreplayCompatibilityDecision({
          mediaType: snapshot.item.mediaType,
          probe: movieSourceProbe,
          profile: devicePlaybackProfile,
          primaryStreamUrl: snapshot.item.streamUrl,
          directSourceUrl: snapshot.item.directSourceUrl,
          fallbackAttempted: movieCompatSessionRef.current.fallbackAttempted,
        })
      : { action: 'play' as const };
  const movieSession = movieCompatSessionRef.current;
  const streamUrl =
    snapshot.item?.mediaType !== 'movie'
      ? (snapshot.item?.streamUrl ?? null)
      : movieSession.movieId === snapshot.item.id && movieSession.preplayBlocked
        ? null
        : movieSession.movieId === snapshot.item.id && movieSession.streamOverride
          ? movieSession.streamOverride
          : moviePreplayDecision.action === 'block'
            ? null
            : moviePreplayDecision.action === 'fallback'
              ? moviePreplayDecision.source.streamUrl
              : snapshot.item.streamUrl;
  const chromeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playbackRetryAttemptedRef = useRef(false);
  const lastPlaybackRetryAtRef = useRef(0);
  const streamCallbacksRef = useRef({
    onError: (_message: string) => {},
    onReady: () => {},
  });
  const { showNotification, dismissNotification, clearScope } = useAppNotification();
  const lastProgressSaveRef = useRef(0);
  const [upNext, setUpNext] = useState<{
    secondsLeft: number;
    title: string;
    seasonNumber?: string;
    episodeNumber?: string;
    autoplay: boolean;
  } | null>(null);
  const upNextArmedForEpisodeIdRef = useRef<string | null>(null);
  const upNextDismissedForEpisodeIdRef = useRef<string | null>(null);
  const upNextTransitionIdRef = useRef<string | null>(null);
  const upNextCommittedTransitionIdRef = useRef<string | null>(null);
  const episodeTransitionInFlightRef = useRef(false);
  const upNextSessionIdRef = useRef<string | null>(null);
  const upNextHandledRef = useRef<string | null>(null);
  const seriesEndHandledForEpisodeIdRef = useRef<string | null>(null);
  const lastPlayingPositionMsRef = useRef(0);
  const autoplayCompletePendingEpisodeIdRef = useRef<string | null>(null);
  const applySeriesAutoplayDecisionRef = useRef<
    (
      decision: ReturnType<typeof resolveSeriesAutoplayDecision>,
      item: PlaybackItem,
      positionMs: number,
      durationMs: number,
    ) => void
  >(() => {});
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
  const seekPreviewActiveRef = useRef(false);
  const cancelSeekPreviewRef = useRef<() => boolean>(() => false);
  const beginVodDirectionalPreviewRef = useRef<(direction: 1 | -1) => boolean>(() => false);
  const requestTimelineFocusRef = useRef<() => void>(() => {});
  const requestDefaultChromeFocusRef = useRef<() => void>(() => {});
  const getTimelineFocusedRef = useRef<() => boolean>(() => false);
  const getTimelineHandlePresentRef = useRef<() => boolean>(() => false);
  const [pendingHiddenSeekDirection, setPendingHiddenSeekDirection] = useState<1 | -1 | null>(null);
  const [seekPreviewActive, setSeekPreviewActive] = useState(false);

  const clearChromeTimer = useCallback(() => {
    if (chromeTimerRef.current) {
      clearTimeout(chromeTimerRef.current);
      chromeTimerRef.current = null;
    }
  }, []);

  const scheduleChromeHide = useCallback(() => {
    clearChromeTimer();
    if (seekPreviewActiveRef.current) {
      return;
    }
    if (!shouldAutoHideUnifiedControls(snapshot.machineState)) {
      return;
    }
    chromeTimerRef.current = setTimeout(() => {
      if (seekPreviewActiveRef.current) {
        return;
      }
      setUnifiedPlayerControlsVisible(false);
    }, UNIFIED_PLAYER_CHROME_AUTO_HIDE_MS);
  }, [clearChromeTimer, snapshot.machineState]);

  const revealControls = useCallback((source: PlayerChromeRevealSource = 'controller') => {
    const current = getUnifiedPlayerState();
    logPlayerChrome({
      event: 'reveal-request',
      source,
      mediaType: current.item?.mediaType ?? null,
      controlsVisibleBefore: current.controlsVisible,
      focusedControl: getTimelineFocusedRef.current() ? 'seek' : null,
      seekPreviewActive: seekPreviewActiveRef.current,
    });
    const wasHidden = !current.controlsVisible;
    setUnifiedPlayerControlsVisible(true);
    if (wasHidden && current.item?.mediaType !== 'live') {
      logPlayerChromeFocus({
        event: 'controls-revealed',
        mediaType: current.item?.mediaType ?? null,
        focusedControl: 'play',
      });
    }
    if (seekPreviewActiveRef.current) {
      clearChromeTimer();
      return;
    }
    scheduleChromeHide();
  }, [clearChromeTimer, scheduleChromeHide]);

  const handleVodDirectionalSeek = useCallback(
    (
      direction: 1 | -1,
      source: VodDirectionalSeekSource | PlayerChromeRevealSource = 'remote-handler',
      eventKeyAction?: number | null,
    ) => {
      const current = getUnifiedPlayerState();
      const entry = resolveVodDirectionalSeekEntry({
        direction,
        controlsVisible: current.controlsVisible,
        mediaType: current.item?.mediaType,
        durationMs: current.durationMs,
        seekPreviewActive: seekPreviewActiveRef.current,
        upNextActive: Boolean(upNext),
      });
      const chromeSource: PlayerChromeRevealSource =
        source === 'hidden-focus-sentinel'
          ? 'hidden-focus-sentinel'
          : source === 'overlay-keydown'
          ? 'overlay-keydown'
          : source === 'remote-handler' || source === 'useTVEventHandler' || source === 'TVEventHandler'
            ? 'remote-handler'
            : source === 'timeline-listener'
              ? 'timeline-listener'
              : source === 'controls-listener'
                ? 'controls-focus'
                : source;

      if (entry === 'ignore') {
        return;
      }

      if (entry === 'reveal-only') {
        revealControls(current.item?.mediaType === 'live' ? 'generic-dpad' : chromeSource);
        if (current.item?.mediaType !== 'live' && (!Number.isFinite(current.durationMs) || current.durationMs <= 0)) {
          logVodSeek({
            event: 'seek-ignored',
            mediaType: current.item?.mediaType,
            contentId: current.item?.id,
            actualPositionMs: current.positionMs,
            durationMs: current.durationMs,
            direction,
            reason: 'unknown-duration',
          });
        }
        return;
      }

      if (
        !consumeVodDirectionalSeek({
          direction,
          nowMs: Date.now(),
          eventKeyAction,
          source,
        })
      ) {
        return;
      }

      logPlayerChrome({
        event: 'reveal-request',
        source: chromeSource,
        mediaType: current.item?.mediaType ?? null,
        controlsVisibleBefore: current.controlsVisible,
        focusedControl: getTimelineFocusedRef.current() ? 'seek' : null,
        seekPreviewActive: seekPreviewActiveRef.current,
      });
      setUnifiedPlayerControlsVisible(true);
      clearChromeTimer();
      beginVodDirectionalPreviewRef.current(direction);
      requestTimelineFocusRef.current();
      setPendingHiddenSeekDirection(direction);
    },
    [clearChromeTimer, revealControls, upNext],
  );

  const handleSeekPreviewActiveChange = useCallback((active: boolean) => {
    seekPreviewActiveRef.current = active;
    setSeekPreviewActive(active);
    if (active) {
      clearChromeTimer();
    }
  }, [clearChromeTimer]);

  const registerCancelSeekPreview = useCallback((cancel: () => boolean) => {
    cancelSeekPreviewRef.current = cancel;
  }, []);

  const registerHiddenVodSeekPreview = useCallback((begin: (direction: 1 | -1) => boolean) => {
    beginVodDirectionalPreviewRef.current = begin;
  }, []);

  const registerRequestTimelineFocus = useCallback((request: () => void) => {
    requestTimelineFocusRef.current = request;
  }, []);

  const registerRequestDefaultFocus = useCallback((request: () => void) => {
    requestDefaultChromeFocusRef.current = request;
  }, []);

  const registerVodSeekQuery = useCallback((query: {
    isTimelineFocused: () => boolean;
    hasTimelineHandle: () => boolean;
  }) => {
    getTimelineFocusedRef.current = query.isTimelineFocused;
    getTimelineHandlePresentRef.current = query.hasTimelineHandle;
  }, []);

  const consumePendingHiddenSeek = useCallback(() => {
    setPendingHiddenSeekDirection(null);
  }, []);

  // Keep native player callbacks pointed at the latest store state without recreating the player.
  // eslint-disable-next-line react-hooks/refs
  streamCallbacksRef.current = {
    onError: (message) => {
      const current = getUnifiedPlayerState();
      if (!current.item) {
        return;
      }
      const failureCategory = normalizePlaybackFailure(message);
      const httpStatus = extractPlaybackHttpStatus(message);
      if (
        current.item.mediaType === 'episode' &&
        autoplayCompletePendingEpisodeIdRef.current === current.item.id
      ) {
        logSeriesAutoplay({
          event: 'source-failed',
          seriesIdPresent: Boolean(current.item.seriesId),
          seasonNumber: current.item.seasonNumber,
          episodeNumber: current.item.episodeNumber,
        });
        logSeriesUpNext({
          event: 'transition-failed',
          seriesId: current.item.seriesId,
          currentEpisodeId: current.item.id,
          currentSeasonNumber: current.item.seasonNumber,
          currentEpisodeNumber: current.item.episodeNumber,
          triggerReason: 'next-source-error',
          sessionId: upNextSessionIdRef.current,
          transitionId: upNextCommittedTransitionIdRef.current ?? upNextTransitionIdRef.current,
        });
        autoplayCompletePendingEpisodeIdRef.current = null;
        episodeTransitionInFlightRef.current = false;
      }
      if (current.item.mediaType === 'movie') {
        const probe = inspectMoviePlaybackSource({
          containerExtension: current.item.containerExtension,
          videoCodec: current.item.videoCodec,
          width: current.item.videoWidth,
          height: current.item.videoHeight,
          directSource: current.item.directSourceUrl,
        });
        const decoderInitFailure = isVideoDecoderInitFailure(message);
        const movieErrorCategory = decoderInitFailure ? UNSUPPORTED_VIDEO_FORMAT_CATEGORY : failureCategory;
        const decision = resolveMovieCompatibilityErrorDecision({
          mediaType: current.item.mediaType,
          error: message,
          fallbackAttempted: movieCompatSessionRef.current.fallbackAttempted,
          primaryStreamUrl: current.item.streamUrl,
          directSourceUrl: current.item.directSourceUrl,
          probe,
        });
        if (decoderInitFailure) {
          logMoviePlaybackCompatibility({
            event: 'decoder-failure',
            codec: probe.codec,
            width: probe.width,
            height: probe.height,
            container: probe.container,
            fallbackAttempt: movieCompatSessionRef.current.fallbackAttempted ? 1 : 0,
          });
        }
        if (decision.action === 'fallback') {
          movieCompatSessionRef.current.fallbackAttempted = true;
          logMoviePlaybackCompatibility({
            event: 'fallback-source-found',
            codec: probe.codec,
            width: probe.width,
            height: probe.height,
            container: decision.source.container,
            fallbackAttempt: MAX_MOVIE_COMPATIBILITY_FALLBACK_ATTEMPTS,
          });
          logMoviePlaybackCompatibility({
            event: 'fallback-start',
            codec: probe.codec,
            width: probe.width,
            height: probe.height,
            container: decision.source.container,
            fallbackAttempt: MAX_MOVIE_COMPATIBILITY_FALLBACK_ATTEMPTS,
          });
          launchUnifiedPlayback(
            {
              ...current.item,
              streamUrl: decision.source.streamUrl,
              containerExtension: decision.source.container ?? current.item.containerExtension,
            },
            {
              launchSource: current.launchSource ?? 'play',
              contentFit: current.contentFit,
              resumePolicy: 'silent',
            },
          );
          return;
        }
        if (decision.action === 'unsupported') {
          logMoviePlaybackCompatibility({
            event: 'fallback-unavailable',
            codec: probe.codec,
            width: probe.width,
            height: probe.height,
            container: probe.container,
            fallbackAttempt: movieCompatSessionRef.current.fallbackAttempted ? 1 : 0,
          });
          logMoviePlaybackCompatibility({
            event: 'unsupported-device-format',
            codec: probe.codec,
            width: probe.width,
            height: probe.height,
            container: probe.container,
            fallbackAttempt: movieCompatSessionRef.current.fallbackAttempted ? 1 : 0,
          });
          endMoviePlaybackAttemptDiag({
            streamId: current.item.id,
            nativeStatus: 'error',
            errorCategory: UNSUPPORTED_VIDEO_FORMAT_CATEGORY,
            outcome: 'error',
          });
          playbackAnalyticsTracker.failure(message);
          setUnifiedPlayerError(UNSUPPORTED_VIDEO_FORMAT_ERROR, UNSUPPORTED_VIDEO_FORMAT_CATEGORY);
          return;
        }
        endMoviePlaybackAttemptDiag({
          streamId: current.item.id,
          nativeStatus: 'error',
          errorCategory: movieErrorCategory,
          outcome: 'error',
        });
        if (
          shouldRunMovieHttpSourceRecovery({
            mediaType: current.item.mediaType,
            httpStatus,
            decoderInitFailure,
          })
        ) {
          console.info(
            '[NovaCast Movies Playback] ' +
              JSON.stringify({
                event: 'movies_playback_http_source_error',
                failureCategory,
                ...buildSanitizedPlaybackSourceSnapshot({
                  movieId: current.item.id,
                  streamUrl: current.item.streamUrl,
                  providerId: current.item.providerId ?? null,
                  httpResponseCode: httpStatus,
                }),
              }),
          );
          const failedItem = current.item;
          void tryHomeContinueWatchingFallbackRecovery({
            movieId: failedItem.id,
            httpResponseCode: httpStatus,
            mediaType: failedItem.mediaType,
          }).then((recovered) => {
            if (!recovered || recovered.streamUrl === failedItem.streamUrl) {
              return;
            }
            launchUnifiedPlayback(
              {
                ...failedItem,
                streamUrl: recovered.streamUrl,
                containerExtension: recovered.containerExtension,
                extensionSource: 'canonical',
              },
              {
                launchSource: current.launchSource ?? 'play',
                contentFit: current.contentFit,
                resumePolicy: 'silent',
              },
            );
          });
        }
      }
      playbackAnalyticsTracker.failure(message);
      setUnifiedPlayerError(
        sanitizePlaybackErrorMessage(message, current.item.mediaType),
        current.item.mediaType === 'movie' ? failureCategory : null,
      );
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

  const vodBufferPolicy = snapshot.item?.mediaType === 'live' ? 'live' : 'vod';
  const { player, retry } = useNovaStreamPlayer(streamUrl, {
    bufferPolicy: vodBufferPolicy,
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

  const persistProgress = useCallback((positionMs: number, durationMs: number, force = false) => {
    const playerState = getUnifiedPlayerState();
    const item = playerState.item;
    if (!item?.providerId || item.mediaType === 'live') {
      return;
    }
    if (
      item.mediaType === 'movie' &&
      !shouldRecordMovieProgressAfterPlayback({
        firstFrameSeen:
          movieCompatSessionRef.current.movieId === item.id && movieCompatSessionRef.current.firstFrameSeen,
        positionMs,
        durationMs,
        errorCategory: playerState.errorCategory,
        preplayBlocked: movieCompatSessionRef.current.preplayBlocked,
      })
    ) {
      return;
    }
    const now = Date.now();
    if (!force && !shouldSaveProgress(lastProgressSaveRef.current, now)) {
      return;
    }
    lastProgressSaveRef.current = now;
    void savePlaybackProgress(
      buildProgressKey(item.providerId, item.mediaType, item.id),
      { title: item.title, positionMs, durationMs },
      item,
    );
  }, []);

  useEffect(() => {
    const episodeId = snapshot.item?.mediaType === 'episode' ? snapshot.item.id : null;
    if (!episodeId) {
      return;
    }
    if (upNextSessionIdRef.current === episodeId) {
      return;
    }
    upNextSessionIdRef.current = episodeId;
    upNextArmedForEpisodeIdRef.current = null;
    upNextDismissedForEpisodeIdRef.current = null;
    upNextTransitionIdRef.current = null;
    upNextCommittedTransitionIdRef.current = null;
    episodeTransitionInFlightRef.current = false;
    upNextHandledRef.current = null;
    seriesEndHandledForEpisodeIdRef.current = null;
    lastPlayingPositionMsRef.current = 0;
    setUpNext(null);
  }, [snapshot.item?.id, snapshot.item?.mediaType]);

  useEffect(() => {
    const item = snapshot.item;
    if (!item || item.mediaType !== 'movie') {
      if (!item) {
        movieCompatSessionRef.current.movieId = null;
        movieCompatSessionRef.current.preplayBlocked = false;
        movieCompatSessionRef.current.streamOverride = null;
      }
      return;
    }
    if (movieCompatSessionRef.current.movieId === item.id) {
      return;
    }
    movieCompatSessionRef.current = {
      movieId: item.id,
      fallbackAttempted: false,
      firstFrameSeen: false,
      preplayBlocked: false,
      streamOverride: null,
    };
    const probe = inspectMoviePlaybackSource({
      containerExtension: item.containerExtension,
      videoCodec: item.videoCodec,
      width: item.videoWidth,
      height: item.videoHeight,
      directSource: item.directSourceUrl,
    });
    logMoviePlaybackCompatibility({
      event: 'device-profile',
      displayWidth: devicePlaybackProfile.displayWidth,
      displayHeight: devicePlaybackProfile.displayHeight,
      platform: devicePlaybackProfile.platform,
      conservativePlayback: devicePlaybackProfile.conservativePlayback,
    });
    logMoviePlaybackCompatibility({
      event: 'source-inspected',
      codec: probe.codec,
      width: probe.width,
      height: probe.height,
      container: probe.container,
    });
    if (isMovieCodecRisk(probe)) {
      logMoviePlaybackCompatibility({
        event: 'codec-risk-detected',
        codec: probe.codec,
        width: probe.width,
        height: probe.height,
        container: probe.container,
      });
    }
    if (isMovieResolutionRisk(probe) && devicePlaybackProfile.conservativePlayback) {
      logMoviePlaybackCompatibility({
        event: 'resolution-risk-detected',
        codec: probe.codec,
        width: probe.width,
        height: probe.height,
        container: probe.container,
        displayWidth: devicePlaybackProfile.displayWidth,
        displayHeight: devicePlaybackProfile.displayHeight,
      });
    }
    const preplay = resolveMoviePreplayCompatibilityDecision({
      mediaType: item.mediaType,
      probe,
      profile: devicePlaybackProfile,
      primaryStreamUrl: item.streamUrl,
      directSourceUrl: item.directSourceUrl,
      fallbackAttempted: false,
    });
    if (preplay.action === 'fallback') {
      movieCompatSessionRef.current.fallbackAttempted = true;
      movieCompatSessionRef.current.streamOverride = preplay.source.streamUrl;
      logMoviePlaybackCompatibility({
        event: 'fallback-source-found',
        codec: probe.codec,
        width: probe.width,
        height: probe.height,
        container: preplay.source.container,
        fallbackAttempt: MAX_MOVIE_COMPATIBILITY_FALLBACK_ATTEMPTS,
      });
      logMoviePlaybackCompatibility({
        event: 'fallback-start',
        codec: probe.codec,
        width: probe.width,
        height: probe.height,
        container: preplay.source.container,
        fallbackAttempt: MAX_MOVIE_COMPATIBILITY_FALLBACK_ATTEMPTS,
      });
      return;
    }
    if (preplay.action === 'block') {
      movieCompatSessionRef.current.preplayBlocked = true;
      logMoviePlaybackCompatibility({
        event: 'preplay-blocked',
        codec: probe.codec,
        width: probe.width,
        height: probe.height,
        container: probe.container,
        reason: preplay.reason,
      });
      logMoviePlaybackCompatibility({
        event: 'fallback-unavailable',
        codec: probe.codec,
        width: probe.width,
        height: probe.height,
        container: probe.container,
        fallbackAttempt: 0,
      });
      logMoviePlaybackCompatibility({
        event: 'unsupported-device-format',
        codec: probe.codec,
        width: probe.width,
        height: probe.height,
        container: probe.container,
        reason: DEVICE_PERFORMANCE_RISK_REASON,
        fallbackAttempt: 0,
      });
      endMoviePlaybackAttemptDiag({
        streamId: item.id,
        nativeStatus: 'blocked',
        errorCategory: UNSUPPORTED_VIDEO_FORMAT_CATEGORY,
        outcome: 'error',
      });
      setUnifiedPlayerError(DEVICE_PERFORMANCE_RISK_ERROR, UNSUPPORTED_VIDEO_FORMAT_CATEGORY);
    }
  }, [devicePlaybackProfile, snapshot.item, snapshot.item?.id, snapshot.item?.mediaType]);

  const handleFirstFrameRender = useCallback(() => {
    const current = getUnifiedPlayerState();
    if (!isUnifiedPlaybackActive(current.machineState, current.item)) {
      return;
    }

    if (current.item?.mediaType === 'movie') {
      movieCompatSessionRef.current.firstFrameSeen = true;
      if (movieCompatSessionRef.current.fallbackAttempted) {
        const probe = inspectMoviePlaybackSource({
          containerExtension: current.item.containerExtension,
          videoCodec: current.item.videoCodec,
          width: current.item.videoWidth,
          height: current.item.videoHeight,
          directSource: current.item.directSourceUrl,
        });
        logMoviePlaybackCompatibility({
          event: 'fallback-success',
          codec: probe.codec,
          width: probe.width,
          height: probe.height,
          container: probe.container,
          fallbackAttempt: MAX_MOVIE_COMPATIBILITY_FALLBACK_ATTEMPTS,
        });
      }
      endMoviePlaybackAttemptDiag({
        streamId: current.item.id,
        nativeStatus: 'readyToPlay',
        outcome: 'started',
      });
      noteMoviePlaybackStarted(current.item.id);
    }
    if (current.item?.mediaType === 'episode') {
      if (autoplayCompletePendingEpisodeIdRef.current === current.item.id) {
        logSeriesAutoplay({
          event: 'autoplay-complete',
          seriesIdPresent: Boolean(current.item.seriesId),
          seasonNumber: current.item.seasonNumber,
          episodeNumber: current.item.episodeNumber,
        });
        autoplayCompletePendingEpisodeIdRef.current = null;
      }
      logSeriesUpNext({
        event: 'next-player-ready',
        seriesId: current.item.seriesId,
        currentEpisodeId: current.item.id,
        currentSeasonNumber: current.item.seasonNumber,
        currentEpisodeNumber: current.item.episodeNumber,
        sessionId: upNextSessionIdRef.current,
        transitionId: upNextCommittedTransitionIdRef.current ?? upNextTransitionIdRef.current,
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
      if (snapshot.item?.mediaType === 'movie') {
        noteMoviePlaybackFailed(snapshot.errorMessage ?? 'player-error', snapshot.item.id);
      }
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

  const previousPlaybackChromeRef = useRef<{
    playbackActive: boolean;
    machineState: typeof snapshot.machineState;
    isPlaying: boolean;
    itemId: string | null;
  }>({
    playbackActive: false,
    machineState: snapshot.machineState,
    isPlaying: false,
    itemId: null,
  });

  useEffect(() => {
    if (!playbackActive) {
      clearChromeTimer();
      resumeAppliedRef.current = null;
      previousPlaybackChromeRef.current = {
        playbackActive: false,
        machineState: snapshot.machineState,
        isPlaying: snapshot.isPlaying,
        itemId: snapshot.item?.id ?? null,
      };
      return;
    }

    const previous = previousPlaybackChromeRef.current;
    const shouldReveal = shouldRevealChromeFromPlaybackState({
      playbackActive: true,
      previousPlaybackActive: previous.playbackActive,
      machineState: snapshot.machineState,
      previousMachineState: previous.machineState,
      isPlaying: snapshot.isPlaying,
      previousIsPlaying: previous.isPlaying,
      itemId: snapshot.item?.id ?? null,
      previousItemId: previous.itemId,
    });
    previousPlaybackChromeRef.current = {
      playbackActive: true,
      machineState: snapshot.machineState,
      isPlaying: snapshot.isPlaying,
      itemId: snapshot.item?.id ?? null,
    };

    if (!shouldReveal) {
      return;
    }

    logPlayerChrome({
      event: 'reveal-request',
      source: 'playback-state',
      mediaType: snapshot.item?.mediaType ?? null,
      controlsVisibleBefore: getUnifiedPlayerState().controlsVisible,
      focusedControl: null,
      seekPreviewActive: seekPreviewActiveRef.current,
    });
    setUnifiedPlayerControlsVisible(true);
  }, [
    clearChromeTimer,
    playbackActive,
    snapshot.isPlaying,
    snapshot.item?.id,
    snapshot.item?.mediaType,
    snapshot.machineState,
  ]);

  useEffect(() => {
    if (!playbackActive || !snapshot.controlsVisible) {
      return;
    }
    if (seekPreviewActive) {
      clearChromeTimer();
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
    seekPreviewActive,
    snapshot.controlsVisible,
    snapshot.machineState,
  ]);

  useEffect(() => {
    const item = snapshot.item;
    if (!item || item.mediaType === 'live') {
      return;
    }

    const resumeKey = `${item.providerId ?? 'none'}:${item.mediaType}:${item.id}:${item.resumePositionMs ?? 0}`;
    if (resumeAppliedRef.current === resumeKey) {
      return;
    }
    if ((item.resumePositionMs ?? 0) <= 0) {
      resumeAppliedRef.current = resumeKey;
      return;
    }
    if (snapshot.machineState === 'loading' || snapshot.durationMs <= 0) {
      return;
    }

    resumeAppliedRef.current = resumeKey;
    applyNativeSeek(item.resumePositionMs ?? 0, 'resume');
  }, [applyNativeSeek, snapshot.durationMs, snapshot.item, snapshot.machineState]);

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

    const livePositionMs = secondsToMs(player.currentTime);
    const liveDurationMs = secondsToMs(player.duration) || current.durationMs;

    if (current.item?.mediaType === 'episode' && status === 'idle') {
      const ended = resolveSeriesAutoplayDecision({
        mediaType: current.item.mediaType,
        remainingMs: remainingPlaybackMs(livePositionMs, liveDurationMs),
        durationMs: liveDurationMs,
        positionMs: livePositionMs,
        nextEpisodePresent: Boolean(pickPlayableNextEpisode(getSeriesAutoplayQueue(current.item)).next),
        alreadyArmed: upNextArmedForEpisodeIdRef.current === current.item.id,
        dismissedForSession: upNextDismissedForEpisodeIdRef.current === current.item.id,
        seekPreviewActive: seekPreviewActiveRef.current,
        autoplayEnabled: getAppSettingsSync().autoplayNextEpisode,
        transitionInFlight: episodeTransitionInFlightRef.current,
        machineState: current.machineState,
        playerStatus: status,
        lastPlayingPositionMs: lastPlayingPositionMsRef.current,
      });
      if (ended.action === 'autoplay' || ended.action === 'close' || ended.action === 'arm') {
        if (liveDurationMs > 0) {
          setUnifiedPlayerProgress(Math.min(livePositionMs, liveDurationMs), liveDurationMs);
        }
        applySeriesAutoplayDecisionRef.current(ended, current.item, livePositionMs, liveDurationMs);
        return;
      }
    }

    const nextState = mapPlayerStatusToMachineState(status, player.playing);
    if (current.machineState !== 'error' && current.machineState !== 'closing') {
      setUnifiedPlayerMachineState(nextState);
    }
    if (liveDurationMs > 0) {
      setUnifiedPlayerProgress(
        Math.min(livePositionMs, liveDurationMs),
        liveDurationMs,
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
      if (current.item?.mediaType === 'movie') {
        noteMoviePlaybackStarted(current.item.id);
      }
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

    persistProgress(positionMs, durationMs);

    const item = current.item;
    if (item?.mediaType === 'episode') {
      if (player.playing) {
        lastPlayingPositionMsRef.current = positionMs;
      }
      const playable = pickPlayableNextEpisode(getSeriesAutoplayQueue(item));
      const nextEpisodePresent = Boolean(playable.next);
      const remainingMs = remainingPlaybackMs(positionMs, durationMs);
      const alreadyArmed = upNextArmedForEpisodeIdRef.current === item.id;
      const dismissedForSession = upNextDismissedForEpisodeIdRef.current === item.id;
      const decision = resolveSeriesAutoplayDecision({
        mediaType: item.mediaType,
        remainingMs,
        durationMs,
        positionMs,
        nextEpisodePresent,
        alreadyArmed,
        dismissedForSession,
        seekPreviewActive: seekPreviewActiveRef.current,
        autoplayEnabled: getAppSettingsSync().autoplayNextEpisode,
        transitionInFlight: episodeTransitionInFlightRef.current,
        machineState: current.machineState,
        lastPlayingPositionMs: lastPlayingPositionMsRef.current,
      });
      applySeriesAutoplayDecisionRef.current(decision, item, positionMs, durationMs);
    }
  }, [persistProgress, player, setUpNext]);

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
    const nextPlaying = !snapshot.isPlaying;
    if (snapshot.isPlaying && !nextPlaying) {
      persistProgress(snapshot.positionMs, snapshot.durationMs, true);
    }
    setUnifiedPlayerPlaying(nextPlaying);
    revealControls('play-toggle');
  }, [persistProgress, revealControls, snapshot.durationMs, snapshot.isPlaying, snapshot.positionMs]);

    const handleRewind = useCallback(() => {
    const current = getUnifiedPlayerState();
    applyNativeSeek(current.positionMs - SEEK_BACK_MS, 'rewind');
    revealControls('rewind-button');
  }, [applyNativeSeek, revealControls]);


    const handleForward = useCallback(() => {
    const current = getUnifiedPlayerState();
    applyNativeSeek(current.positionMs + SEEK_FORWARD_MS, 'forward');
    revealControls('forward-button');
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
      persistProgress(pendingMs, getUnifiedPlayerState().durationMs, true);
      const item = getUnifiedPlayerState().item;
      logVodSeek({
        event: 'seek-progress-saved',
        mediaType: item?.mediaType,
        contentId: item?.id,
        actualPositionMs: pendingMs,
        previewPositionMs: pendingMs,
        durationMs: getUnifiedPlayerState().durationMs,
      });
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
  }, [applyNativeSeek, persistProgress]);

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
      const remainingMs = remainingPlaybackMs(clampedNextMs, snapshot.durationMs);
      if (
        shouldResetSeriesUpNextAfterCommittedSeek({
          mediaType: snapshot.item?.mediaType,
          remainingMs,
          upNextVisible: Boolean(upNext),
          alreadyArmed: upNextArmedForEpisodeIdRef.current === snapshot.item?.id,
        })
      ) {
        upNextArmedForEpisodeIdRef.current = null;
        setUpNext(null);
      }
      const queue = seekQueueRef.current;
      queue.pendingMs = clampedNextMs;

      if (queue.inFlight) {
        revealControls('handle-seek');
        return;
      }

      queue.inFlight = true;
      queue.flushTimer = setTimeout(flushSeek, UNIFIED_SEEK_FLUSH_DEBOUNCE_MS);
      revealControls('handle-seek');
    },
    [flushSeek, revealControls, setUpNext, snapshot.durationMs, snapshot.item?.id, snapshot.item?.mediaType, upNext],
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
    if (cancelSeekPreviewRef.current()) {
      revealControls('handle-back');
      return;
    }
    if (upNext) {
      upNextDismissedForEpisodeIdRef.current = snapshot.item?.id ?? upNextDismissedForEpisodeIdRef.current;
      logSeriesAutoplay({
        event: 'cancelled',
        seriesIdPresent: Boolean(snapshot.item?.seriesId),
        seasonNumber: snapshot.item?.seasonNumber,
        episodeNumber: snapshot.item?.episodeNumber,
        nextSeasonNumber: snapshot.item?.nextEpisode?.seasonNumber,
        nextEpisodeNumber: snapshot.item?.nextEpisode?.episodeNumber,
        countdownSeconds: upNext.secondsLeft,
      });
      logSeriesUpNext({
        event: 'cancelled',
        seriesId: snapshot.item?.seriesId,
        currentEpisodeId: snapshot.item?.id,
        currentSeasonNumber: snapshot.item?.seasonNumber,
        currentEpisodeNumber: snapshot.item?.episodeNumber,
        nextEpisodeId: snapshot.item?.nextEpisode?.id,
        nextSeasonNumber: snapshot.item?.nextEpisode?.seasonNumber,
        nextEpisodeNumber: snapshot.item?.nextEpisode?.episodeNumber,
        remainingSeconds: upNext.secondsLeft,
        triggerReason: 'back',
        sessionId: upNextSessionIdRef.current,
        transitionId: upNextTransitionIdRef.current,
      });
      setUpNext(null);
      logSeriesAutoplayFocus({ event: 'focus-restored', focusedControl: null });
      return;
    }
    const item = snapshot.item;
    if (item?.providerId && item.mediaType !== 'live') {
      persistProgress(snapshot.positionMs, snapshot.durationMs, true);
    }
    closeUnifiedPlayback();
  }, [persistProgress, revealControls, setUpNext, snapshot.durationMs, snapshot.item, snapshot.positionMs, upNext]);

  useEffect(() => {
    if (Platform.OS !== 'android' || (!playbackActive && snapshot.machineState !== 'closing')) {
      return;
    }

    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      wrapOnnMoviesBackHandler(
        'unified-player',
        () => {
          if (snapshot.machineState === 'closing') {
            return true;
          }

          handleBack();
          return true;
        },
        () => ({
          screen: 'UnifiedPlayerController',
          machineState: snapshot.machineState,
          playbackActive,
        }),
      ),
    );

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

    const current = getUnifiedPlayerState();
    if (!shouldRetryMovieUnsupportedFormat(current.errorCategory)) {
      return;
    }

    lastPlaybackRetryAtRef.current = now;
    playbackRetryAttemptedRef.current = true;
    if (current.item) playbackAnalyticsTracker.request(current.item, current.launchSource, true);
    clearUnifiedPlayerError();
    retry();
    revealControls('retry');
  }, [retry, revealControls]);

  useEffect(() => {
    if (snapshot.machineState === 'error') {
      logPlayerChrome({
        event: 'reveal-request',
        source: 'error-state',
        mediaType: snapshot.item?.mediaType ?? null,
        controlsVisibleBefore: getUnifiedPlayerState().controlsVisible,
        focusedControl: null,
        seekPreviewActive: seekPreviewActiveRef.current,
      });
      setUnifiedPlayerControlsVisible(true);
    }
  }, [snapshot.item?.mediaType, snapshot.machineState]);

  useEffect(() => {
    if (!playbackActive && snapshot.machineState === 'error') {
      clearUnifiedPlayerError();
    }
  }, [playbackActive, snapshot.machineState]);

  useEffect(() => {
    const spec = playbackActive
      ? resolveUnifiedPlaybackNotification(
          snapshot.machineState,
          playbackRetryAttemptedRef.current,
          snapshot.errorCategory,
        )
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
  }, [dismissNotification, playbackActive, showNotification, snapshot.errorCategory, snapshot.machineState]);

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

  const playNextEpisode = useCallback(async (reason: 'play-now' | 'auto-triggered' = 'play-now') => {
    const currentState = getUnifiedPlayerState();
    const current = currentState.item;
    const queue = current ? getSeriesAutoplayQueue(current) : [];
    const picked = pickPlayableNextEpisode(queue);
    const nextItem = picked.next;
    const remaining = picked.remaining;
    if (!upNextTransitionIdRef.current && current?.id) {
      upNextTransitionIdRef.current = createSeriesUpNextTransitionId(
        current.id,
        upNextSessionIdRef.current ?? current.id,
      );
    }
    const transitionId = upNextTransitionIdRef.current;
    if (
      !shouldCommitSeriesUpNextTransition({
        transitionId,
        committedTransitionId: upNextCommittedTransitionIdRef.current,
        nextStreamUrlPresent: Boolean(nextItem?.streamUrl),
      })
    ) {
      if (current?.mediaType === 'episode' && queue.length > 0 && !nextItem?.streamUrl) {
        logSeriesAutoplay({
          event: 'source-failed',
          seriesIdPresent: Boolean(current.seriesId),
          seasonNumber: current.seasonNumber,
          episodeNumber: current.episodeNumber,
          nextSeasonNumber: queue[0]?.seasonNumber,
          nextEpisodeNumber: queue[0]?.episodeNumber,
        });
        logSeriesUpNext({
          event: 'transition-failed',
          seriesId: current.seriesId,
          currentEpisodeId: current.id,
          currentSeasonNumber: current.seasonNumber,
          currentEpisodeNumber: current.episodeNumber,
          nextEpisodeId: queue[0]?.id,
          nextSeasonNumber: queue[0]?.seasonNumber,
          nextEpisodeNumber: queue[0]?.episodeNumber,
          triggerReason: 'missing-next-source',
          sessionId: upNextSessionIdRef.current,
          transitionId,
        });
        upNextDismissedForEpisodeIdRef.current = current.id;
        setUpNext(null);
        showNotification({
          id: PLAYBACK_NOTIFICATION_ID,
          type: 'error',
          title: 'Next episode unavailable',
          message: 'This episode could not start. The current episode will continue.',
          duration: PLAYBACK_NOTIFICATION_DURATION_MS,
          position: 'bottom-right',
          scope: 'playback',
        });
      }
      return;
    }

    if (!current?.providerId || !nextItem?.streamUrl) {
      return;
    }

    upNextCommittedTransitionIdRef.current = transitionId;
    episodeTransitionInFlightRef.current = true;
    logSeriesAutoplay({
      event: reason === 'play-now' ? 'play-now' : 'autoplay-start',
      seriesIdPresent: Boolean(current.seriesId),
      seasonNumber: current.seasonNumber,
      episodeNumber: current.episodeNumber,
      nextSeasonNumber: nextItem.seasonNumber,
      nextEpisodeNumber: nextItem.episodeNumber,
      countdownSeconds: reason === 'play-now' ? undefined : 0,
    });
    logSeriesUpNext({
      event: reason,
      seriesId: current.seriesId,
      currentEpisodeId: current.id,
      currentSeasonNumber: current.seasonNumber,
      currentEpisodeNumber: current.episodeNumber,
      nextEpisodeId: nextItem.id,
      nextSeasonNumber: nextItem.seasonNumber,
      nextEpisodeNumber: nextItem.episodeNumber,
      remainingSeconds: 0,
      triggerReason: reason,
      sessionId: upNextSessionIdRef.current,
      transitionId,
    });
    logSeriesUpNext({
      event: 'transition-start',
      seriesId: current.seriesId,
      currentEpisodeId: current.id,
      currentSeasonNumber: current.seasonNumber,
      currentEpisodeNumber: current.episodeNumber,
      nextEpisodeId: nextItem.id,
      nextSeasonNumber: nextItem.seasonNumber,
      nextEpisodeNumber: nextItem.episodeNumber,
      sessionId: upNextSessionIdRef.current,
      transitionId,
    });

    const completeMs =
      currentState.durationMs > 0 ? currentState.durationMs : Math.max(currentState.positionMs, 1);
    await savePlaybackProgress(
      buildProgressKey(current.providerId, 'episode', current.id),
      { title: current.title, positionMs: completeMs, durationMs: completeMs },
      current,
    );
    logSeriesUpNext({
      event: 'current-completion-saved',
      seriesId: current.seriesId,
      currentEpisodeId: current.id,
      currentSeasonNumber: current.seasonNumber,
      currentEpisodeNumber: current.episodeNumber,
      nextEpisodeId: nextItem.id,
      sessionId: upNextSessionIdRef.current,
      transitionId,
    });

    try {
      await handoffSeriesContinueWatchingToNextEpisode({
        providerId: current.providerId,
        seriesId: nextItem.seriesId,
        seasonNumber: nextItem.seasonNumber,
        episodeNumber: nextItem.episodeNumber,
        episodeId: nextItem.id,
        title: nextItem.title,
        seriesTitle: current.subtitle,
        artworkUrl: current.artworkUrl,
      });
    } catch {
      // Continue watching handoff must not block a resolved next source.
    }

    logSeriesUpNext({
      event: 'next-source-resolved',
      seriesId: current.seriesId,
      currentEpisodeId: current.id,
      nextEpisodeId: nextItem.id,
      nextSeasonNumber: nextItem.seasonNumber,
      nextEpisodeNumber: nextItem.episodeNumber,
      triggerReason: 'prebuilt-series-source',
      sessionId: upNextSessionIdRef.current,
      transitionId,
    });

    setUpNext(null);
    const closeCallback = getUnifiedPlayerCloseCallback();
    launchUnifiedPlayback(
      {
        id: nextItem.id,
        mediaType: 'episode',
        title: nextItem.title,
        subtitle: current.subtitle,
        streamUrl: nextItem.streamUrl,
        artworkUrl: current.artworkUrl,
        isLive: false,
        providerId: current.providerId,
        resumePositionMs: 0,
        seriesId: nextItem.seriesId,
        seasonNumber: nextItem.seasonNumber,
        episodeNumber: nextItem.episodeNumber,
        episodeId: nextItem.id,
        nextEpisode: remaining[0],
        upcomingEpisodes: remaining.length ? remaining : undefined,
        previousEpisode: toEpisodeRefFromPlaybackItem(current) ?? undefined,
        previousEpisodes: [
          ...(toEpisodeRefFromPlaybackItem(current) ? [toEpisodeRefFromPlaybackItem(current)!] : []),
          ...(current.previousEpisodes ?? []),
        ],
      },
      {
        launchSource: currentState.launchSource ?? 'episode',
        contentFit: currentState.contentFit,
        onClose: closeCallback ?? undefined,
      },
    );
    logSeriesUpNext({
      event: 'next-session-created',
      seriesId: nextItem.seriesId,
      currentEpisodeId: current.id,
      nextEpisodeId: nextItem.id,
      nextSeasonNumber: nextItem.seasonNumber,
      nextEpisodeNumber: nextItem.episodeNumber,
      sessionId: nextItem.id,
      transitionId,
    });
    autoplayCompletePendingEpisodeIdRef.current = nextItem.id;
  }, [setUpNext, showNotification]);

  const handleManualEpisodeNavigation = useCallback(
    async (direction: 1 | -1) => {
      const currentState = getUnifiedPlayerState();
      const current = currentState.item;
      const eventName = direction < 0 ? 'previous-request' : 'next-request';
      logEpisodeNavigation({
        event: eventName,
        seriesId: current?.seriesId,
        fromEpisodeId: current?.id,
        fromSeason: current?.seasonNumber,
        fromEpisode: current?.episodeNumber,
        direction,
      });

      if (!current || current.mediaType !== 'episode') {
        return;
      }

      if (episodeTransitionInFlightRef.current) {
        logEpisodeNavigation({
          event: 'duplicate-transition-blocked',
          seriesId: current.seriesId,
          fromEpisodeId: current.id,
          direction,
          transitionId: upNextCommittedTransitionIdRef.current,
        });
        return;
      }

      const target =
        direction < 0
          ? current.previousEpisodes?.[0] ?? current.previousEpisode ?? null
          : current.upcomingEpisodes?.[0] ?? current.nextEpisode ?? null;

      if (!target) {
        logEpisodeNavigation({
          event: 'boundary-noop',
          seriesId: current.seriesId,
          fromEpisodeId: current.id,
          fromSeason: current.seasonNumber,
          fromEpisode: current.episodeNumber,
          direction,
        });
        return;
      }

      logEpisodeNavigation({
        event: 'target-resolved',
        seriesId: current.seriesId,
        fromEpisodeId: current.id,
        toEpisodeId: target.id,
        fromSeason: current.seasonNumber,
        fromEpisode: current.episodeNumber,
        toSeason: target.seasonNumber,
        toEpisode: target.episodeNumber,
        direction,
      });

      if (!target.streamUrl || !current.providerId) {
        logEpisodeNavigation({
          event: 'transition-failed',
          seriesId: current.seriesId,
          fromEpisodeId: current.id,
          toEpisodeId: target.id,
          direction,
        });
        showNotification({
          id: PLAYBACK_NOTIFICATION_ID,
          type: 'error',
          title: direction < 0 ? 'Previous episode unavailable' : 'Next episode unavailable',
          message: 'This episode could not start. The current episode will continue.',
          duration: PLAYBACK_NOTIFICATION_DURATION_MS,
          position: 'bottom-right',
          scope: 'playback',
        });
        return;
      }

      const transitionId = createEpisodeNavigationTransitionId(current.id, target.id, direction);
      episodeTransitionInFlightRef.current = true;
      if (upNextTransitionIdRef.current) {
        upNextCommittedTransitionIdRef.current = upNextTransitionIdRef.current;
      }
      setUpNext(null);

      persistProgress(currentState.positionMs, currentState.durationMs, true);
      logEpisodeNavigation({
        event: 'current-progress-saved',
        seriesId: current.seriesId,
        fromEpisodeId: current.id,
        toEpisodeId: target.id,
        direction,
        transitionId,
      });

      try {
        await handoffSeriesContinueWatchingToNextEpisode({
          providerId: current.providerId,
          seriesId: target.seriesId,
          seasonNumber: target.seasonNumber,
          episodeNumber: target.episodeNumber,
          episodeId: target.id,
          title: target.title,
          seriesTitle: current.subtitle,
          artworkUrl: current.artworkUrl,
        });
      } catch {
        // Continue watching handoff must not block a resolved next source.
      }

      logEpisodeNavigation({
        event: 'source-resolved',
        seriesId: current.seriesId,
        fromEpisodeId: current.id,
        toEpisodeId: target.id,
        toSeason: target.seasonNumber,
        toEpisode: target.episodeNumber,
        direction,
        transitionId,
      });
      logEpisodeNavigation({
        event: 'transition-start',
        seriesId: current.seriesId,
        fromEpisodeId: current.id,
        toEpisodeId: target.id,
        direction,
        transitionId,
      });

      const currentRef = toEpisodeRefFromPlaybackItem(current);
      const remainingUpcoming =
        direction > 0 ? current.upcomingEpisodes?.slice(1) ?? [] : currentRef ? [currentRef, ...(current.upcomingEpisodes ?? [])] : current.upcomingEpisodes ?? [];
      const remainingPrevious =
        direction < 0 ? current.previousEpisodes?.slice(1) ?? [] : currentRef ? [currentRef, ...(current.previousEpisodes ?? [])] : current.previousEpisodes ?? [];

      try {
        const closeCallback = getUnifiedPlayerCloseCallback();
        launchUnifiedPlayback(
          {
            id: target.id,
            mediaType: 'episode',
            title: target.title,
            subtitle: current.subtitle,
            streamUrl: target.streamUrl,
            artworkUrl: current.artworkUrl,
            isLive: false,
            providerId: current.providerId,
            resumePositionMs: 0,
            seriesId: target.seriesId,
            seasonNumber: target.seasonNumber,
            episodeNumber: target.episodeNumber,
            episodeId: target.id,
            nextEpisode: remainingUpcoming[0],
            upcomingEpisodes: remainingUpcoming.length ? remainingUpcoming : undefined,
            previousEpisode: remainingPrevious[0],
            previousEpisodes: remainingPrevious.length ? remainingPrevious : undefined,
          },
          {
            launchSource: currentState.launchSource ?? 'episode',
            contentFit: currentState.contentFit,
            onClose: closeCallback ?? undefined,
            resumePolicy: 'start',
          },
        );
        logEpisodeNavigation({
          event: 'transition-complete',
          seriesId: target.seriesId,
          fromEpisodeId: current.id,
          toEpisodeId: target.id,
          toSeason: target.seasonNumber,
          toEpisode: target.episodeNumber,
          direction,
          transitionId,
        });
      } catch {
        episodeTransitionInFlightRef.current = false;
        logEpisodeNavigation({
          event: 'transition-failed',
          seriesId: current.seriesId,
          fromEpisodeId: current.id,
          toEpisodeId: target.id,
          direction,
          transitionId,
        });
        showNotification({
          id: PLAYBACK_NOTIFICATION_ID,
          type: 'error',
          title: direction < 0 ? 'Previous episode unavailable' : 'Next episode unavailable',
          message: 'This episode could not start. The current episode will continue.',
          duration: PLAYBACK_NOTIFICATION_DURATION_MS,
          position: 'bottom-right',
          scope: 'playback',
        });
      }
    },
    [persistProgress, setUpNext, showNotification],
  );

  const handlePreviousEpisode = useCallback(() => {
    void handleManualEpisodeNavigation(-1);
  }, [handleManualEpisodeNavigation]);

  const handleNextEpisode = useCallback(() => {
    void handleManualEpisodeNavigation(1);
  }, [handleManualEpisodeNavigation]);

  const cancelUpNext = useCallback(() => {
    const current = getUnifiedPlayerState().item;
    if (current?.id) {
      upNextDismissedForEpisodeIdRef.current = current.id;
    }
    logSeriesAutoplay({
      event: 'cancelled',
      seriesIdPresent: Boolean(current?.seriesId),
      seasonNumber: current?.seasonNumber,
      episodeNumber: current?.episodeNumber,
      nextSeasonNumber: current?.nextEpisode?.seasonNumber,
      nextEpisodeNumber: current?.nextEpisode?.episodeNumber,
    });
    logSeriesUpNext({
      event: 'cancelled',
      seriesId: current?.seriesId,
      currentEpisodeId: current?.id,
      currentSeasonNumber: current?.seasonNumber,
      currentEpisodeNumber: current?.episodeNumber,
      nextEpisodeId: current?.nextEpisode?.id,
      nextSeasonNumber: current?.nextEpisode?.seasonNumber,
      nextEpisodeNumber: current?.nextEpisode?.episodeNumber,
      triggerReason: 'cancel-button',
      sessionId: upNextSessionIdRef.current,
      transitionId: upNextTransitionIdRef.current,
    });
    setUpNext(null);
    logSeriesAutoplayFocus({ event: 'focus-restored', focusedControl: null });
  }, [setUpNext]);

  applySeriesAutoplayDecisionRef.current = (decision, item, positionMs, durationMs) => {
    const remainingMs = remainingPlaybackMs(positionMs, durationMs);
    const playable = pickPlayableNextEpisode(getSeriesAutoplayQueue(item));
    const next = playable.next;

    if (decision.action === 'arm') {
      const shouldArm = shouldArmSeriesUpNext({
        mediaType: item.mediaType,
        remainingMs,
        durationMs,
        nextEpisodePresent: Boolean(next),
        alreadyArmed: upNextArmedForEpisodeIdRef.current === item.id,
        dismissedForSession: upNextDismissedForEpisodeIdRef.current === item.id,
        seekPreviewActive: seekPreviewActiveRef.current,
      });
      if (!shouldArm) {
        return;
      }
      const transitionId = createSeriesUpNextTransitionId(item.id, upNextSessionIdRef.current ?? item.id);
      upNextArmedForEpisodeIdRef.current = item.id;
      upNextHandledRef.current = item.id;
      upNextTransitionIdRef.current = transitionId;
      const remainingSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
      logSeriesAutoplay({
        event: 'completion-detected',
        seriesIdPresent: Boolean(item.seriesId),
        seasonNumber: item.seasonNumber,
        episodeNumber: item.episodeNumber,
        nextSeasonNumber: next?.seasonNumber,
        nextEpisodeNumber: next?.episodeNumber,
        countdownSeconds: UP_NEXT_COUNTDOWN_SECONDS,
      });
      logSeriesAutoplay({
        event: 'next-episode-resolved',
        seriesIdPresent: Boolean(item.seriesId),
        seasonNumber: item.seasonNumber,
        episodeNumber: item.episodeNumber,
        nextSeasonNumber: next?.seasonNumber,
        nextEpisodeNumber: next?.episodeNumber,
      });
      logSeriesUpNext({
        event: 'candidate-resolved',
        seriesId: item.seriesId,
        currentEpisodeId: item.id,
        currentSeasonNumber: item.seasonNumber,
        currentEpisodeNumber: item.episodeNumber,
        nextEpisodeId: next?.id,
        nextSeasonNumber: next?.seasonNumber,
        nextEpisodeNumber: next?.episodeNumber,
        remainingSeconds,
        triggerReason: 'remaining-threshold',
        sessionId: upNextSessionIdRef.current,
        transitionId,
      });
      logSeriesUpNext({
        event: 'armed',
        seriesId: item.seriesId,
        currentEpisodeId: item.id,
        currentSeasonNumber: item.seasonNumber,
        currentEpisodeNumber: item.episodeNumber,
        nextEpisodeId: next?.id,
        nextSeasonNumber: next?.seasonNumber,
        nextEpisodeNumber: next?.episodeNumber,
        remainingSeconds: UP_NEXT_COUNTDOWN_SECONDS,
        triggerReason: 'remaining-threshold',
        sessionId: upNextSessionIdRef.current,
        transitionId,
      });
      setUpNext({
        secondsLeft: UP_NEXT_COUNTDOWN_SECONDS,
        title: next?.title ?? '',
        seasonNumber: next?.seasonNumber,
        episodeNumber: next?.episodeNumber,
        autoplay: getAppSettingsSync().autoplayNextEpisode,
      });
      logSeriesAutoplay({
        event: 'countdown-shown',
        seriesIdPresent: Boolean(item.seriesId),
        seasonNumber: item.seasonNumber,
        episodeNumber: item.episodeNumber,
        nextSeasonNumber: next?.seasonNumber,
        nextEpisodeNumber: next?.episodeNumber,
        countdownSeconds: UP_NEXT_COUNTDOWN_SECONDS,
      });
      logSeriesUpNext({
        event: 'countdown-started',
        seriesId: item.seriesId,
        currentEpisodeId: item.id,
        currentSeasonNumber: item.seasonNumber,
        currentEpisodeNumber: item.episodeNumber,
        nextEpisodeId: next?.id,
        nextSeasonNumber: next?.seasonNumber,
        nextEpisodeNumber: next?.episodeNumber,
        remainingSeconds: UP_NEXT_COUNTDOWN_SECONDS,
        sessionId: upNextSessionIdRef.current,
        transitionId,
      });
      return;
    }

    if (decision.action === 'autoplay') {
      if (seriesEndHandledForEpisodeIdRef.current === item.id) {
        return;
      }
      seriesEndHandledForEpisodeIdRef.current = item.id;
      logSeriesAutoplay({
        event: 'completion-detected',
        seriesIdPresent: Boolean(item.seriesId),
        seasonNumber: item.seasonNumber,
        episodeNumber: item.episodeNumber,
        nextSeasonNumber: next?.seasonNumber,
        nextEpisodeNumber: next?.episodeNumber,
        countdownSeconds: 0,
      });
      void playNextEpisode('auto-triggered');
      return;
    }

    if (decision.action === 'close') {
      if (seriesEndHandledForEpisodeIdRef.current === item.id) {
        return;
      }
      const dismissedForSession = upNextDismissedForEpisodeIdRef.current === item.id;
      if (
        !shouldCloseSeriesEpisodeWithoutUpNext({
          nextEpisodePresent: Boolean(next),
          dismissedForSession,
          naturallyFinished: true,
          upNextVisible: upNextArmedForEpisodeIdRef.current === item.id && !dismissedForSession,
          autoplayEnabled: getAppSettingsSync().autoplayNextEpisode,
        })
      ) {
        return;
      }
      seriesEndHandledForEpisodeIdRef.current = item.id;
      if (decision.reason === 'no-next-episode' || !next) {
        logSeriesAutoplay({
          event: 'no-next-episode',
          seriesIdPresent: Boolean(item.seriesId),
          seasonNumber: item.seasonNumber,
          episodeNumber: item.episodeNumber,
        });
        logSeriesUpNext({
          event: 'no-next-episode',
          seriesId: item.seriesId,
          currentEpisodeId: item.id,
          currentSeasonNumber: item.seasonNumber,
          currentEpisodeNumber: item.episodeNumber,
          remainingSeconds: Math.max(0, Math.ceil(remainingMs / 1000)),
          sessionId: upNextSessionIdRef.current,
        });
      }
      persistProgress(durationMs, durationMs, true);
      closeUnifiedPlayback();
    }
  };

  const upNextActive = Boolean(upNext);
  useEffect(() => {
    if (!upNextActive) {
      return;
    }
    const timer = setInterval(() => {
      setUpNext((current) => {
        if (!current || !current.autoplay) {
          return current;
        }
        logSeriesAutoplay({
          event: 'countdown-tick',
          seriesIdPresent: Boolean(getUnifiedPlayerState().item?.seriesId),
          seasonNumber: getUnifiedPlayerState().item?.seasonNumber,
          episodeNumber: getUnifiedPlayerState().item?.episodeNumber,
          countdownSeconds: Math.max(0, current.secondsLeft - 1),
        });
        logSeriesUpNext({
          event: 'countdown-tick',
          remainingSeconds: Math.max(0, current.secondsLeft - 1),
          sessionId: upNextSessionIdRef.current,
          transitionId: upNextTransitionIdRef.current,
        });
        if (current.secondsLeft <= 1) {
          setTimeout(() => {
            void playNextEpisode('auto-triggered');
          }, 0);
          return null;
        }
        return { ...current, secondsLeft: current.secondsLeft - 1 };
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [playNextEpisode, setUpNext, upNextActive]);

  if (!playbackActive && snapshot.machineState !== 'closing') {
    return null;
  }

  return (
    <>
      <UnifiedRemoteDebugListeners enabled={playbackActive || snapshot.machineState === 'closing'} />
      <UnifiedPlayerRemoteHandlers
        enabled={playbackActive && !upNext}
        controlsVisible={snapshot.controlsVisible}
        mediaType={snapshot.item?.mediaType}
        upNextActive={Boolean(upNext)}
        onTogglePlay={handleTogglePlay}
        onRevealControls={revealControls}
        onRequestDefaultFocus={() => requestDefaultChromeFocusRef.current()}
        getSeekPreviewActive={() => seekPreviewActiveRef.current}
        getTimelineFocused={() => getTimelineFocusedRef.current()}
        getTimelineHandlePresent={() => getTimelineHandlePresentRef.current()}
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
      pendingSeekDirection={pendingHiddenSeekDirection}
      onPendingSeekConsumed={consumePendingHiddenSeek}
      onSeekPreviewActiveChange={handleSeekPreviewActiveChange}
      onRegisterCancelSeekPreview={registerCancelSeekPreview}
      onRegisterHiddenVodSeekPreview={registerHiddenVodSeekPreview}
      onRegisterRequestTimelineFocus={registerRequestTimelineFocus}
      onRegisterRequestDefaultFocus={registerRequestDefaultFocus}
      onRegisterVodSeekQuery={registerVodSeekQuery}
      onVodDirectionalSeek={handleVodDirectionalSeek}
      upNext={upNext}
      onPlayNextEpisode={playNextEpisode}
      onPreviousEpisode={handlePreviousEpisode}
      onNextEpisode={handleNextEpisode}
      canGoPreviousEpisode={Boolean(
        snapshot.item?.mediaType === 'episode' && (snapshot.item.previousEpisode || snapshot.item.previousEpisodes?.[0]),
      )}
      canGoNextEpisode={Boolean(
        snapshot.item?.mediaType === 'episode' && (snapshot.item.nextEpisode || snapshot.item.upcomingEpisodes?.[0]),
      )}
      onCancelUpNext={cancelUpNext}
    />
    </>
  );
}

export async function prepareUnifiedPlaybackLaunch(item: PlaybackItem) {
  return item;
}

export { launchUnifiedPlayback, closeUnifiedPlayback };
