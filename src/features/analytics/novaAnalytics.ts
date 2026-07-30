import * as Crypto from 'expo-crypto';

import { analyticsConfig } from './analyticsConfig';
import { enqueueAnalyticsBatch, flushAnalyticsQueue, getAnalyticsQueueSize } from './analyticsQueue';
import { initializeAnalyticsLifecycle } from './analyticsLifecycle';
import { getAnalyticsSession, touchAnalyticsSession } from './analyticsSession';
import { sendAnalyticsBatch } from './analyticsTransport';
import type { AnalyticsDeviceState, AnalyticsEventName, AnalyticsMetadata } from './analyticsTypes';

let initialized = false;
let currentRoute: string | null = null;
let currentState: Omit<AnalyticsDeviceState, 'sessionUuid' | 'appVersion' | 'appBuild' | 'lastSeenAt'> = {};
let flushPromise: Promise<void> | null = null;
let debouncedFlushTimer: ReturnType<typeof setTimeout> | null = null;

function developmentLog(...args: unknown[]) {
  if (typeof __DEV__ !== 'undefined' && __DEV__) console.log('[analytics]', ...args);
}

export function getAnalyticsCurrentRoute() {
  return currentRoute;
}

export function normalizeAnalyticsRoute(route: string | null) {
  const path = route?.split(/[?#]/, 1)[0]?.trim() ?? '';
  return (path || '/').slice(0, 96);
}

export function setAnalyticsRoute(route: string | null) {
  const normalizedRoute = normalizeAnalyticsRoute(route);
  developmentLog('normalized route', normalizedRoute);
  if (currentRoute === normalizedRoute) return;
  currentRoute = normalizedRoute;
  void enqueueAnalyticsEvent('screen_view', { route: normalizedRoute }).then((queued) => {
    if (!queued) return;
    void getAnalyticsQueueSize().then((queueLength) => {
      developmentLog('screen_view queued', normalizedRoute, 'queue length', queueLength);
    }).catch(() => undefined);
    scheduleDebouncedAnalyticsFlush();
  });
}

function scheduleDebouncedAnalyticsFlush() {
  if (debouncedFlushTimer) clearTimeout(debouncedFlushTimer);
  debouncedFlushTimer = setTimeout(() => {
    debouncedFlushTimer = null;
    developmentLog('debounced flush started');
    void flushNovaAnalytics().catch(() => undefined);
  }, 4_000);
}

export function setAnalyticsState(state: Partial<typeof currentState>) {
  currentState = { ...currentState, ...state };
}

function retryDelay(attempt: number) {
  return Math.min(analyticsConfig.maxRetryDelayMs, analyticsConfig.baseRetryDelayMs * 2 ** Math.max(0, attempt - 1));
}

export async function enqueueAnalyticsEvent(eventName: AnalyticsEventName, input: {
  route?: string;
  providerId?: string;
  contentId?: string;
  contentType?: string;
  outcome?: string;
  durationMs?: number;
  countValue?: number;
  metadata?: AnalyticsMetadata;
} = {}) {
  if (!analyticsConfig.enabled) return false;
  try {
    const session = await getAnalyticsSession();
    await enqueueAnalyticsBatch({
      session: { ...session },
      events: [{
        idempotencyKey: Crypto.randomUUID(),
        eventName,
        occurredAt: new Date().toISOString(),
        route: input.route ?? currentRoute ?? undefined,
        providerId: input.providerId,
        contentId: input.contentId,
        contentType: input.contentType,
        outcome: input.outcome,
        durationMs: input.durationMs,
        countValue: input.countValue,
        metadata: input.metadata,
      }],
    });
    return true;
  } catch {
    return false;
  }
}

function buildState(session: Awaited<ReturnType<typeof getAnalyticsSession>>) {
  return {
    sessionUuid: session.sessionUuid,
    lastSeenAt: new Date().toISOString(),
    currentRoute: currentRoute ?? undefined,
    ...currentState,
    appVersion: session.appVersion,
    appBuild: session.appBuild,
  };
}

export async function flushNovaAnalytics(options: { includeState?: boolean; lifecycle?: string } = {}) {
  if (!analyticsConfig.enabled || flushPromise) return flushPromise;
  flushPromise = (async () => {
    const session = await touchAnalyticsSession();
    const state = options.includeState ? buildState(session) : undefined;
    await flushAnalyticsQueue(async (batch) => {
      const next = { ...batch, state: state ?? batch.state };
      const response = await sendAnalyticsBatch(next);
      developmentLog('accepted/duplicate/rejected counts', response.accepted ?? 0, response.duplicates ?? 0, response.rejected ?? 0);
      return response;
    }, session, state, retryDelay);
  })().catch(() => undefined).finally(() => {
    flushPromise = null;
  });
  return flushPromise;
}

export async function initializeNovaAnalytics() {
  if (!analyticsConfig.enabled || initialized) return;
  initialized = true;
  try {
    await getAnalyticsSession();
    initializeAnalyticsLifecycle();
    await enqueueAnalyticsEvent('session_started');
    await flushNovaAnalytics({ includeState: true });
  } catch {
    // Analytics must never affect app startup.
  }
}

export function resetNovaAnalyticsForTests() {
  if (debouncedFlushTimer) clearTimeout(debouncedFlushTimer);
  debouncedFlushTimer = null;
  initialized = false;
  currentRoute = null;
  currentState = {};
  flushPromise = null;
}
