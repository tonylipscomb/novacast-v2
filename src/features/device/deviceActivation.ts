import { deviceAuthHeaders, deviceMetadata, registerDevice } from './deviceRegistration.ts';
import { clearCachedDeviceStatus, readCachedDeviceStatus, writeCachedDeviceStatus } from './deviceStorage.ts';
import type { ActivationStatus, DeviceHeartbeatResponse, DeviceState, DeviceStatusResponse } from './deviceTypes.ts';
import { useEffect, useState } from 'react';
import { deviceFeatureFlags } from './deviceFeatureFlags.ts';
import { reportNetworkOutcome } from '../resilience/offlineStatus.ts';
import { recordSanitizedDiagnostic } from '../resilience/sanitizedDiagnostics.ts';
import { withTimeout, STARTUP_NETWORK_TIMEOUT_MS } from '../startup/startupTimeouts.ts';

const listeners = new Set<() => void>();
let state: DeviceState = { identity: null, status: null, state: 'idle', lastCheckedAt: null, error: null };
let initPromise: Promise<DeviceState> | null = null;

function emit() {
  listeners.forEach((listener) => listener());
}
function setState(next: DeviceState) {
  state = next;
  emit();
}
function config() {
  const apiUrl = process.env.EXPO_PUBLIC_NOVACAST_PAIRING_API_URL?.trim().replace(/\/+$/, '');
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim();
  return apiUrl && anonKey ? { apiUrl, anonKey } : null;
}

function isHardRevokeError(message: string) {
  return /invalid_device|revoked|blocked|device_not_found/i.test(message);
}

export async function checkDeviceStatus() {
  if (!deviceFeatureFlags.registrationEnabled) return state;
  const identity = await registerDevice();
  const cached = await readCachedDeviceStatus();
  const api = config();
  if (!api || !identity.deviceId) {
    setState({
      identity,
      status: cached,
      state: cached?.status === 'revoked' ? 'revoked' : 'ready',
      lastCheckedAt: Date.now(),
      error: null,
    });
    return state;
  }
  setState({ ...state, identity, state: 'checking', error: null });
  try {
    const response = await withTimeout(
      fetch(`${api.apiUrl}/device-status`, {
        method: 'POST',
        headers: {
          apikey: api.anonKey,
          Authorization: `Bearer ${api.anonKey}`,
          'Content-Type': 'application/json',
          ...(await deviceAuthHeaders()),
        },
        body: JSON.stringify({ metadata: deviceMetadata() }),
      }),
      STARTUP_NETWORK_TIMEOUT_MS,
      'device_status_timeout',
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const category = typeof payload.errorCategory === 'string' ? payload.errorCategory : 'device_status_failed';
      throw new Error(category);
    }
    const status = payload as DeviceStatusResponse;
    await writeCachedDeviceStatus(status);
    reportNetworkOutcome(true);
    setState({
      identity,
      status,
      state: status.status === 'revoked' || status.status === 'blocked' ? 'revoked' : 'ready',
      lastCheckedAt: Date.now(),
      error: null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'device_status_failed';
    if (isHardRevokeError(message)) {
      await clearCachedDeviceStatus().catch(() => undefined);
      reportNetworkOutcome(true);
      recordSanitizedDiagnostic({
        operation: 'device_status',
        screen: 'device',
        errorType: message,
        outcome: 'revoked',
      });
      setState({
        identity,
        status: cached ? { ...cached, status: 'revoked', activationStatus: 'revoked' } : null,
        state: 'revoked',
        lastCheckedAt: Date.now(),
        error: message,
      });
      return state;
    }
    reportNetworkOutcome(false);
    setState({
      identity,
      status: cached,
      state: cached ? 'offline' : 'error',
      lastCheckedAt: Date.now(),
      error: message,
    });
  }
  return state;
}

/** Apply heartbeat access fields so mid-session revoke/expiry is enforced. */
export function applyHeartbeatAccess(payload: DeviceHeartbeatResponse) {
  const identity = state.identity;
  if (!identity) {
    return;
  }

  const activationStatus = payload.activationStatus as ActivationStatus;
  const revoked =
    payload.deviceActive === false || activationStatus === 'revoked' || activationStatus === 'suspended';
  const expired = activationStatus === 'expired';

  const nextStatus: DeviceStatusResponse = {
    deviceId: state.status?.deviceId ?? identity.deviceId ?? '',
    publicDeviceCode: state.status?.publicDeviceCode ?? identity.publicDeviceCode ?? '',
    status: revoked ? 'revoked' : expired ? 'inactive' : (state.status?.status ?? 'active'),
    activationStatus,
    activationExpiresAt: payload.expirationTime,
    remainingBetaMs: payload.remainingBetaMs,
    remainingBetaHours: payload.remainingBetaHours,
    providerAssigned: payload.providerAssigned,
    managedProviderId: payload.managedProviderId,
    contentPolicy: payload.contentPolicy,
    requiresProviderDownload: state.status?.requiresProviderDownload,
    serverTime: payload.serverTime,
    offlineGraceUntil: payload.offlineGraceUntil,
  };

  void writeCachedDeviceStatus(nextStatus).catch(() => undefined);

  if (revoked) {
    recordSanitizedDiagnostic({
      operation: 'device_heartbeat',
      screen: 'device',
      errorType: 'device_inactive',
      outcome: 'revoked',
    });
    setState({
      identity,
      status: nextStatus,
      state: 'revoked',
      lastCheckedAt: Date.now(),
      error: 'device_inactive',
    });
    return;
  }

  setState({
    identity,
    status: nextStatus,
    state: 'ready',
    lastCheckedAt: Date.now(),
    error: null,
  });
}

export function initializeDevice() {
  if (!initPromise) initPromise = checkDeviceStatus().finally(() => {
    initPromise = null;
  });
  return initPromise;
}

export function getDeviceState() {
  return state;
}
export function subscribeDeviceState(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function useDeviceState() {
  const [snapshot, setSnapshot] = useState(state);
  useEffect(() => subscribeDeviceState(() => setSnapshot(state)), []);
  return snapshot;
}
