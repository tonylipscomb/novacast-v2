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
    title: 'Settings not saved',
    message: 'Smart Categories preference could not be saved. Try again.',
  },
  'replay-guides': {
    title: 'Guides not reset',
    message: 'Walkthrough guides could not be reset. Try again.',
  },
  'suppress-guides': {
    title: 'Guides not updated',
    message: 'Guide preferences could not be updated. Try again.',
  },
};

/** Recoverable settings action failures become toasts; the settings list stays focusable. */
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
