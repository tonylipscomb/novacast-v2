import { Stack, usePathname } from 'expo-router';
import * as Sentry from '@sentry/react-native';
import * as SplashScreen from 'expo-splash-screen';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AppState, ImageBackground, LogBox, Platform, StyleSheet, View, DeviceEventEmitter } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AppNotificationProvider } from '@/features/notifications/AppNotificationProvider';
import { TvPerfHud } from '@/features/perf/TvPerfHud';
import { NovaErrorBoundary } from '@/features/resilience/NovaErrorBoundary';
import { OfflineStatusBanner } from '@/features/resilience/OfflineStatusBanner';
import { ensureAppLifecycleMonitor, getAppLifecycleState, subscribeAppLifecycle } from '@/features/resilience/appLifecycle';
import { cancelAllPendingTvFocus } from '@/features/navigation/tvFocusDiagnostics';
import { AppThemeProvider } from '@/theme/AppThemeProvider';
import { useAppTheme } from '@/theme/AppThemeProvider';
import { UnifiedPlayerHost } from '@/features/playback/unified';
import {
  completeLaunchOverlay,
  getLaunchOverlayState,
  subscribeLaunchOverlay,
} from '@/features/startup/launchOverlay';
import { NovaCastIntroScreen } from '@/features/startup/NovaCastIntroScreen';
import { NovaCastLaunchSequence } from '@/features/startup/NovaCastLaunchSequence';
import {
  markNovaCastIntroPlayed,
  shouldPlayNovaCastIntro,
} from '@/features/startup/novaCastIntroSession';
import {
  beginStartupTiming,
  logStartupPhase,
  markLaunchTransitionComplete,
  markNativeSplashHidden,
  markProviderReady,
} from '@/features/startup/startupDiagnostics';
import { useProviderStore } from '@/features/providers/providerStore';
import { bindDeviceAssignmentRealtimeLifecycle, sendDeviceHeartbeat } from '@/features/device';
import { isStartupReady, markStartupReady, subscribeStartupReadiness } from '@/features/startup/startupReadiness';
import { beforeSendNovaEvent, initializeNovaSentryContext, setNovaLifecycleContext, setNovaPlaybackContext, setNovaProviderContext, setNovaRouteContext, setNovaStartupContext } from '@/features/diagnostics/sentryDiagnostics';
import { initializeCatalogAudit, markCatalogAuditFocus } from '@/features/diagnostics/novaCastCatalogAudit';
import { initializeEarlyBootAudit, earlyBootMark, earlyBootTimed } from '@/features/diagnostics/earlyBootAudit';
import {
  initializeFocusLatencyAudit,
  noteFocusLatencyFocus,
  noteFocusLatencyKeyEvent,
  setFocusLatencyPhase,
  logFocusLatencySummary,
} from '@/features/diagnostics/focusLatencyAudit';
import { getOfflineSnapshot, subscribeOfflineStatus } from '@/features/resilience/offlineStatus';
import { closeUnifiedPlayback, getUnifiedPlayerState, subscribeUnifiedPlayer } from '@/features/playback/unified/unifiedPlayerStore';
import { cancelPlaybackResumePrompt, getPlaybackResumeEpoch, subscribePlaybackResumePrompt } from '@/features/playback/continuity/playbackResumeGate';
import { initializeNovaAnalytics, setAnalyticsRoute, setAnalyticsState } from '@/features/analytics';
import { sendNovaAnalyticsHeartbeat } from '@/features/analytics/analyticsHeartbeat';
import { recordSupportLog } from '@/features/diagnostics/diagnosticsClient';
import { StartupVisualGateProvider } from '@/features/startup/startupVisualGate';

const NOVACAST_BACKGROUND = require('../../assets/images/ncnewbackground.png');
const NOVACAST_ICE_BACKGROUND = require('../../assets/images/novacasticeback.png');
const NOVACAST_MIDNIGHT_BACKGROUND = require('../../assets/images/midnightbackground.png');

const CATALOG_BUILD_MARKER = 'stage295-native-completion-v1';

SplashScreen.preventAutoHideAsync().catch(() => {
  // Fast refresh can call this more than once.
});
initializeCatalogAudit();
initializeEarlyBootAudit();
initializeFocusLatencyAudit();
console.info(`[NovaCast Catalog] ${CATALOG_BUILD_MARKER}`);
earlyBootMark('root_layout_init');

// Defer Sentry init one macrotask so first paint/focus wiring is not competing with
// SDK bootstrap on the cold JS thread (Stage 2.95 early-boot isolation).
setTimeout(() => {
  earlyBootMark('sentry_init_begin');
  Sentry.init({
    dsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
    enabled: !__DEV__,
    sendDefaultPii: false,
    tracesSampleRate: 0.1,
    beforeSend: (event) => beforeSendNovaEvent(event),
  });
  earlyBootMark('sentry_init_end');
}, 0);

export default function RootLayout() {
  const [showColdIntro, setShowColdIntro] = useState(() => shouldPlayNovaCastIntro());
  const [startupReady, setStartupReady] = useState(isStartupReady());
  const [launchOverlay, setLaunchOverlay] = useState(getLaunchOverlayState);
  const splashHiddenRef = useRef(false);
  useState(() => beginStartupTiming(Date.now()));
  const { ready: providerStoreReady } = useProviderStore();

  useEffect(() => {
    // Diagnostics only: detect first HW remote event without changing focus routing.
    const subscription = (globalThis as typeof globalThis & {
      __NOVACAST_AUDIT_TV?: boolean;
    });
    if (subscription.__NOVACAST_AUDIT_TV) {
      return;
    }
    subscription.__NOVACAST_AUDIT_TV = true;

    const onRemote = (eventType?: string) => {
      if (!eventType || eventType === 'blur' || eventType === 'focus') {
        return;
      }
      noteFocusLatencyKeyEvent(eventType);
      markCatalogAuditFocus(`tv:${eventType}`);
    };

    const sub = DeviceEventEmitter.addListener('onTVRemoteEvent', (event: { eventType?: string }) => {
      onRemote(event?.eventType);
    });

    let disableTvHandler: (() => void) | null = null;
    try {
      const reactNative = require('react-native') as {
        TVEventHandler?: new () => {
          enable: (
            component: unknown,
            handler: (_component: unknown, event: { eventType?: string }) => void,
          ) => void;
          disable: () => void;
        };
      };
      if (typeof reactNative.TVEventHandler === 'function') {
        const handler = new reactNative.TVEventHandler();
        handler.enable(null, (_component, event) => onRemote(event?.eventType));
        disableTvHandler = () => handler.disable();
      }
    } catch {
      // TVEventHandler unavailable on this runtime.
    }

    return () => {
      sub.remove();
      disableTvHandler?.();
      subscription.__NOVACAST_AUDIT_TV = false;
    };
  }, []);

  useEffect(() => {
    setFocusLatencyPhase('A_first_30s');
    console.info('[NovaCast FocusLatency]', 'physical_remote_required', {
      phases: ['A_first_30s', 'B_sync_active', 'C_series_sync', 'D_post_complete'],
      note: 'Use the ONN Bluetooth/IR remote — adb keyevents do not drive TVEventHandler',
    });
    const timers = [
      setTimeout(() => {
        logFocusLatencySummary();
        setFocusLatencyPhase('B_sync_active');
      }, 30_000),
      setTimeout(() => {
        logFocusLatencySummary();
        setFocusLatencyPhase('C_series_sync');
      }, 120_000),
      setTimeout(() => {
        setFocusLatencyPhase('D_post_complete');
        logFocusLatencySummary();
      }, 300_000),
      setTimeout(() => logFocusLatencySummary(), 420_000),
    ];
    return () => timers.forEach((timer) => clearTimeout(timer));
  }, []);

  useEffect(() => {
    if (__DEV__) {
      LogBox.ignoreLogs(['Open debugger to view warnings']);
    }
  }, []);

  useEffect(() => {
    ensureAppLifecycleMonitor();
    return subscribeAppLifecycle((status) => {
      if (status !== 'active') {
        cancelAllPendingTvFocus('inactive');
      }
    });
  }, []);

  useEffect(() => {
    return subscribeLaunchOverlay(() => {
      setLaunchOverlay(getLaunchOverlayState());
    });
  }, []);

  useEffect(() => {
    return subscribeStartupReadiness(() => {
      markProviderReady();
      setStartupReady(true);
    });
  }, []);

  useEffect(() => {
    if (isStartupReady()) {
      markProviderReady();
      setStartupReady(true);
    }
  }, []);

  useEffect(() => {
    if (providerStoreReady) {
      markStartupReady();
    }
  }, [providerStoreReady]);

  // StartupGate owns the one-time registration/status check. RootLayout only
  // owns the long-lived realtime binding and durable heartbeat fallback.
  useEffect(() => {
    earlyBootMark('device_assignment_realtime_scheduled');
    const unbindAssignmentRealtime = bindDeviceAssignmentRealtimeLifecycle();
    // Keep device commands (including enhanced diagnostics capture) responsive
    // while the app is foregrounded; the heartbeat also enables diagnostics.
    const heartbeat = setInterval(() => {
      void sendDeviceHeartbeat().finally(() => {
        void sendNovaAnalyticsHeartbeat();
      });
    }, 60 * 1000);
    void sendDeviceHeartbeat().finally(() => {
      void sendNovaAnalyticsHeartbeat();
    });
    return () => {
      clearInterval(heartbeat);
      unbindAssignmentRealtime();
    };
  }, []);

  // Analytics is not required for first usable Home focus — defer until shell exit
  // or a safety timeout so it cannot own the residual ~500 ms early-boot stall.
  useEffect(() => {
    if (showColdIntro) {
      return;
    }
    earlyBootMark('analytics_init_scheduled');
    void earlyBootTimed('analytics.initializeNovaAnalytics', () => initializeNovaAnalytics()).finally(() => {
      void sendNovaAnalyticsHeartbeat();
    });
  }, [showColdIntro]);

  useEffect(() => {
    const fallback = setTimeout(() => {
      earlyBootMark('analytics_init_fallback_timeout');
      void earlyBootTimed('analytics.initializeNovaAnalytics_fallback', () => initializeNovaAnalytics());
    }, 6_000);
    return () => clearTimeout(fallback);
  }, []);

  useEffect(() => {
    if (true) {
      return;
    }

    // Exit as soon as the intro video finishes — don't hold for a min-duration leftover.
  }, []);

  const hideNativeSplash = useCallback(() => {
    if (splashHiddenRef.current) {
      return;
    }

    splashHiddenRef.current = true;
    markNativeSplashHidden();
    void SplashScreen.hideAsync().catch(() => undefined);
  }, []);

  useEffect(() => {
    // Keep the native splash up until the intro video paints (or fails).
    // Hiding on first layout left a black gap while the video was still decoding.
    const fallbackTimer = setTimeout(() => {
      logStartupPhase('native splash hide fallback');
      hideNativeSplash();
    }, 4_500);

    return () => clearTimeout(fallbackTimer);
  }, [hideNativeSplash]);

  const handleLaunchExitComplete = () => {
    markLaunchTransitionComplete();
    completeLaunchOverlay();
  };

  const handleOverlayExitComplete = () => {
    completeLaunchOverlay();
  };

  const handleColdIntroFinished = useCallback(() => {
    markNovaCastIntroPlayed();
    hideNativeSplash();
    setShowColdIntro(false);
    completeLaunchOverlay();
  }, [hideNativeSplash]);

  return (
    <SafeAreaProvider>
      <NovaErrorBoundary region="root" showProviderAction>
        <AppThemeProvider>
          <View style={styles.rootContainer}>
            <View style={[styles.appScene, showColdIntro && styles.appSceneHidden]}>
              <ThemedAppRoot
                launchOverlay={launchOverlay}
                onOverlayExitComplete={handleOverlayExitComplete}
                visualsVisible={!showColdIntro}
              />
            </View>
            {showColdIntro ? (
              <View style={styles.introScene}>
                <NovaCastIntroScreen
                  appStartupReady={startupReady}
                  onReady={hideNativeSplash}
                  onFinished={handleColdIntroFinished}
                />
              </View>
            ) : null}
          </View>
        </AppThemeProvider>
      </NovaErrorBoundary>
    </SafeAreaProvider>
  );
}

function getPlaybackBoundaryResetKey() {
  return `${getUnifiedPlayerState().machineState}:${getPlaybackResumeEpoch()}`;
}

function ThemedAppRoot({
  launchOverlay,
  onOverlayExitComplete,
  visualsVisible,
}: {
  launchOverlay: ReturnType<typeof getLaunchOverlayState>;
  onOverlayExitComplete: () => void;
  visualsVisible: boolean;
}) {
  const pathname = usePathname();
  const { themeId } = useAppTheme();
  const { selectedProvider } = useProviderStore();
  const playbackBoundaryResetKey = useSyncExternalStore(
    (onStoreChange) => {
      const unsubscribePlayer = subscribeUnifiedPlayer(onStoreChange);
      const unsubscribeGate = subscribePlaybackResumePrompt(onStoreChange);
      return () => {
        unsubscribePlayer();
        unsubscribeGate();
      };
    },
    getPlaybackBoundaryResetKey,
    getPlaybackBoundaryResetKey,
  );

  useEffect(() => {
    void initializeNovaSentryContext();
    recordSupportLog({ eventType: 'app_launch', metadata: { platform: Platform.OS } });
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') recordSupportLog({ eventType: 'app_resumed' });
      else if (state === 'background') recordSupportLog({ eventType: 'app_backgrounded' });
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    setNovaRouteContext({ route: pathname || '/', area: pathname?.split('/')[1] || 'startup' });
    setAnalyticsRoute(pathname || '/');
    recordSupportLog({ eventType: 'route_changed', metadata: { route: pathname || '/' } });
  }, [pathname]);

  useEffect(() => {
    setNovaProviderContext(selectedProvider ? {
      id: selectedProvider.id,
      displayName: selectedProvider.name,
      type: selectedProvider.connection?.type,
      state: selectedProvider.connection ? 'connected' : 'disconnected',
    } : null);
    setAnalyticsState({
      providerState: selectedProvider?.connection ? 'connected' : 'disconnected',
    });
  }, [selectedProvider]);

  useEffect(() => {
    const update = () => {
      const snapshot = getUnifiedPlayerState();
      setNovaPlaybackContext(snapshot.item ? {
        type: snapshot.item.mediaType,
        state: snapshot.machineState,
        contentId: snapshot.item.id,
        providerId: snapshot.item.providerId,
        errorCode: snapshot.errorMessage,
      } : null);
      setAnalyticsState({
        currentActivity: snapshot.item ? 'playback' : 'browse',
        playbackState: snapshot.machineState,
      });
    };
    update();
    const unsubscribe = subscribeUnifiedPlayer(update);
    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    const update = () => {
      setNovaLifecycleContext({ state: getAppLifecycleState() });
      setNovaStartupContext({ ready: isStartupReady() });
      const network = getOfflineSnapshot();
      setNovaLifecycleContext({ network: network.status });
    };
    update();
    const unsubscribeNetwork = subscribeOfflineStatus(update);
    return () => unsubscribeNetwork();
  }, []);

  return (
    <ImageBackground
      source={
        themeId === 'ice'
          ? NOVACAST_ICE_BACKGROUND
          : themeId === 'blackout'
            ? NOVACAST_MIDNIGHT_BACKGROUND
            : NOVACAST_BACKGROUND
      }
      resizeMode="cover"
      onLoad={() => console.info('[NovaCast Global Background]', 'loaded')}
      style={styles.root}>
      <View
        pointerEvents={visualsVisible ? 'auto' : 'none'}
        style={[styles.appContent, !visualsVisible && styles.appContentHidden]}>
        <StartupVisualGateProvider interactive={visualsVisible}>
          <Stack
            screenOptions={{
              headerShown: false,
              animation: 'fade',
              contentStyle: { backgroundColor: 'transparent' },
            }}
          />
        </StartupVisualGateProvider>

        <AppNotificationProvider />
        <OfflineStatusBanner />
        <TvPerfHud />

        <View pointerEvents="box-none" style={styles.playerHostLayer}>
          <NovaErrorBoundary
            region="playback"
            resetKey={playbackBoundaryResetKey}
            onRetry={() => {
              cancelPlaybackResumePrompt();
              closeUnifiedPlayback();
            }}
            fallbackTitle="Playback unavailable"
            fallbackMessage="Playback hit an unexpected problem. Retry or return home."
            showHomeAction>
            <UnifiedPlayerHost />
          </NovaErrorBoundary>
        </View>

        {launchOverlay.visible ? (
          <View
            pointerEvents="none"
            focusable={false}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={styles.launchOverlayLayer}>
            <NovaCastLaunchSequence
              exitRequested={launchOverlay.exiting}
              startupReady={launchOverlay.exiting}
              playVideo={false}
              onIntroComplete={() => undefined}
              onExitComplete={onOverlayExitComplete}
            />
          </View>
        ) : null}
      </View>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  rootContainer: {
    flex: 1,
  },
  appScene: {
    flex: 1,
  },
  appSceneHidden: {
    display: 'none',
  },
  introScene: {
    flex: 1,
    backgroundColor: '#000000',
  },
  splashRoot: {
    flex: 1,
    backgroundColor: '#000000',
  },
  root: {
    flex: 1,
    backgroundColor: '#05070A',
  },
  appContent: {
    flex: 1,
    zIndex: 1,
  },
  // Keep the router and startup/bootstrap effects mounted, but remove every
  // native scene surface from the visual tree while the intro owns startup.
  // This avoids Android TV SurfaceView z-order exposing Home over intro video.
  appContentHidden: {
    display: 'none',
  },
  launchOverlayLayer: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 1000,
    backgroundColor: '#000000',
  },
  playerHostLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 400,
    elevation: Platform.OS === 'android' ? 100 : 40,
  },
});
