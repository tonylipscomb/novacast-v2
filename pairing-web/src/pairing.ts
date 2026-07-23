const viteEnv = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env ?? {};
const API_URL = viteEnv.VITE_PAIRING_API_URL?.trim().replace(/\/+$/, '') ?? '';
const ANON_KEY = viteEnv.VITE_SUPABASE_ANON_KEY?.trim() ?? '';
const SUPABASE_URL = viteEnv.VITE_SUPABASE_URL?.trim() || API_URL.replace(/\/functions\/v1\/?$/, '');

export async function adminLogin(email: string, password: string) {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || typeof payload.access_token !== 'string') throw new Error('admin_login_failed');
  return payload.access_token as string;
}

export async function adminRequest(path: string, token: string, init: RequestInit = {}) {
  const response = await fetch(`${API_URL}/${path}`, { ...init, headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof payload.errorCategory === 'string' ? payload.errorCategory : 'admin_request_failed');
  return payload;
}

export async function activateDevice(deviceId: string, invitationCode: string, friendlyName: string) {
  if (!API_URL || !ANON_KEY) throw new Error('unexpected_server_error');
  const response = await fetch(`${API_URL}/device-activate`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId: deviceId.trim().toUpperCase(), invitationCode: invitationCode.trim(), friendlyName: friendlyName.trim() || undefined }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof payload.errorCategory === 'string' ? payload.errorCategory : 'activation_unavailable');
  return payload;
}

export function isPairingWebConfigured() {
  return Boolean(API_URL && ANON_KEY);
}

export function pairingWebConfigError() {
  if (!API_URL && !ANON_KEY) {
    return 'This pairing site is missing VITE_PAIRING_API_URL and VITE_SUPABASE_ANON_KEY.';
  }
  if (!API_URL) {
    return 'This pairing site is missing VITE_PAIRING_API_URL.';
  }
  if (!ANON_KEY) {
    return 'This pairing site is missing VITE_SUPABASE_ANON_KEY.';
  }
  return null;
}

export function normalizeCode(value: string) {
  return value.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 8);
}

export function normalizeProviderUrl(value: string) {
  const trimmed = value.trim().replace(/\/+$/, '');
  const url = new URL(trimmed);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Use a valid provider URL.');
  if (url.username || url.password || url.search || url.hash) throw new Error('Provider URL must not contain credentials or query parameters.');
  if (['localhost', '127.0.0.1', '0.0.0.0'].includes(url.hostname)) throw new Error('Local provider addresses are not supported.');
  return url.toString().replace(/\/$/, '');
}

export type ProviderInput = {
  name: string;
  baseUrl: string;
  username: string;
  password: string;
};

export type PairingFailure =
  | 'invalid_pairing_code'
  | 'expired_pairing_code'
  | 'pairing_code_already_used'
  | 'invalid_provider_url'
  | 'http_provider_not_allowed'
  | 'unsafe_provider_target'
  | 'provider_unreachable'
  | 'authentication_failed'
  | 'provider_response_invalid'
  | 'validation_timed_out'
  | 'rate_limited'
  | 'activation_unavailable'
  | 'activation_required'
  | 'admin_login_failed'
  | 'unexpected_server_error';

const messages: Record<PairingFailure, string> = {
  invalid_pairing_code: 'That pairing code is not valid.',
  expired_pairing_code: 'That pairing code has expired. Generate a new code on NovaCast.',
  pairing_code_already_used: 'That pairing code has already been used.',
  invalid_provider_url: 'Enter a valid provider server URL without credentials or query parameters.',
  http_provider_not_allowed: 'That provider uses HTTP, which is not enabled on this NovaCast server. Try https:// or contact support.',
  unsafe_provider_target: 'That provider address is not allowed for security reasons.',
  provider_unreachable: 'NovaCast could not reach that provider server.',
  authentication_failed: 'The provider rejected those credentials.',
  provider_response_invalid: 'The provider returned an unsupported response.',
  validation_timed_out: 'Provider validation timed out. Check the address and try again.',
  rate_limited: 'Too many attempts. Wait a moment and try again.',
  activation_unavailable: 'That activation could not be completed. Check the Device ID and invitation code.',
  activation_required: 'Activate this device before starting provider pairing.',
  admin_login_failed: 'Administrator sign-in failed.',
  unexpected_server_error: 'Pairing is temporarily unavailable. Try again shortly.',
};

export function failureMessage(value: unknown) {
  return messages[(typeof value === 'string' ? value : 'unexpected_server_error') as PairingFailure] ?? messages.unexpected_server_error;
}

export async function submitPairing(code: string, provider: ProviderInput) {
  if (!API_URL || !ANON_KEY) throw new Error('unexpected_server_error');
  const response = await fetch(`${API_URL}/pairing-submit`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: normalizeCode(code), provider: { ...provider, baseUrl: normalizeProviderUrl(provider.baseUrl) } }),
  });
  let body: Record<string, unknown> = {};
  try { body = (await response.json()) as Record<string, unknown>; } catch { /* Use generic error below. */ }
  if (!response.ok) throw new Error(typeof body.errorCategory === 'string' ? body.errorCategory : 'unexpected_server_error');
  return body;
}
