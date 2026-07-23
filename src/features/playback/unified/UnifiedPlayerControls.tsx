import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { ComponentType, ElementRef, ReactNode } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import * as ReactNative from 'react-native';
import {
  Animated,
  InteractionManager,
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
  resolveUnifiedSeekDelta,
  resolveUnifiedSeekPosition,
  shouldAssignUnifiedPlayerInitialFocus,
  shouldHandleUnifiedSeekRemoteEvent,
  type UnifiedControlFocusId,
} from './unifiedPlayerLogic.ts';
import {
  isUnifiedRemoteDebugEnabled,
  logUnifiedRemoteEvent,
  setUnifiedRemoteFocusedControl,
} from './unifiedRemoteDebug.ts';

type UnifiedPlayerControlsProps = {
  title: string;
  subtitle?: string;
  visible: boolean;
  isPlaying: boolean;
  positionMs: number;
  durationMs: number;
  onTogglePlay: () => void;
  onRewind: () => void;
  onForward: () => void;
  onSeek: (nextPositionMs: number) => void;
  onBack: () => void;
  onReveal: () => void;
};

function formatTime(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function resolveSeekDeltaFromNativeKeyEvent(nativeEvent: {
  key?: string;
  code?: string;
  keyCode?: number | null;
  eventType?: string;
}) {
  const eventType = nativeEvent.key ?? nativeEvent.code ?? nativeEvent.eventType ?? (
    nativeEvent.keyCode === 21 ? 'ArrowLeft' : nativeEvent.keyCode === 22 ? 'ArrowRight' : null
  );
  return resolveUnifiedSeekDelta(eventType);
}

type TvEventPayload = {
  eventType?: string;
  eventKeyAction?: number;
};

function noopUseTVEventHandler(_handler: (event: TvEventPayload) => void) {
  // Keep the hook order stable on platforms that do not expose TV events.
}

function UnifiedPlayerSeekRemoteListener({
  enabled,
  durationMs,
  onSeekDelta,
  onFocusSeek,
}: {
  enabled: boolean;
  durationMs: number;
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
      if (!enabled) {
        return;
      }

      if (!shouldHandleUnifiedSeekRemoteEvent({
        visible: enabled,
        focusedControl: 'seek',
        durationMs,
        eventType: event.eventType,
        eventKeyAction: event.eventKeyAction,
      })) {
        return;
      }

      const deltaMs = resolveUnifiedSeekDelta(event.eventType);
      if (deltaMs == null) {
        return;
      }

      onFocusSeekRef.current();
      onSeekDeltaRef.current(deltaMs);
    },
    [durationMs, enabled],
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
) {
  const rewind = handles.rewind;
  const play = handles.play;
  const forward = handles.forward;
  const seek = handles.seek;

  switch (controlId) {
    case 'back':
      return seek != null ? { nextFocusDown: seek } : null;
    case 'rewind':
      return {
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
        ...(seek != null ? { nextFocusUp: seek } : {}),
        ...(seek != null ? { nextFocusDown: seek } : {}),
      };
    case 'seek':
      return {
        ...(seek != null ? { nextFocusLeft: seek, nextFocusRight: seek } : {}),
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
}: UnifiedPlayerControlsProps) {
  const progress = durationMs > 0 ? Math.min(1, positionMs / durationMs) : 0;
  const elapsed = formatTime(positionMs);
  const durationLabel = formatTime(Math.max(0, durationMs));
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
  });
  const [androidFocusHandles, setAndroidFocusHandles] = useState<Partial<Record<UnifiedControlFocusId, number>>>({});
  const [focusedControl, setFocusedControl] = useState<UnifiedControlFocusId | null>(null);
  const [seekTargetMs, setSeekTargetMs] = useState<number | null>(null);
  const lastKeyActivateAtRef = useRef(0);
  const lastSeekInputRef = useRef<{ deltaMs: number; at: number } | null>(null);
  const initialPlayerFocusAssignedRef = useRef(false);
  const previousVisibleRef = useRef(visible);
  const seekTargetMsRef = useRef<number | null>(null);
  const activeSeekPositionMs = seekTargetMs ?? positionMs;
  const seekProgress = seekTargetMs != null && durationMs > 0 ? Math.min(1, activeSeekPositionMs / durationMs) : progress;

  const handleControlFocus = useCallback(
    (controlId: UnifiedControlFocusId) => {
      setFocusedControl(controlId);
      setUnifiedRemoteFocusedControl(controlId);
      if (controlId === 'seek') {
        const initialTargetMs = positionMs;
        seekTargetMsRef.current = initialTargetMs;
        setSeekTargetMs(initialTargetMs);
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
      onReveal();
    },
    [onReveal, positionMs],
  );

  const handleControlBlur = useCallback((controlId: UnifiedControlFocusId) => {
    setFocusedControl((current) => (current === controlId ? null : current));
    if (controlId === 'seek') {
      seekTargetMsRef.current = null;
      setSeekTargetMs(null);
    }
  }, []);

  const clampSeekPosition = useCallback(
    (nextPositionMs: number) => Math.max(0, Math.min(nextPositionMs, durationMs || nextPositionMs)),
    [durationMs],
  );

  const adjustSeekTarget = useCallback(
    (deltaMs: number) => {
      const baseMs = seekTargetMsRef.current ?? positionMs;
      const nextPositionMs = resolveUnifiedSeekPosition(baseMs, durationMs, deltaMs);
      if (nextPositionMs == null) {
        return;
      }
      seekTargetMsRef.current = nextPositionMs;
      setSeekTargetMs(nextPositionMs);
      if (isUnifiedRemoteDebugEnabled()) {
        logUnifiedRemoteEvent({
          source: 'controls-control-key',
          eventType: 'seek-adjust',
          disposition: 'accepted',
          actionTaken: `seek-adjust nextPositionMs=${nextPositionMs} deltaMs=${deltaMs}`,
          controlId: 'seek',
        });
      }
      onSeek(nextPositionMs);
    },
    [durationMs, onSeek, positionMs],
  );

  const applySeekDelta = useCallback(
    (deltaMs: number) => {
      const now = Date.now();
      const lastInput = lastSeekInputRef.current;
      if (lastInput && lastInput.deltaMs === deltaMs && now - lastInput.at < 80) {
        return;
      }
      lastSeekInputRef.current = { deltaMs, at: now };
      adjustSeekTarget(deltaMs);
    },
    [adjustSeekTarget],
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
        if (!visible) {
          return;
        }

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

        if (controlId === 'seek') {
          const deltaMs = resolveSeekDeltaFromNativeKeyEvent(event.nativeEvent);
          if (deltaMs != null) {
            // Android can deliver the key to the newly focused native view before
            // React has committed its onFocus state update. Trust the event target
            // for scrubbing, then bring the React focus mirror up to date.
            if (focusedControl !== 'seek') {
              handleControlFocus('seek');
            }
            event.preventDefault?.();
            event.stopPropagation?.();
            applySeekDelta(deltaMs);
            return;
          }
        }

        if (focusedControl !== controlId) {
          return;
        }

        const nextControl = resolveUnifiedControlFocusMove(controlId, event.nativeEvent);
        if (!nextControl || nextControl === controlId) {
          return;
        }

        event.preventDefault?.();
        event.stopPropagation?.();
        focusControl(nextControl);
      },
    [applySeekDelta, focusControl, focusedControl, handleControlFocus, visible],
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
    if (!shouldAssignUnifiedPlayerInitialFocus({
      visible,
      initialFocusAssigned: initialPlayerFocusAssignedRef.current,
      focusedControl,
    })) {
      return;
    }

    let cancelled = false;
    let focusCleanup: (() => void) | undefined;
    initialPlayerFocusAssignedRef.current = true;

    const task = InteractionManager.runAfterInteractions(() => {
      if (cancelled) {
        return;
      }

      if (isUnifiedRemoteDebugEnabled()) {
        logUnifiedRemoteEvent({
          source: 'controls-onFocus',
          eventType: 'focus',
          disposition: 'accepted',
          actionTaken: 'initial-player-focus-requested',
          controlId: 'play',
        });
      }

      focusCleanup = focusNativeViewWhenReady(
        () => controlRefs.current.play,
        () => {
          if (cancelled) {
            return;
          }
          setUnifiedRemoteFocusedControl('play');
        },
        8,
      );
    });

    return () => {
      cancelled = true;
      task.cancel();
      focusCleanup?.();
    };
  }, [visible, focusedControl]);

  useEffect(() => {
    const becameVisible = visible && !previousVisibleRef.current;
    previousVisibleRef.current = visible;
    if (!becameVisible) {
      return;
    }

    let cancelled = false;
    let focusCleanup: (() => void) | undefined;
    const task = InteractionManager.runAfterInteractions(() => {
      if (cancelled) {
        return;
      }

      focusCleanup = focusNativeViewWhenReady(
        () => controlRefs.current.play,
        () => {
          if (cancelled) {
            return;
          }
          setUnifiedRemoteFocusedControl('play');
        },
      );
    });

    return () => {
      cancelled = true;
      task.cancel();
      focusCleanup?.();
    };
  }, [visible]);

  const registerControlRef = useCallback(
    (controlId: UnifiedControlFocusId) => (instance: ElementRef<typeof Pressable> | null) => {
      controlRefs.current[controlId] = instance;

      if (Platform.OS !== 'android') {
        return;
      }

      const handle = instance ? findNodeHandle(instance) : null;
      setAndroidFocusHandles((current) => {
        const currentHandle = current[controlId];
        if ((handle == null && currentHandle == null) || currentHandle === handle) {
          return current;
        }

        const next = { ...current };
        if (handle == null) {
          delete next[controlId];
        } else {
          next[controlId] = handle;
        }
        return next;
      });
    },
    [],
  );

  const assignBackRef = registerControlRef('back');
  const assignRewindRef = registerControlRef('rewind');
  const assignPlayRef = registerControlRef('play');
  const assignForwardRef = registerControlRef('forward');
  const assignSeekRef = registerControlRef('seek');

  const backFocusProps = Platform.OS === 'android' ? buildAndroidControlFocusProps('back', androidFocusHandles) : null;
  const rewindFocusProps =
    Platform.OS === 'android' ? buildAndroidControlFocusProps('rewind', androidFocusHandles) : null;
  const playFocusProps = Platform.OS === 'android' ? buildAndroidControlFocusProps('play', androidFocusHandles) : null;
  const forwardFocusProps =
    Platform.OS === 'android' ? buildAndroidControlFocusProps('forward', androidFocusHandles) : null;
  const seekFocusProps = Platform.OS === 'android' ? buildAndroidControlFocusProps('seek', androidFocusHandles) : null;

  return (
    <View style={styles.host} pointerEvents="box-none">
      <UnifiedPlayerSeekRemoteListener
        enabled={visible && focusedControl === 'seek'}
        durationMs={durationMs}
        onSeekDelta={applySeekDelta}
        onFocusSeek={() => focusControl('seek')}
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
            <Text style={styles.timeBadge}>{`${elapsed} / ${durationLabel}`}</Text>
          </View>

          <SeekFocusGuideView
            {...(Platform.OS === 'android' && reactNative.TVFocusGuideView ? { trapFocusLeft: true, trapFocusRight: true } : {})}
            style={styles.seekGuide}>
            <Pressable
              ref={assignSeekRef}
              focusable={visible}
              accessibilityRole="button"
              accessibilityLabel="Seek"
              {...(seekFocusProps ?? {})}
              {...({ onKeyDown: handleControlKeyDown('seek') } as any)}
              onPress={() => {
                const commitTargetMs = seekTargetMsRef.current ?? activeSeekPositionMs;
                const nextPositionMs = clampSeekPosition(commitTargetMs);
                handleControlPress('seek', 'commit-seek', () => onSeek(nextPositionMs));
                seekTargetMsRef.current = null;
                setSeekTargetMs(null);
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
          </View>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    ...StyleSheet.absoluteFill,
    zIndex: 3,
    elevation: 8,
    justifyContent: 'flex-end',
  },
  panelWrap: {
    zIndex: 3,
    elevation: 8,
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
  timeBadge: {
    color: novaTheme.colors.textMuted,
    fontSize: 11,
    fontWeight: '700',
    minWidth: 88,
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
});
