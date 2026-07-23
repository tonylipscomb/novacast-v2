import { getClientAddress } from './http.ts';
import { hashDeviceSecret, hashToken, normalizePublicDeviceCode } from './security.ts';
import { getAdminClient } from './supabase.ts';

export async function authenticateDevice(request: Request, client: ReturnType<typeof getAdminClient>) {
  const publicCode = normalizePublicDeviceCode(request.headers.get('x-novacast-device-id'));
  const secret = request.headers.get('x-novacast-device-secret') ?? '';
  const secretHash = await hashDeviceSecret(secret);
  const { data: device, error } = await client.from('devices').select('id,public_device_code,status,activation_status').eq('public_device_code', publicCode).eq('device_secret_hash', secretHash).maybeSingle();
  if (error || !device || ['revoked', 'blocked'].includes(device.status)) throw new Error('invalid_device');
  return device;
}

export async function deviceRateKey(request: Request, deviceId: string, action: string) {
  return hashToken(`${deviceId}:${getClientAddress(request)}:${action}`);
}
