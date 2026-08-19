import { deviceAuthHeaders, deviceMetadata, getDeviceIdentity, registerDevice } from './deviceRegistration.ts';
import { clearCachedDeviceStatus, readCachedDeviceStatus, writeCachedDeviceStatus } from './deviceStorage.ts';
import type {
  ActivationStatus,
  DeviceAuthorization,
  DeviceHeartbeatResponse,
  DeviceState,
  DeviceStatusResponse,
} from './deviceTypes.ts';
import { useEffect, useState } from 'react';
import { deviceFeatureFlags, getLocalActivationBypassDecision, isLocalActivationBypassEnabled } from './deviceFeatureFlags.ts';
import { reportNetworkOutcome } from '../resilience/offlineStatus.ts';
import { recordSanitizedDiagnostic } from '../resilience/sanitizedDiagnostics.ts';
import { withTimeout, STARTUP_NETWORK_TIMEOUT_MS } from '../startup/startupTimeouts.ts';

const emptyAuthorization: DeviceAuthorization = {
  backendActivated: false,
  localBypassAuthorized: false,
  effectiveAuthorized: false,
};

const listeners = new Set<() => void>();
let state: DeviceState = {
  identity: null,
  status: null,
  authorization: emptyAuthorization,
  state: 'idle',
  lastCheckedAt: null,
  error: null,
};
let initPromise: Promise<DeviceState> | null = null;

function emit() {
  listeners.forEach((listener) => listener());
}

function isHardDeniedStatus(status: DeviceStatusResponse | null | undefined) {
  return (
    status?.status === 'revoked' ||
    status?.status === 'blocked' ||
    status?.activationStatus === 'revoked' ||
    status?.activationStatus === 'suspended'
  );
}

function resolveAuthorization(status: DeviceStatusResponse | null | undefined): DeviceAuthorization {
  const hardDenied = isHardDeniedStatus(status);
  const backendActivated = status?.activationStatus === 'active' && !hardDenied;
  const localBypassAuthorized = !hardDenied && isLocalActivationBypassEnabled({ log: false });
  return {
    backendActivated,
    localBypassAuthorized,
    effectiveAuthorized: backendActivated || localBypassAuthorized,
  };
}

function assignmentPresence(status: DeviceStatusResponse | null | undefined) {
  return {
    providerAssignmentPresent: Boolean(status?.providerAssigned || status?.managedProviderId),
    libraryAssignmentPresent: Boolean(status?.providerAssigned || status?.requiresProviderDownload),
  };
}

function logLocalTestStatusMerge(
  status: DeviceStatusResponse | null | undefined,
  authorization: DeviceAuthorization,
  backendStatusReceived: boolean,
) {
  if (!authorization.localBypassAuthorized && !isLocalActivationBypassEnabled({ log: false })) {
    return;
  }
  const assignment = assignmentPresence(status);
  console.info('[NovaCast Device Activation]', JSON.stringify({
    event: 'local-test-status-merge',
    backendStatusReceived,
    backendActivated: authorization.backendActivated,
    localBypassAuthorized: authorization.localBypassAuthorized,
    effectiveAuthorized: authorization.effectiveAuthorized,
    providerAssignmentPresent: assignment.providerAssignmentPresent,
    libraryAssignmentPresent: assignment.libraryAssignmentPresent,
  }));
}

function setState(next: Omit<DeviceState, 'authorization'> & { authorization?: DeviceAuthorization }) {
  state = {
    ...next,
    authorization: next.authorization ?? resolveAuthorization(next.status),
  };
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

function logLocalBypassApplied() {
  const bypass = getLocalActivationBypassDecision('device-status');
  if (!bypass.eligible) {
    return false;
  }
  console.info('[NovaCast Device Activation]', JSON.stringify({
    event: 'local-test-bypass-applied',
    platform: 'android',
    isEmulator: bypass.isEmulator,
    bypassFlagEnabled: bypass.bypassFlagEnabled,
  }));
  return true;
}

export async function checkDeviceStatus() {
  if (!deviceFeatureFlags.registrationEnabled) return state;
  setState({ ...state, state: 'registering', error: null });
  let identity;
  try {
    identity = await registerDevice();
  } catch (error) {
    const localIdentity = isLocalActivationBypassEnabled({ log: false })
      ? await getDeviceIdentity().catch(() => null)
      : null;
    if (!localIdentity) {
      const message = error instanceof Error ? error.message : 'device_registration_failed';
      reportNetworkOutcome(false);
      setState({ ...state, identity: identity ?? null, state: 'error', lastCheckedAt: Date.now(), error: message });
      return state;
    }
    identity = localIdentity;
  }
  const cached = await readCachedDeviceStatus();
  const api = config();
  const bypassEligible = isLocalActivationBypassEnabled({ log: false });
  if (!api && deviceFeatureFlags.activationRequired && !bypassEligible) {
    setState({ ...state, identity, state: 'error', lastCheckedAt: Date.now(), error: 'pairing_api_unconfigured' });
    return state;
  }
  if (!api || !identity.deviceId) {
    const authorization = resolveAuthorization(cached);
    if (bypassEligible) {
      logLocalBypassApplied();
      logLocalTestStatusMerge(cached, authorization, false);
    }
    setState({
      identity,
      status: cached,
      authorization,
      state: isHardDeniedStatus(cached) ? 'revoked' : 'ready',
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
    const authorization = resolveAuthorization(status);
    if (authorization.localBypassAuthorized) {
      logLocalBypassApplied();
      logLocalTestStatusMerge(status, authorization, true);
    }
    setState({
      identity,
      status,
      authorization,
      state: isHardDeniedStatus(status) ? 'revoked' : 'ready',
      lastCheckedAt: Date.now(),
      error: null,
    });
    console.info('[NovaCast Device Activation]', JSON.stringify({
      event: 'status-complete',
      activated: authorization.backendActivated,
      activationRequired: deviceFeatureFlags.activationRequired,
      publicDeviceIdPresent: Boolean(identity.publicDeviceCode || status.publicDeviceCode),
      backendDeviceIdPresent: Boolean(identity.deviceId || status.deviceId),
    }));
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
      const revokedStatus = cached ? { ...cached, status: 'revoked' as const, activationStatus: 'revoked' as const } : null;
      setState({
        identity,
        status: revokedStatus,
        authorization: resolveAuthorization(revokedStatus),
        state: 'revoked',
        lastCheckedAt: Date.now(),
        error: message,
      });
      return state;
    }
    reportNetworkOutcome(false);
    const authorization = resolveAuthorization(cached);
    if (bypassEligible) {
      logLocalBypassApplied();
      logLocalTestStatusMerge(cached, authorization, false);
    }
    setState({
      identity,
      status: cached,
      authorization,
      state: isHardDeniedStatus(cached)
        ? 'revoked'
        : cached || authorization.effectiveAuthorized
          ? 'offline'
          : 'error',
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
  const localBypass = isLocalActivationBypassEnabled({ log: false });
  const revoked =
    activationStatus === 'revoked' ||
    activationStatus === 'suspended' ||
    (payload.deviceActive === false && !localBypass);
  const expired = activationStatus === 'expired';

  const nextStatus: DeviceStatusResponse = {
    deviceId: state.status?.deviceId ?? identity.deviceId ?? '',
    publicDeviceCode: state.status?.publicDeviceCode ?? identity.publicDeviceCode ?? '',
    status: revoked ? 'revoked' : expired ? 'inactive' : (state.status?.status ?? 'registered'),
    activationStatus,
    activationExpiresAt: payload.expirationTime,
    remainingBetaMs: payload.remainingBetaMs,
    remainingBetaHours: payload.remainingBetaHours,
    providerAssigned: payload.providerAssigned,
    managedProviderId: payload.managedProviderId,
    contentPolicy: payload.contentPolicy,
    requiresProviderDownload:
      payload.providerAssigned || state.status?.requiresProviderDownload,
    serverTime: payload.serverTime,
    offlineGraceUntil: payload.offlineGraceUntil,
  };

  void writeCachedDeviceStatus(nextStatus).catch(() => undefined);
  const authorization = resolveAuthorization(nextStatus);

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
      authorization,
      state: 'revoked',
      lastCheckedAt: Date.now(),
      error: 'device_inactive',
    });
    return;
  }

  if (authorization.localBypassAuthorized) {
    logLocalTestStatusMerge(nextStatus, authorization, true);
  }

  setState({
    identity,
    status: nextStatus,
    authorization,
    state: 'ready',
    lastCheckedAt: Date.now(),
    error: null,
  });
}

export function isDeviceEffectivelyAuthorized(device: DeviceState = state) {
  return device.authorization.effectiveAuthorized;
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
