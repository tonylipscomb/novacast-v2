export type SettingsActionKind = 'smart-categories' | 'replay-guides' | 'suppress-guides';

export const SETTINGS_ACTION_NOTIFICATION_ID = 'settings-action-failed';
export const SETTINGS_NOTIFICATION_DURATION_MS = 7000;

export type SettingsNotificationSpec = {
  title: string;
  message: string;
  persistent: boolean;
};

const ACTION_COPY: Record<SettingsActionKind, { title: string; message: string }> = {
  'smart-categories': {
    title: 'Setting could not be updated',
    message: 'Please try the setting again.',
  },
  'replay-guides': {
    title: 'Setting could not be updated',
    message: 'Please try the setting again.',
  },
  'suppress-guides': {
    title: 'Setting could not be updated',
    message: 'Please try the setting again.',
  },
};

/** Recoverable settings action failures become passive toasts; retry via the setting control. */
export function resolveSettingsActionNotification(
  action: SettingsActionKind | null,
  retryAttemptedAndStillFailing: boolean,
): SettingsNotificationSpec | null {
  if (!action) {
    return null;
  }

  const copy = ACTION_COPY[action];
  return {
    title: copy.title,
    message: copy.message,
    persistent: retryAttemptedAndStillFailing,
  };
}
