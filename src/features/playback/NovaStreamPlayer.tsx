import {
  type PlayingChangeEventPayload,
  type StatusChangeEventPayload,
  type TimeUpdateEventPayload,
  type VideoPlayer,
  type VideoSource,
  useVideoPlayer,
  VideoView,
} from 'expo-video';
import {
  applyVodBufferProfile,
  logVodPlayerMemory,
  noteVodPlayerCreated,
  noteVodPlayerReleased,
  primeVodHeapLimit,
  resolveVodBufferProfile,
  subscribeVodHeapProfile,
} from './vodPlayerMemory.ts';
import { isNovaCastTraceLoggingEnabled } from '../diagnostics/novacastLogPolicy.ts';
import { type ComponentProps, useCallback, useEffect, useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { useEventListener } from 'expo';
import { isVideoDecoderInitFailure, UNSUPPORTED_VIDEO_FORMAT_CATEGORY } from './unified/moviePlaybackCompatibility.ts';

let nextPlayerGenerationId = 1;
const playerGenerationIds = new WeakMap<object, number>();

function getPlayerGenerationId(player: VideoPlayer) {
  const existing = playerGenerationIds.get(player);
  if (existing) return existing;
  const next = nextPlayerGenerationId++;
  playerGenerationIds.set(player, next);
  return next;
}

function nativeErrorText(error: unknown) {
  if (typeof error === 'string') {
    return error;
  }
  if (error instanceof Error) {
    return `${error.name} ${error.message}`;
  }
  if (error && typeof error === 'object') {
    const record = error as { name?: unknown; message?: unknown; localizedMessage?: unknown; code?: unknown };
    return [record.name, record.message, record.localizedMessage, record.code].filter(Boolean).join(' ');
  }
  return String(error ?? '');
}

function normalizedNativeErrorCategory(message: unknown) {
  const value = typeof message === 'string' ? message : nativeErrorText(message);
  if (isVideoDecoderInitFailure(value)) return UNSUPPORTED_VIDEO_FORMAT_CATEGORY;
  const lowered = value.toLowerCase();
  if (/outofmemory|out of memory|oom/.test(lowered)) return 'oom';
  if (/decoder|decode|codec|format/.test(lowered)) return 'decoder';
  if (/unsupported|not supported/.test(lowered)) return 'unsupported';
  if (/timeout|timed out|stall/.test(lowered)) return 'timeout';
  if (/network|connection|offline|unreachable|dns/.test(lowered)) return 'network';
  return value.trim() ? 'unknown' : 'unknown';
}

type NovaStreamPlayerOptions = {
  autoPlay?: boolean;
  muted?: boolean;
  onError?: (message: string) => void;
  onReady?: () => void;
  /**
   * Live keeps expo-video defaults. VOD applies a bounded Media3 LoadControl
   * so progressive MKV cannot grow DefaultAllocator to the Java heap ceiling.
   */
  bufferPolicy?: 'vod' | 'live';
};

type NovaStreamSurfaceProps = {
  player: VideoPlayer;
  /**
   * Fires once the mounted player has actually decoded and rendered a frame
   * into the VideoView. `playing`/`readyToPlay` status alone only means
   * playback has started internally - it is not proof a frame is visible,
   * which is what leaves a black surface on some live streams.
   */
  onFirstFrameRender?: () => void;
  contentFit?: 'contain' | 'cover' | 'fill';
  surfaceType?: ComponentProps<typeof VideoView>['surfaceType'];
  style?: object;
};

type NovaStreamSurfaceEvents = {
  onStatusChange?: (payload: StatusChangeEventPayload) => void;
  onPlayingChange?: (payload: PlayingChangeEventPayload) => void;
  onTimeUpdate?: (payload: TimeUpdateEventPayload) => void;
};

type NovaStreamPlayerProps = NovaStreamPlayerOptions & {
  streamUrl: string | null;
  onFirstFrameRender?: () => void;
  contentFit?: 'contain' | 'cover' | 'fill';
  style?: object;
};

function replacePlayerSource(player: VideoPlayer, source: VideoSource) {
  try {
    if (typeof player.replaceAsync === 'function') {
      return player.replaceAsync(source);
    }

    player.replace(source);
    return Promise.resolve();
  } catch (error) {
    return Promise.reject(error);
  }
}

export function useNovaStreamPlayer(streamUrl: VideoSource, options: NovaStreamPlayerOptions = {}) {
  const { autoPlay = true, muted = false, onError, onReady, bufferPolicy = 'live' } = options;
  const lastUrlRef = useRef(streamUrl);
  const lastPlayerRef = useRef<VideoPlayer | null>(null);
  const onErrorRef = useRef(onError);
  const onReadyRef = useRef(onReady);
  const bufferPolicyRef = useRef(bufferPolicy);

  useEffect(() => {
    onErrorRef.current = onError;
    onReadyRef.current = onReady;
    bufferPolicyRef.current = bufferPolicy;
  }, [bufferPolicy, onError, onReady]);

  useEffect(() => {
    if (bufferPolicy !== 'vod') {
      return;
    }
    void primeVodHeapLimit();
  }, [bufferPolicy]);

  const stableSource = useMemo(() => streamUrl, [streamUrl]);
  const player = useVideoPlayer(stableSource, (nextPlayer) => {
    if (bufferPolicyRef.current === 'vod') {
      applyVodBufferProfile(nextPlayer);
    }
    nextPlayer.muted = muted;
    if (autoPlay && streamUrl) {
      nextPlayer.play();
    }
  });

  const playerGenerationId = getPlayerGenerationId(player);

  useEffect(() => {
    if (bufferPolicy !== 'vod') {
      return undefined;
    }
    noteVodPlayerCreated(playerGenerationId);
    const profile = applyVodBufferProfile(player);
    logVodPlayerMemory('player-created', {
      playerGenerationId,
    });
    const unsubscribe = subscribeVodHeapProfile(() => {
      const nextProfile = resolveVodBufferProfile();
      if (nextProfile.name !== profile.name) {
        applyVodBufferProfile(player, nextProfile);
        logVodPlayerMemory('buffer-profile-upgraded', { playerGenerationId });
      }
    });
    return () => {
      unsubscribe();
      noteVodPlayerReleased(playerGenerationId);
      logVodPlayerMemory('player-released', { playerGenerationId });
    };
  }, [bufferPolicy, player, playerGenerationId]);

  const lastLoggedPlayerGenerationRef = useRef<number | null>(null);
  useEffect(() => {
    const isNewGeneration = lastLoggedPlayerGenerationRef.current !== playerGenerationId;
    lastLoggedPlayerGenerationRef.current = playerGenerationId;
    if (!isNovaCastTraceLoggingEnabled()) {
      return;
    }
    console.info('[NovaCast Playback Player]', {
      event: 'player instance',
      reason: isNewGeneration ? 'new-generation' : 'source-effect',
      playerGenerationId,
      bufferPolicy,
      sourceObjectShape: streamUrl ? 'string' : 'null',
    });
  }, [bufferPolicy, player, playerGenerationId, streamUrl]);

  useEventListener(player, 'statusChange', ({ status, error }) => {
    const errorText = nativeErrorText(error?.message ?? error);
    const errorCategory = status === 'error' ? normalizedNativeErrorCategory(errorText) : undefined;
    if (status === 'error' || isNovaCastTraceLoggingEnabled()) {
      console.info('[NovaCast Playback Player]', {
        event: 'player status',
        status,
        playerGenerationId,
        errorCategory,
      });
    }
    if (bufferPolicy === 'vod' && status === 'error') {
      logVodPlayerMemory('playback-error', { playerGenerationId, errorCategory });
    }
    if (status === 'error' && lastUrlRef.current) {
      onErrorRef.current?.(errorText.trim() || 'Unable to play this stream right now.');
    }
  });

  const replaceRequestRef = useRef(0);

  useEffect(() => {
    if (!streamUrl) {
      if (!lastUrlRef.current) {
        lastPlayerRef.current = player;
        return;
      }

      replaceRequestRef.current += 1;
      lastUrlRef.current = null;
      lastPlayerRef.current = player;
      if (bufferPolicy === 'vod') {
        logVodPlayerMemory('source-cleared', { playerGenerationId });
      }
      try {
        player.pause();
        void replacePlayerSource(player, null).catch(() => {});
      } catch {
        // The hook-managed player may already be releasing during unmount.
      }
      return;
    }

    const playerChanged = lastPlayerRef.current !== player;
    lastPlayerRef.current = player;

    if (lastUrlRef.current === streamUrl) {
      return;
    }

    lastUrlRef.current = streamUrl;

    if (playerChanged) {
      // useVideoPlayer already constructed this generation with the new source.
      // A second replaceAsync would overlap two Media3 loads in one heap.
      if (bufferPolicy === 'vod') {
        logVodPlayerMemory('source-bound-on-new-generation', { playerGenerationId });
      }
      return;
    }

    const requestId = ++replaceRequestRef.current;
    if (bufferPolicy === 'vod') {
      applyVodBufferProfile(player);
      logVodPlayerMemory('source-replaced', { playerGenerationId });
    }

    void replacePlayerSource(player, streamUrl)
      .then(() => {
        if (requestId !== replaceRequestRef.current) {
          return;
        }

        player.muted = muted;
        if (autoPlay) {
          player.play();
        }
        onReadyRef.current?.();
      })
      .catch(() => {
        if (requestId === replaceRequestRef.current) {
          onErrorRef.current?.('Unable to start playback for this stream.');
        }
      });
  }, [autoPlay, bufferPolicy, muted, player, playerGenerationId, streamUrl]);

  useEffect(() => {
    return () => {
      replaceRequestRef.current += 1;
      try {
        player.pause();
        void replacePlayerSource(player, null).catch(() => {});
      } catch {
        // Player may already be released during unmount.
      }
    };
  }, [player]);

  const retry = useCallback(() => {
    if (!streamUrl) {
      return;
    }

    const requestId = ++replaceRequestRef.current;
    if (isNovaCastTraceLoggingEnabled()) {
      console.info('[NovaCast Playback Player]', {
        event: 'player retry',
        playerGenerationId,
        retryCount: requestId,
      });
    }
    if (bufferPolicy === 'vod') {
      applyVodBufferProfile(player);
      logVodPlayerMemory('retry', { playerGenerationId, retryCount: requestId });
    }
    void replacePlayerSource(player, streamUrl)
      .then(() => {
        if (requestId !== replaceRequestRef.current) {
          return;
        }

        player.muted = muted;
        if (autoPlay) {
          player.play();
        }
      })
      .catch(() => {
        if (requestId === replaceRequestRef.current) {
          onErrorRef.current?.('Unable to restart playback for this stream.');
        }
      });
  }, [autoPlay, bufferPolicy, muted, player, playerGenerationId, streamUrl]);

  return { player, retry, hasStream: Boolean(streamUrl) };
}

export function NovaStreamSurface({
  player,
  onFirstFrameRender,
  onStatusChange,
  onPlayingChange,
  onTimeUpdate,
  contentFit = 'contain',
  // Live TV relies on this default. VOD/episode passes textureView from UnifiedPlayerOverlay.
  surfaceType = 'surfaceView',
  style,
}: NovaStreamSurfaceProps & NovaStreamSurfaceEvents) {
  const onFirstFrameRenderRef = useRef(onFirstFrameRender);
  const onStatusChangeRef = useRef(onStatusChange);
  const onPlayingChangeRef = useRef(onPlayingChange);
  const onTimeUpdateRef = useRef(onTimeUpdate);
  useEffect(() => {
    onFirstFrameRenderRef.current = onFirstFrameRender;
    onStatusChangeRef.current = onStatusChange;
    onPlayingChangeRef.current = onPlayingChange;
    onTimeUpdateRef.current = onTimeUpdate;
  }, [onFirstFrameRender, onPlayingChange, onStatusChange, onTimeUpdate]);

  useEffect(() => {
    const statusSubscription = player.addListener('statusChange', (payload) => {
      onStatusChangeRef.current?.(payload);
    });
    const playingSubscription = player.addListener('playingChange', (payload) => {
      onPlayingChangeRef.current?.(payload);
    });
    const timeSubscription = player.addListener('timeUpdate', (payload) => {
      onTimeUpdateRef.current?.(payload);
    });

    return () => {
      statusSubscription.remove();
      playingSubscription.remove();
      timeSubscription.remove();
    };
  }, [player]);

  return (
    <View
      style={[styles.container, style]}
      collapsable={false}
      focusable={false}
      importantForAccessibility="no-hide-descendants">
      <VideoView
        player={player}
        style={styles.video}
        contentFit={contentFit}
        surfaceType={surfaceType}
        useExoShutter={false}
        nativeControls={false}
        onFirstFrameRender={() => onFirstFrameRenderRef.current?.()}
      />
    </View>
  );
}

function NovaStreamPlayerInner({
  streamUrl,
  autoPlay = true,
  muted = false,
  onError,
  onReady,
  onFirstFrameRender,
  contentFit = 'contain',
  style,
}: NovaStreamPlayerProps & { streamUrl: string }) {
  const { player } = useNovaStreamPlayer(streamUrl, { autoPlay, muted, onError, onReady });

  return (
    <NovaStreamSurface
      player={player}
      onFirstFrameRender={onFirstFrameRender}
      contentFit={contentFit}
      style={style}
    />
  );
}

export function NovaStreamPlayer(props: NovaStreamPlayerProps) {
  if (!props.streamUrl) {
    return null;
  }

  return <NovaStreamPlayerInner {...props} streamUrl={props.streamUrl} />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    minHeight: 0,
    backgroundColor: '#000000',
  },
  video: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
});
