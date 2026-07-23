const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function encodeBase64(bytes: Uint8Array) {
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function decodeBase64(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function hmac(value: string, secretName: string) {
  const secret = Deno.env.get(secretName);
  if (!secret) {
    throw new Error('server_configuration_error');
  }

  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function normalizeCode(value: unknown) {
  return typeof value === 'string' ? value.replace(/[^A-Za-z0-9]/g, '').toUpperCase() : '';
}

export function createPairingCode() {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join('');
}

export function createSecretToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return encodeBase64(bytes).replace(/[^A-Za-z0-9]/g, '');
}

export function normalizeInstallationId(value: unknown) {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(value)) {
    throw new Error('invalid_device');
  }
  return value.toLowerCase();
}

export async function normalizeProviderUrl(value: unknown) {
  if (typeof value !== 'string' || value.length > 500) {
    throw new Error('invalid_provider_url');
  }

  const trimmed = value.trim().replace(/\/+$/, '');
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error('invalid_provider_url');
  }

  const allowHttp = Deno.env.get('ALLOW_HTTP_PROVIDER') !== 'false';
  if (url.protocol === 'http:' && !allowHttp) {
    throw new Error('http_provider_not_allowed');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('invalid_provider_url');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('invalid_provider_url');
  }

  const host = url.hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host === 'metadata.google.internal' ||
    host === '169.254.169.254' ||
    isPrivateIpv4(host) ||
    host.includes(':')
  ) {
    throw new Error('unsafe_provider_target');
  }

  if (!isPrivateIpv4(host)) {
    try {
      const addresses = await Deno.resolveDns(host, 'A');
      if (addresses.some((address) => isPrivateIpv4(address))) {
        throw new Error('unsafe_provider_target');
      }
    } catch (error) {
      if (error instanceof Error && error.message === 'unsafe_provider_target') {
        throw error;
      }
      throw new Error('provider_unreachable');
    }
  }

  return url.toString().replace(/\/$/, '');
}

function isPrivateIpv4(host: string) {
  const parts = host.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  return parts[0] === 10 || parts[0] === 127 || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && parts[1] === 168) || (parts[0] === 169 && parts[1] === 254);
}

export async function hashCode(code: string) {
  return hmac(normalizeCode(code), 'PAIRING_CODE_SECRET');
}

export async function hashInstallation(value: string) {
  return hmac(normalizeInstallationId(value), 'INSTALLATION_HASH_SECRET');
}

export async function hashToken(token: string) {
  return hmac(token, 'PAIRING_CODE_SECRET');
}

export async function hashDeviceSecret(secret: string) {
  if (typeof secret !== 'string' || secret.length < 32 || secret.length > 256) {
    throw new Error('invalid_device');
  }
  return hmac(secret, 'DEVICE_SECRET_HASH_SECRET');
}

export function normalizePublicDeviceCode(value: unknown) {
  if (typeof value !== 'string' || !/^NC-[A-Z2-9]{4}-[A-Z2-9]{4}$/i.test(value.trim())) {
    throw new Error('invalid_device');
  }
  return value.trim().toUpperCase();
}

export function createPublicDeviceCode() {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return `NC-${Array.from(bytes.slice(0, 4), (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join('')}-${Array.from(bytes.slice(4), (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join('')}`;
}

function encryptionKeyBytes() {
  const raw = Deno.env.get('PROVIDER_ENCRYPTION_KEY');
  if (!raw) {
    throw new Error('server_configuration_error');
  }

  const bytes = raw.length === 64 && /^[0-9a-f]+$/i.test(raw) ? Uint8Array.from(raw.match(/.{2}/g)!.map((pair) => parseInt(pair, 16))) : decodeBase64(raw);
  if (bytes.length !== 32) {
    throw new Error('server_configuration_error');
  }
  return bytes;
}

export async function encryptSecret(value: string) {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const key = await crypto.subtle.importKey('raw', encryptionKeyBytes(), 'AES-GCM', false, ['encrypt']);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(value));
  return { ciphertext: encodeBase64(new Uint8Array(ciphertext)), iv: encodeBase64(iv) };
}

export async function decryptSecret(ciphertext: string, ivValue: string) {
  const key = await crypto.subtle.importKey('raw', encryptionKeyBytes(), 'AES-GCM', false, ['decrypt']);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decodeBase64(ivValue) }, key, decodeBase64(ciphertext));
  return new TextDecoder().decode(plaintext);
}

export async function validateXtreamProvider(baseUrl: string, username: string, password: string) {
  const url = new URL(baseUrl);
  url.pathname = `${url.pathname.replace(/\/$/, '')}/player_api.php`;
  url.searchParams.set('username', username);
  url.searchParams.set('password', password);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(url, { redirect: 'error', signal: controller.signal });
    const length = Number(response.headers.get('content-length') ?? 0);
    if (length > 1_000_000) {
      throw new Error('provider_response_invalid');
    }
    const text = await response.text();
    if (!response.ok || text.length > 1_000_000) {
      throw new Error('provider_unreachable');
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new Error('provider_response_invalid');
    }

    const userInfo = payload.user_info;
    if (!userInfo || typeof userInfo !== 'object' || (userInfo as Record<string, unknown>).auth !== 1) {
      throw new Error('authentication_failed');
    }

    return {
      status: typeof (userInfo as Record<string, unknown>).status === 'string' ? (userInfo as Record<string, unknown>).status : 'Active',
      expiresAt: typeof (userInfo as Record<string, unknown>).exp_date === 'string' ? Number((userInfo as Record<string, unknown>).exp_date) * 1000 : null,
    };
  } catch (error) {
    if (error instanceof Error && ['provider_response_invalid', 'provider_unreachable', 'authentication_failed'].includes(error.message)) {
      throw error;
    }
    throw new Error(error instanceof DOMException && error.name === 'AbortError' ? 'validation_timed_out' : 'provider_unreachable');
  } finally {
    clearTimeout(timeout);
  }
}
