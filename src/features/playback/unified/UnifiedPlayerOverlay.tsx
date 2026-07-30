import type { ComponentProps } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, useWindowDimensions, View } from 'react-native';

import { NovaStreamSurface } from '@/features/playback/NovaStreamPlayer';
import type { VideoPlayer } from 'expo-video';

import { UnifiedPlayerControls } from './UnifiedPlayerControls';
import { UnifiedPlayerErrorState } from './UnifiedPlayerErrorState';
import { UnifiedPlayerLoadingState } from './UnifiedPlayerLoadingState';
import type { UnifiedPlayerState } from './types.ts';
import { shouldShowUnifiedErrorState, shouldShowUnifiedLoadingState } from './unifiedPlayerLogic.ts';

type NovaStreamSurfaceProps = ComponentProps<typeof NovaStreamSurface>;

type UnifiedPlayerOverlayProps = {
  player: VideoPlayer;
  state: UnifiedPlayerState;
  onFirstFrameRender: NonNullable<NovaStreamSurfaceProps['onFirstFrameRender']>;
  onStatusChange: NonNullable<NovaStreamSurfaceProps['onStatusChange']>;
  onPlayingChange: NonNullable<NovaStreamSurfaceProps['onPlayingChange']>;
  onTimeUpdate: NonNullable<NovaStreamSurfaceProps['onTimeUpdate']>;
  onTogglePlay: () => void;
  onRewind: () => void;
  onForward: () => void;
  onSeek: (nextPositionMs: number) => void;
  onBack: () => void;
  onRevealControls: () => void;
  onRetry: () => void;
};

const BUILD_MARKER = 'playback-recovery-phase1-textureview';
const BUILD_MARKER_LOOP_FIX = 'playback-recovery-phase1b-controls-loop-fix';

function logPlaybackRecovery(event: string, payload: Record<string, unknown>) {
  console.info('[NovaCast Playback Recovery]', event, payload);
}

export function UnifiedPlayerOverlay({
  player,
  state,
  onFirstFrameRender,
  onStatusChange,
  onPlayingChange,
  onTimeUpdate,
  onTogglePlay,
  onRewind,
  onForward,
  onSeek,
  onBack,
  onRevealControls,
  onRetry,
}: UnifiedPlayerOverlayProps) {
  const { width, height } = useWindowDimensions();
  const [firstFrameReady, setFirstFrameReady] = useState(false);
  const layoutSizeRef = useRef({ width: 0, height: 0 });
  const markerLoggedRef = useRef(false);
  const lastRecoveryLogKeyRef = useRef<string | null>(null);
  const showError = shouldShowUnifiedErrorState(state.machineState) && Boolean(state.errorMessage);
  const showLoading = shouldShowUnifiedLoadingState(state.machineState) && !firstFrameReady;
  // Remote OK / D-pad while chrome is hidden is owned by UnifiedPlayerRemoteHandlers.
  // Do not mount a full-screen elevated Pressable above VideoView on Android TV.

  useEffect(() => {
    if (markerLoggedRef.current) {
      return;
    }
    markerLoggedRef.current = true;
    console.info(`[NovaCast Build] ${BUILD_MARKER}`);
    console.info(`[NovaCast Build] ${BUILD_MARKER_LOOP_FIX}`);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      setFirstFrameReady(false);
    }, 0);

    return () => clearTimeout(timer);
  }, [state.item?.id]);

  useEffect(() => {
    if (state.machineState === 'idle' || state.machineState === 'closing') {
      const timer = setTimeout(() => {
        setFirstFrameReady(false);
      }, 0);

      return () => clearTimeout(timer);
    }

    return undefined;
  }, [state.machineState]);

  useEffect(() => {
    if (state.machineState === 'idle' || state.machineState === 'closing') {
      return;
    }

    let playerStatus: string | null = null;
    let playerPlaying: boolean | null = null;
    try {
      playerStatus = player.status;
      playerPlaying = player.playing;
    } catch {
      // Player may be releasing during close.
    }

    const logKey = [
      state.machineState,
      playerStatus,
      playerPlaying,
      firstFrameReady,
      state.controlsVisible,
      showLoading,
      showError,
      layoutSizeRef.current.width,
      layoutSizeRef.current.height,
    ].join('|');
    if (lastRecoveryLogKeyRef.current === logKey) {
      return;
    }
    lastRecoveryLogKeyRef.current = logKey;

    logPlaybackRecovery('overlay-state', {
      buildMarker: BUILD_MARKER,
      mediaType: state.item?.mediaType ?? null,
      machineState: state.machineState,
      hasStreamUrl: Boolean(state.item?.streamUrl),
      playerStatus,
      playerPlaying,
      firstFrameReady,
      overlayWidth: width,
      overlayHeight: height,
      playerHostWidth: layoutSizeRef.current.width,
      playerHostHeight: layoutSizeRef.current.height,
      surfaceType: 'surfaceView',
      controlsVisible: state.controlsVisible,
      showLoading,
      showError,
      interactionLayerMounted: false,
    });
  }, [
    firstFrameReady,
    height,
    player,
    showError,
    showLoading,
    state.controlsVisible,
    state.item?.mediaType,
    state.item?.streamUrl,
    state.machineState,
    width,
  ]);
  const handleFirstFrameRender = useCallback(() => {
    setFirstFrameReady(true);
    logPlaybackRecovery('first-frame', {
      mediaType: state.item?.mediaType ?? null,
      machineState: state.machineState,
      hasStreamUrl: Boolean(state.item?.streamUrl),
    });
    onFirstFrameRender();
  }, [onFirstFrameRender, state.item?.mediaType, state.item?.streamUrl, state.machineState]);

  if (state.machineState === 'idle') {
    return null;
  }

  if (state.machineState === 'closing') {
    return (
      <View style={[styles.overlay, { width, height }]}>
        <View style={styles.closingCover} />
      </View>
    );
  }

  return (
    <View
      style={[styles.overlay, { width, height }]}
      accessibilityViewIsModal
      collapsable={false}
      onLayout={(event) => {
        const next = event.nativeEvent.layout;
        layoutSizeRef.current = { width: next.width, height: next.height };
      }}>
      <NovaStreamSurface
        player={player}
        style={[styles.player, { width, height }]}
        contentFit={state.contentFit}
        surfaceType="surfaceView"
        onFirstFrameRender={handleFirstFrameRender}
        onStatusChange={onStatusChange}
        onPlayingChange={onPlayingChange}
        onTimeUpdate={onTimeUpdate}
      />

      {showLoading ? <UnifiedPlayerLoadingState title={state.item?.title} /> : null}

      {!showError ? (
        <UnifiedPlayerControls
          title={state.item?.title ?? 'Playback'}
          subtitle={state.item?.subtitle}
          visible={state.controlsVisible}
          isPlaying={state.isPlaying}
          positionMs={state.positionMs}
          durationMs={state.durationMs}
          onTogglePlay={onTogglePlay}
          onRewind={onRewind}
          onForward={onForward}
          onSeek={onSeek}
          onBack={onBack}
          onReveal={onRevealControls}
        />
      ) : null}

      {showError ? (
        <UnifiedPlayerErrorState
          message={state.errorMessage ?? 'Playback unavailable'}
          onRetry={onRetry}
          onBack={onBack}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    // Transparent so SurfaceView can punch through; opaque black here left a blank
    // Modal frame when the player surface failed to take size.
    backgroundColor: 'transparent',
    zIndex: 100,
    elevation: Platform.OS === 'android' ? 100 : 6,
  },
  player: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000000',
    zIndex: 1,
    elevation: Platform.OS === 'android' ? 1 : 0,
  },
  closingCover: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000000',
    zIndex: 101,
  },
});
