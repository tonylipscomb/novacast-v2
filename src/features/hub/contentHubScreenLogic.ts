export const CONTENT_HUB_SWITCH_NOTIFICATION_ID = 'content-hub-provider-switch';
export const CONTENT_HUB_NOTIFICATION_DURATION_MS = 7000;

export type ContentHubNotificationSpec = {
  title: string;
  message: string;
  persistent: boolean;
};

/** Provider switch failures become toasts; the hub layout and provider cards stay usable. */
export function resolveContentHubProviderSwitchNotification(
  providerSwitchError: string | null | undefined,
  retryAttemptedAndStillFailing: boolean,
): ContentHubNotificationSpec | null {
  if (!providerSwitchError?.trim()) {
    return null;
  }

  return {
    title: 'Provider switch failed',
    message: 'We could not connect to that provider. Check your subscription and try again.',
    persistent: retryAttemptedAndStillFailing,
  };
}
