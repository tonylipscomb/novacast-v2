import type { AppNotification, NotificationsSnapshot, ShowNotificationInput } from './types';

declare const __DEV__: boolean | undefined;

/** At most this many notifications render at once; the rest wait in `queued` (FIFO). */
export const MAX_VISIBLE_NOTIFICATIONS = 2;
/** Temporary notifications auto-dismiss after this long unless `duration`/`persistent` says otherwise. */
export const DEFAULT_NOTIFICATION_DURATION_MS = 7000;
/** A repeated `show()` with the same `dedupeKey` inside this window refreshes the existing entry instead of adding a new one. */
export const DEDUPE_WINDOW_MS = 4000;

let state: NotificationsSnapshot = { visible: [], queued: [] };
const listeners = new Set<() => void>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const dedupeIndex = new Map<string, { id: string; lastTriggeredAt: number }>();
const actionTriggeredIds = new Set<string>();
let idCounter = 0;

function isDevEnvironment(): boolean {
  if (typeof __DEV__ !== 'undefined') {
    return Boolean(__DEV__);
  }
  return process.env.NODE_ENV !== 'production';
}

// Nice-to-have safety net: notifications shown to users must never contain provider
// URLs, credentials, tokens, or raw error/response bodies. This only warns in dev; the
// real guardrail is that callers (e.g. Guide's migration) always pass human-authored,
// generic copy instead of caught error objects/messages.
const SENSITIVE_LOOKING_PATTERN = /(https?:\/\/|\/\/[\w.-]+@|password\s*[:=]|token\s*[:=]|api[_-]?key\s*[:=]|secret\s*[:=])/i;

function warnIfLooksSensitive(value: string | undefined | null) {
  if (!value || !isDevEnvironment()) {
    return;
  }
  if (SENSITIVE_LOOKING_PATTERN.test(value)) {
    console.warn(
      '[notifications] A notification title/message looks like it may contain a URL, token, or credential. ' +
        'Notifications must only show human-authored, generic copy; log raw details via console.warn instead.',
      value,
    );
  }
}

function generateNotificationId(): string {
  idCounter += 1;
  return `notif-${Date.now()}-${idCounter}-${Math.random().toString(36).slice(2, 8)}`;
}

function notify() {
  listeners.forEach((listener) => listener());
}

function setState(patch: Partial<NotificationsSnapshot>) {
  state = { ...state, ...patch };
  notify();
}

export function getNotificationsSnapshot(): NotificationsSnapshot {
  return state;
}

export function subscribeNotifications(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function findNotification(id: string): AppNotification | null {
  return state.visible.find((notification) => notification.id === id) ?? state.queued.find((notification) => notification.id === id) ?? null;
}

function notificationExists(id: string): boolean {
  return findNotification(id) !== null;
}

function clearTimer(id: string) {
  const timer = timers.get(id);
  if (timer) {
    clearTimeout(timer);
    timers.delete(id);
  }
}

function scheduleTimer(notification: AppNotification) {
  clearTimer(notification.id);
  if (notification.persistent) {
    return;
  }
  const duration = notification.duration ?? DEFAULT_NOTIFICATION_DURATION_MS;
  const timer = setTimeout(() => {
    dismissNotification(notification.id);
  }, duration);
  timers.set(notification.id, timer);
}

/** Fills `visible` back up to `MAX_VISIBLE_NOTIFICATIONS` from the front of `queued`, starting each promoted entry's timer. */
function promote() {
  let visible = state.visible;
  let queued = state.queued;
  const promoted: AppNotification[] = [];

  while (visible.length < MAX_VISIBLE_NOTIFICATIONS && queued.length > 0) {
    const [next, ...rest] = queued;
    visible = [...visible, next];
    queued = rest;
    promoted.push(next);
  }

  if (!promoted.length) {
    return;
  }

  setState({ visible, queued });
  promoted.forEach(scheduleTimer);
}

function buildNotification(id: string, input: ShowNotificationInput): AppNotification {
  warnIfLooksSensitive(input.title);
  warnIfLooksSensitive(input.message);

  return {
    id,
    type: input.type,
    title: input.title,
    message: input.message,
    actionLabel: input.actionLabel,
    onAction: input.onAction,
    dismissLabel: input.dismissLabel,
    duration: input.duration,
    persistent: input.persistent,
    position: input.position ?? 'bottom-right',
    scope: input.scope,
    dedupeKey: input.dedupeKey,
    autoFocusAction: input.autoFocusAction ?? false,
  };
}

function notificationContentEqual(left: AppNotification, right: AppNotification) {
  return (
    left.type === right.type &&
    left.title === right.title &&
    left.message === right.message &&
    left.actionLabel === right.actionLabel &&
    left.dismissLabel === right.dismissLabel &&
    left.duration === right.duration &&
    left.persistent === right.persistent &&
    left.position === right.position &&
    left.scope === right.scope &&
    left.dedupeKey === right.dedupeKey &&
    left.autoFocusAction === right.autoFocusAction
  );
}

function replaceNotification(id: string, notification: AppNotification) {
  const existing = findNotification(id);
  if (existing && notificationContentEqual(existing, notification)) {
    return;
  }

  actionTriggeredIds.delete(id);
  const isVisible = state.visible.some((existing) => existing.id === id);
  const visible = state.visible.map((existing) => (existing.id === id ? notification : existing));
  const queued = state.queued.map((existing) => (existing.id === id ? notification : existing));
  setState({ visible, queued });
  if (isVisible) {
    scheduleTimer(notification);
  }
}

function enqueueNotification(notification: AppNotification) {
  setState({ queued: [...state.queued, notification] });
  promote();
}

/**
 * Shows a notification, auto-generating an id when one isn't supplied. Calling this again
 * with the same `id` updates that notification in place (and restarts its timer if visible)
 * instead of queuing a duplicate. A `dedupeKey` match on an still-active entry within
 * `DEDUPE_WINDOW_MS` is treated the same way, so a burst of identical failures collapses
 * into one refreshed toast rather than spamming the queue.
 */
export function showNotification(input: ShowNotificationInput): string {
  const now = Date.now();
  let targetId = input.id ?? null;

  if (!targetId && input.dedupeKey) {
    const tracked = dedupeIndex.get(input.dedupeKey);
    if (tracked && now - tracked.lastTriggeredAt < DEDUPE_WINDOW_MS && notificationExists(tracked.id)) {
      targetId = tracked.id;
    }
  }

  const id = targetId ?? generateNotificationId();
  const notification = buildNotification(id, input);

  if (input.dedupeKey) {
    dedupeIndex.set(input.dedupeKey, { id, lastTriggeredAt: now });
  }

  if (notificationExists(id)) {
    replaceNotification(id, notification);
  } else {
    enqueueNotification(notification);
  }

  return id;
}

/** Dismisses a notification (visible or still-queued), tearing down its timer and promoting the next queued entry if a visible slot opened up. */
export function dismissNotification(id: string) {
  clearTimer(id);
  actionTriggeredIds.delete(id);

  const wasVisible = state.visible.some((notification) => notification.id === id);
  const nextVisible = state.visible.filter((notification) => notification.id !== id);
  const nextQueued = state.queued.filter((notification) => notification.id !== id);
  const changed = nextVisible.length !== state.visible.length || nextQueued.length !== state.queued.length;
  if (!changed) {
    return;
  }

  setState({ visible: nextVisible, queued: nextQueued });
  if (wasVisible) {
    promote();
  }
}

/** Removes every notification (visible or queued) tagged with `scope`, e.g. called from a screen's unmount cleanup. */
export function clearScope(scope: string) {
  const removedIds = [...state.visible, ...state.queued].filter((notification) => notification.scope === scope).map((notification) => notification.id);
  if (!removedIds.length) {
    return;
  }

  removedIds.forEach((id) => {
    clearTimer(id);
    actionTriggeredIds.delete(id);
  });

  setState({
    visible: state.visible.filter((notification) => notification.scope !== scope),
    queued: state.queued.filter((notification) => notification.scope !== scope),
  });
  promote();
}

/** Invokes a notification's `onAction` exactly once (guarded against double-fire from a fast double press) then dismisses it. */
export function triggerNotificationAction(id: string) {
  const notification = findNotification(id);
  if (!notification) {
    return;
  }

  if (notification.onAction && !actionTriggeredIds.has(id)) {
    actionTriggeredIds.add(id);
    notification.onAction();
  }

  dismissNotification(id);
}

export function resetNotificationsForTests() {
  timers.forEach((timer) => clearTimeout(timer));
  timers.clear();
  dedupeIndex.clear();
  actionTriggeredIds.clear();
  listeners.clear();
  idCounter = 0;
  state = { visible: [], queued: [] };
}

export function getActiveNotificationTimerCountForTests(): number {
  return timers.size;
}
