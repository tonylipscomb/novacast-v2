import { deviceAuthHeaders, deviceMetadata, registerDevice } from './deviceRegistration';
import { readCachedDeviceStatus, writeCachedDeviceStatus } from './deviceStorage';
import type { DeviceState, DeviceStatusResponse } from './deviceTypes';
import { useEffect, useState } from 'react';
import { deviceFeatureFlags } from './deviceFeatureFlags';

const listeners = new Set<() => void>();
let state: DeviceState = { identity: null, status: null, state: 'idle', lastCheckedAt: null, error: null };
let initPromise: Promise<DeviceState> | null = null;

function emit() { listeners.forEach((listener) => listener()); }
function setState(next: DeviceState) { state = next; emit(); }
function config() {
  const apiUrl = process.env.EXPO_PUBLIC_NOVACAST_PAIRING_API_URL?.trim().replace(/\/+$/, '');
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim();
  return apiUrl && anonKey ? { apiUrl, anonKey } : null;
}

export async function checkDeviceStatus() {
  if (!deviceFeatureFlags.registrationEnabled) return state;
  const identity = await registerDevice();
  const cached = await readCachedDeviceStatus();
  const api = config();
  if (!api || !identity.deviceId) {
    setState({ identity, status: cached, state: cached?.status === 'revoked' ? 'revoked' : 'ready', lastCheckedAt: Date.now(), error: null });
    return state;
  }
  setState({ ...state, identity, state: 'checking', error: null });
  try {
    const response = await fetch(`${api.apiUrl}/device-status`, {
      method: 'POST',
      headers: { apikey: api.anonKey, Authorization: `Bearer ${api.anonKey}`, 'Content-Type': 'application/json', ...(await deviceAuthHeaders()) },
      body: JSON.stringify({ metadata: deviceMetadata() }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(typeof payload.errorCategory === 'string' ? payload.errorCategory : 'device_status_failed');
    const status = payload as DeviceStatusResponse;
    await writeCachedDeviceStatus(status);
    setState({ identity, status, state: status.status === 'revoked' || status.status === 'blocked' ? 'revoked' : 'ready', lastCheckedAt: Date.now(), error: null });
  } catch (error) {
    setState({ identity, status: cached, state: cached ? 'offline' : 'error', lastCheckedAt: Date.now(), error: error instanceof Error ? error.message : 'device_status_failed' });
  }
  return state;
}

export function initializeDevice() {
  if (!initPromise) initPromise = checkDeviceStatus().finally(() => { initPromise = null; });
  return initPromise;
}

export function getDeviceState() { return state; }
export function subscribeDeviceState(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function useDeviceState() {
  const [snapshot, setSnapshot] = useState(state);
  useEffect(() => subscribeDeviceState(() => setSnapshot(state)), []);
  return snapshot;
}
