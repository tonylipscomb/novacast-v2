import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { ComponentProps, ElementRef } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, BackHandler, findNodeHandle, Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { getTvDensity } from '@/components/nova/tvDensity';
import { createNovaTvFocusTextStyles } from '@/components/nova/novaTvFocus';
import { wrapOnnMoviesBackHandler } from '@/features/diagnostics/onnMoviesTrace';
import { requestTvFocus } from '@/features/navigation/tvFocusDiagnostics';
import { useAppTheme } from '@/theme/AppThemeProvider';
import type { NovaTheme } from '@/theme/tokens';

import { dismissNotification, triggerNotificationAction } from './notificationStore';
import {
  isPassiveNotification,
  resolveNotificationInitialFocusTarget,
  shouldRenderNotificationFocusableControls,
} from './notificationFocusLogic';
import type { AppNotification, AppNotificationType } from './types';

type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];
type Focusable = ElementRef<typeof Pressable>;

const TYPE_ICON: Record<AppNotificationType, IconName> = {
  error: 'alert-circle-outline',
  warning: 'alert-outline',
  success: 'check-circle-outline',
  info: 'information-outline',
};

type AppNotificationToastProps = {
  notification: AppNotification;
  captureFocus?: boolean;
};

function typeAccent(theme: NovaTheme, type: AppNotificationType): string {
  switch (type) {
    case 'error':
      return theme.colors.danger;
    case 'warning':
      return theme.colors.warning;
    case 'success':
      return theme.colors.success;
    case 'info':
    default:
      return theme.scheme === 'light' ? theme.colors.accent : theme.colors.accentHover;
  }
}

/**
 * Toast card. Passive (default) toasts are non-focusable and never steal TV focus.
 * Blocking toasts trap focus for an explicit Retry/Dismiss choice.
 */
export function AppNotificationToast({ notification, captureFocus = false }: AppNotificationToastProps) {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const focusText = useMemo(() => createNovaTvFocusTextStyles(theme), [theme]);
  const { width } = useWindowDimensions();
  const density = getTvDensity(width);
  const maxWidth = density === 'compact' ? 380 : 440;
  const passive = isPassiveNotification(notification.interactionMode);
  const showFocusableControls = shouldRenderNotificationFocusableControls(notification.interactionMode);
  const blocking = showFocusableControls && captureFocus;
  const entrance = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    entrance.setValue(0);
    Animated.timing(entrance, {
      toValue: 1,
      duration: 180,
      useNativeDriver: true,
    }).start();
  }, [entrance, notification.id]);

  const actionRef = useRef<Focusable | null>(null);
  const dismissRef = useRef<Focusable | null>(null);
  const focusedButtonRef = useRef<'action' | 'dismiss' | null>(null);
  const lockDismissFocusRef = useRef(true);
  const [focusedButton, setFocusedButton] = useState<'action' | 'dismiss' | null>(null);
  const [actionHandle, setActionHandle] = useState<number | undefined>();
  const [dismissHandle, setDismissHandle] = useState<number | undefined>();

  const hasAction = Boolean(notification.actionLabel && notification.onAction);
  const initialFocusTarget = resolveNotificationInitialFocusTarget(
    notification.autoFocusAction ?? false,
    hasAction,
  );

  useEffect(() => {
    focusedButtonRef.current = focusedButton;
  }, [focusedButton]);

  useEffect(() => {
    lockDismissFocusRef.current = true;
  }, [notification.id]);

  useEffect(() => {
    if (passive) {
      setActionHandle(undefined);
      setDismissHandle(undefined);
      return undefined;
    }

    const frame = requestAnimationFrame(() => {
      setActionHandle(findNodeHandle(actionRef.current) ?? undefined);
      setDismissHandle(findNodeHandle(dismissRef.current) ?? undefined);
    });
    return () => cancelAnimationFrame(frame);
  }, [hasAction, passive]);

  useEffect(() => {
    if (!blocking || Platform.OS !== 'android') {
      return undefined;
    }

    return requestTvFocus({
      screen: 'notification-toast',
      source: 'AppNotificationToast',
      region: 'toast-actions',
      itemId: notification.id,
      reason: initialFocusTarget === 'action' ? 'blocking-focus-action' : 'blocking-focus-dismiss',
      getTarget: () => (initialFocusTarget === 'action' ? actionRef.current : dismissRef.current),
    });
  }, [blocking, initialFocusTarget, notification.id]);

  useEffect(() => {
    if (!blocking || Platform.OS !== 'android') {
      return undefined;
    }

    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      wrapOnnMoviesBackHandler(
        'blocking-toast',
        () => {
          if (!focusedButtonRef.current) {
            return false;
          }

          lockDismissFocusRef.current = false;
          dismissNotification(notification.id);
          return true;
        },
        () => ({
          screen: 'AppNotificationToast',
          blocking,
          notificationId: notification.id,
        }),
      ),
    );

    return () => subscription.remove();
  }, [blocking, notification.id]);

  const releaseDismissFocusLock = () => {
    lockDismissFocusRef.current = false;
  };

  const restoreDismissFocusIfLocked = () => {
    if (!blocking || !lockDismissFocusRef.current || initialFocusTarget !== 'dismiss') {
      return;
    }

    requestTvFocus({
      screen: 'notification-toast',
      source: 'AppNotificationToast',
      region: 'toast-actions',
      itemId: notification.id,
      reason: 'blocking-reclaim-dismiss',
      getTarget: () => dismissRef.current,
    });
  };

  const accentColor = typeAccent(theme, notification.type);
  const dismissTrapHandle = dismissHandle;
  const actionTrapHandle = actionHandle ?? dismissHandle;

  return (
    <Animated.View
      pointerEvents={passive ? 'none' : 'auto'}
      style={[styles.toast, { maxWidth, borderColor: `${accentColor}88`, opacity: entrance, transform: [{ translateY: entrance.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }] }]}
      importantForAccessibility={passive ? 'no-hide-descendants' : 'yes'}
      accessible={!passive}>
      <View style={[styles.accentRail, { backgroundColor: accentColor }]} />
      <View style={styles.content} pointerEvents={passive ? 'none' : 'auto'}>
        <View style={styles.header}>
          <View style={[styles.iconChip, { borderBottomColor: `${accentColor}99` }]}>
            <MaterialCommunityIcons name={TYPE_ICON[notification.type]} size={18} color={accentColor} />
          </View>
          <Text style={styles.title} numberOfLines={1}>
            {notification.title}
          </Text>
        </View>

        {notification.message ? (
          <Text style={styles.message} numberOfLines={3}>
            {notification.message}
          </Text>
        ) : null}

        {showFocusableControls ? (
          <View style={styles.actions}>
            {hasAction ? (
              <Pressable
                ref={actionRef}
                focusable
                hasTVPreferredFocus={blocking && initialFocusTarget === 'action'}
                accessibilityRole="button"
                accessibilityLabel={notification.actionLabel}
                {...(actionTrapHandle != null ? { nextFocusUp: actionTrapHandle, nextFocusDown: actionTrapHandle } : null)}
                {...(dismissHandle != null ? { nextFocusRight: dismissHandle } : null)}
                {...(actionTrapHandle != null ? { nextFocusLeft: actionTrapHandle } : null)}
                onFocus={() => {
                  lockDismissFocusRef.current = false;
                  setFocusedButton('action');
                }}
                onBlur={() => setFocusedButton((current) => (current === 'action' ? null : current))}
                onPress={() => {
                  releaseDismissFocusLock();
                  triggerNotificationAction(notification.id);
                }}
                style={[styles.actionButton, focusedButton === 'action' && styles.buttonFocused]}>
                <Text style={[styles.actionText, focusedButton === 'action' && focusText.title]}>
                  {notification.actionLabel}
                </Text>
              </Pressable>
            ) : null}

            <Pressable
              ref={dismissRef}
              focusable
              hasTVPreferredFocus={blocking && initialFocusTarget === 'dismiss'}
              accessibilityRole="button"
              accessibilityLabel={notification.dismissLabel ?? 'Dismiss'}
              {...(dismissTrapHandle != null
                ? {
                    nextFocusUp: dismissTrapHandle,
                    nextFocusDown: dismissTrapHandle,
                    nextFocusRight: dismissTrapHandle,
                  }
                : null)}
              {...(hasAction && actionHandle != null
                ? { nextFocusLeft: actionHandle }
                : dismissTrapHandle != null
                  ? { nextFocusLeft: dismissTrapHandle }
                  : null)}
              onFocus={() => setFocusedButton('dismiss')}
              onBlur={() => {
                setFocusedButton((current) => (current === 'dismiss' ? null : current));
                restoreDismissFocusIfLocked();
              }}
              onPress={() => {
                releaseDismissFocusLock();
                dismissNotification(notification.id);
              }}
              style={[styles.dismissButton, focusedButton === 'dismiss' && styles.buttonFocused]}>
              <MaterialCommunityIcons
                name="close"
                size={14}
                color={
                  focusedButton === 'dismiss'
                    ? theme.scheme === 'light'
                      ? theme.colors.accent
                      : theme.colors.accentHover
                    : theme.colors.textSecondary
                }
              />
              <Text style={[styles.dismissText, focusedButton === 'dismiss' && focusText.title]}>
                {notification.dismissLabel ?? 'Dismiss'}
              </Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    </Animated.View>
  );
}

function createStyles(theme: NovaTheme) {
  const light = theme.scheme === 'light';

  return StyleSheet.create({
    toast: {
      minWidth: 320,
      flexDirection: 'row',
      overflow: 'hidden',
      borderRadius: 18,
      borderWidth: 1,
      backgroundColor: light ? 'rgba(245,248,255,0.88)' : 'rgba(7,9,22,0.82)',
      shadowColor: light ? theme.colors.textPrimary : '#000000',
      shadowOpacity: light ? 0.12 : 0.25,
      shadowRadius: light ? 8 : 6,
      shadowOffset: { width: 0, height: 3 },
      elevation: 8,
    },
    accentRail: {
      width: 3,
    },
    content: {
      flex: 1,
      minWidth: 0,
      paddingHorizontal: 16,
      paddingVertical: 14,
      gap: 8,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    iconChip: {
      width: 28,
      height: 28,
      borderRadius: 14,
      borderWidth: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    title: {
      flex: 1,
      minWidth: 0,
      color: theme.colors.textPrimary,
      fontSize: 14,
      fontWeight: '800',
      letterSpacing: 0.1,
    },
    message: {
      color: theme.colors.textSecondary,
      fontSize: 12,
      lineHeight: 17,
    },
    actions: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      gap: 8,
      marginTop: 2,
    },
    actionButton: {
      minHeight: 34,
      borderRadius: 0,
      borderBottomWidth: 1,
      borderColor: theme.colors.borderSubtle,
      backgroundColor: 'transparent',
      paddingHorizontal: 14,
      alignItems: 'center',
      justifyContent: 'center',
    },
    actionText: {
      color: theme.colors.textPrimary,
      fontSize: 13,
      fontWeight: '800',
    },
    dismissButton: {
      minHeight: 34,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      borderRadius: 0,
      borderBottomWidth: 1,
      borderColor: theme.colors.borderSubtle,
      paddingHorizontal: 10,
    },
    dismissText: {
      color: theme.colors.textSecondary,
      fontSize: 13,
      fontWeight: '700',
    },
    buttonFocused: light
      ? {
          borderColor: theme.colors.focusRing,
          backgroundColor: theme.colors.surfaceFocused,
        }
      : {
          borderColor: theme.colors.focusRing,
          backgroundColor: 'transparent',
          shadowColor: theme.colors.focusRing,
          shadowOpacity: 0.7,
          shadowRadius: 6,
        },
  });
}
