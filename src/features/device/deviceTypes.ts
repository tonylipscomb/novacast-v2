export type DeviceStatus = 'registered' | 'active' | 'inactive' | 'revoked' | 'blocked';
export type ActivationStatus = 'inactive' | 'active' | 'expired' | 'revoked' | 'suspended';

export type DeviceIdentity = {
  installationId: string;
  deviceSecret: string;
  deviceId: string | null;
  publicDeviceCode: string | null;
};

export type DevicePendingCommand = {
  id: string;
  command: string;
  payload: Record<string, unknown>;
  created_at?: string;
};

export type DeviceStatusResponse = {
  deviceId: string;
  publicDeviceCode: string;
  status: DeviceStatus;
  activationStatus: ActivationStatus;
  activationExpiresAt: string | null;
  remainingBetaMs?: number | null;
  remainingBetaHours?: number | null;
  providerAssigned?: boolean;
  managedProviderId?: string | null;
  contentPolicy?: string | null;
  requiresProviderDownload?: boolean;
  serverTime: string;
  offlineGraceUntil: string | null;
};

export type DeviceHeartbeatResponse = {
  ok: boolean;
  deviceActive: boolean;
  activationStatus: ActivationStatus;
  expirationTime: string | null;
  remainingBetaMs: number | null;
  remainingBetaHours: number | null;
  providerAssigned: boolean;
  managedProviderId: string | null;
  contentPolicy: string;
  serverTime: string;
  pendingCommands: DevicePendingCommand[];
  requiredSync: boolean;
  offlineGraceUntil: string | null;
};

export type DeviceState = {
  identity: DeviceIdentity | null;
  status: DeviceStatusResponse | null;
  state: 'idle' | 'registering' | 'checking' | 'ready' | 'offline' | 'revoked' | 'error';
  lastCheckedAt: number | null;
  error: string | null;
};
