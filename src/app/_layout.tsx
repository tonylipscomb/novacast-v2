import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useCallback, useEffect, useRef, useState } from 'react';
import { LogBox, Platform, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AppNotificationProvider } from '@/features/notifications/AppNotificationProvider';
import { AppThemeProvider, useAppTheme } from '@/theme/AppThemeProvider';
import { UnifiedPlayerHost } from '@/features/playback/unified';
import {
  completeLaunchOverlay,
  getLaunchOverlayState,
  subscribeLaunchOverlay,
} from '@/features/startup/launchOverlay';
import { NovaCastLaunchSequence } from '@/features/startup/NovaCastLaunchSequence';
import {
  beginStartupTiming,
  logStartupPhase,
  markLaunchExitRequested,
  markLaunchTransitionComplete,
  markNativeSplashHidden,
  markProviderReady,
} from '@/features/startup/startupDiagnostics';
import {
  getStartupSplashRemainingMs,
  STARTUP_READY_TIMEOUT_MS,
} from '@/features/startup/startupLogic';
import { useProviderStore } from '@/features/providers/providerStore';
import { initializeDevice, sendDeviceHeartbeat } from '@/features/device';
import { isStartupReady, markStartupReady, subscribeStartupReadiness } from '@/features/startup/startupReadiness';

SplashScreen.preventAutoHideAsync().catch(() => {
  // Fast refresh can call this more than once.
});

export default function RootLayout() {
  const [showBrandSplash, setShowBrandSplash] = useState(true);
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

  useEffect(() => {
    void initializeDevice().then(() => sendDeviceHeartbeat()).catch(() => undefined);
    const heartbeat = setInterval(() => {
      void sendDeviceHeartbeat();
    }, 20 * 60 * 1000);
    return () => clearInterval(heartbeat);
  }, []);

  useEffect(() => {
    if (!introComplete) {
      return;
    }

    const remaining = getStartupSplashRemainingMs(startedAt);
    const exitTimer = setTimeout(requestExit, remaining);

    return () => clearTimeout(exitTimer);
  }, [introComplete, requestExit, startedAt]);

  useEffect(() => {
    const forceTimer = setTimeout(() => {
      logStartupPhase('startup ready timeout fallback');
      markStartupReady();
      requestExit();
    }, STARTUP_READY_TIMEOUT_MS);

    return () => clearTimeout(forceTimer);
  }, [requestExit, startedAt]);

  const hideNativeSplash = useCallback(() => {
    if (splashHiddenRef.current) {
      return;
    }

    splashHiddenRef.current = true;
    markNativeSplashHidden();
    void SplashScreen.hideAsync().catch(() => undefined);
  }, []);

  const handleLaunchLayout = useCallback(() => {
    hideNativeSplash();
  }, [hideNativeSplash]);

  useEffect(() => {
    const fallbackTimer = setTimeout(() => {
      logStartupPhase('native splash hide fallback');
      hideNativeSplash();
    }, 1_500);

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

  if (showBrandSplash) {
    return (
      <SafeAreaProvider>
        <View style={styles.splashRoot}>
          <NovaCastLaunchSequence
            exitRequested={exitRequested}
            startupReady={startupReady}
            onIntroComplete={() => setIntroComplete(true)}
            onVideoReady={handleLaunchLayout}
            onExitComplete={handleLaunchExitComplete}
            onLayout={handleLaunchLayout}
          />
        </View>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <AppThemeProvider>
        <ThemedAppRoot
          launchOverlay={launchOverlay}
          onOverlayExitComplete={handleOverlayExitComplete}
        />
      </AppThemeProvider>
    </SafeAreaProvider>
  );
}

function ThemedAppRoot({
  launchOverlay,
  onOverlayExitComplete,
}: {
  launchOverlay: ReturnType<typeof getLaunchOverlayState>;
  onOverlayExitComplete: () => void;
}) {
  const { theme } = useAppTheme();

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

      <View pointerEvents="box-none" style={styles.playerHostLayer}>
        <UnifiedPlayerHost />
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
