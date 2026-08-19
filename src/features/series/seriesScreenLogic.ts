export type SeriesLoadStatus = 'loading' | 'ready' | 'empty' | 'error';

export const SERIES_LOAD_NOTIFICATION_ID = 'series-load-unavailable';
export const SERIES_DETAIL_NOTIFICATION_ID = 'series-detail-unavailable';
/** Stage 4.2O.1 — episode playback launch failures (popup stays open; toast only). */
export const SERIES_PLAYBACK_NOTIFICATION_ID = 'series-playback-unavailable';
export const SERIES_NOTIFICATION_DURATION_MS = 7000;

export type SeriesNotificationSpec = {
  title: string;
  message: string;
  persistent: boolean;
};

/** Recoverable category/page failures become toasts; ready/empty/loading stay inline. */
export function resolveSeriesNotificationForStatus(
  status: SeriesLoadStatus,
  retryAttemptedAndStillFailing: boolean,
  errorMessage?: string | null,
): SeriesNotificationSpec | null {
  if (status !== 'error') {
    return null;
  }

  return {
    title: 'Series unavailable',
    message: errorMessage?.trim() || 'We could not load series from your provider.',
    persistent: retryAttemptedAndStillFailing,
  };
}

export function resolveSeriesDetailNotification(
  retryAttemptedAndStillFailing: boolean,
  detailError?: string | null,
): SeriesNotificationSpec {
  return {
    title: 'Series details unavailable',
    message: detailError?.trim() || 'Detailed series information could not be loaded.',
    persistent: retryAttemptedAndStillFailing,
  };
}

/** Stage 4.2O.1 §6/§9 — episode playback launch failure toast (never persistent, popup stays open). */
export function resolveSeriesPlaybackNotification(playbackError: string): SeriesNotificationSpec {
  return {
    title: 'Playback unavailable',
    message: playbackError.trim() || 'This episode could not be played right now.',
    persistent: false,
  };
}
