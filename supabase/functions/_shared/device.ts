import { getClientAddress } from './http.ts';
import { hashDeviceSecret, hashToken, normalizePublicDeviceCode } from './security.ts';
import { getAdminClient } from './supabase.ts';

export function hasDeviceAuthHeaders(request: Request) {
  const publicCode = request.headers.get('x-novacast-device-id')?.trim() ?? '';
  const secret = request.headers.get('x-novacast-device-secret')?.trim() ?? '';
  return Boolean(publicCode && secret);
}

async function lookupDevice(request: Request, client: ReturnType<typeof getAdminClient>) {
  const publicCode = normalizePublicDeviceCode(request.headers.get('x-novacast-device-id'));
  const secret = request.headers.get('x-novacast-device-secret') ?? '';
  const secretHash = await hashDeviceSecret(secret);
  const { data: device, error } = await client.from('devices').select('id,public_device_code,status,activation_status').eq('public_device_code', publicCode).eq('device_secret_hash', secretHash).maybeSingle();
  if (error || !device) throw new Error('invalid_device');
  return device;
}

export async function authenticateDevice(request: Request, client: ReturnType<typeof getAdminClient>) {
  const device = await lookupDevice(request, client);
  if (['revoked', 'blocked'].includes(device.status)) throw new Error('invalid_device');
  return device;
}

export function canBootstrapPairingForDevice(device: { status?: string | null; activation_status?: string | null }) {
  return device.status === 'registered' && device.activation_status === 'inactive';
}

function logDeviceActivation(event: string, fields: { activationStatus?: string | null; reason?: string; sessionState?: string; elapsedMs?: number; devicePresent?: boolean } = {}) {
  console.info('[NovaCastDeviceActivation]', JSON.stringify({
    event,
    ...(fields.activationStatus ? { activationStatus: fields.activationStatus } : {}),
    ...(fields.reason ? { reason: fields.reason } : {}),
    ...(fields.sessionState ? { sessionState: fields.sessionState } : {}),
    ...(fields.elapsedMs !== undefined ? { elapsedMs: Math.max(0, Math.round(fields.elapsedMs)) } : {}),
    ...(fields.devicePresent !== undefined ? { devicePresent: fields.devicePresent } : {}),
  }));
}

/**
 * Atomically activates the exact registered device for a completed pairing.
 * The database function is intentionally idempotent and refuses blocked,
 * revoked, expired, or mismatched sessions.
 */
export async function autoActivateDeviceAfterPairing(
  client: ReturnType<typeof getAdminClient>,
  sessionId: string,
  deviceId: string,
) {
  const startedAt = Date.now();
  logDeviceActivation('auto-activation-started', { devicePresent: true });
  const { data, error } = await client.rpc('auto_activate_device_after_pairing', {
    p_session_id: sessionId,
    p_device_id: deviceId,
  });
  if (error || !data?.[0]) {
    const category = String(error?.message ?? '').toLowerCase();
    const reason = category.includes('blocked') || category.includes('revoked')
      ? 'device-blocked'
      : category.includes('mismatch')
        ? 'session-device-mismatch'
        : category.includes('expired')
          ? 'session-expired'
          : 'not-eligible';
    logDeviceActivation('auto-activation-failed', {
      reason,
      elapsedMs: Date.now() - startedAt,
      devicePresent: true,
    });
    throw new Error('activation_unavailable');
  }

  const activation = data[0] as { activation_status?: string | null };
  const reason = activation.activation_status === 'active' ? 'validated-pairing' : 'not-eligible';
  logDeviceActivation(reason === 'validated-pairing' ? 'auto-activation-complete' : 'auto-activation-skipped', {
    activationStatus: activation.activation_status,
    reason,
    elapsedMs: Date.now() - startedAt,
    devicePresent: true,
  });
  return activation;
}

export function isDeviceAuthorizationActive(
  device: { status?: string | null; activation_status?: string | null },
  activation: { status?: string | null; expires_at?: string | null; activation_source?: string | null } | null,
  nowMs = Date.now(),
) {
  if (!device.status || !['registered', 'active'].includes(device.status)) return false;
  if (device.activation_status !== 'active' || activation?.status !== 'active') return false;
  if (activation?.activation_source === 'production') return device.status === 'active';
  if (activation.expires_at) {
    const expiresAtMs = new Date(activation.expires_at).getTime();
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs) return false;
  }
  return true;
}

export async function authenticateActiveDevice(request: Request, client: ReturnType<typeof getAdminClient>) {
  const device = await lookupDevice(request, client);
  const { data: activation, error } = await client
    .from('device_activations')
    .select('status,expires_at,activation_source')
    .eq('device_id', device.id)
    .eq('status', 'active')
    .maybeSingle();
  if (error) throw new Error('device_authorization_unavailable');
  if (!isDeviceAuthorizationActive(device, activation)) throw new Error('device_not_authorized');
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
