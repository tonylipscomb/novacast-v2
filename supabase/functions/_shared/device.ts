import { getClientAddress } from './http.ts';
import { hashDeviceSecret, hashToken, normalizePublicDeviceCode } from './security.ts';
import { getAdminClient } from './supabase.ts';

export function hasDeviceAuthHeaders(request: Request) {
  const publicCode = request.headers.get('x-novacast-device-id')?.trim() ?? '';
  const secret = request.headers.get('x-novacast-device-secret')?.trim() ?? '';
  return Boolean(publicCode && secret);
}

export async function authenticateDevice(request: Request, client: ReturnType<typeof getAdminClient>) {
  const publicCode = normalizePublicDeviceCode(request.headers.get('x-novacast-device-id'));
  const secret = request.headers.get('x-novacast-device-secret') ?? '';
  const secretHash = await hashDeviceSecret(secret);
  const { data: device, error } = await client.from('devices').select('id,public_device_code,status,activation_status').eq('public_device_code', publicCode).eq('device_secret_hash', secretHash).maybeSingle();
  if (error || !device || ['revoked', 'blocked'].includes(device.status)) throw new Error('invalid_device');
  return device;
}

/** Authenticate when credentials are present; otherwise return null (legacy pairing path). */
export async function optionalAuthenticateDevice(request: Request, client: ReturnType<typeof getAdminClient>) {
  if (!hasDeviceAuthHeaders(request)) return null;
  try {
    return await authenticateDevice(request, client);
  } catch (error) {
    // Keep personal pairing working while device registration rolls out.
    // Activation-required mode must still fail closed.
    if (Deno.env.get('DEVICE_ACTIVATION_REQUIRED') === 'true') throw error;
    return null;
  }
}

/**
 * Ownership for pairing sessions: installation hash is always required.
 * When a device is authenticated and the session already has device_id, it must match.
 */
export function assertPairingSessionOwnership(
  session: { device_id?: string | null; installation_hash?: string | null },
  installationHash: string,
  authenticatedDevice: { id: string } | null,
) {
  if (session.installation_hash !== installationHash) {
    throw new Error('invalid_pairing_session');
  }
  if (authenticatedDevice && session.device_id && session.device_id !== authenticatedDevice.id) {
    throw new Error('invalid_pairing_session');
  }
}

export async function deviceRateKey(request: Request, deviceId: string, action: string) {
  return hashToken(`${deviceId}:${getClientAddress(request)}:${action}`);
}
