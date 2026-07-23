export type DeviceStatus = 'registered' | 'active' | 'inactive' | 'revoked' | 'blocked';
export type ActivationStatus = 'inactive' | 'active' | 'expired' | 'revoked' | 'suspended';

export type DeviceIdentity = {
  installationId: string;
  deviceSecret: string;
  deviceId: string | null;
  publicDeviceCode: string | null;
};

export type DeviceStatusResponse = {
  deviceId: string;
  publicDeviceCode: string;
  status: DeviceStatus;
  activationStatus: ActivationStatus;
  activationExpiresAt: string | null;
  serverTime: string;
  offlineGraceUntil: string | null;
};

export type DeviceState = {
  identity: DeviceIdentity | null;
  status: DeviceStatusResponse | null;
  state: 'idle' | 'registering' | 'checking' | 'ready' | 'offline' | 'revoked' | 'error';
  lastCheckedAt: number | null;
  error: string | null;
};
