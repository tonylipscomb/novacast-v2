import AsyncStorage from '@react-native-async-storage/async-storage';

import type { AppNotificationCategory, AppNotificationType } from './types';

export const NOTIFICATION_CENTER_STORAGE_KEY = '@novacast/notification-center-v1';
export const MAX_NOTIFICATION_CENTER_ENTRIES = 100;

export type NotificationCenterEntry = {
  id: string;
  category: AppNotificationCategory;
  type: AppNotificationType;
  title: string;
  message?: string;
  actionLabel?: string;
  createdAt: number;
  readAt: number | null;
  dismissedAt: number | null;
};

let entries: NotificationCenterEntry[] = [];
let hydrated = false;
let hydrationPromise: Promise<void> | null = null;
const listeners = new Set<() => void>();
let persistTimer: ReturnType<typeof setTimeout> | null = null;
const SENSITIVE_TEXT = /(https?:\/\/|\/\/[\w.-]+@|password\s*[:=]|token\s*[:=]|api[_-]?key\s*[:=]|secret\s*[:=])/i;

function safeText(value: string | undefined, fallback?: string): string | undefined {
  if (value == null || SENSITIVE_TEXT.test(value)) return fallback;
  return value;
}

function notify() {
  listeners.forEach((listener) => listener());
}

function schedulePersist() {
  if (typeof AsyncStorage?.setItem !== 'function' || persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void AsyncStorage.setItem(NOTIFICATION_CENTER_STORAGE_KEY, JSON.stringify(entries)).catch(() => undefined);
  }, 0);
}

function sanitizeEntry(value: unknown): NotificationCenterEntry | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== 'string' || typeof record.title !== 'string') return null;
  const createdAt = Number(record.createdAt);
  if (!Number.isFinite(createdAt)) return null;
  return {
    id: record.id,
    category: typeof record.category === 'string' ? record.category as AppNotificationCategory : 'general',
    type: record.type === 'error' || record.type === 'warning' || record.type === 'success' ? record.type : 'info',
    title: safeText(record.title, 'NovaCast notification')!.slice(0, 160),
    message: typeof record.message === 'string' ? safeText(record.message)?.slice(0, 500) : undefined,
    actionLabel: typeof record.actionLabel === 'string' ? safeText(record.actionLabel)?.slice(0, 80) : undefined,
    createdAt,
    readAt: Number.isFinite(Number(record.readAt)) ? Number(record.readAt) : null,
    dismissedAt: Number.isFinite(Number(record.dismissedAt)) ? Number(record.dismissedAt) : null,
  };
}

export function getNotificationCenterSnapshot(): NotificationCenterEntry[] {
  return entries;
}

export function subscribeNotificationCenter(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function hydrateNotificationCenter(): Promise<void> {
  if (hydrated) return Promise.resolve();
  if (typeof AsyncStorage?.getItem !== 'function') {
    hydrated = true;
    return Promise.resolve();
  }
  if (!hydrationPromise) {
    hydrationPromise = AsyncStorage.getItem(NOTIFICATION_CENTER_STORAGE_KEY)
      .then((raw) => {
        if (!raw) return;
        try {
          const parsed: unknown = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            entries = parsed.map(sanitizeEntry).filter((entry): entry is NotificationCenterEntry => entry !== null).slice(-MAX_NOTIFICATION_CENTER_ENTRIES);
          }
        } catch {
          entries = [];
        }
      })
      .catch(() => undefined)
      .finally(() => {
        hydrated = true;
        hydrationPromise = null;
        notify();
      });
  }
  return hydrationPromise;
}

export function recordNotification(input: Omit<NotificationCenterEntry, 'createdAt' | 'readAt' | 'dismissedAt'> & { createdAt?: number }) {
  const now = input.createdAt ?? Date.now();
  const existing = entries.find((entry) => entry.id === input.id);
  const next: NotificationCenterEntry = {
    ...input,
    category: input.category ?? 'general',
    title: safeText(input.title, 'NovaCast notification')!.slice(0, 160),
    message: safeText(input.message),
    actionLabel: safeText(input.actionLabel),
    createdAt: existing?.createdAt ?? now,
    readAt: existing && existing.title === input.title && existing.message === input.message ? existing.readAt : null,
    dismissedAt: null,
  };
  entries = [
    ...entries.filter((entry) => entry.id !== input.id),
    next,
  ].slice(-MAX_NOTIFICATION_CENTER_ENTRIES);
  schedulePersist();
  notify();
}

export function markNotificationRead(id: string) {
  const now = Date.now();
  let changed = false;
  entries = entries.map((entry) => {
    if (entry.id !== id || entry.readAt !== null) return entry;
    changed = true;
    return { ...entry, readAt: now };
  });
  if (changed) { schedulePersist(); notify(); }
}

export function markAllNotificationsRead() {
  const now = Date.now();
  let changed = false;
  entries = entries.map((entry) => {
    if (entry.dismissedAt !== null || entry.readAt !== null) return entry;
    changed = true;
    return { ...entry, readAt: now };
  });
  if (changed) { schedulePersist(); notify(); }
}

export function dismissCenterNotification(id: string) {
  const now = Date.now();
  let changed = false;
  entries = entries.map((entry) => {
    if (entry.id !== id || entry.dismissedAt !== null) return entry;
    changed = true;
    return { ...entry, dismissedAt: now };
  });
  if (changed) { schedulePersist(); notify(); }
}

export function resetNotificationCenterForTests() {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = null;
  entries = [];
  hydrated = false;
  hydrationPromise = null;
  listeners.clear();
}
