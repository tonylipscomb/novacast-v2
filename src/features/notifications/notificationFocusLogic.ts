import type { NotificationInteractionMode } from './types';

export type NotificationFocusTarget = 'action' | 'dismiss';

/** Blocking TV toasts default to Dismiss; callers can opt into focusing Retry via autoFocusAction. */
export function resolveNotificationInitialFocusTarget(
  autoFocusAction: boolean,
  hasAction: boolean,
): NotificationFocusTarget {
  if (autoFocusAction && hasAction) {
    return 'action';
  }

  return 'dismiss';
}

export function resolveNotificationInteractionMode(
  mode: NotificationInteractionMode | undefined,
): NotificationInteractionMode {
  return mode ?? 'passive';
}

/** Only a topmost blocking toast may capture TV focus. Passive toasts never do. */
export function shouldCaptureNotificationFocus(
  isTopmostVisibleToast: boolean,
  interactionMode: NotificationInteractionMode | undefined = 'passive',
): boolean {
  return isTopmostVisibleToast && resolveNotificationInteractionMode(interactionMode) === 'blocking';
}

export function isPassiveNotification(interactionMode: NotificationInteractionMode | undefined): boolean {
  return resolveNotificationInteractionMode(interactionMode) === 'passive';
}

/** Passive toasts never mount focusable Retry/Dismiss controls. */
export function shouldRenderNotificationFocusableControls(
  interactionMode: NotificationInteractionMode | undefined,
): boolean {
  return resolveNotificationInteractionMode(interactionMode) === 'blocking';
}
