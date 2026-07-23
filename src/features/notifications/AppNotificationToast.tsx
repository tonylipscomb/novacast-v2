import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { ComponentProps, ElementRef } from 'react';
import { useEffect, useRef, useState } from 'react';
import { BackHandler, findNodeHandle, Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { getTvDensity } from '@/components/nova/tvDensity';
import { novaTheme } from '@/theme';

import { dismissNotification, triggerNotificationAction } from './notificationStore';
import { resolveNotificationInitialFocusTarget } from './notificationFocusLogic';
import type { AppNotification, AppNotificationType } from './types';

type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];
type Focusable = ElementRef<typeof Pressable>;

const TYPE_ICON: Record<AppNotificationType, IconName> = {
  error: 'alert-circle-outline',
  warning: 'alert-outline',
  success: 'check-circle-outline',
  info: 'information-outline',
};

const TYPE_ACCENT: Record<AppNotificationType, string> = {
  error: novaTheme.colors.danger,
  warning: novaTheme.colors.warning,
  success: novaTheme.colors.success,
  info: novaTheme.colors.accentHover,
};

type AppNotificationToastProps = {
  notification: AppNotification;
  captureFocus?: boolean;
};

/**
 * TV-safe toast card. When visible, focus is trapped inside the toast: it snaps to Dismiss
 * (or Retry when autoFocusAction is set), and D-pad navigation cannot escape to the screen
 * underneath until the toast is dismissed or its action is activated.
 */
export function AppNotificationToast({ notification, captureFocus = true }: AppNotificationToastProps) {
  const { width } = useWindowDimensions();
  const density = getTvDensity(width);
  const maxWidth = density === 'compact' ? 380 : 440;

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
    const frame = requestAnimationFrame(() => {
      setActionHandle(findNodeHandle(actionRef.current) ?? undefined);
      setDismissHandle(findNodeHandle(dismissRef.current) ?? undefined);
    });
    return () => cancelAnimationFrame(frame);
  }, [hasAction]);

  useEffect(() => {
    if (!captureFocus || Platform.OS !== 'android') {
      return undefined;
    }

    const frame = requestAnimationFrame(() => {
      const target = initialFocusTarget === 'action' ? actionRef.current : dismissRef.current;
      target?.focus();
    });

    return () => cancelAnimationFrame(frame);
  }, [captureFocus, initialFocusTarget, notification.id]);

  useEffect(() => {
    if (Platform.OS !== 'android') {
      return undefined;
    }

    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!focusedButtonRef.current) {
        return false;
      }

      lockDismissFocusRef.current = false;
      dismissNotification(notification.id);
      return true;
    });

    return () => subscription.remove();
  }, [notification.id]);

  const releaseDismissFocusLock = () => {
    lockDismissFocusRef.current = false;
  };

  const restoreDismissFocusIfLocked = () => {
    if (!lockDismissFocusRef.current || initialFocusTarget !== 'dismiss') {
      return;
    }

    requestAnimationFrame(() => {
      dismissRef.current?.focus();
    });
  };

  const accentColor = TYPE_ACCENT[notification.type];
  const dismissTrapHandle = dismissHandle;
  const actionTrapHandle = actionHandle ?? dismissHandle;

  return (
    <View
      style={[styles.toast, { maxWidth, borderColor: `${accentColor}66` }]}
      importantForAccessibility="yes">
      <View style={[styles.accentRail, { backgroundColor: accentColor }]} />
      <View style={styles.content}>
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

        <View style={styles.actions}>
          {hasAction ? (
            <Pressable
              ref={actionRef}
              focusable
              hasTVPreferredFocus={captureFocus && initialFocusTarget === 'action'}
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
              <Text style={styles.actionText}>{notification.actionLabel}</Text>
            </Pressable>
          ) : null}

          <Pressable
            ref={dismissRef}
            focusable
            hasTVPreferredFocus={captureFocus && initialFocusTarget === 'dismiss'}
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
            <MaterialCommunityIcons name="close" size={14} color={novaTheme.colors.textSecondary} />
            <Text style={styles.dismissText}>{notification.dismissLabel ?? 'Dismiss'}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  toast: {
    minWidth: 320,
    flexDirection: 'row',
    overflow: 'hidden',
    borderRadius: 0,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    backgroundColor: 'rgba(7,9,13,0.94)',
    shadowColor: '#000000',
    shadowOpacity: 0.25,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 5,
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
    borderRadius: 0,
    borderBottomWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    flex: 1,
    minWidth: 0,
    color: novaTheme.colors.textPrimary,
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0.1,
  },
  message: {
    color: novaTheme.colors.textSecondary,
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
    borderColor: novaTheme.colors.borderSubtle,
    backgroundColor: 'transparent',
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionText: {
    color: novaTheme.colors.textPrimary,
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
    borderColor: novaTheme.colors.borderSubtle,
    paddingHorizontal: 10,
  },
  dismissText: {
    color: novaTheme.colors.textSecondary,
    fontSize: 13,
    fontWeight: '700',
  },
  buttonFocused: {
    borderColor: novaTheme.colors.focusRing,
    backgroundColor: 'transparent',
    shadowColor: novaTheme.colors.focusRing,
    shadowOpacity: 0.7,
    shadowRadius: 6,
  },
});
