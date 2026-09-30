import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';

import {
  buildDeviceAssignmentChannelName,
  logDeviceAssignmentRealtime,
  parseRealtimeAssignmentSignal,
  shortenDeviceId,
  assignmentToken,
} from './deviceAssignmentLogic.ts';
import {
  fetchAuthoritativeDeviceAssignment,
  reconcileDeviceAssignment,
} from './deviceAssignmentReconcile.ts';
import { getDeviceState, subscribeDeviceState } from './deviceActivation.ts';

const ASSIGNMENT_CHANGED_EVENT = 'assignment-changed';

let client: SupabaseClient | null = null;
let channel: RealtimeChannel | null = null;
let subscribedDeviceId: string | null = null;
let lifecycleBound = false;
let unbindLifecycle: (() => void) | null = null;
let startPromise: Promise<void> | null = null;
let lifecycleGeneration = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryAttempt = 0;

const RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 15_000] as const;

export function resolveSupabaseRealtimeConfig() {
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim();
  const explicitUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim().replace(/\/+$/, '');
  const pairingApiUrl = process.env.EXPO_PUBLIC_NOVACAST_PAIRING_API_URL?.trim().replace(/\/+$/, '');
  const url =
    explicitUrl ||
    (pairingApiUrl ? pairingApiUrl.replace(/\/functions\/v1$/i, '') : '');
  if (!url || !anonKey || !/^https?:\/\//i.test(url)) {
    return null;
  }
  return { url, anonKey };
}

function getRealtimeClient() {
  const config = resolveSupabaseRealtimeConfig();
  if (!config) {
    return null;
  }
  if (!client) {
    client = createClient(config.url, config.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  }
  return client;
}

function realtimeErrorCategory(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  if (!message) return 'unknown';
  if (/timeout|timed_out/.test(message)) return 'timeout';
  if (/auth|unauthorized|forbidden|401|403/.test(message)) return 'authorization';
  if (/network|socket|websocket|connect|closed/.test(message)) return 'network';
  return 'channel';
}

function clearRetryTimer() {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
}

function scheduleRetry(deviceId: string, generation: number) {
  if (!lifecycleBound || generation !== lifecycleGeneration || retryTimer) return;
  const attempt = retryAttempt;
  const delayMs = RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)];
  retryAttempt = Math.min(attempt + 1, RETRY_DELAYS_MS.length - 1);
  logDeviceAssignmentRealtime('retry-scheduled', {
    deviceId: shortenDeviceId(deviceId),
    retryAttempt: attempt + 1,
    delayMs,
  });
  retryTimer = setTimeout(() => {
    retryTimer = null;
    if (!lifecycleBound || generation !== lifecycleGeneration) return;
    void startDeviceAssignmentRealtime(deviceId, true);
  }, delayMs);
}

async function removeErroredChannel(
  erroredChannel: RealtimeChannel,
  deviceId: string,
  generation: number,
  error: unknown,
) {
  if (channel !== erroredChannel || subscribedDeviceId !== deviceId || generation !== lifecycleGeneration) return;
  channel = null;
  subscribedDeviceId = null;
  logDeviceAssignmentRealtime('channel-removed', {
    deviceId: shortenDeviceId(deviceId),
    reason: 'subscription-error',
    errorCategory: realtimeErrorCategory(error),
  });
  try {
    await erroredChannel.unsubscribe();
  } catch {
    // Teardown is best effort after detaching the channel from application state.
  }
  getRealtimeClient()?.removeChannel(erroredChannel);
  scheduleRetry(deviceId, generation);
}

async function startChannel(deviceId: string, generation: number) {
  const realtime = getRealtimeClient();
  if (!realtime || generation !== lifecycleGeneration) {
    if (!realtime) {
      logDeviceAssignmentRealtime('subscription-error', {
        reason: 'realtime-unconfigured',
        deviceId: shortenDeviceId(deviceId),
      });
    }
    return;
  }
  const nextChannel = realtime.channel(buildDeviceAssignmentChannelName(deviceId), {
    config: { broadcast: { self: false } },
  });
  nextChannel.on('broadcast', { event: ASSIGNMENT_CHANGED_EVENT }, (message) => {
    void handleDeviceAssignmentRealtimeEvent(deviceId, message?.payload);
  });
  channel = nextChannel;
  subscribedDeviceId = deviceId;
  logDeviceAssignmentRealtime('subscribe-started', {
    deviceId: shortenDeviceId(deviceId),
    lifecycleGeneration: generation,
  });
  nextChannel.subscribe((status, error) => {
    if (status === 'SUBSCRIBED') {
      retryAttempt = 0;
      logDeviceAssignmentRealtime('subscribed', {
        deviceId: shortenDeviceId(deviceId),
        reason: 'device-identity-ready',
      });
      return;
    }
    if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
      logDeviceAssignmentRealtime('subscription-error', {
        deviceId: shortenDeviceId(deviceId),
        reason: status.toLowerCase(),
        errorCategory: realtimeErrorCategory(error),
      });
      void removeErroredChannel(nextChannel, deviceId, generation, error);
    }
  });
}

export function getDeviceAssignmentSubscriptionState() {
  return {
    deviceId: subscribedDeviceId,
    channelName: subscribedDeviceId ? buildDeviceAssignmentChannelName(subscribedDeviceId) : null,
    subscribed: Boolean(channel && subscribedDeviceId),
  };
}

export async function startDeviceAssignmentRealtime(
  deviceId = getDeviceState().identity?.deviceId,
  preserveRetryBackoff = false,
) {
  const nextDeviceId = String(deviceId ?? '').trim();
  if (!nextDeviceId) return;
  if (subscribedDeviceId === nextDeviceId && channel) return;
  if (startPromise) return startPromise;

  const generation = ++lifecycleGeneration;
  if (!preserveRetryBackoff) {
    clearRetryTimer();
    retryAttempt = 0;
  }
  startPromise = (async () => {
    await stopDeviceAssignmentRealtime('device-identity-replacement', false);
    await startChannel(nextDeviceId, generation);
  })().finally(() => {
    startPromise = null;
  });
  return startPromise;
}

export async function stopDeviceAssignmentRealtime(reason = 'unsubscribed', invalidate = true) {
  if (invalidate) {
    lifecycleGeneration += 1;
    clearRetryTimer();
    retryAttempt = 0;
  }
  const deviceId = subscribedDeviceId;
  const active = channel;
  channel = null;
  subscribedDeviceId = null;
  if (!active) {
    return;
  }
  try {
    await active.unsubscribe();
  } catch {
    // Ignore teardown races.
  }
  getRealtimeClient()?.removeChannel(active);
  logDeviceAssignmentRealtime('unsubscribed', {
    deviceId: shortenDeviceId(deviceId),
    reason,
  });
}

export async function handleDeviceAssignmentRealtimeEvent(deviceId: string, payload: unknown) {
  const startedAt = Date.now();
  const parsed = parseRealtimeAssignmentSignal(
    payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : null,
  );
  logDeviceAssignmentRealtime('assignment-change-received', {
    deviceId: shortenDeviceId(deviceId),
    assignmentVersion: parsed.signal.assignmentId,
    providerId: parsed.signal.managedProviderId,
    elapsedMs: Date.now() - startedAt,
  });
  const current = getDeviceState().status;
  const currentToken = assignmentToken(current ?? {});
  const signalToken = assignmentToken(parsed.signal);
  if (currentToken && signalToken && currentToken === signalToken) {
    logDeviceAssignmentRealtime('assignment-unchanged', {
      source: 'realtime',
      reason: 'signal-matches-current-status',
      assignmentVersion: signalToken,
    });
    return null;
  }
  return reconcileDeviceAssignment({
    source: 'realtime',
    fetchAuthoritative: fetchAuthoritativeDeviceAssignment,
  });
}

export function bindDeviceAssignmentRealtimeLifecycle() {
  if (lifecycleBound) {
    return unbindLifecycle ?? (() => undefined);
  }
  lifecycleBound = true;
  const startFromIdentity = () => {
    const deviceId = getDeviceState().identity?.deviceId;
    if (deviceId) {
      void startDeviceAssignmentRealtime(deviceId);
    }
  };
  startFromIdentity();
  const unsubscribe = subscribeDeviceState(startFromIdentity);
  unbindLifecycle = () => {
    unsubscribe();
    lifecycleBound = false;
    unbindLifecycle = null;
    lifecycleGeneration += 1;
    clearRetryTimer();
    void stopDeviceAssignmentRealtime('app-teardown');
  };
  return unbindLifecycle;
}

export function resetDeviceAssignmentRealtimeForTests() {
  clearRetryTimer();
  channel = null;
  subscribedDeviceId = null;
  client = null;
  lifecycleBound = false;
  unbindLifecycle = null;
  startPromise = null;
  lifecycleGeneration = 0;
  retryAttempt = 0;
}
