export const AUTH_INIT_NOTIFICATION_ID = 'auth-init-failed';
export const AUTH_PAIRING_NOTIFICATION_ID = 'auth-pairing-failed';
export const AUTH_NOTIFICATION_DURATION_MS = 7000;

export type AuthNotificationSpec = {
  title: string;
  message: string;
  persistent: boolean;
};

/** Startup init failures become toasts; recovery actions stay focusable on screen. */
export function resolveAuthInitNotification(
  initFailed: boolean,
  retryAttemptedAndStillFailing: boolean,
): AuthNotificationSpec | null {
  if (!initFailed) {
    return null;
  }

  return {
    title: 'Provider connection failed',
    message: 'NovaCast could not connect to your saved provider. Retry or pair another provider.',
    persistent: retryAttemptedAndStillFailing,
  };
}

/** Pairing connection failures become toasts; the pairing layout stays usable. */
export function resolveAuthPairingNotification(
  connectionFailed: boolean,
  retryAttemptedAndStillFailing: boolean,
): AuthNotificationSpec | null {
  if (!connectionFailed) {
    return null;
  }

  return {
    title: 'Pairing connection failed',
    message: 'NovaCast could not connect the paired provider. Try again.',
    persistent: retryAttemptedAndStillFailing,
  };
}
