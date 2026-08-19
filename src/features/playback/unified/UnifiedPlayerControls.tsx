import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { ComponentType, ElementRef, ReactNode } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import * as ReactNative from 'react-native';
import {
  Animated,
  findNodeHandle,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { focusNativeViewWhenReady } from '@/features/navigation/focusNativeViewWhenReady';
import { novaTvFocus } from '@/components/nova/novaTvFocus';
import { displayStreamTitle } from '@/features/series/metadata/titleNormalization';
import { novaTheme } from '@/theme';

import {
  UNIFIED_CONTROL_ACTIVATE_DEBOUNCE_MS,
  resolveUnifiedControlFocusMove,
  shouldAssignUnifiedPlayerInitialFocus,
  shouldHandleUnifiedSeekRemoteEvent,
  type UnifiedControlFocusId,
} from './unifiedPlayerLogic.ts';
import {
  isUnifiedRemoteDebugEnabled,
  logUnifiedRemoteEvent,
  setUnifiedRemoteFocusedControl,
} from './unifiedRemoteDebug.ts';
import { UnifiedPlayerVodFocusRouter } from './UnifiedPlayerHiddenChromeCapture';
import {
  VOD_SEEK_IDLE_COMMIT_MS,
  VOD_SEEK_STEP_MS,
  applyVodSeekPreviewStep,
  beginVodSeekCommit,
  canEnterVodSeek,
  completeVodSeekCommit,
  createVodSeekCommitGate,
  createVodSeekSessionId,
  formatVodSeekClock,
  formatVodSeekDelta,
  isVodSeekMediaType,
  logPlayerFocus,
  logTvInputRaw,
  logVodFocusSeek,
  logVodSeek,
  logVodSeekRemote,
  resolveVodSeekDirection,
  resolveVodSeekRepeatCount,
  resolveVodSeekStepMs,
  shouldActivateVodFocusRouter,
  type PlayerChromeRevealSource,
  type VodSeekCommitGate,
  type VodSeekDirection,
} from './vodSeek.ts';
import {
  getPlayerChromeDefaultFocusControl,
  logPlayerChromeFocus,
  type PlayerChromeWakeKey,
} from './playerChromeWake.ts';

type UnifiedPlayerControlsProps = {
  title: string;
  subtitle?: string;
  visible: boolean;
  isPlaying: boolean;
  positionMs: number;
  durationMs: number;
  mediaType?: string | null;
  contentId?: string | null;
  onTogglePlay: () => void;
  onRewind: () => void;
  onForward: () => void;
  onSeek: (nextPositionMs: number) => void;
  onBack: () => void;
  onReveal: (source?: PlayerChromeRevealSource) => void;
  allowSeek?: boolean;
  pendingSeekDirection?: VodSeekDirection | null;
  onPendingSeekConsumed?: () => void;
  onSeekPreviewActiveChange?: (active: boolean) => void;
  onRegisterCancelSeekPreview?: (cancel: () => boolean) => void;
  onRegisterHiddenVodSeekPreview?: (begin: (direction: 1 | -1) => boolean) => void;
  onRegisterRequestTimelineFocus?: (request: () => void) => void;
  onRegisterRequestDefaultFocus?: (request: () => void) => void;
  onRegisterVodSeekQuery?: (query: {
    isTimelineFocused: () => boolean;
    hasTimelineHandle: () => boolean;
  }) => void;
  onVodDirectionalSeek?: (direction: VodSeekDirection, source: 'hidden-focus-sentinel') => void;
  onPreviousEpisode?: () => void;
  onNextEpisode?: () => void;
  canGoPreviousEpisode?: boolean;
  canGoNextEpisode?: boolean;
  upNextActive?: boolean;
};

type TvEventPayload = {
  eventType?: string;
  eventKeyAction?: number;
  keyCode?: number;
  key?: string;
};

function noopUseTVEventHandler(_handler: (event: TvEventPayload) => void) {
  // Keep the hook order stable on platforms that do not expose TV events.
}

function UnifiedPlayerSeekRemoteListener({
  enabled,
  durationMs,
  isSeekFocused,
  onSeekDelta,
  onFocusSeek,
}: {
  enabled: boolean;
  durationMs: number;
  isSeekFocused: () => boolean;
  onSeekDelta: (deltaMs: number) => void;
  onFocusSeek: () => void;
}) {
  const reactNative = ReactNative as typeof ReactNative & {
    useTVEventHandler?: (handler: (event: TvEventPayload) => void) => void;
    TVEventHandler?: new () => {
      enable: (component: null, callback: (component: null, data: TvEventPayload) => void) => void;
      disable: () => void;
    };
  };
  const useTVEventHandler = reactNative.useTVEventHandler ?? noopUseTVEventHandler;
  const onSeekDeltaRef = useRef(onSeekDelta);
  const onFocusSeekRef = useRef(onFocusSeek);

  useEffect(() => {
    onSeekDeltaRef.current = onSeekDelta;
  }, [onSeekDelta]);

  useEffect(() => {
    onFocusSeekRef.current = onFocusSeek;
  }, [onFocusSeek]);

  const handleTvEvent = useCallback(
    (event: TvEventPayload) => {
      logTvInputRaw({
        source: 'timeline-listener',
        rawEventType: event.eventType ?? event.key ?? 'unknown',
        eventKeyAction: event.eventKeyAction ?? null,
        keyCode: event.keyCode ?? null,
        controlsVisible: enabled,
        focusedControl: isSeekFocused() ? 'seek' : null,
        mediaType: null,
      });
      if (!enabled) {
        return;
      }

      if (!shouldHandleUnifiedSeekRemoteEvent({
        visible: enabled,
        focusedControl: isSeekFocused() ? 'seek' : null,
        durationMs,
        eventType: event.eventType,
        eventKeyAction: event.eventKeyAction,
      })) {
        return;
      }

      const deltaMs = resolveVodSeekDirection({
        eventType: event.eventType,
        eventKeyAction: event.eventKeyAction,
        keyCode: event.keyCode,
      });
      if (deltaMs == null) {
        return;
      }

      onFocusSeekRef.current();
      onSeekDeltaRef.current(deltaMs * VOD_SEEK_STEP_MS);
    },
    [durationMs, enabled, isSeekFocused],
  );

  // The TV event hook invokes this callback outside React's render cycle.
  // eslint-disable-next-line react-hooks/refs
  useTVEventHandler(handleTvEvent);

  useEffect(() => {
    if (!enabled || Platform.OS !== 'android' || typeof reactNative.TVEventHandler !== 'function') {
      return;
    }

    const handler = new reactNative.TVEventHandler();
    handler.enable(null, (_component, event) => {
      handleTvEvent(event);
    });

    return () => handler.disable();
  }, [enabled, handleTvEvent, reactNative.TVEventHandler]);

  return null;
}

function buildAndroidControlFocusProps(
  controlId: UnifiedControlFocusId,
  handles: Partial<Record<UnifiedControlFocusId, number>>,
  sentinelHandles?: { left?: number | null; right?: number | null },
) {
  const rewind = handles.rewind;
  const play = handles.play;
  const forward = handles.forward;
  const seek = handles.seek;
  const previousEpisode = handles.previousEpisode;
  const nextEpisode = handles.nextEpisode;
  const leftSentinel = sentinelHandles?.left ?? null;
  const rightSentinel = sentinelHandles?.right ?? null;

  switch (controlId) {
    case 'back':
      return seek != null ? { nextFocusDown: seek } : null;
    case 'previousEpisode':
      return {
        ...(rewind != null ? { nextFocusRight: rewind } : {}),
        ...(seek != null ? { nextFocusUp: seek } : {}),
        ...(seek != null ? { nextFocusDown: seek } : {}),
      };
    case 'rewind':
      return {
        ...(previousEpisode != null ? { nextFocusLeft: previousEpisode } : {}),
        ...(play != null ? { nextFocusRight: play } : {}),
        ...(seek != null ? { nextFocusUp: seek } : {}),
        ...(seek != null ? { nextFocusDown: seek } : {}),
      };
    case 'play':
      return {
        ...(rewind != null ? { nextFocusLeft: rewind } : {}),
        ...(forward != null ? { nextFocusRight: forward } : {}),
        ...(seek != null ? { nextFocusUp: seek } : {}),
        ...(seek != null ? { nextFocusDown: seek } : {}),
      };
    case 'forward':
      return {
        ...(play != null ? { nextFocusLeft: play } : {}),
        ...(nextEpisode != null ? { nextFocusRight: nextEpisode } : {}),
        ...(seek != null ? { nextFocusUp: seek } : {}),
        ...(seek != null ? { nextFocusDown: seek } : {}),
      };
    case 'nextEpisode':
      return {
        ...(forward != null ? { nextFocusLeft: forward } : {}),
        ...(seek != null ? { nextFocusUp: seek } : {}),
        ...(seek != null ? { nextFocusDown: seek } : {}),
      };
    case 'seek':
      return {
        ...(leftSentinel != null ? { nextFocusLeft: leftSentinel } : seek != null ? { nextFocusLeft: seek } : {}),
        ...(rightSentinel != null ? { nextFocusRight: rightSentinel } : seek != null ? { nextFocusRight: seek } : {}),
        ...(play != null ? { nextFocusUp: play } : {}),
        ...(rewind != null ? { nextFocusDown: rewind } : {}),
      };
    default:
      return null;
  }
}

export function UnifiedPlayerControls({
  title,
  subtitle,
  visible,
  isPlaying,
  positionMs,
  durationMs,
  onTogglePlay,
  onRewind,
  onForward,
  onSeek,
  onBack,
  onReveal,
  allowSeek = true,
  mediaType = null,
  contentId = null,
  pendingSeekDirection = null,
  onPendingSeekConsumed,
  onSeekPreviewActiveChange,
  onRegisterCancelSeekPreview,
  onRegisterHiddenVodSeekPreview,
  onRegisterRequestTimelineFocus,
  onRegisterRequestDefaultFocus,
  onRegisterVodSeekQuery,
  onVodDirectionalSeek,
  onPreviousEpisode,
  onNextEpisode,
  canGoPreviousEpisode = false,
  canGoNextEpisode = false,
  upNextActive = false,
}: UnifiedPlayerControlsProps) {
  const progress = durationMs > 0 ? Math.min(1, positionMs / durationMs) : 0;
  const displayTitle = displayStreamTitle(title);
  const displaySubtitle = subtitle ? displayStreamTitle(subtitle) : undefined;
  const [opacity] = useState(() => new Animated.Value(visible ? 1 : 0));
  const reactNative = ReactNative as typeof ReactNative & {
    TVFocusGuideView?: typeof View;
  };
  const SeekFocusGuideView = (reactNative.TVFocusGuideView ?? View) as unknown as ComponentType<{
    children?: ReactNode;
    style?: unknown;
    trapFocusLeft?: boolean;
    trapFocusRight?: boolean;
  }>;
  const controlRefs = useRef<Record<UnifiedControlFocusId, ElementRef<typeof Pressable> | null>>({
    back: null,
    rewind: null,
    play: null,
    forward: null,
    seek: null,
    previousEpisode: null,
    nextEpisode: null,
  });
  const [androidFocusHandles, setAndroidFocusHandles] = useState<Partial<Record<UnifiedControlFocusId, number>>>({});
  const [sentinelHandles, setSentinelHandles] = useState<{ left: number | null; right: number | null }>({
    left: null,
    right: null,
  });
  const [focusedControl, setFocusedControl] = useState<UnifiedControlFocusId | null>(null);
  const focusedControlRef = useRef<UnifiedControlFocusId | null>(null);
  const [seekTargetMs, setSeekTargetMs] = useState<number | null>(null);
  const lastKeyActivateAtRef = useRef(0);
  const lastSeekInputRef = useRef<{
    direction: VodSeekDirection;
    at: number;
    repeatCount: number;
    stepMs: number;
  } | null>(null);
  const initialPlayerFocusAssignedRef = useRef(false);
  const defaultFocusPendingRef = useRef(false);
  const defaultFocusRequestedLogRef = useRef(false);
  const visibleRef = useRef(visible);
  const previousVisibleRef = useRef(visible);
  const previousContentIdRef = useRef(contentId);
  const seekTargetMsRef = useRef<number | null>(null);
  const seekSessionIdRef = useRef<string | null>(null);
  const seekCommitGateRef = useRef<VodSeekCommitGate | null>(null);
  const seekWasPlayingRef = useRef(isPlaying);
  const idleCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSeekRef = useRef(onSeek);
  const onRevealRef = useRef(onReveal);
  const onSeekPreviewActiveChangeRef = useRef(onSeekPreviewActiveChange);
  const onPendingSeekConsumedRef = useRef(onPendingSeekConsumed);
  const activeSeekPositionMs = seekTargetMs ?? positionMs;
  const seekProgress =
    seekTargetMs != null && durationMs > 0 ? Math.min(1, activeSeekPositionMs / durationMs) : progress;
  const elapsed = formatVodSeekClock(activeSeekPositionMs, durationMs);
  const durationLabel = formatVodSeekClock(Math.max(0, durationMs), durationMs);
  const previewDeltaLabel =
    seekTargetMs != null ? formatVodSeekDelta(activeSeekPositionMs - positionMs) : null;

  useEffect(() => {
    onSeekRef.current = onSeek;
  }, [onSeek]);
  useEffect(() => {
    onRevealRef.current = onReveal;
  }, [onReveal]);
  useEffect(() => {
    onSeekPreviewActiveChangeRef.current = onSeekPreviewActiveChange;
  }, [onSeekPreviewActiveChange]);
  useEffect(() => {
    onPendingSeekConsumedRef.current = onPendingSeekConsumed;
  }, [onPendingSeekConsumed]);
  useEffect(() => {
    visibleRef.current = visible;
  }, [visible]);

  const clearIdleCommitTimer = useCallback(() => {
    if (idleCommitTimerRef.current) {
      clearTimeout(idleCommitTimerRef.current);
      idleCommitTimerRef.current = null;
    }
  }, []);

  const resetSeekAcceleration = useCallback(() => {
    lastSeekInputRef.current = null;
  }, []);

  const clearSeekPreviewState = useCallback(() => {
    seekTargetMsRef.current = null;
    seekSessionIdRef.current = null;
    seekCommitGateRef.current = null;
    setSeekTargetMs(null);
    resetSeekAcceleration();
    onSeekPreviewActiveChangeRef.current?.(false);
  }, [resetSeekAcceleration]);

  const handleControlFocus = useCallback(
    (controlId: UnifiedControlFocusId) => {
      const previousControl = focusedControlRef.current;
      focusedControlRef.current = controlId;
      setFocusedControl(controlId);
      setUnifiedRemoteFocusedControl(controlId);
      logPlayerFocus({
        event: 'focus-received',
        control: controlId,
        previousControl,
        controlsVisible: visible,
        seekPreviewActive: seekSessionIdRef.current != null,
      });
      if (controlId === getPlayerChromeDefaultFocusControl() && defaultFocusPendingRef.current) {
        defaultFocusPendingRef.current = false;
        logPlayerChromeFocus({
          event: 'default-focused',
          mediaType,
          focusedControl: controlId,
        });
      }
      const revealSource = controlId === 'seek' ? 'timeline-focus' : 'controls-focus';
      if (controlId === 'seek') {
        logVodSeekRemote({
          event: 'timeline-focus-confirmed',
          mediaType,
          controlsVisible: visible,
          allowSeek,
          timelineFocused: true,
          seekPreviewActive: seekSessionIdRef.current != null,
          nativeTimelineHandlePresent: controlRefs.current.seek != null,
          eventConsumedBy: 'timeline-focus',
        });
      }
      if (isUnifiedRemoteDebugEnabled()) {
        logUnifiedRemoteEvent({
          source: 'controls-onFocus',
          eventType: 'focus',
          disposition: 'accepted',
          actionTaken: `focus-${controlId}`,
          controlId,
        });
      }
      // Native onFocus is not a LEFT/RIGHT direction. Hidden chrome parks on the
      // seek anchor; sentinels own directional preview. Do not resurrect chrome
      // from rewind/seek focus while hidden.
      if (visible) {
        onReveal(revealSource);
      }
    },
    [allowSeek, mediaType, onReveal, visible],
  );

  const handleControlBlur = useCallback((controlId: UnifiedControlFocusId) => {
    logPlayerFocus({
      event: 'focus-lost',
      control: controlId,
      previousControl: focusedControlRef.current,
      controlsVisible: visible,
      seekPreviewActive: seekSessionIdRef.current != null,
    });
    if (focusedControlRef.current === controlId) {
      focusedControlRef.current = null;
    }
    setFocusedControl((current) => (current === controlId ? null : current));
  }, [visible]);

  const commitSeekPreview = useCallback(
    (reason: 'ok' | 'idle') => {
      const sessionId = seekSessionIdRef.current;
      const gate = seekCommitGateRef.current;
      const previewActive = sessionId != null && gate != null;

      if (previewActive && !beginVodSeekCommit(gate, sessionId)) {
        return;
      }

      const commitTargetMs = seekTargetMsRef.current ?? positionMs;
      const nextPositionMs = Number.isFinite(commitTargetMs)
        ? Math.max(0, durationMs > 0 ? Math.min(commitTargetMs, durationMs) : commitTargetMs)
        : positionMs;

      if (previewActive) {
        logVodSeek({
          event: 'seek-commit-requested',
          mediaType,
          contentId,
          actualPositionMs: positionMs,
          previewPositionMs: seekTargetMsRef.current,
          durationMs,
          commitReason: reason,
          wasPlaying: seekWasPlayingRef.current,
          seekSessionId: sessionId,
        });
      }

      clearIdleCommitTimer();
      onSeekRef.current(nextPositionMs);
      completeVodSeekCommit(gate);

      if (previewActive) {
        logVodSeek({
          event: 'seek-committed',
          mediaType,
          contentId,
          actualPositionMs: positionMs,
          previewPositionMs: nextPositionMs,
          durationMs,
          commitReason: reason,
          wasPlaying: seekWasPlayingRef.current,
          seekSessionId: sessionId,
        });
      }

      if (isUnifiedRemoteDebugEnabled() || reason === 'ok') {
        logUnifiedRemoteEvent({
          source: 'controls-onPress',
          eventType: 'seek-commit',
          disposition: 'accepted',
          actionTaken: `seek-commit nextPositionMs=${nextPositionMs}`,
          controlId: 'seek',
        });
      }

      clearSeekPreviewState();
      onRevealRef.current('timeline-focus');
    },
    [clearIdleCommitTimer, clearSeekPreviewState, contentId, durationMs, mediaType, positionMs],
  );

  const scheduleIdleCommit = useCallback(
    (sessionId: string) => {
      clearIdleCommitTimer();
      idleCommitTimerRef.current = setTimeout(() => {
        idleCommitTimerRef.current = null;
        if (seekSessionIdRef.current !== sessionId) {
          return;
        }
        commitSeekPreview('idle');
      }, VOD_SEEK_IDLE_COMMIT_MS);
    },
    [clearIdleCommitTimer, commitSeekPreview],
  );

  const cancelSeekPreview = useCallback(() => {
    const sessionId = seekSessionIdRef.current;
    const gate = seekCommitGateRef.current;
    if (!sessionId || !gate || gate.commitStarted || gate.commitCompleted) {
      return false;
    }

    logVodSeek({
      event: 'seek-cancelled',
      mediaType,
      contentId,
      actualPositionMs: positionMs,
      previewPositionMs: seekTargetMsRef.current,
      durationMs,
      wasPlaying: seekWasPlayingRef.current,
      seekSessionId: sessionId,
    });

    clearIdleCommitTimer();
    clearSeekPreviewState();
    onRevealRef.current('timeline-focus');
    return true;
  }, [clearIdleCommitTimer, clearSeekPreviewState, contentId, durationMs, mediaType, positionMs]);

  const applySeekDelta = useCallback(
    (deltaMs: number) => {
      if (!allowSeek || !isVodSeekMediaType(mediaType)) {
        logVodSeek({
          event: 'seek-ignored',
          mediaType,
          contentId,
          actualPositionMs: positionMs,
          durationMs,
          reason: allowSeek ? 'unsupported-media' : 'seek-disabled',
          seekSessionId: seekSessionIdRef.current,
        });
        return;
      }
      if (!canEnterVodSeek(durationMs)) {
        logVodSeek({
          event: 'seek-ignored',
          mediaType,
          contentId,
          actualPositionMs: positionMs,
          durationMs,
          reason: 'unknown-duration',
          seekSessionId: seekSessionIdRef.current,
        });
        return;
      }

      const direction: VodSeekDirection = deltaMs < 0 ? -1 : 1;
      const now = Date.now();
      const lastInput = lastSeekInputRef.current;
      // Same-frame double-fire only. Sentinel repeats must each count.
      if (lastInput && lastInput.direction === direction && now - lastInput.at < 16) {
        return;
      }

      const repeatCount = resolveVodSeekRepeatCount({
        previousDirection: lastInput?.direction ?? null,
        nextDirection: direction,
        previousRepeatCount: lastInput?.repeatCount ?? 0,
      });
      const stepMs = resolveVodSeekStepMs(repeatCount);
      if (lastInput && lastInput.stepMs !== stepMs) {
        logVodSeek({
          event: 'seek-acceleration-change',
          mediaType,
          contentId,
          actualPositionMs: positionMs,
          previewPositionMs: seekTargetMsRef.current,
          durationMs,
          direction,
          stepMs,
          repeatCount,
          wasPlaying: seekWasPlayingRef.current,
          seekSessionId: seekSessionIdRef.current,
        });
      }

      const started = seekSessionIdRef.current == null;
      if (started) {
        const seekSessionId = createVodSeekSessionId();
        seekSessionIdRef.current = seekSessionId;
        seekCommitGateRef.current = createVodSeekCommitGate(seekSessionId);
        seekWasPlayingRef.current = isPlaying;
        onSeekPreviewActiveChangeRef.current?.(true);
      }

      const result = applyVodSeekPreviewStep({
        actualPositionMs: positionMs,
        previewPositionMs: seekTargetMsRef.current,
        durationMs,
        direction,
        repeatCount,
      });

      if (result.ignored || result.previewPositionMs == null) {
        logVodSeek({
          event: 'seek-ignored',
          mediaType,
          contentId,
          actualPositionMs: positionMs,
          durationMs,
          direction,
          stepMs: result.stepMs,
          repeatCount,
          reason: result.ignoreReason ?? 'invalid-target',
          seekSessionId: seekSessionIdRef.current,
        });
        return;
      }

      lastSeekInputRef.current = { direction, at: now, repeatCount, stepMs };
      seekTargetMsRef.current = result.previewPositionMs;
      setSeekTargetMs(result.previewPositionMs);

      if (result.clamped) {
        logVodSeek({
          event: 'seek-clamped',
          mediaType,
          contentId,
          actualPositionMs: positionMs,
          previewPositionMs: result.previewPositionMs,
          durationMs,
          direction,
          stepMs: result.stepMs,
          repeatCount,
          reason: result.clampReason,
          wasPlaying: seekWasPlayingRef.current,
          seekSessionId: seekSessionIdRef.current,
        });
      }

      logVodSeek({
        event: started ? 'seek-preview-start' : 'seek-preview-step',
        mediaType,
        contentId,
        actualPositionMs: positionMs,
        previewPositionMs: result.previewPositionMs,
        durationMs,
        direction,
        stepMs: result.stepMs,
        repeatCount,
        wasPlaying: seekWasPlayingRef.current,
        seekSessionId: seekSessionIdRef.current,
      });

      if (isUnifiedRemoteDebugEnabled()) {
        logUnifiedRemoteEvent({
          source: 'controls-control-key',
          eventType: 'seek-preview',
          disposition: 'accepted',
          actionTaken: `seek-preview nextPositionMs=${result.previewPositionMs} deltaMs=${result.stepMs}`,
          controlId: 'seek',
        });
      }

      const sessionId = seekSessionIdRef.current;
      if (sessionId) {
        scheduleIdleCommit(sessionId);
      }
      onReveal('timeline-focus');
    },
    [
      allowSeek,
      contentId,
      durationMs,
      isPlaying,
      mediaType,
      onReveal,
      positionMs,
      scheduleIdleCommit,
    ],
  );

  const focusControl = useCallback(
    (controlId: UnifiedControlFocusId) => {
      const target = controlRefs.current[controlId];
      if (!target) {
        return;
      }

      focusNativeViewWhenReady(
        () => controlRefs.current[controlId],
        () => {
          setUnifiedRemoteFocusedControl(controlId);
        },
      );
    },
    [],
  );

  const handleControlKeyDown = useCallback(
    (controlId: UnifiedControlFocusId) =>
      (event: {
        nativeEvent: { key?: string; code?: string; keyCode?: number | null; eventType?: string };
        preventDefault?: () => void;
        stopPropagation?: () => void;
      }) => {
        if (isUnifiedRemoteDebugEnabled()) {
          logUnifiedRemoteEvent({
            source: 'controls-control-key',
            eventType: 'native-keydown',
            key: event.nativeEvent.key ?? event.nativeEvent.code ?? event.nativeEvent.eventType ?? null,
            keyCode: event.nativeEvent.keyCode ?? null,
            disposition: 'accepted',
            actionTaken: `received-${controlId}`,
            controlId,
          });
        }

        logTvInputRaw({
          source: controlId === 'seek' ? 'timeline-listener' : 'controls-listener',
          rawEventType: event.nativeEvent.key ?? event.nativeEvent.code ?? event.nativeEvent.eventType ?? 'unknown',
          eventKeyAction: 0,
          keyCode: event.nativeEvent.keyCode ?? null,
          controlsVisible: visible,
          focusedControl: controlId,
          mediaType,
        });

        const direction = resolveVodSeekDirection({
          eventType: event.nativeEvent.key ?? event.nativeEvent.code ?? event.nativeEvent.eventType,
          keyCode: event.nativeEvent.keyCode,
          key: event.nativeEvent.key,
        });

        if (!visible) {
          return;
        }

        if (controlId === 'seek' && direction != null) {
          // Native nextFocusLeft/Right → seek sentinels own this press.
          return;
        }

        if (focusedControl !== controlId) {
          return;
        }

        const nextControl = resolveUnifiedControlFocusMove(controlId, event.nativeEvent, {
          episodeButtonsVisible: mediaType === 'episode',
          canGoPreviousEpisode,
          canGoNextEpisode,
        });
        if (!nextControl || nextControl === controlId || !controlRefs.current[nextControl]) {
          return;
        }

        event.preventDefault?.();
        event.stopPropagation?.();
        focusControl(nextControl);
      },
    [canGoNextEpisode, canGoPreviousEpisode, focusControl, focusedControl, mediaType, visible],
  );

  const handleControlPress = useCallback(
    (controlId: UnifiedControlFocusId, actionTaken: string, handler: () => void) => {
      if (controlId !== 'back' && Date.now() - lastKeyActivateAtRef.current < UNIFIED_CONTROL_ACTIVATE_DEBOUNCE_MS) {
        return;
      }
      lastKeyActivateAtRef.current = Date.now();
      if (isUnifiedRemoteDebugEnabled()) {
        logUnifiedRemoteEvent({
          source: 'controls-onPress',
          eventType: 'press',
          disposition: 'accepted',
          actionTaken,
          controlId,
        });
      }
      handler();
    },
    [],
  );

  useEffect(() => {
    Animated.timing(opacity, {
      toValue: visible ? 1 : 0,
      duration: visible ? 180 : 500,
      useNativeDriver: true,
    }).start();
  }, [opacity, visible]);

  useEffect(() => {
    onRegisterCancelSeekPreview?.(cancelSeekPreview);
  }, [cancelSeekPreview, onRegisterCancelSeekPreview]);

  const beginVodDirectionalPreview = useCallback(
    (direction: VodSeekDirection) => {
      logVodSeekRemote({
        event: 'preview-entry-request',
        mediaType,
        controlsVisible: visible,
        allowSeek,
        timelineFocused: focusedControlRef.current === 'seek',
        seekPreviewActive: seekSessionIdRef.current != null,
        vodEligible: isVodSeekMediaType(mediaType) && canEnterVodSeek(durationMs),
        hiddenVodSeekEligible: !visible && isVodSeekMediaType(mediaType) && canEnterVodSeek(durationMs),
        nativeTimelineHandlePresent: controlRefs.current.seek != null,
        direction,
      });
      applySeekDelta(direction * VOD_SEEK_STEP_MS);
      const started = seekSessionIdRef.current != null;
      if (started) {
        logVodSeekRemote({
          event: 'preview-entry-confirmed',
          mediaType,
          controlsVisible: visible,
          allowSeek,
          timelineFocused: focusedControlRef.current === 'seek',
          seekPreviewActive: true,
          nativeTimelineHandlePresent: controlRefs.current.seek != null,
          direction,
          eventConsumedBy: 'hidden-vod-seek',
        });
      }
      return started;
    },
    [allowSeek, applySeekDelta, durationMs, mediaType, visible],
  );

  const requestTimelineFocus = useCallback(() => {
    logVodSeekRemote({
      event: 'timeline-focus-request',
      mediaType,
      controlsVisible: visible,
      allowSeek,
      timelineFocused: focusedControlRef.current === 'seek',
      seekPreviewActive: seekSessionIdRef.current != null,
      nativeTimelineHandlePresent: controlRefs.current.seek != null,
    });
    logVodFocusSeek({
      event: 'timeline-return-request',
      mediaType,
      contentId,
      controlsVisible: visible,
      timelineFocused: focusedControlRef.current === 'seek',
      seekPreviewActive: seekSessionIdRef.current != null,
      actualPositionMs: positionMs,
      previewPositionMs: seekTargetMsRef.current,
      seekSessionId: seekSessionIdRef.current,
    });
    handleControlFocus('seek');
    focusControl('seek');
    logVodFocusSeek({
      event: 'timeline-return-confirmed',
      mediaType,
      contentId,
      controlsVisible: true,
      timelineFocused: true,
      seekPreviewActive: seekSessionIdRef.current != null,
      actualPositionMs: positionMs,
      previewPositionMs: seekTargetMsRef.current,
      seekSessionId: seekSessionIdRef.current,
    });
  }, [allowSeek, contentId, focusControl, handleControlFocus, mediaType, positionMs, visible]);

  const handleSentinelFocus = useCallback(
    (direction: VodSeekDirection) => {
      if (!visible) {
        return;
      }
      if (!allowSeek || !isVodSeekMediaType(mediaType)) {
        return;
      }
      if (onVodDirectionalSeek) {
        onVodDirectionalSeek(direction, 'hidden-focus-sentinel');
      } else {
        beginVodDirectionalPreview(direction);
      }
      requestTimelineFocus();
    },
    [allowSeek, beginVodDirectionalPreview, mediaType, onVodDirectionalSeek, requestTimelineFocus, visible],
  );

  const requestDefaultChromeFocus = useCallback(() => {
    const defaultControl = getPlayerChromeDefaultFocusControl();
    if (focusedControlRef.current === defaultControl && initialPlayerFocusAssignedRef.current) {
      return;
    }
    defaultFocusPendingRef.current = true;
    if (!defaultFocusRequestedLogRef.current) {
      defaultFocusRequestedLogRef.current = true;
      logPlayerChromeFocus({
        event: 'default-focus-requested',
        mediaType,
        focusedControl: defaultControl,
      });
    }
    let retried = false;
    const attempt = () => {
      const target = controlRefs.current[defaultControl] as { focus?: () => void } | null;
      if (visibleRef.current && target && typeof target.focus === 'function') {
        try {
          target.focus();
        } catch {
          // Native focus is best-effort; visual state still tracks Play/Pause.
        }
        initialPlayerFocusAssignedRef.current = true;
        return;
      }
      if (!retried) {
        retried = true;
        requestAnimationFrame(attempt);
      }
    };
    requestAnimationFrame(attempt);
  }, [mediaType]);

  const handleHiddenChromeWake = useCallback(
    (key: PlayerChromeWakeKey) => {
      if (visible || upNextActive) {
        return;
      }
      logPlayerChromeFocus({
        event: 'wake-input',
        key,
        mediaType,
        focusedControl: null,
      });
      logPlayerChromeFocus({
        event: 'wake-consumed',
        key,
        mediaType,
        focusedControl: null,
      });
      onReveal('hidden-focus-sentinel');
      requestDefaultChromeFocus();
    },
    [mediaType, onReveal, requestDefaultChromeFocus, upNextActive, visible],
  );

  useEffect(() => {
    onRegisterHiddenVodSeekPreview?.(beginVodDirectionalPreview);
  }, [beginVodDirectionalPreview, onRegisterHiddenVodSeekPreview]);

  useEffect(() => {
    onRegisterRequestTimelineFocus?.(requestTimelineFocus);
  }, [onRegisterRequestTimelineFocus, requestTimelineFocus]);

  useEffect(() => {
    onRegisterRequestDefaultFocus?.(requestDefaultChromeFocus);
  }, [onRegisterRequestDefaultFocus, requestDefaultChromeFocus]);

  useEffect(() => {
    onRegisterVodSeekQuery?.({
      isTimelineFocused: () => focusedControlRef.current === 'seek',
      hasTimelineHandle: () => controlRefs.current.seek != null,
    });
  }, [onRegisterVodSeekQuery]);

  useEffect(() => {
    return () => {
      clearIdleCommitTimer();
    };
  }, [clearIdleCommitTimer]);

  useEffect(() => {
    if (previousContentIdRef.current !== contentId) {
      previousContentIdRef.current = contentId;
      initialPlayerFocusAssignedRef.current = false;
      defaultFocusPendingRef.current = false;
      focusedControlRef.current = null;
      setFocusedControl(null);
      logPlayerChromeFocus({
        event: 'stale-focus-cleared',
        mediaType,
        focusedControl: null,
      });
    }

    if (!visible) {
      initialPlayerFocusAssignedRef.current = false;
      defaultFocusRequestedLogRef.current = false;
      previousVisibleRef.current = false;
      return;
    }

    if (pendingSeekDirection != null) {
      previousVisibleRef.current = visible;
      return;
    }

    if (!shouldAssignUnifiedPlayerInitialFocus({
      visible,
      initialFocusAssigned: initialPlayerFocusAssignedRef.current,
      focusedControl: focusedControlRef.current,
    })) {
      previousVisibleRef.current = visible;
      return;
    }

    previousVisibleRef.current = visible;
    requestDefaultChromeFocus();
  }, [contentId, mediaType, pendingSeekDirection, requestDefaultChromeFocus, visible]);

  const pendingSeekConsumedRef = useRef<VodSeekDirection | null>(null);
  useEffect(() => {
    if (pendingSeekDirection == null) {
      pendingSeekConsumedRef.current = null;
    }
  }, [pendingSeekDirection]);

  useEffect(() => {
    if (!visible || pendingSeekDirection == null || !allowSeek) {
      return;
    }
    if (pendingSeekConsumedRef.current === pendingSeekDirection) {
      return;
    }
    pendingSeekConsumedRef.current = pendingSeekDirection;
    logVodSeekRemote({
      event: 'timeline-focus-request',
      mediaType,
      controlsVisible: true,
      allowSeek,
      timelineFocused: focusedControlRef.current === 'seek',
      seekPreviewActive: seekSessionIdRef.current != null,
      nativeTimelineHandlePresent: controlRefs.current.seek != null,
      direction: pendingSeekDirection,
    });
    handleControlFocus('seek');
    focusControl('seek');
    if (seekSessionIdRef.current == null) {
      applySeekDelta(pendingSeekDirection * VOD_SEEK_STEP_MS);
    }
    onPendingSeekConsumedRef.current?.();
  }, [allowSeek, applySeekDelta, focusControl, handleControlFocus, mediaType, pendingSeekDirection, visible]);

  // Stable ref callbacks are required on Android: a new function each render makes
  // React detach/re-attach Pressable refs, which updates androidFocusHandles and
  // immediately re-renders (Maximum update depth → black playback Modal).
  const updateAndroidFocusHandle = useCallback((controlId: UnifiedControlFocusId, instance: ElementRef<typeof Pressable> | null) => {
    if (Platform.OS !== 'android') {
      return;
    }

    const handle = instance ? findNodeHandle(instance) : null;
    setAndroidFocusHandles((current) => {
      const currentHandle = current[controlId];
      // Ignore transient null during parent re-renders that recreate unstable refs.
      if (handle == null) {
        return current;
      }
      if (currentHandle === handle) {
        return current;
      }
      return { ...current, [controlId]: handle };
    });
  }, []);

  const assignBackRef = useCallback(
    (instance: ElementRef<typeof Pressable> | null) => {
      controlRefs.current.back = instance;
      updateAndroidFocusHandle('back', instance);
    },
    [updateAndroidFocusHandle],
  );
  const assignRewindRef = useCallback(
    (instance: ElementRef<typeof Pressable> | null) => {
      controlRefs.current.rewind = instance;
      updateAndroidFocusHandle('rewind', instance);
    },
    [updateAndroidFocusHandle],
  );
  const assignPlayRef = useCallback(
    (instance: ElementRef<typeof Pressable> | null) => {
      controlRefs.current.play = instance;
      updateAndroidFocusHandle('play', instance);
    },
    [updateAndroidFocusHandle],
  );
  const assignForwardRef = useCallback(
    (instance: ElementRef<typeof Pressable> | null) => {
      controlRefs.current.forward = instance;
      updateAndroidFocusHandle('forward', instance);
    },
    [updateAndroidFocusHandle],
  );
  const assignSeekRef = useCallback(
    (instance: ElementRef<typeof Pressable> | null) => {
      controlRefs.current.seek = instance;
      updateAndroidFocusHandle('seek', instance);
    },
    [updateAndroidFocusHandle],
  );
  const assignPreviousEpisodeRef = useCallback(
    (instance: ElementRef<typeof Pressable> | null) => {
      controlRefs.current.previousEpisode = instance;
      updateAndroidFocusHandle('previousEpisode', instance);
    },
    [updateAndroidFocusHandle],
  );
  const assignNextEpisodeRef = useCallback(
    (instance: ElementRef<typeof Pressable> | null) => {
      controlRefs.current.nextEpisode = instance;
      updateAndroidFocusHandle('nextEpisode', instance);
    },
    [updateAndroidFocusHandle],
  );
  const showEpisodeButtons = mediaType === 'episode';
  const episodeFocusHandles = {
    ...androidFocusHandles,
    previousEpisode: showEpisodeButtons && canGoPreviousEpisode ? androidFocusHandles.previousEpisode : undefined,
    nextEpisode: showEpisodeButtons && canGoNextEpisode ? androidFocusHandles.nextEpisode : undefined,
  };
  const backFocusProps = Platform.OS === 'android' ? buildAndroidControlFocusProps('back', episodeFocusHandles) : null;
  const rewindFocusProps =
    Platform.OS === 'android' ? buildAndroidControlFocusProps('rewind', episodeFocusHandles) : null;
  const playFocusProps = Platform.OS === 'android' ? buildAndroidControlFocusProps('play', episodeFocusHandles) : null;
  const forwardFocusProps =
    Platform.OS === 'android' ? buildAndroidControlFocusProps('forward', episodeFocusHandles) : null;
  const seekFocusProps =
    Platform.OS === 'android'
      ? buildAndroidControlFocusProps('seek', episodeFocusHandles, sentinelHandles)
      : null;
  const previousEpisodeFocusProps =
    Platform.OS === 'android' ? buildAndroidControlFocusProps('previousEpisode', episodeFocusHandles) : null;
  const nextEpisodeFocusProps =
    Platform.OS === 'android' ? buildAndroidControlFocusProps('nextEpisode', episodeFocusHandles) : null;
  const vodFocusRouterEnabled = shouldActivateVodFocusRouter({
    mediaType,
    upNextActive,
    platformOs: Platform.OS,
  });

  return (
    <View style={styles.host} pointerEvents="box-none">
      <UnifiedPlayerSeekRemoteListener
        enabled={false}
        durationMs={durationMs}
        isSeekFocused={() => focusedControlRef.current === 'seek'}
        onSeekDelta={applySeekDelta}
        onFocusSeek={() => handleControlFocus('seek')}
      />
      <Animated.View
        pointerEvents={visible ? 'auto' : 'none'}
        style={[styles.panelWrap, { opacity }]}>
        <View style={styles.panel}>
          <View style={styles.topBar}>
            <Pressable
              ref={assignBackRef}
              focusable={visible}
              accessibilityRole="button"
              accessibilityLabel="Player Back"
              {...(backFocusProps ?? {})}
              {...({ onKeyDown: handleControlKeyDown('back') } as any)}
              onPress={() => handleControlPress('back', 'back-close-playback', onBack)}
              onFocus={() => handleControlFocus('back')}
              onBlur={() => handleControlBlur('back')}
              style={[styles.backButton, novaTvFocus.base, focusedControl === 'back' && novaTvFocus.active]}>
              <MaterialCommunityIcons name="arrow-left" size={16} color={novaTheme.colors.textPrimary} />
              <Text style={styles.backButtonText}>Back</Text>
            </Pressable>
            <View style={styles.titles}>
              <Text numberOfLines={1} style={styles.title}>
                {displayTitle}
              </Text>
              {displaySubtitle ? (
                <Text numberOfLines={1} style={styles.subtitle}>
                  {displaySubtitle}
                </Text>
              ) : null}
            </View>
            <View style={styles.timeBadgeWrap}>
              <Text style={styles.timeBadge}>{`${elapsed} / ${durationLabel}`}</Text>
              {previewDeltaLabel ? <Text style={styles.seekDeltaLabel}>{previewDeltaLabel}</Text> : null}
            </View>
          </View>

          <SeekFocusGuideView
            style={styles.seekGuide}>
            <Pressable
              ref={assignSeekRef}
              focusable={visible && allowSeek}
              accessibilityRole="button"
              accessibilityLabel="Seek"
              {...(seekFocusProps ?? {})}
              {...({ onKeyDown: handleControlKeyDown('seek') } as any)}
              onPress={() => {
                handleControlPress('seek', 'commit-seek', () => {
                  commitSeekPreview('ok');
                });
              }}
              onFocus={() => handleControlFocus('seek')}
              onBlur={() => handleControlBlur('seek')}
              style={[
                styles.seekCard,
                novaTvFocus.base,
                focusedControl === 'seek' && novaTvFocus.active,
                focusedControl === 'seek' && styles.seekCardFocused,
              ]}>
              <View style={[styles.seekTrack, focusedControl === 'seek' && styles.seekTrackFocused]}>
                <View style={[styles.seekFill, focusedControl === 'seek' && styles.seekFillFocused, { width: `${seekProgress * 100}%` }]} />
              </View>
            </Pressable>
          </SeekFocusGuideView>

          <View style={styles.controls}>
            {showEpisodeButtons ? (
              <Pressable
                ref={assignPreviousEpisodeRef}
                focusable={visible && canGoPreviousEpisode}
                accessibilityRole="button"
                accessibilityLabel="Previous Episode"
                accessibilityState={{ disabled: !canGoPreviousEpisode }}
                {...(previousEpisodeFocusProps ?? {})}
                {...({ onKeyDown: handleControlKeyDown('previousEpisode') } as any)}
                onPress={() => {
                  if (!canGoPreviousEpisode) {
                    return;
                  }
                  handleControlPress('previousEpisode', 'previous-episode', () => onPreviousEpisode?.());
                }}
                onFocus={() => handleControlFocus('previousEpisode')}
                onBlur={() => handleControlBlur('previousEpisode')}
                style={[
                  styles.controlButton,
                  novaTvFocus.base,
                  !canGoPreviousEpisode && styles.controlButtonDisabled,
                  focusedControl === 'previousEpisode' && novaTvFocus.active,
                ]}>
                <MaterialCommunityIcons name="skip-previous" size={20} color={novaTheme.colors.textPrimary} />
              </Pressable>
            ) : null}
            <Pressable
              ref={assignRewindRef}
              focusable={visible}
              accessibilityRole="button"
              accessibilityLabel="Rewind"
              {...(rewindFocusProps ?? {})}
              {...({ onKeyDown: handleControlKeyDown('rewind') } as any)}
              onPress={() => handleControlPress('rewind', 'rewind-10s', onRewind)}
              onFocus={() => handleControlFocus('rewind')}
              onBlur={() => handleControlBlur('rewind')}
              style={[styles.controlButton, novaTvFocus.base, focusedControl === 'rewind' && novaTvFocus.active]}>
              <MaterialCommunityIcons name="rewind" size={20} color={novaTheme.colors.textPrimary} />
            </Pressable>
            <Pressable
              ref={assignPlayRef}
              focusable={visible}
              accessibilityRole="button"
              accessibilityLabel={isPlaying ? 'Pause' : 'Play'}
              {...(playFocusProps ?? {})}
              {...({ onKeyDown: handleControlKeyDown('play') } as any)}
              onPress={() => handleControlPress('play', isPlaying ? 'pause-playback' : 'start-playback', onTogglePlay)}
              onFocus={() => handleControlFocus('play')}
              onBlur={() => handleControlBlur('play')}
              style={[
                styles.controlButton,
                styles.playButton,
                novaTvFocus.base,
                focusedControl === 'play' && novaTvFocus.active,
              ]}>
              <MaterialCommunityIcons name={isPlaying ? 'pause' : 'play'} size={22} color="#FFFFFF" />
            </Pressable>
            <Pressable
              ref={assignForwardRef}
              focusable={visible}
              accessibilityRole="button"
              accessibilityLabel="Fast Forward"
              {...(forwardFocusProps ?? {})}
              {...({ onKeyDown: handleControlKeyDown('forward') } as any)}
              onPress={() => handleControlPress('forward', 'forward-30s', onForward)}
              onFocus={() => handleControlFocus('forward')}
              onBlur={() => handleControlBlur('forward')}
              style={[styles.controlButton, novaTvFocus.base, focusedControl === 'forward' && novaTvFocus.active]}>
              <MaterialCommunityIcons name="fast-forward" size={20} color={novaTheme.colors.textPrimary} />
            </Pressable>
            {showEpisodeButtons ? (
              <Pressable
                ref={assignNextEpisodeRef}
                focusable={visible && canGoNextEpisode}
                accessibilityRole="button"
                accessibilityLabel="Next Episode"
                accessibilityState={{ disabled: !canGoNextEpisode }}
                {...(nextEpisodeFocusProps ?? {})}
                {...({ onKeyDown: handleControlKeyDown('nextEpisode') } as any)}
                onPress={() => {
                  if (!canGoNextEpisode) {
                    return;
                  }
                  handleControlPress('nextEpisode', 'next-episode', () => onNextEpisode?.());
                }}
                onFocus={() => handleControlFocus('nextEpisode')}
                onBlur={() => handleControlBlur('nextEpisode')}
                style={[
                  styles.controlButton,
                  novaTvFocus.base,
                  !canGoNextEpisode && styles.controlButtonDisabled,
                  focusedControl === 'nextEpisode' && novaTvFocus.active,
                ]}>
                <MaterialCommunityIcons name="skip-next" size={20} color={novaTheme.colors.textPrimary} />
              </Pressable>
            ) : null}
          </View>
        </View>
      </Animated.View>
      <UnifiedPlayerVodFocusRouter
        enabled={vodFocusRouterEnabled && allowSeek}
        chromeVisible={visible}
        mediaType={mediaType}
        contentId={contentId}
        timelineFocused={focusedControl === 'seek'}
        seekPreviewActive={seekTargetMs != null}
        actualPositionMs={positionMs}
        previewPositionMs={seekTargetMs}
        seekSessionId={null}
        seekHandle={androidFocusHandles.seek ?? null}
        onSentinelFocus={handleSentinelFocus}
        onHiddenChromeWake={handleHiddenChromeWake}
        onHandlesChange={(next) => {
          setSentinelHandles((current) => {
            if (current.left === next.left && current.right === next.right) {
              return current;
            }
            return { left: next.left, right: next.right };
          });
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    ...StyleSheet.absoluteFill,
    zIndex: 3,
    // Elevation above SurfaceView hides video on Android TV when this host
    // remains mounted (even with opacity-0 children). Keep zIndex only.
    justifyContent: 'flex-end',
  },
  panelWrap: {
    zIndex: 3,
  },
  panel: {
    paddingHorizontal: 20,
    paddingBottom: 18,
    paddingTop: 12,
    backgroundColor: 'rgba(3,7,12,0.82)',
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  titles: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  title: {
    color: novaTheme.colors.textPrimary,
    fontSize: 16,
    fontWeight: '800',
  },
  subtitle: {
    color: novaTheme.colors.textSecondary,
    fontSize: 11,
    fontWeight: '600',
  },
  timeBadgeWrap: {
    alignItems: 'flex-end',
    minWidth: 88,
    gap: 1,
  },
  timeBadge: {
    color: novaTheme.colors.textMuted,
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'right',
  },
  seekDeltaLabel: {
    color: novaTheme.colors.focusRing,
    fontSize: 12,
    fontWeight: '800',
    textAlign: 'right',
  },
  backButton: {
    minHeight: 34,
    minWidth: 34,
    borderRadius: 0,
    borderWidth: 1,
    borderColor: novaTheme.colors.borderSubtle,
    backgroundColor: 'rgba(18,24,34,0.88)',
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  backButtonText: {
    color: novaTheme.colors.textPrimary,
    fontSize: 12,
    fontWeight: '800',
  },
  seekGuide: {
    alignSelf: 'stretch',
  },
  seekCard: {
    borderRadius: 0,
    paddingVertical: 6,
    paddingHorizontal: 2,
  },
  seekCardFocused: {
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  seekTrack: {
    position: 'relative',
    height: 4,
    borderRadius: 99,
    backgroundColor: 'rgba(255,255,255,0.18)',
    overflow: 'hidden',
  },
  seekTrackFocused: {
    backgroundColor: 'rgba(88, 124, 255, 0.32)',
  },
  seekFill: {
    height: '100%',
    borderRadius: 99,
    backgroundColor: novaTheme.colors.accent,
  },
  seekFillFocused: {
    backgroundColor: novaTheme.colors.focusRing,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  controlButton: {
    minWidth: 44,
    minHeight: 44,
    borderRadius: 0,
    borderWidth: 1,
    borderColor: novaTheme.colors.borderSubtle,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  playButton: {
    minWidth: 52,
    minHeight: 44,
    backgroundColor: novaTheme.colors.accent,
    borderColor: novaTheme.colors.accent,
  },
  controlButtonDisabled: {
    opacity: 0.35,
  },
});
