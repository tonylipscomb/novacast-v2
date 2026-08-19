import { Stack, usePathname } from 'expo-router';
import * as Sentry from '@sentry/react-native';
import * as SplashScreen from 'expo-splash-screen';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { LogBox, Platform, StyleSheet, View, DeviceEventEmitter } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AppNotificationProvider } from '@/features/notifications/AppNotificationProvider';
import { TvPerfHud } from '@/features/perf/TvPerfHud';
import { NovaErrorBoundary } from '@/features/resilience/NovaErrorBoundary';
import { OfflineStatusBanner } from '@/features/resilience/OfflineStatusBanner';
import { ensureAppLifecycleMonitor, getAppLifecycleState, subscribeAppLifecycle } from '@/features/resilience/appLifecycle';
import { cancelAllPendingTvFocus } from '@/features/navigation/tvFocusDiagnostics';
import { AppThemeProvider, useAppTheme } from '@/theme/AppThemeProvider';
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
  markLaunchExitRequested,
  markLaunchTransitionComplete,
  markNativeSplashHidden,
  markProviderReady,
} from '@/features/startup/startupDiagnostics';
import { STARTUP_READY_TIMEOUT_MS } from '@/features/startup/startupLogic';
import { useProviderStore } from '@/features/providers/providerStore';
import { initializeDevice, sendDeviceHeartbeat } from '@/features/device';
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
  const [showBrandSplash, setShowBrandSplash] = useState(() => !shouldPlayNovaCastIntro());
  const [exitRequested, setExitRequested] = useState(false);
  const [startupReady, setStartupReady] = useState(isStartupReady());
  const [introComplete, setIntroComplete] = useState(false);
  const [launchOverlay, setLaunchOverlay] = useState(getLaunchOverlayState);
  const splashHiddenRef = useRef(false);
  const exitRequestedRef = useRef(false);
  const [startedAt] = useState(() => {
    beginStartupTiming(Date.now());
    return Date.now();
  });
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

  const requestExit = useCallback(() => {
    if (exitRequestedRef.current) {
      return;
    }

    exitRequestedRef.current = true;
    markLaunchExitRequested();
    setExitRequested(true);
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

  // Device registration is required for beta access; keep it early but timed.
  useEffect(() => {
    earlyBootMark('device_init_scheduled');
    void earlyBootTimed('device.initializeDevice', () =>
      initializeDevice()
        .then(() => sendDeviceHeartbeat())
        .catch(() => undefined),
    );
    const heartbeat = setInterval(() => {
      void sendDeviceHeartbeat().finally(() => {
        void sendNovaAnalyticsHeartbeat();
      });
    }, 20 * 60 * 1000);
    return () => clearInterval(heartbeat);
  }, []);

  // Analytics is not required for first usable Home focus — defer until shell exit
  // or a safety timeout so it cannot own the residual ~500 ms early-boot stall.
  useEffect(() => {
    if (showColdIntro || (!exitRequested && showBrandSplash)) {
      return;
    }
    earlyBootMark('analytics_init_scheduled');
    void earlyBootTimed('analytics.initializeNovaAnalytics', () => initializeNovaAnalytics()).finally(() => {
      void sendNovaAnalyticsHeartbeat();
    });
  }, [exitRequested, showBrandSplash, showColdIntro]);

  useEffect(() => {
    const fallback = setTimeout(() => {
      if (!exitRequestedRef.current) {
        earlyBootMark('analytics_init_fallback_timeout');
        void earlyBootTimed('analytics.initializeNovaAnalytics_fallback', () => initializeNovaAnalytics());
      }
    }, 6_000);
    return () => clearTimeout(fallback);
  }, []);

  useEffect(() => {
    if (!introComplete) {
      return;
    }

    // Exit as soon as the intro video finishes — don't hold for a min-duration leftover.
    requestExit();
  }, [introComplete, requestExit]);

  useEffect(() => {
    if (showColdIntro) {
      return;
    }
    const forceTimer = setTimeout(() => {
      logStartupPhase('startup ready timeout fallback');
      markStartupReady();
      requestExit();
    }, STARTUP_READY_TIMEOUT_MS);

    return () => clearTimeout(forceTimer);
  }, [requestExit, showColdIntro, startedAt]);

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
    setShowBrandSplash(false);
    completeLaunchOverlay();
  };

  const handleOverlayExitComplete = () => {
    completeLaunchOverlay();
  };

  const handleColdIntroFinished = useCallback(() => {
    markNovaCastIntroPlayed();
    hideNativeSplash();
    setShowColdIntro(false);
    setShowBrandSplash(false);
    completeLaunchOverlay();
  }, [hideNativeSplash]);

  if (showColdIntro) {
    return (
      <SafeAreaProvider>
        <View style={styles.splashRoot}>
          <NovaCastIntroScreen onReady={hideNativeSplash} onFinished={handleColdIntroFinished} />
        </View>
      </SafeAreaProvider>
    );
  }

  if (showBrandSplash) {
    return (
      <SafeAreaProvider>
        <View style={styles.splashRoot}>
          <NovaCastLaunchSequence
            exitRequested={exitRequested}
            startupReady={startupReady}
            onIntroComplete={() => setIntroComplete(true)}
            onVideoReady={hideNativeSplash}
            onExitComplete={handleLaunchExitComplete}
          />
        </View>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <NovaErrorBoundary region="root" showProviderAction>
        <AppThemeProvider>
          <ThemedAppRoot
            launchOverlay={launchOverlay}
            onOverlayExitComplete={handleOverlayExitComplete}
          />
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
}: {
  launchOverlay: ReturnType<typeof getLaunchOverlayState>;
  onOverlayExitComplete: () => void;
}) {
  const { theme } = useAppTheme();
  const pathname = usePathname();
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
  }, []);

  useEffect(() => {
    setNovaRouteContext({ route: pathname || '/', area: pathname?.split('/')[1] || 'startup' });
    setAnalyticsRoute(pathname || '/');
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
    <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
      <Stack
        screenOptions={{
          headerShown: false,
          animation: 'fade',
          contentStyle: { backgroundColor: theme.colors.background },
        }}
      />

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
  );
}

const styles = StyleSheet.create({
  splashRoot: {
    flex: 1,
    backgroundColor: '#000000',
  },
  root: {
    flex: 1,
    backgroundColor: '#000000',
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
