import { useEventListener } from 'expo';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Platform,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';

import { earlyBootMark } from '@/features/diagnostics/earlyBootAudit';
import { getAppSettings, getAppSettingsSync } from '@/features/settings/appSettingsStore';
import { logStartupPhase } from '@/features/startup/startupDiagnostics.ts';
import {
  resolveStartupStatusLabel,
  STARTUP_EXIT_FADE_MS,
  STARTUP_REDUCED_MOTION_INTRO_MS,
  STARTUP_VIDEO_DURATION_MS,
} from '@/features/startup/startupLogic.ts';
import { getThemeLogoSource } from '@/theme/brandingAssets';
import type { AppearanceThemeId } from '@/theme/variants';

const STARTUP_VIDEO = require('@/assets/videos/novacast-startup.mp4');
/** Android TV cold starts can take several seconds to decode the intro asset. */
const VIDEO_FIRST_FRAME_TIMEOUT_MS = 5_000;
/**
 * Stage 2.95: expo-video player construction stalls the JS thread ~600ms on ONN.
 * Prefer the existing logo intro on Android TV so first usable focus is not gated
 * by splash media decode. Non-TV keeps the video path.
 */
const PREFER_STATIC_TV_INTRO = Platform.OS === 'android' && Platform.isTV === true;

void getAppSettings();

type NovaCastLaunchSequenceProps = {
  exitRequested: boolean;
  startupReady?: boolean;
  playVideo?: boolean;
  onIntroComplete?: () => void;
  onVideoReady?: () => void;
  onExitComplete: () => void;
  onLayout?: (event: LayoutChangeEvent) => void;
};

type LaunchIntroVideoProps = {
  playVideo: boolean;
  onFirstFrame: () => void;
  onVideoFailed: () => void;
  onPlayToEnd: () => void;
  pauseToken: number;
};

/**
 * Isolated so the parent can defer mounting past first paint / first usable shell
 * without conditionally calling useVideoPlayer (Rules of Hooks).
 */
function LaunchIntroVideo({
  playVideo,
  onFirstFrame,
  onVideoFailed,
  onPlayToEnd,
  pauseToken,
}: LaunchIntroVideoProps) {
  const firstFrameTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const firstFrameReportedRef = useRef(false);

  const player = useVideoPlayer(STARTUP_VIDEO, (nextPlayer) => {
    nextPlayer.loop = false;
    nextPlayer.muted = true;
    if (playVideo) {
      nextPlayer.play();
    }
  });

  useEffect(() => {
    earlyBootMark('launch_video_player_created');
    logStartupPhase('startup video play requested');
    player.play();

    firstFrameTimerRef.current = setTimeout(() => {
      if (!firstFrameReportedRef.current) {
        logStartupPhase('startup video first frame timeout');
        onVideoFailed();
      }
    }, VIDEO_FIRST_FRAME_TIMEOUT_MS);

    return () => {
      if (firstFrameTimerRef.current) {
        clearTimeout(firstFrameTimerRef.current);
        firstFrameTimerRef.current = undefined;
      }
    };
  }, [onVideoFailed, player]);

  useEffect(() => {
    if (pauseToken > 0) {
      player.pause();
    }
  }, [pauseToken, player]);

  useEventListener(player, 'playToEnd', () => {
    logStartupPhase('startup video playToEnd');
    onPlayToEnd();
  });

  useEventListener(player, 'statusChange', ({ status, error }) => {
    logStartupPhase(`startup video status: ${status}`);
    if (status === 'error') {
      logStartupPhase(`startup video error: ${error?.message ?? 'unknown'}`);
      onVideoFailed();
    }
  });

  const handleVideoFirstFrame = useCallback(() => {
    if (firstFrameReportedRef.current) {
      return;
    }
    firstFrameReportedRef.current = true;
    if (firstFrameTimerRef.current) {
      clearTimeout(firstFrameTimerRef.current);
      firstFrameTimerRef.current = undefined;
    }
    earlyBootMark('launch_video_first_frame');
    logStartupPhase('startup video first frame');
    onFirstFrame();
  }, [onFirstFrame]);

  return (
    <View style={styles.videoStage}>
      <VideoView
        player={player}
        style={styles.video}
        contentFit="cover"
        nativeControls={false}
        allowsPictureInPicture={false}
        onFirstFrameRender={handleVideoFirstFrame}
      />
    </View>
  );
}

export function NovaCastLaunchSequence({
  exitRequested,
  startupReady = false,
  playVideo = true,
  onIntroComplete,
  onVideoReady,
  onExitComplete,
  onLayout,
}: NovaCastLaunchSequenceProps) {
  const [themeId, setThemeId] = useState<AppearanceThemeId>(() => getAppSettingsSync().appearanceTheme);
  const logoSource = useMemo(() => getThemeLogoSource(themeId), [themeId]);
  const [motionChecked, setMotionChecked] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [videoFailed, setVideoFailed] = useState(false);
  const [allowVideoMount, setAllowVideoMount] = useState(false);
  const [pauseToken, setPauseToken] = useState(0);
  const [screenOpacity] = useState(() => new Animated.Value(1));
  const [logoOpacity] = useState(() => new Animated.Value(0));
  const [statusOpacity] = useState(() => new Animated.Value(0));

  const introReportedRef = useRef(false);
  const exitStartedRef = useRef(false);
  const introTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const shouldUseVideo = playVideo && !reducedMotion && !videoFailed && !PREFER_STATIC_TV_INTRO;

  useEffect(() => {
    earlyBootMark('launch_sequence_mounted', {
      preferStaticTvIntro: PREFER_STATIC_TV_INTRO,
      isTV: Platform.isTV === true,
    });
    let mounted = true;
    void getAppSettings().then((settings) => {
      if (mounted) {
        setThemeId(settings.appearanceTheme);
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  // Defer expo-video native player creation one macrotask past first paint so it
  // cannot own the residual early-boot JS stall before Home focus wiring starts.
  useEffect(() => {
    if (PREFER_STATIC_TV_INTRO) {
      earlyBootMark('launch_video_skipped_tv_static');
      return;
    }
    earlyBootMark('launch_video_defer_scheduled');
    const timer = setTimeout(() => {
      earlyBootMark('launch_video_mount_allowed');
      setAllowVideoMount(true);
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  const reportIntroComplete = useCallback(() => {
    if (introReportedRef.current) {
      return;
    }

    introReportedRef.current = true;
    if (introTimerRef.current) {
      clearTimeout(introTimerRef.current);
      introTimerRef.current = undefined;
    }
    logStartupPhase('intro complete');
    onIntroComplete?.();
  }, [onIntroComplete]);

  const scheduleIntroCompletion = useCallback(() => {
    if (introTimerRef.current) {
      clearTimeout(introTimerRef.current);
    }

    introTimerRef.current = setTimeout(() => {
      reportIntroComplete();
    }, STARTUP_VIDEO_DURATION_MS + 250);
  }, [reportIntroComplete]);

  useEffect(() => {
    let mounted = true;

    void AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (mounted) {
          setReducedMotion(enabled);
          setMotionChecked(true);
        }
      })
      .catch(() => {
        if (mounted) {
          setMotionChecked(true);
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!motionChecked) {
      return;
    }

    scheduleIntroCompletion();

    return () => {
      if (introTimerRef.current) {
        clearTimeout(introTimerRef.current);
        introTimerRef.current = undefined;
      }
    };
  }, [motionChecked, scheduleIntroCompletion]);

  useEffect(() => {
    if (!motionChecked || shouldUseVideo) {
      return;
    }

    onVideoReady?.();
    Animated.parallel([
      Animated.timing(logoOpacity, {
        toValue: 1,
        duration: STARTUP_REDUCED_MOTION_INTRO_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(statusOpacity, {
        toValue: 1,
        duration: 220,
        delay: 120,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, [logoOpacity, motionChecked, onVideoReady, shouldUseVideo, statusOpacity]);

  useEffect(() => {
    if (!playVideo && motionChecked) {
      reportIntroComplete();
    }
  }, [motionChecked, playVideo, reportIntroComplete]);

  useEffect(() => {
    if (!exitRequested || exitStartedRef.current) {
      return;
    }

    exitStartedRef.current = true;
    setPauseToken((value) => value + 1);

    Animated.timing(screenOpacity, {
      toValue: 0,
      duration: STARTUP_EXIT_FADE_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start(({ finished }) => {
      if (finished) {
        onExitComplete();
      }
    });
  }, [exitRequested, onExitComplete, screenOpacity]);

  const statusLabel = resolveStartupStatusLabel(startupReady, exitRequested);

  const handleVideoFailed = useCallback(() => {
    setVideoFailed(true);
    onVideoReady?.();
  }, [onVideoReady]);

  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.root, { opacity: screenOpacity }]}
      onLayout={onLayout}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants">
      {shouldUseVideo && allowVideoMount ? (
        <LaunchIntroVideo
          playVideo={playVideo}
          onFirstFrame={() => onVideoReady?.()}
          onVideoFailed={handleVideoFailed}
          onPlayToEnd={reportIntroComplete}
          pauseToken={pauseToken}
        />
      ) : shouldUseVideo ? (
        <View style={styles.videoStage} />
      ) : (
        <View style={styles.fallbackStage}>
          <Animated.Image source={logoSource} style={[styles.fallbackLogo, { opacity: logoOpacity }]} resizeMode="contain" />
        </View>
      )}

      <Animated.View pointerEvents="none" style={[styles.statusBar, { opacity: shouldUseVideo ? 1 : statusOpacity }]}>
        <Text style={styles.statusText}>{statusLabel}</Text>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000000',
    overflow: 'hidden',
  },
  videoStage: {
    flex: 1,
    backgroundColor: '#000000',
  },
  video: {
    flex: 1,
    width: '100%',
    height: '100%',
    backgroundColor: '#000000',
  },
  fallbackStage: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#03050A',
  },
  fallbackLogo: {
    width: '28%',
    maxWidth: 420,
    aspectRatio: 1,
  },
  statusBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 36,
    alignItems: 'center',
  },
  statusText: {
    color: 'rgba(191, 219, 254, 0.72)',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 4.2,
    textTransform: 'uppercase',
  },
});
