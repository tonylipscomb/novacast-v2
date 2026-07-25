export const MAX_BATCH_EVENTS = 50;
export const MAX_BODY_BYTES = 32 * 1024;
export const MAX_METADATA_BYTES = 2 * 1024;
export const MAX_METADATA_KEYS = 12;
export const MAX_EVENTS_PER_HOUR = 100;
export const MAX_PAST_TIMESTAMP_MS = 24 * 60 * 60 * 1000;
export const MAX_FUTURE_TIMESTAMP_MS = 5 * 60 * 1000;

export const EVENT_CATEGORIES: Record<string, string> = {
  session_started: 'session',
  session_backgrounded: 'session',
  session_resumed: 'session',
  session_ended: 'session',
  screen_view: 'navigation',
  playback_requested: 'playback',
  playback_started: 'playback',
  playback_failed: 'playback',
  playback_recovered: 'playback',
  playback_stopped: 'playback',
  search_opened: 'search',
  search_results: 'search',
  search_cancelled: 'search',
  search_failed: 'search',
  provider_auth_started: 'provider',
  provider_auth_completed: 'provider',
  provider_auth_failed: 'provider',
  catalog_sync_started: 'catalog',
  catalog_sync_completed: 'catalog',
  catalog_sync_failed: 'catalog',
  guide_load_started: 'guide',
  guide_first_rows_rendered: 'guide',
  guide_load_completed: 'guide',
  guide_load_failed: 'guide',
};

export const ALLOWED_METADATA_KEYS = new Set([
  'retry_count',
  'startup_elapsed_bucket',
  'launch_source',
  'search_scope',
  'query_length_bucket',
  'result_count',
  'classification',
  'player_engine',
  'catalog_source',
  'channel_count',
  'movie_count',
  'series_count',
  'category_count',
  'row_count',
  'screen_group',
  'overlay',
  'exit_reason',
  'network_connected',
  'content_type',
  'provider_type',
  'background_duration_bucket',
  'error_classification',
  'stale_age_bucket',
  'is_fullscreen',
]);

const FORBIDDEN_KEY = /(^|_)(username|password|passwd|provider_url|stream_url|url|uri|token|access_token|refresh_token|authorization|cookie|device_secret|invitation_token|pairing_code|email|ip|search_query|title|raw_error|diagnostic_snapshot)($|_)/i;
const SECRET_VALUE = /(bearer\s+|https?:\/\/|password\s*=|token\s*=|authorization\s*:|[\w.+-]+@[\w.-]+\.[a-z]{2,})/i;

export type AnalyticsPrimitive = string | number | boolean | null;
export type AnalyticsMetadata = Record<string, AnalyticsPrimitive | Record<string, AnalyticsPrimitive>>;

export class AnalyticsValidationError extends Error {
  constructor(public readonly category: string) {
    super(category);
    this.name = 'AnalyticsValidationError';
  }
}

export function assertObject(value: unknown, category = 'invalid_field_type'): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AnalyticsValidationError(category);
  }
}

export function optionalString(value: unknown, max: number, category = 'invalid_field_type'): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || value.length > max) throw new AnalyticsValidationError(category);
  return value;
}

export function requiredString(value: unknown, max: number, category = 'invalid_field_type'): string {
  const result = optionalString(value, max, category);
  if (!result) throw new AnalyticsValidationError(category);
  return result;
}

export function optionalNonnegativeInteger(value: unknown, category = 'invalid_field_type'): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Number.isInteger(value) || (value as number) < 0) throw new AnalyticsValidationError(category);
  return value as number;
}

export function optionalBoolean(value: unknown, category = 'invalid_field_type'): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'boolean') throw new AnalyticsValidationError(category);
  return value;
}

export function validateEventName(value: unknown): { name: string; category: string } {
  const name = requiredString(value, 48);
  const category = EVENT_CATEGORIES[name];
  if (!category) throw new AnalyticsValidationError('invalid_event_name');
  return { name, category };
}

function validateMetadataValue(value: unknown, depth: number): AnalyticsPrimitive | Record<string, AnalyticsPrimitive> {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    if (typeof value === 'string' && (value.length > 160 || SECRET_VALUE.test(value))) {
      throw new AnalyticsValidationError('forbidden_metadata');
    }
    if (typeof value === 'number' && !Number.isFinite(value)) throw new AnalyticsValidationError('invalid_metadata');
    return value;
  }
  if (depth >= 1 || !value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AnalyticsValidationError('invalid_metadata');
  }
  const nested: Record<string, AnalyticsPrimitive> = {};
  for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
    if (!key || key.length > 40 || FORBIDDEN_KEY.test(key)) throw new AnalyticsValidationError('forbidden_metadata');
    if (nestedValue !== null && typeof nestedValue !== 'string' && typeof nestedValue !== 'number' && typeof nestedValue !== 'boolean') {
      throw new AnalyticsValidationError('invalid_metadata');
    }
    nested[key] = validateMetadataValue(nestedValue, depth + 1) as AnalyticsPrimitive;
  }
  return nested;
}

export function validateMetadata(value: unknown): AnalyticsMetadata {
  if (value === undefined || value === null) return {};
  assertObject(value, 'invalid_metadata');
  const entries = Object.entries(value);
  if (entries.length > MAX_METADATA_KEYS) throw new AnalyticsValidationError('metadata_key_limit');
  const result: AnalyticsMetadata = {};
  for (const [key, rawValue] of entries) {
    if (!ALLOWED_METADATA_KEYS.has(key) || key.length > 40 || FORBIDDEN_KEY.test(key)) {
      throw new AnalyticsValidationError('forbidden_metadata');
    }
    result[key] = validateMetadataValue(rawValue, 0);
  }
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > MAX_METADATA_BYTES) {
    throw new AnalyticsValidationError('metadata_size_limit');
  }
  return result;
}

export function clampTimestamp(value: unknown, now = Date.now()): Date {
  if (value === undefined || value === null) return new Date(now);
  const parsed = typeof value === 'number' || typeof value === 'string' ? new Date(value) : null;
  if (!parsed || Number.isNaN(parsed.getTime())) throw new AnalyticsValidationError('malformed_timestamp');
  const clamped = Math.min(now + MAX_FUTURE_TIMESTAMP_MS, Math.max(now - MAX_PAST_TIMESTAMP_MS, parsed.getTime()));
  return new Date(clamped);
}

async function hmacReference(prefix: 'p1_' | 'c1_', rawValue: unknown): Promise<string | null> {
  if (rawValue === undefined || rawValue === null) return null;
  const value = requiredString(rawValue, 256, 'invalid_hmac_input').trim();
  if (!value) throw new AnalyticsValidationError('invalid_hmac_input');
  const secret = Deno.env.get('ANALYTICS_HMAC_SECRET');
  if (!secret) throw new AnalyticsValidationError('server_configuration_error');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  const hex = Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${prefix}${hex}`;
}

export function hashProviderReference(value: unknown) { return hmacReference('p1_', value); }
export function hashContentReference(value: unknown) { return hmacReference('c1_', value); }

export function responseStatus(category: string) {
  if (category === 'rate_limited') return 429;
  if (category === 'temporary_database_error' || category === 'server_configuration_error') return 503;
  return 400;
}
