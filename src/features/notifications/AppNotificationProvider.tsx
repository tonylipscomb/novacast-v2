import type { ComponentType, ReactNode } from 'react';
import { useSyncExternalStore } from 'react';
import * as ReactNative from 'react-native';
import { Platform, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppNotificationToast } from './AppNotificationToast';
import { shouldCaptureNotificationFocus } from './notificationFocusLogic';
import { getNotificationsSnapshot, subscribeNotifications } from './notificationStore';
import type { AppNotification, AppNotificationPosition } from './types';

type PositionOffsets = { top?: number; bottom?: number; left?: number; right?: number };

type FocusBoundaryProps = {
  children: ReactNode;
  style?: object;
  pointerEvents?: 'auto' | 'box-none' | 'none';
  trapFocusLeft?: boolean;
  trapFocusRight?: boolean;
  trapFocusUp?: boolean;
  trapFocusDown?: boolean;
};

const FocusBoundaryView = (
  (ReactNative as typeof ReactNative & { TVFocusGuideView?: ComponentType<FocusBoundaryProps> }).TVFocusGuideView ??
  View
) as ComponentType<FocusBoundaryProps>;

// Bottom buckets use a generous base offset so a bottom-right/bottom-center toast clears
// typical screen-level bottom chrome (e.g. Guide's Program Details panel) without
// this generic host needing per-screen positioning knowledge.
const POSITION_OFFSETS: Record<AppNotificationPosition, PositionOffsets> = {
  'top-right': { top: 24, right: 24 },
  'bottom-right': { bottom: 130, right: 24 },
  'bottom-center': { bottom: 130 },
};

const EMPTY_GROUP: AppNotification[] = [];

function useNotificationsSnapshot() {
  return useSyncExternalStore(subscribeNotifications, getNotificationsSnapshot, getNotificationsSnapshot);
}

function groupByPosition(notifications: AppNotification[]): Record<AppNotificationPosition, AppNotification[]> {
  const groups: Record<AppNotificationPosition, AppNotification[]> = {
    'top-right': [],
    'bottom-right': [],
    'bottom-center': [],
  };
  notifications.forEach((notification) => {
    const position = notification.position ?? 'bottom-right';
    groups[position].push(notification);
  });
  return groups;
}

/**
 * Mounted once near the app root. Passive toasts never steal TV focus.
 * Blocking toasts may trap focus locally; the scrim stays non-interactive.
 */
export function AppNotificationProvider() {
  const { visible } = useNotificationsSnapshot();
  const insets = useSafeAreaInsets();

  if (!visible.length) {
    return null;
  }

  const groups = groupByPosition(visible);
  const topmostToast = visible[visible.length - 1] ?? null;
  const anyBlocking = visible.some((notification) =>
    shouldCaptureNotificationFocus(notification.id === topmostToast?.id, notification.interactionMode),
  );

  return (
    <View
      pointerEvents="box-none"
      style={styles.host}
      accessibilityViewIsModal={anyBlocking}
      importantForAccessibility={anyBlocking ? 'yes' : 'no-hide-descendants'}>
      <View pointerEvents="none" style={styles.focusScrim} accessible={false} importantForAccessibility="no" />
      <FocusBoundaryView
        style={styles.focusGuide}
        pointerEvents="box-none"
        {...(Platform.OS === 'android' && anyBlocking
          ? {
              trapFocusLeft: true,
              trapFocusRight: true,
              trapFocusUp: true,
              trapFocusDown: true,
            }
          : {})}>
        {(Object.keys(POSITION_OFFSETS) as AppNotificationPosition[]).map((position) => {
          const items = groups[position] ?? EMPTY_GROUP;
          if (!items.length) {
            return null;
          }

          const offsets = POSITION_OFFSETS[position];
          const isCenter = position === 'bottom-center';

          return (
            <View
              key={position}
              pointerEvents="box-none"
              style={[
                styles.bucket,
                isCenter ? styles.bucketCenter : styles.bucketEnd,
                offsets.top != null ? { top: offsets.top + insets.top } : null,
                offsets.bottom != null ? { bottom: offsets.bottom + insets.bottom } : null,
                offsets.right != null ? { right: offsets.right + insets.right } : null,
                offsets.left != null ? { left: offsets.left + insets.left } : null,
              ]}>
              {items.map((notification) => (
                <AppNotificationToast
                  key={notification.id}
                  notification={notification}
                  captureFocus={shouldCaptureNotificationFocus(
                    notification.id === topmostToast?.id,
                    notification.interactionMode,
                  )}
                />
              ))}
            </View>
          );
        })}
      </FocusBoundaryView>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 500,
    elevation: 20,
  },
  focusScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'transparent',
  },
  focusGuide: {
    ...StyleSheet.absoluteFillObject,
  },
  bucket: {
    position: 'absolute',
    gap: 10,
  },
  bucketEnd: {
    alignItems: 'flex-end',
  },
  bucketCenter: {
    left: 0,
    right: 0,
    alignItems: 'center',
  },
});
