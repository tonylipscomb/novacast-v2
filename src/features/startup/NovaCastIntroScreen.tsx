import { useEventListener } from 'expo';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';

import { logStartupPhase } from '@/features/startup/startupDiagnostics.ts';
import { markNovaCastIntroPlayed } from '@/features/startup/novaCastIntroSession.ts';

const INTRO_VIDEO = require('../../../NovacastIntro.mp4');
const INTRO_UNKNOWN_DURATION_FALLBACK_MS = 10_000;
const INTRO_DURATION_TOLERANCE_MS = 750;

type NovaCastIntroScreenProps = {
  onReady?: () => void;
  onFinished: () => void;
};

function resolveIntroFallbackMs(durationSeconds: number): number {
  if (Number.isFinite(durationSeconds) && durationSeconds > 0) {
    return Math.round(durationSeconds * 1000) + INTRO_DURATION_TOLERANCE_MS;
  }
  return INTRO_UNKNOWN_DURATION_FALLBACK_MS;
}

export function NovaCastIntroScreen({ onReady, onFinished }: NovaCastIntroScreenProps) {
  const finishedRef = useRef(false);
  const readyRef = useRef(false);
  const fallbackTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

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
      logStartupPhase(`cold intro finished (${reason})`);
      onFinished();
    },
    [onFinished],
  );

  const reportReady = useCallback(() => {
    if (readyRef.current) {
      return;
    }
    readyRef.current = true;
    logStartupPhase('cold intro first frame');
    onReady?.();
  }, [onReady]);

  const player = useVideoPlayer(INTRO_VIDEO, (nextPlayer) => {
    nextPlayer.loop = false;
    nextPlayer.muted = false;
    nextPlayer.play();
  });

  const armFallback = useCallback(
    (durationSeconds: number) => {
      if (finishedRef.current) {
        return;
      }
      if (fallbackTimerRef.current) {
        clearTimeout(fallbackTimerRef.current);
      }
      const fallbackMs = resolveIntroFallbackMs(durationSeconds);
      fallbackTimerRef.current = setTimeout(() => {
        finish('fallback-timeout');
      }, fallbackMs);
    },
    [finish],
  );

  useEffect(() => {
    markNovaCastIntroPlayed();
    logStartupPhase('cold intro started');
    player.play();
    armFallback(player.duration);

    return () => {
      if (fallbackTimerRef.current) {
        clearTimeout(fallbackTimerRef.current);
        fallbackTimerRef.current = undefined;
      }
    };
  }, [armFallback, player]);

  useEventListener(player, 'playToEnd', () => {
    finish('playToEnd');
  });

  useEventListener(player, 'sourceLoad', ({ duration }) => {
    armFallback(duration);
  });

  useEventListener(player, 'statusChange', ({ status, error }) => {
    if (status === 'readyToPlay' && player.duration > 0) {
      armFallback(player.duration);
    }
    if (status === 'error') {
      console.warn('[NovaCast Startup] intro playback failed; continuing into app', {
        reason: error?.message ? 'player-error' : 'unknown',
      });
      reportReady();
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
        onFirstFrameRender={reportReady}
      />
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
});
