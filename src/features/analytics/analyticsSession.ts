import * as Crypto from 'expo-crypto';
import * as Device from 'expo-device';

import { analyticsConfig } from './analyticsConfig';
import { resolveAnalyticsAppMetadata } from './analyticsAppMetadata';
import { writeAnalyticsSession } from './analyticsStorage';
import type { AnalyticsSession } from './analyticsTypes';

let session: AnalyticsSession | null = null;
let sessionPromise: Promise<AnalyticsSession> | null = null;

function nowIso() {
  return new Date().toISOString();
}

export async function getAnalyticsSession() {
  if (session) return session;
  if (!sessionPromise) {
    sessionPromise = Promise.resolve().then(async () => {
      const startedAt = nowIso();
      const appMetadata = resolveAnalyticsAppMetadata();
      const next: AnalyticsSession = {
        sessionUuid: Crypto.randomUUID(),
        startedAt,
        lastSeenAt: startedAt,
        appVersion: appMetadata.appVersion,
        appBuild: appMetadata.appBuild,
        manufacturer: Device.manufacturer ?? undefined,
        model: Device.modelName ?? undefined,
        platformApiLevel: Device.platformApiLevel ?? undefined,
        environment: typeof __DEV__ !== 'undefined' && __DEV__ ? 'development' : 'beta',
      };
      session = next;
      await writeAnalyticsSession(next);
      return next;
    }).finally(() => {
      sessionPromise = null;
    });
  }
  return sessionPromise;
}

export async function touchAnalyticsSession(at = nowIso()) {
  const current = await getAnalyticsSession();
  current.lastSeenAt = at;
  await writeAnalyticsSession(current);
  return current;
}

export async function endAnalyticsSession(exitReason: string, at = nowIso()) {
  const current = await getAnalyticsSession();
  if (!current.endedAt) {
    current.endedAt = at;
    current.lastSeenAt = at;
    current.exitReason = exitReason.slice(0, 80);
    current.durationMs = Math.max(0, Date.parse(at) - Date.parse(current.startedAt));
    await writeAnalyticsSession(current);
  }
  return current;
}

export function resetAnalyticsSessionForTests() {
  session = null;
  sessionPromise = null;
}

export function analyticsIsEnabled() {
  return analyticsConfig.enabled;
}
