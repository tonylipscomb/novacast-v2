import { getDeviceState } from './deviceActivation';

export function getSafeDeviceDiagnostics() {
  const current = getDeviceState();
  return {
    deviceId: current.status?.publicDeviceCode ?? current.identity?.publicDeviceCode ?? 'Not registered',
    deviceStatus: current.status?.status ?? 'Unknown',
    activation: current.status?.activationStatus ?? 'Unknown',
    lastServerCheck: current.lastCheckedAt ? new Date(current.lastCheckedAt).toISOString() : 'Never',
  };
}
