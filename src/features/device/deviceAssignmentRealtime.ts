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

export function getDeviceAssignmentSubscriptionState() {
  return {
    deviceId: subscribedDeviceId,
    channelName: subscribedDeviceId ? buildDeviceAssignmentChannelName(subscribedDeviceId) : null,
    subscribed: Boolean(channel && subscribedDeviceId),
  };
}

export async function startDeviceAssignmentRealtime(deviceId = getDeviceState().identity?.deviceId) {
  const nextDeviceId = String(deviceId ?? '').trim();
  if (!nextDeviceId) {
    return;
  }
  if (subscribedDeviceId === nextDeviceId && channel) {
    return;
  }

  await stopDeviceAssignmentRealtime('device-identity-replacement');
  const realtime = getRealtimeClient();
  if (!realtime) {
    logDeviceAssignmentRealtime('subscription-error', {
      reason: 'realtime-unconfigured',
      deviceId: shortenDeviceId(nextDeviceId),
    });
    return;
  }

  const channelName = buildDeviceAssignmentChannelName(nextDeviceId);
  const nextChannel = realtime.channel(channelName, {
    config: { broadcast: { self: false } },
  });
  nextChannel.on('broadcast', { event: ASSIGNMENT_CHANGED_EVENT }, (message) => {
    void handleDeviceAssignmentRealtimeEvent(nextDeviceId, message?.payload);
  });
  channel = nextChannel;
  subscribedDeviceId = nextDeviceId;
  nextChannel.subscribe((status, error) => {
    if (status === 'SUBSCRIBED') {
      logDeviceAssignmentRealtime('subscribed', {
        deviceId: shortenDeviceId(nextDeviceId),
        reason: 'device-identity-ready',
      });
      return;
    }
    if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
      logDeviceAssignmentRealtime('subscription-error', {
        deviceId: shortenDeviceId(nextDeviceId),
        reason: status.toLowerCase(),
        elapsedMs: error ? 0 : undefined,
      });
    }
  });
}

export async function stopDeviceAssignmentRealtime(reason = 'unsubscribed') {
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
    void stopDeviceAssignmentRealtime('app-teardown');
  };
  return unbindLifecycle;
}

export function resetDeviceAssignmentRealtimeForTests() {
  channel = null;
  subscribedDeviceId = null;
  client = null;
  lifecycleBound = false;
  unbindLifecycle = null;
}
