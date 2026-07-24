export type AppNotificationType = 'error' | 'warning' | 'success' | 'info';
export type AppNotificationPosition = 'top-right' | 'bottom-right' | 'bottom-center';

/**
 * `passive` (default): non-blocking toast — never steals TV focus or intercepts Back.
 * `blocking`: rare modal-style toast that may capture focus for an explicit choice.
 */
export type NotificationInteractionMode = 'passive' | 'blocking';

export type AppNotification = {
  id: string;
  type: AppNotificationType;
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
  dismissLabel?: string;
  duration?: number;
  persistent?: boolean;
  position?: AppNotificationPosition;
  /** Screen/feature key so a caller can bulk-clear its own notifications on unmount via `clearScope`. */
  scope?: string;
  /** Collapses repeated triggers of the same underlying condition into one entry instead of stacking duplicates. */
  dedupeKey?: string;
  /**
   * Only meaningful for `blocking` notifications. When true, Retry/action receives
   * initial TV focus instead of Dismiss.
   */
  autoFocusAction?: boolean;
  /** Defaults to `passive`. Existing call sites stay non-blocking unless they opt in. */
  interactionMode?: NotificationInteractionMode;
};

export type ShowNotificationInput = Omit<AppNotification, 'id'> & { id?: string };

export type NotificationsSnapshot = {
  visible: AppNotification[];
  queued: AppNotification[];
};
