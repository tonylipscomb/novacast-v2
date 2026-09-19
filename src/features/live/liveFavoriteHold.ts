export const LIVE_FAVORITE_HOLD_THRESHOLD_MS = 425;

export type FavoriteHoldEvent = {
  eventType?: string;
  eventKeyAction?: number;
  key?: string;
  keyCode?: number;
  repeatCount?: number;
  eventTime?: number;
  downTime?: number;
};

export type FavoriteHoldResult = {
  reason: string;
  durationMs: number;
  thresholdMs: number;
  measuredHoldMs: number;
  keyCode?: number;
  suppressionArmed: boolean;
  triggerLatencyMs?: number;
};

type FavoriteHoldDetectorOptions = {
  thresholdMs?: number;
  now?: () => number;
  schedule?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  cancelSchedule?: (timer: ReturnType<typeof setTimeout>) => void;
  onStarted?: (event: FavoriteHoldResult) => void;
  onTriggered?: (event: FavoriteHoldResult) => void;
  onCancelled?: (event: FavoriteHoldResult) => void;
};

function isSelectEvent(event: FavoriteHoldEvent) {
  return event.eventType === 'select' || event.eventType === 'playPause' || event.key === 'Enter' || event.key === 'Select' || event.keyCode === 23 || event.keyCode === 66 || event.keyCode === 160;
}

export function createFavoriteHoldDetector(options: FavoriteHoldDetectorOptions = {}) {
  const thresholdMs = options.thresholdMs ?? LIVE_FAVORITE_HOLD_THRESHOLD_MS;
  const now = options.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  const schedule = options.schedule ?? ((callback, delayMs) => setTimeout(callback, delayMs));
  const cancelSchedule = options.cancelSchedule ?? ((timer) => clearTimeout(timer));
  let startedAt: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let triggered = false;
  let suppressNextPress = false;
  let activeKeyCode: number | undefined;
  let nativeStartedAt: number | null = null;
  let nativeTimingAvailable = false;

  const clearTimer = () => {
    if (timer !== null) {
      cancelSchedule(timer);
      timer = null;
    }
  };

  const trigger = (reason: string, measuredAt = now(), measuredHoldMs?: number) => {
    if (startedAt === null || triggered) return false;
    const durationMs = Math.max(0, measuredHoldMs ?? measuredAt - startedAt);
    clearTimer();
    triggered = true;
    suppressNextPress = true;
    options.onTriggered?.({ reason, durationMs, thresholdMs, measuredHoldMs: durationMs, keyCode: activeKeyCode, suppressionArmed: true, triggerLatencyMs: Math.max(0, now() - startedAt) });
    return true;
  };

  const start = (reason: string, keyCode?: number, eventTime?: number) => {
    if (startedAt !== null) return false;
    startedAt = now();
    activeKeyCode = keyCode;
    nativeStartedAt = Number.isFinite(eventTime) ? eventTime ?? null : null;
    nativeTimingAvailable = nativeStartedAt !== null;
    triggered = false;
    suppressNextPress = false;
    options.onStarted?.({ reason, durationMs: 0, thresholdMs, measuredHoldMs: 0, keyCode: activeKeyCode, suppressionArmed: false });
    timer = schedule(() => {
      // Android can deliver JS callbacks late while the UI thread is busy.
      // With native event timing available, wait for key-up to confirm the
      // physical hold instead of converting callback delay into a favorite.
      if (!nativeTimingAvailable) {
        trigger('threshold');
      }
    }, thresholdMs);
    return true;
  };

  const release = (reason: string, eventTime?: number) => {
    if (startedAt === null) return false;
    const nativeDurationMs = nativeTimingAvailable && Number.isFinite(eventTime) && nativeStartedAt !== null
      ? Math.max(0, (eventTime ?? nativeStartedAt) - nativeStartedAt)
      : undefined;
    const durationMs = nativeDurationMs ?? Math.max(0, now() - startedAt);
    clearTimer();
    if (!triggered && durationMs >= thresholdMs) {
      trigger(reason, now(), durationMs);
    }
    if (!triggered) {
      options.onCancelled?.({ reason, durationMs, thresholdMs, measuredHoldMs: durationMs, keyCode: activeKeyCode, suppressionArmed: false });
    }
    startedAt = null;
    triggered = false;
    activeKeyCode = undefined;
    nativeStartedAt = null;
    nativeTimingAvailable = false;
    return true;
  };

  return {
    handleEvent(event: FavoriteHoldEvent) {
      if (!isSelectEvent(event)) return false;
      const localReceiptMs = now();
      if (event.eventKeyAction === 1) return release('key_up', event.eventTime);
      if (event.eventKeyAction === 2) {
        if (startedAt !== null) {
          return true;
        }
        return start('key_repeat', event.keyCode, event.eventTime);
      }
      return start('key_down', event.keyCode, event.eventTime);
    },
    pressIn: () => start('press_in'),
    pressOut: () => release('press_out'),
    trigger,
    cancel: release,
    consumeSuppressedPress: () => {
      if (!suppressNextPress) return false;
      suppressNextPress = false;
      return true;
    },
  };
}
