export type AppNotificationType = 'error' | 'warning' | 'success' | 'info';
export type AppNotificationPosition = 'top-right' | 'bottom-right' | 'bottom-center';

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
   * When true, the notification's Retry/action button receives initial TV focus instead of
   * Dismiss. Defaults to false: toasts snap focus to Dismiss and trap it there until the
   * toast is dismissed or its action is activated.
   */
  autoFocusAction?: boolean;
};

export type ShowNotificationInput = Omit<AppNotification, 'id'> & { id?: string };

export type NotificationsSnapshot = {
  visible: AppNotification[];
  queued: AppNotification[];
};
