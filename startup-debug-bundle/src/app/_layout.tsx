import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, LogBox, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AppNotificationProvider } from '@/features/notifications/AppNotificationProvider';
import { NovaCastLaunchSequence } from '@/features/startup/NovaCastLaunchSequence';
import { getStartupSplashRemainingMs } from '@/features/startup/startupLogic';
import { isStartupReady, subscribeStartupReadiness } from '@/features/startup/startupReadiness';

SplashScreen.preventAutoHideAsync().catch(() => {
  // Fast refresh can call this more than once.
});

const BRAND_SPLASH_FADE_MS = 650;

export default function RootLayout() {
  const [showBrandSplash, setShowBrandSplash] = useState(true);
  const [startupReady, setStartupReady] = useState(() => isStartupReady());
  const [opacity] = useState(() => new Animated.Value(1));
  const completedRef = useRef(false);
  const [startedAt] = useState(() => Date.now());

  useEffect(() => {
    if (__DEV__) {
      LogBox.ignoreLogs(['Open debugger to view warnings']);
    }
  }, []);

  useEffect(() => {
    let finishTimer: ReturnType<typeof setTimeout> | undefined;

    const finish = () => {
      if (completedRef.current) return;
      completedRef.current = true;

      if (finishTimer) clearTimeout(finishTimer);

      Animated.timing(opacity, {
        toValue: 0,
        duration: BRAND_SPLASH_FADE_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start(() => setShowBrandSplash(false));
    };

    const scheduleFinish = () => {
      if (finishTimer || completedRef.current) return;

      finishTimer = setTimeout(finish, getStartupSplashRemainingMs(startedAt));
    };

    const unsubscribe = subscribeStartupReadiness(() => {
      setStartupReady(true);
      scheduleFinish();
    });

    if (isStartupReady()) {
      scheduleFinish();
    }

    // Drop the native splash after the React launch sequence is mounted.
    void SplashScreen.hideAsync().catch(() => {});

    return () => {
      unsubscribe();
      if (finishTimer) clearTimeout(finishTimer);
    };
  }, [opacity, startedAt]);

  return (
    <SafeAreaProvider>
      <View style={styles.root}>
        <Stack
          screenOptions={{
            headerShown: false,
            animation: 'fade',
            contentStyle: styles.routeContent,
          }}
        />

        <AppNotificationProvider />

        {showBrandSplash ? (
          <Animated.View pointerEvents="none" style={[styles.brandSplash, { opacity }]}> 
            <NovaCastLaunchSequence ready={startupReady} />
          </Animated.View>
        ) : null}
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000000',
  },
  routeContent: {
    backgroundColor: '#07090D',
  },
  brandSplash: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 999,
    backgroundColor: '#000000',
  },
});
