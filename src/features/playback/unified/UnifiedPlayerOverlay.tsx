import { useCallback, useEffect, useState } from 'react';
import { Platform, StyleSheet, useWindowDimensions, View } from 'react-native';

import { NovaStreamSurface } from '@/features/playback/NovaStreamPlayer';
import type { VideoPlayer } from 'expo-video';

import { UnifiedPlayerControls } from './UnifiedPlayerControls';
import { UnifiedPlayerErrorState } from './UnifiedPlayerErrorState';
import { UnifiedPlayerInteractionLayer } from './UnifiedPlayerInteractionLayer';
import { UnifiedPlayerLoadingState } from './UnifiedPlayerLoadingState';
import type { UnifiedPlayerState } from './types.ts';
import {
  shouldShowUnifiedErrorState,
  shouldShowUnifiedLoadingState,
} from './unifiedPlayerLogic.ts';

type UnifiedPlayerOverlayProps = {
  player: VideoPlayer;
  state: UnifiedPlayerState;
  onFirstFrameRender?: () => void;
  onTogglePlay: () => void;
  onRewind: () => void;
  onForward: () => void;
  onSeek: (nextPositionMs: number) => void;
  onBack: () => void;
  onRetry: () => void;
  onRevealControls: () => void;
};

export function UnifiedPlayerOverlay({
  player,
  state,
  onFirstFrameRender,
  onTogglePlay,
  onRewind,
  onForward,
  onSeek,
  onBack,
  onRetry,
  onRevealControls,
}: UnifiedPlayerOverlayProps) {
  const { width, height } = useWindowDimensions();
  const [firstFrameReady, setFirstFrameReady] = useState(false);
  const showError = shouldShowUnifiedErrorState(state.machineState) && Boolean(state.errorMessage);
  const captureRemoteInput = !state.controlsVisible && !showError;

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

  const handleFirstFrameRender = useCallback(() => {
    setFirstFrameReady(true);
    onFirstFrameRender?.();
  }, [onFirstFrameRender]);

  const showLoading = shouldShowUnifiedLoadingState(state.machineState) && !firstFrameReady;

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
    <View style={[styles.overlay, { width, height }]} accessibilityViewIsModal collapsable={false}>
      <NovaStreamSurface
        player={player}
        style={[styles.player, { width, height }]}
        contentFit={state.contentFit}
        onFirstFrameRender={handleFirstFrameRender}
      />

      {showLoading ? <UnifiedPlayerLoadingState title={state.item?.title} /> : null}

      {!showError ? (
        <>
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
          <UnifiedPlayerInteractionLayer
            active={captureRemoteInput}
            onTogglePlay={onTogglePlay}
            onRevealControls={onRevealControls}
          />
        </>
      ) : null}
      {showError ? (
        <UnifiedPlayerErrorState
          message={state.errorMessage ?? 'Playback could not start.'}
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
