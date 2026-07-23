export type NotificationFocusTarget = 'action' | 'dismiss';

/** TV toasts default to Dismiss; callers can opt into focusing Retry via autoFocusAction. */
export function resolveNotificationInitialFocusTarget(
  autoFocusAction: boolean,
  hasAction: boolean,
): NotificationFocusTarget {
  if (autoFocusAction && hasAction) {
    return 'action';
  }

  return 'dismiss';
}

export function shouldCaptureNotificationFocus(isTopmostVisibleToast: boolean): boolean {
  return isTopmostVisibleToast;
}
