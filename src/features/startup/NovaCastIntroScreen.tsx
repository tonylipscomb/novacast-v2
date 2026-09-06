import { useEventListener } from 'expo';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { logStartupPhase } from '@/features/startup/startupDiagnostics.ts';
import { markNovaCastIntroPlayed } from '@/features/startup/novaCastIntroSession.ts';

const INTRO_VIDEO = require('../../../NovacastIntro.mp4');
const INTRO_UNKNOWN_DURATION_FALLBACK_MS = 15_000;
const INTRO_DURATION_TOLERANCE_MS = 750;
const INTRO_INITIALIZING_MINIMUM_MS = 1_000;

type NovaCastIntroScreenProps = {
  onReady?: () => void;
  onFinished: () => void;
  appStartupReady?: boolean;
};

function resolveIntroFallbackMs(durationSeconds: number): number {
  if (Number.isFinite(durationSeconds) && durationSeconds > 0) {
    return Math.round(durationSeconds * 1000) + INTRO_DURATION_TOLERANCE_MS;
  }
  return INTRO_UNKNOWN_DURATION_FALLBACK_MS;
}

export function NovaCastIntroScreen({ onReady, onFinished, appStartupReady = false }: NovaCastIntroScreenProps) {
  const finishedRef = useRef(false);
  const readyRef = useRef(false);
  const confirmedDurationRef = useRef<number | null>(null);
  const sourceLoadedRef = useRef(false);
  const earlyPlayToEndResumeAttemptedRef = useRef(false);
  const fallbackTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const initializingTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const videoCompletedRef = useRef(false);
  const [videoCompleted, setVideoCompleted] = useState(false);
  const [initializingMinimumElapsed, setInitializingMinimumElapsed] = useState(false);

  const player = useVideoPlayer(INTRO_VIDEO, (nextPlayer) => {
    nextPlayer.loop = false;
    nextPlayer.muted = false;
    nextPlayer.play();
  });

  const logIntro = useCallback(
    (event: string, extra: Record<string, unknown> = {}) => {
      console.info('[NovaCast Cold Intro]', {
        event,
        durationSeconds: Number.isFinite(player.duration) && player.duration > 0 ? player.duration : null,
        confirmedDurationSeconds: confirmedDurationRef.current,
        currentTimeSeconds: Number.isFinite(player.currentTime) ? player.currentTime : null,
        playerStatus: player.status,
        playing: player.playing,
        finishReason: extra.finishReason ?? null,
        ...extra,
      });
    },
    // player is stable for the lifetime of this screen; this callback is used
    // by the player event listeners below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const finish = useCallback(
    (reason: string) => {
      if (finishedRef.current) {
        return;
      }
      finishedRef.current = true;
      if (fallbackTimerRef.current) {
        clearTimeout(fallbackTimerRef.current);
        fallbackTimerRef.current = undefined;
      }
      markNovaCastIntroPlayed();
      logIntro('finish', { finishReason: reason });
      logStartupPhase(`cold intro finished (${reason})`);
      onFinished();
    },
    [logIntro, onFinished],
  );

  useEffect(() => {
    if (!videoCompleted) {
      return;
    }

    initializingTimerRef.current = setTimeout(() => {
      initializingTimerRef.current = undefined;
      setInitializingMinimumElapsed(true);
    }, INTRO_INITIALIZING_MINIMUM_MS);

    return () => {
      if (initializingTimerRef.current) {
        clearTimeout(initializingTimerRef.current);
        initializingTimerRef.current = undefined;
      }
    };
  }, [videoCompleted]);

  useEffect(() => {
    if (!videoCompleted || !appStartupReady || !initializingMinimumElapsed) {
      return;
    }

    finish('video-complete-and-startup-ready');
  }, [appStartupReady, finish, initializingMinimumElapsed, videoCompleted]);

  const reportMediaReadyForSplashHandoff = useCallback(() => {
    if (readyRef.current) {
      return;
    }
    readyRef.current = true;
    logIntro('native-splash-handoff-ready');
    logStartupPhase('cold intro media ready for splash handoff');
    onReady?.();
  }, [logIntro, onReady]);

  const reportFirstFrame = useCallback(() => {
    logIntro('first-frame');
    logStartupPhase('cold intro first frame');
  }, [logIntro]);

  const armFallback = useCallback(
    (durationSeconds?: number) => {
      if (finishedRef.current) {
        return;
      }
      if (fallbackTimerRef.current) {
        clearTimeout(fallbackTimerRef.current);
      }
      const fallbackMs = resolveIntroFallbackMs(durationSeconds ?? Number.NaN);
      fallbackTimerRef.current = setTimeout(() => {
        if (videoCompletedRef.current) {
          fallbackTimerRef.current = undefined;
          return;
        }
        logIntro('fallback-timeout', { finishReason: 'fallback-timeout' });
        videoCompletedRef.current = true;
        setVideoCompleted(true);
      }, fallbackMs);
    },
    [finish, logIntro],
  );

  useEffect(() => {
    logIntro('mount');
    logStartupPhase('cold intro started');
    player.play();
    armFallback();
    logIntro('unknown-fallback-armed');

    return () => {
      if (fallbackTimerRef.current) {
        clearTimeout(fallbackTimerRef.current);
        fallbackTimerRef.current = undefined;
      }
      if (initializingTimerRef.current) {
        clearTimeout(initializingTimerRef.current);
        initializingTimerRef.current = undefined;
      }
    };
  }, [armFallback, logIntro, player]);

  useEventListener(player, 'playToEnd', () => {
    const confirmedDuration = confirmedDurationRef.current;
    const currentTime = player.currentTime;
    if (
      confirmedDuration != null &&
      Number.isFinite(currentTime) &&
      currentTime < confirmedDuration - INTRO_DURATION_TOLERANCE_MS / 1000
    ) {
      logIntro('early-play-to-end', { finishReason: 'early-play-to-end' });
      if (!earlyPlayToEndResumeAttemptedRef.current && !player.playing) {
        earlyPlayToEndResumeAttemptedRef.current = true;
        player.play();
      }
      return;
    }

    logIntro('play-to-end', { finishReason: 'playToEnd' });
    if (fallbackTimerRef.current) {
      clearTimeout(fallbackTimerRef.current);
      fallbackTimerRef.current = undefined;
    }
    videoCompletedRef.current = true;
    player.pause();
    setVideoCompleted(true);
  });

  useEventListener(player, 'sourceLoad', ({ duration }) => {
    logIntro('source-load');
    if (Number.isFinite(duration) && duration > 0) {
      sourceLoadedRef.current = true;
      confirmedDurationRef.current = duration;
      earlyPlayToEndResumeAttemptedRef.current = false;
      logIntro('confirmed-duration');
    }
    armFallback(duration);
  });

  useEventListener(player, 'statusChange', ({ status, error }) => {
    if (status === 'readyToPlay') {
      const readyDuration = player.duration;
      const confirmedDuration = confirmedDurationRef.current;
      const acceptsReadyDuration =
        sourceLoadedRef.current &&
        Number.isFinite(readyDuration) &&
        readyDuration > 0 &&
        (confirmedDuration == null || readyDuration >= confirmedDuration * 0.8);
      logIntro('ready-to-play', {
        readyDurationSeconds: Number.isFinite(readyDuration) && readyDuration > 0 ? readyDuration : null,
        sourceLoaded: sourceLoadedRef.current,
        readyDurationAccepted: acceptsReadyDuration,
      });
      if (acceptsReadyDuration) {
        confirmedDurationRef.current = readyDuration;
        armFallback(readyDuration);
        reportMediaReadyForSplashHandoff();
      }
    }
    if (status === 'error') {
      logIntro('player-error', { finishReason: 'player-error' });
      console.warn('[NovaCast Startup] intro playback failed; continuing into app', {
        reason: error?.message ? 'player-error' : 'unknown',
      });
      reportMediaReadyForSplashHandoff();
      finish('player-error');
    }
  });

  return (
    <View
      pointerEvents="none"
      focusable={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.root}>
      <VideoView
        player={player}
        style={styles.video}
        contentFit="contain"
        nativeControls={false}
        allowsPictureInPicture={false}
        startsPictureInPictureAutomatically={false}
        requiresLinearPlayback
        fullscreenOptions={{ enable: false }}
        useExoShutter={false}
        focusable={false}
        surfaceType="textureView"
        onFirstFrameRender={reportFirstFrame}
      />
      {videoCompleted ? (
        <View pointerEvents="none" style={styles.initializingLabel}>
          <Text style={styles.initializingText}>SIGNAL INITIALIZING...</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000000',
  },
  video: {
    flex: 1,
    width: '100%',
    height: '100%',
    backgroundColor: '#000000',
  },
  initializingLabel: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 36,
    alignItems: 'center',
  },
  initializingText: {
    color: 'rgba(191, 219, 254, 0.78)',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 4.2,
  },
});
