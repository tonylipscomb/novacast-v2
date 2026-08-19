import type { ComponentProps } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, useWindowDimensions, View } from 'react-native';

import { isNovaCastTraceLoggingEnabled } from '../../diagnostics/novacastLogPolicy.ts';
import { NovaStreamSurface } from '@/features/playback/NovaStreamPlayer';
import type { VideoPlayer } from 'expo-video';

import { PlaybackUpNextOverlay } from '../continuity/PlaybackUpNextOverlay';
import { UnifiedPlayerControls } from './UnifiedPlayerControls';
import { UnifiedPlayerErrorState } from './UnifiedPlayerErrorState';
import { UnifiedPlayerLoadingState } from './UnifiedPlayerLoadingState';
import type { PlaybackMediaType, UnifiedPlayerState } from './types.ts';
import { shouldShowUnifiedErrorState, shouldShowUnifiedLoadingState } from './unifiedPlayerLogic.ts';
import {
  resolveMovieCompatibilityErrorCopy,
  shouldRetryMovieUnsupportedFormat,
} from './moviePlaybackCompatibility.ts';
import {
  type PlayerChromeRevealSource,
  type VodSeekDirection,
} from './vodSeek.ts';

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
  onRevealControls: (source?: PlayerChromeRevealSource) => void;
  onRetry: () => void;
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
  onVodDirectionalSeek?: (
    direction: VodSeekDirection,
    source: 'hidden-focus-sentinel',
    eventKeyAction?: number | null,
  ) => void;
  upNext?: {
    secondsLeft: number;
    title: string;
    seasonNumber?: string;
    episodeNumber?: string;
    autoplay?: boolean;
  } | null;
  onPlayNextEpisode?: () => void;
  onPreviousEpisode?: () => void;
  onNextEpisode?: () => void;
  canGoPreviousEpisode?: boolean;
  canGoNextEpisode?: boolean;
  onCancelUpNext?: () => void;
};

const BUILD_MARKER = 'playback-recovery-phase1-textureview';
const BUILD_MARKER_LOOP_FIX = 'playback-recovery-phase1b-controls-loop-fix';
const BUILD_MARKER_VOD_SURFACE = 'rc-firetv-vod-textureview';

export function resolveUnifiedPlayerSurfaceType(
  mediaType: PlaybackMediaType | null | undefined,
): 'textureView' | 'surfaceView' {
  // VOD only. Live TV (and any non-Android surface) stays SurfaceView.
  // SurfaceView is a separate hardware overlay and covers RN chrome on Fire TV.
  if (Platform.OS === 'android' && mediaType && mediaType !== 'live') {
    return 'textureView';
  }
  return 'surfaceView';
}

function logPlaybackRecovery(event: string, payload: Record<string, unknown>) {
  if (!isNovaCastTraceLoggingEnabled()) {
    return;
  }
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
  pendingSeekDirection = null,
  onPendingSeekConsumed,
  onSeekPreviewActiveChange,
  onRegisterCancelSeekPreview,
  onRegisterHiddenVodSeekPreview,
  onRegisterRequestTimelineFocus,
  onRegisterRequestDefaultFocus,
  onRegisterVodSeekQuery,
  onVodDirectionalSeek,
  upNext,
  onPlayNextEpisode,
  onPreviousEpisode,
  onNextEpisode,
  canGoPreviousEpisode = false,
  canGoNextEpisode = false,
  onCancelUpNext,
}: UnifiedPlayerOverlayProps) {
  const { width, height } = useWindowDimensions();
  const [firstFrameReady, setFirstFrameReady] = useState(false);
  const layoutSizeRef = useRef({ width: 0, height: 0 });
  const markerLoggedRef = useRef(false);
  const lastRecoveryLogKeyRef = useRef<string | null>(null);
  const showError = shouldShowUnifiedErrorState(state.machineState) && Boolean(state.errorMessage);
  const showLoading = shouldShowUnifiedLoadingState(state.machineState) && !firstFrameReady;
  const requestedSurfaceType = resolveUnifiedPlayerSurfaceType(state.item?.mediaType);
  const effectiveSurfaceType = requestedSurfaceType;

  useEffect(() => {
    if (markerLoggedRef.current) {
      return;
    }
    markerLoggedRef.current = true;
    if (isNovaCastTraceLoggingEnabled()) {
      console.info(`[NovaCast Build] ${BUILD_MARKER}`);
      console.info(`[NovaCast Build] ${BUILD_MARKER_LOOP_FIX}`);
      console.info(`[NovaCast Build] ${BUILD_MARKER_VOD_SURFACE}`);
    }
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
      requestedSurfaceType,
      layoutSizeRef.current.width,
      layoutSizeRef.current.height,
    ].join('|');
    if (lastRecoveryLogKeyRef.current === logKey) {
      return;
    }
    lastRecoveryLogKeyRef.current = logKey;

    logPlaybackRecovery('overlay-state', {
      buildMarker: BUILD_MARKER_VOD_SURFACE,
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
      requestedSurfaceType,
      effectiveSurfaceType,
      surfaceType: effectiveSurfaceType,
      controlsVisible: state.controlsVisible,
      showLoading,
      showError,
      interactionLayerMounted: false,
    });
  }, [
    effectiveSurfaceType,
    firstFrameReady,
    height,
    player,
    requestedSurfaceType,
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
        style={[
          styles.player,
          { width, height },
          effectiveSurfaceType === 'textureView' ? styles.texturePlayer : null,
        ]}
        contentFit={state.contentFit}
        surfaceType={effectiveSurfaceType}
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
          visible={state.controlsVisible && !upNext}
          isPlaying={state.isPlaying}
          positionMs={state.positionMs}
          durationMs={state.durationMs}
          onTogglePlay={onTogglePlay}
          onRewind={onRewind}
          onForward={onForward}
          onSeek={onSeek}
          onBack={onBack}
          onReveal={onRevealControls}
          allowSeek={state.item?.mediaType !== 'live'}
          mediaType={state.item?.mediaType}
          contentId={state.item?.id}
          pendingSeekDirection={pendingSeekDirection}
          onPendingSeekConsumed={onPendingSeekConsumed}
          onSeekPreviewActiveChange={onSeekPreviewActiveChange}
          onRegisterCancelSeekPreview={onRegisterCancelSeekPreview}
          onRegisterHiddenVodSeekPreview={onRegisterHiddenVodSeekPreview}
          onRegisterRequestTimelineFocus={onRegisterRequestTimelineFocus}
          onRegisterRequestDefaultFocus={onRegisterRequestDefaultFocus}
          onRegisterVodSeekQuery={onRegisterVodSeekQuery}
          onVodDirectionalSeek={onVodDirectionalSeek}
          onPreviousEpisode={onPreviousEpisode}
          onNextEpisode={onNextEpisode}
          canGoPreviousEpisode={canGoPreviousEpisode}
          canGoNextEpisode={canGoNextEpisode}
          upNextActive={Boolean(upNext)}
        />
      ) : null}

      {upNext ? (
      <PlaybackUpNextOverlay
        visible
        secondsLeft={upNext.secondsLeft}
        title={upNext.title}
        seasonNumber={upNext.seasonNumber}
        episodeNumber={upNext.episodeNumber}
        autoplay={upNext.autoplay !== false}
        onPlayNow={() => onPlayNextEpisode?.()}
        onCancel={() => onCancelUpNext?.()}
      />
      ) : null}

      {showError ? (
        <UnifiedPlayerErrorState
          title={
            resolveMovieCompatibilityErrorCopy({
              errorMessage: state.errorMessage,
              errorCategory: state.errorCategory,
            }).title
          }
          message={
            resolveMovieCompatibilityErrorCopy({
              errorMessage: state.errorMessage,
              errorCategory: state.errorCategory,
            }).message
          }
          canRetry={shouldRetryMovieUnsupportedFormat(state.errorCategory)}
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
  texturePlayer: {
    // TextureView composites in the RN tree. Elevation on this host would
    // cover chrome that intentionally has zIndex only (no elevation).
    elevation: 0,
  },
  closingCover: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000000',
    zIndex: 101,
  },
});
