import {
  type PlayingChangeEventPayload,
  type StatusChangeEventPayload,
  type TimeUpdateEventPayload,
  type VideoPlayer,
  type VideoSource,
  useVideoPlayer,
  VideoView,
} from 'expo-video';
import { type ComponentProps, useCallback, useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { useEventListener } from 'expo';

let nextPlayerGenerationId = 1;
const playerGenerationIds = new WeakMap<object, number>();

function getPlayerGenerationId(player: VideoPlayer) {
  const existing = playerGenerationIds.get(player);
  if (existing) return existing;
  const next = nextPlayerGenerationId++;
  playerGenerationIds.set(player, next);
  return next;
}

function normalizedNativeErrorCategory(message: unknown) {
  const value = typeof message === 'string' ? message.toLowerCase() : '';
  if (/decoder|decode|codec|format/.test(value)) return 'decoder';
  if (/unsupported|not supported/.test(value)) return 'unsupported';
  if (/timeout|timed out|stall/.test(value)) return 'timeout';
  if (/network|connection|offline|unreachable|dns/.test(value)) return 'network';
  return 'unknown';
}

type NovaStreamPlayerOptions = {
  autoPlay?: boolean;
  muted?: boolean;
  onError?: (message: string) => void;
  onReady?: () => void;
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

export function useNovaStreamPlayer(streamUrl: string | null, options: NovaStreamPlayerOptions = {}) {
  const { autoPlay = true, muted = false, onError, onReady } = options;
  const lastUrlRef = useRef(streamUrl);
  const onErrorRef = useRef(onError);
  const onReadyRef = useRef(onReady);

  useEffect(() => {
    onErrorRef.current = onError;
    onReadyRef.current = onReady;
  }, [onError, onReady]);

  const player = useVideoPlayer(streamUrl, (nextPlayer) => {
    nextPlayer.muted = muted;
    if (autoPlay && streamUrl) {
      nextPlayer.play();
    }
  });

  const playerGenerationId = getPlayerGenerationId(player);

  useEffect(() => {
    console.info('[NovaCast Playback Player]', {
      event: 'player instance',
      playerGenerationId,
      sourceObjectShape: streamUrl ? 'string' : 'null',
    });
  }, [player, playerGenerationId, streamUrl]);

  useEventListener(player, 'statusChange', ({ status, error }) => {
    console.info('[NovaCast Playback Player]', {
      event: 'player status',
      status,
      playerGenerationId,
      errorCategory: status === 'error' ? normalizedNativeErrorCategory(error?.message) : undefined,
    });
    if (status === 'error' && lastUrlRef.current) {
      onErrorRef.current?.(error?.message ?? 'Unable to play this stream right now.');
    }
  });

  const replaceRequestRef = useRef(0);

  useEffect(() => {
    if (!streamUrl) {
      if (!lastUrlRef.current) {
        return;
      }

      replaceRequestRef.current += 1;
      lastUrlRef.current = null;
      try {
        player.pause();
        void replacePlayerSource(player, null).catch(() => {});
      } catch {
        // The hook-managed player may already be releasing during unmount.
      }
      return;
    }

    if (lastUrlRef.current === streamUrl) {
      return;
    }

    lastUrlRef.current = streamUrl;
    const requestId = ++replaceRequestRef.current;

    void replacePlayerSource(player, streamUrl)
      .then(() => {
        if (requestId !== replaceRequestRef.current) {
          return;
        }

        // expo-video requires imperative player control for stream changes.
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
  }, [autoPlay, muted, player, playerGenerationId, streamUrl]);

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
    console.info('[NovaCast Playback Player]', {
      event: 'player retry',
      playerGenerationId,
      retryCount: requestId,
    });
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
  }, [autoPlay, muted, player, playerGenerationId, streamUrl]);

  return { player, retry, hasStream: Boolean(streamUrl) };
}

export function NovaStreamSurface({
  player,
  onFirstFrameRender,
  onStatusChange,
  onPlayingChange,
  onTimeUpdate,
  contentFit = 'contain',
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
