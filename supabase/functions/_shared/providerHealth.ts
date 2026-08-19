export type ProviderHealthStatus = 'unvalidated' | 'testing' | 'healthy' | 'degraded' | 'failed';
export type ProviderActivationStatus = 'draft' | 'active' | 'paused' | 'revoked';
export type CheckVerdict = 'pass' | 'warn' | 'fail' | 'skip';
export type CheckSeverity = 'critical' | 'noncritical';

export type ProviderHealthCheck = {
  id: string;
  label: string;
  verdict: CheckVerdict;
  severity: CheckSeverity;
  detail: string;
  latencyMs?: number | null;
  counts?: Record<string, number>;
};

export type StreamProbeKind = 'live' | 'movie' | 'episode';

export type StreamProbeCode =
  | 'ok'
  | 'stream_connection_limit'
  | 'stream_http_401'
  | 'stream_http_403'
  | 'stream_http_404'
  | 'stream_http_429'
  | 'stream_timeout'
  | 'stream_redirect_blocked'
  | 'stream_html_response'
  | 'stream_invalid_media'
  | 'stream_range_rejected'
  | 'stream_endpoint_unavailable'
  | 'stream_empty_body';

export type StreamProbeResult = {
  kind: StreamProbeKind;
  ok: boolean;
  latencyMs: number;
  httpStatus?: number | null;
  mediaHint?: string | null;
  reason: string;
  code?: StreamProbeCode;
  rangeRetried?: boolean;
  redirected?: boolean;
  contentType?: string | null;
  byteCount?: number | null;
};

/** Matches NovaCast Android TV expo-video / ExoPlayer, not Deno's default User-Agent. */
export const NOVACAST_STREAM_PROBE_UA = 'ExoPlayerLib/2.18.1 (Linux; Android 12)';

export type ProviderHealthSummary = {
  overall: ProviderHealthStatus;
  overallLabel: string;
  testedAt: string;
  durationMs: number;
  checks: ProviderHealthCheck[];
  account?: {
    status?: string | null;
    expiresAt?: string | null;
    maxConnections?: number | null;
    activeConnections?: number | null;
    timezone?: string | null;
    allowedOutputFormats?: string[] | null;
  };
  catalogs?: {
    liveCategories: number;
    liveChannels: number;
    movieCategories: number;
    movies: number;
    seriesCategories: number;
    series: number;
    episodeLookupOk?: boolean;
  };
  probes?: {
    live: { passed: number; total: number; averageMs: number | null };
    movies: { passed: number; total: number; averageMs: number | null };
    episodes: { passed: number; total: number; averageMs: number | null };
  };
  notes: string[];
  decoderCaveat: string;
};

export const STREAM_PROBE_CAVEAT =
  'Stream Probe confirms the playback endpoint returns plausible media. Physical NovaCast decoder compatibility is still proven on-device.';

export const LIVE_PROBE_SAMPLE = 3;
export const MOVIE_PROBE_SAMPLE = 2;
export const EPISODE_PROBE_SAMPLE = 2;

const PRIVATE_IPV4 =
  /^(?:127\.|10\.|192\.168\.|169\.254\.|0\.|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|172\.(?:1[6-9]|2\d|3[0-1])\.)/;

const BLOCKED_HOSTS = new Set([
  'localhost',
  'metadata.google.internal',
  'metadata.goog',
  'kubernetes.default.svc',
  'instance-data',
]);

export function stripPlayerApiPath(value: string) {
  return value.trim().replace(/\/+$/, '').replace(/\/(?:player|panel)_api\.php$/i, '');
}

export function isBlockedIpv4(host: string) {
  return PRIVATE_IPV4.test(host);
}

export function isBlockedIpv6(host: string) {
  if (!host.includes(':')) return false;
  const normalized = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (normalized === '::1' || normalized === '0:0:0:0:0:0:0:1') return true;
  if (normalized.startsWith('fe80:')) return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
  if (normalized.startsWith('::ffff:')) {
    const mapped = normalized.slice('::ffff:'.length);
    return isBlockedIpv4(mapped);
  }
  return false;
}

export function isBlockedProviderHost(host: string) {
  const hostname = host.trim().toLowerCase().replace(/\.$/, '');
  if (!hostname) return true;
  if (BLOCKED_HOSTS.has(hostname)) return true;
  if (hostname.endsWith('.localhost') || hostname.endsWith('.local') || hostname.endsWith('.internal')) return true;
  if (hostname === '169.254.169.254' || hostname.endsWith('.metadata.google.internal')) return true;
  if (isBlockedIpv4(hostname) || isBlockedIpv6(hostname)) return true;
  return false;
}

export function parseProviderBaseUrl(value: unknown) {
  if (typeof value !== 'string' || value.length > 500) {
    throw new Error('invalid_provider_url');
  }
  const trimmed = stripPlayerApiPath(value);
  if (!trimmed) throw new Error('invalid_provider_url');
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) && !/^https?:/i.test(trimmed)) {
    throw new Error('invalid_provider_url');
  }
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    throw new Error('invalid_provider_url');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('invalid_provider_url');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('invalid_provider_url');
  }
  if (isBlockedProviderHost(url.hostname)) {
    throw new Error('unsafe_provider_target');
  }
  return url;
}

export function sanitizeCredentialUrl(value: string, username?: string, password?: string) {
  let next = value;
  if (username) {
    next = next.split(username).join('***');
  }
  if (password) {
    next = next.split(password).join('***');
  }
  try {
    const url = new URL(next);
    for (const key of ['username', 'password', 'user', 'pass', 'token']) {
      if (url.searchParams.has(key)) url.searchParams.set(key, '***');
    }
    next = url.toString();
  } catch {
    /* keep string replacements */
  }
  next = next.replace(/\/(live|movie|series)\/[^/]+\/[^/]+\//gi, '/$1/***/***/');
  next = next.replace(/((?:username|password|user|pass|token)=)[^&]+/gi, '$1***');
  return next;
}

export function sanitizeFailureMessage(value: unknown, username?: string, password?: string) {
  const text = value instanceof Error ? value.message : String(value ?? 'unknown_error');
  return sanitizeCredentialUrl(text, username, password)
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer ***')
    .slice(0, 240);
}

export function sanitizeHealthSummary(summary: ProviderHealthSummary, username?: string, password?: string): ProviderHealthSummary {
  const scrub = (value: unknown): unknown => {
    if (typeof value === 'string') return sanitizeFailureMessage(value, username, password);
    if (Array.isArray(value)) return value.map(scrub);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, next]) => [key, scrub(next)]));
    }
    return value;
  };
  return scrub(summary) as ProviderHealthSummary;
}

export function classifyStreamProbePayload(input: {
  httpStatus?: number | null;
  contentType?: string | null;
  bytes?: Uint8Array | null;
  extension?: string | null;
}): { ok: boolean; mediaHint: string | null; reason: string; code: StreamProbeCode } {
  const status = input.httpStatus ?? 0;
  if (status === 401) {
    return { ok: false, mediaHint: null, reason: streamProbeMessage('stream_http_401'), code: 'stream_http_401' };
  }
  if (status === 403) {
    return { ok: false, mediaHint: null, reason: streamProbeMessage('stream_http_403'), code: 'stream_http_403' };
  }
  if (status === 404) {
    return { ok: false, mediaHint: null, reason: streamProbeMessage('stream_http_404'), code: 'stream_http_404' };
  }
  if (status === 429) {
    return { ok: false, mediaHint: null, reason: streamProbeMessage('stream_http_429'), code: 'stream_http_429' };
  }
  if (status === 416 || status === 405 || status === 501) {
    return { ok: false, mediaHint: null, reason: streamProbeMessage('stream_range_rejected', status), code: 'stream_range_rejected' };
  }
  if (status >= 500) {
    return { ok: false, mediaHint: null, reason: `Playback request returned HTTP ${status}.`, code: 'stream_endpoint_unavailable' };
  }
  if (status && status !== 200 && status !== 206) {
    return { ok: false, mediaHint: null, reason: `Playback request returned HTTP ${status}.`, code: 'stream_endpoint_unavailable' };
  }

  const type = String(input.contentType ?? '').toLowerCase();
  const bytes = input.bytes ?? new Uint8Array();
  const ascii = new TextDecoder().decode(bytes.slice(0, 24));
  const looksMedia = ascii.startsWith('#EXTM3U') || looksLikeMpegTs(bytes) || hasFtyp(bytes);

  if (type.includes('text/html') && !looksMedia) {
    return { ok: false, mediaHint: 'html', reason: streamProbeMessage('stream_html_response'), code: 'stream_html_response' };
  }
  if (type.includes('application/json') || type.includes('text/plain')) {
    const text = bytes.length ? new TextDecoder().decode(bytes.slice(0, 256)).trim() : '';
    if (/^<!doctype html|<html|login|unauthorized|error/i.test(text) && !looksMedia) {
      return { ok: false, mediaHint: 'html', reason: streamProbeMessage('stream_html_response'), code: 'stream_html_response' };
    }
  }
  if (ascii.startsWith('#EXTM3U')) {
    return { ok: true, mediaHint: 'hls', reason: 'HLS playlist received.', code: 'ok' };
  }
  if (bytes.length >= 8) {
    const box = new TextDecoder('latin1').decode(bytes.slice(4, 8));
    if (box === 'ftyp') {
      return { ok: true, mediaHint: 'mp4', reason: 'MP4 container header received.', code: 'ok' };
    }
  }
  if (looksLikeMpegTs(bytes)) {
    return { ok: true, mediaHint: 'mpegts', reason: 'MPEG-TS sync bytes received.', code: 'ok' };
  }
  if (type.includes('mpegurl') || type.includes('x-mpegurl')) {
    return { ok: true, mediaHint: 'hls', reason: 'HLS content type received.', code: 'ok' };
  }
  if (type.includes('mp2t') || type.includes('video/') || type.includes('application/octet-stream')) {
    return {
      ok: bytes.length > 0,
      mediaHint: type,
      reason: bytes.length > 0 ? 'Binary media response received.' : streamProbeMessage('stream_empty_body'),
      code: bytes.length > 0 ? 'ok' : 'stream_empty_body',
    };
  }
  if (bytes.length === 0) {
    return { ok: false, mediaHint: null, reason: streamProbeMessage('stream_empty_body'), code: 'stream_empty_body' };
  }
  return { ok: false, mediaHint: null, reason: streamProbeMessage('stream_invalid_media'), code: 'stream_invalid_media' };
}

function hasFtyp(bytes: Uint8Array) {
  if (bytes.length < 8) return false;
  return new TextDecoder('latin1').decode(bytes.slice(4, 8)) === 'ftyp';
}

function looksLikeMpegTs(bytes: Uint8Array) {
  if (bytes.length < 188) return bytes[0] === 0x47;
  let hits = 0;
  const limit = Math.min(bytes.length, 188 * 6);
  for (let offset = 0; offset + 1 < limit; offset += 188) {
    if (bytes[offset] === 0x47) hits += 1;
  }
  return hits >= 2;
}

export function summarizeProbeGroup(results: StreamProbeResult[]) {
  const passed = results.filter((item) => item.ok).length;
  const latencies = results.filter((item) => item.ok).map((item) => item.latencyMs);
  return {
    passed,
    total: results.length,
    averageMs: latencies.length ? Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length) : null,
  };
}

export function pickRepresentativeIndexes(count: number, take: number, salt = 7) {
  if (count <= 0 || take <= 0) return [];
  if (count <= take) return Array.from({ length: count }, (_, index) => index);
  const chosen = new Set<number>();
  const mid = Math.floor(count / 2);
  const candidates = [Math.max(0, Math.min(count - 1, salt % count)), mid, count - 1, Math.floor(count / 3), Math.floor((count * 2) / 3)];
  for (const index of candidates) {
    if (chosen.size >= take) break;
    chosen.add(((index % count) + count) % count);
  }
  let cursor = salt % count;
  while (chosen.size < take) {
    chosen.add(cursor);
    cursor = (cursor + 11) % count;
  }
  return [...chosen].slice(0, take);
}

export function shouldSkipPlaceholderName(name: string) {
  return /^(ppv|xxx|adult|18\+|info|test|promo|24\/7\s*cam)\b/i.test(name.trim());
}

export function classifyOverallHealth(checks: ProviderHealthCheck[], probeSummary?: {
  live: { passed: number; total: number };
  movies: { passed: number; total: number };
  episodes: { passed: number; total: number };
}): { overall: ProviderHealthStatus; overallLabel: string; notes: string[] } {
  const notes: string[] = [];
  const criticalFails = checks.filter((check) => check.severity === 'critical' && check.verdict === 'fail');
  const warnings = checks.filter((check) => check.verdict === 'warn' || (check.severity === 'noncritical' && check.verdict === 'fail'));

  if (probeSummary) {
    const groups = [probeSummary.live, probeSummary.movies, probeSummary.episodes].filter((group) => group.total > 0);
    const attempted = groups.reduce((sum, group) => sum + group.total, 0);
    const passed = groups.reduce((sum, group) => sum + group.passed, 0);
    if (attempted > 0 && passed === 0) {
      criticalFails.push({
        id: 'playback',
        label: 'Stream Probe',
        verdict: 'fail',
        severity: 'critical',
        detail: 'Representative playback endpoints failed.',
      });
    } else if (attempted > 0 && passed < attempted) {
      warnings.push({
        id: 'playback-partial',
        label: 'Stream Probe',
        verdict: 'warn',
        severity: 'noncritical',
        detail: `${passed}/${attempted} sampled streams responded.`,
      });
    }
  }

  if (criticalFails.length) {
    return {
      overall: 'failed',
      overallLabel: criticalFails[0]?.detail || 'A critical provider check failed.',
      notes: criticalFails.map((check) => check.detail),
    };
  }

  if (warnings.length) {
    notes.push(...warnings.map((check) => check.detail));
    return {
      overall: 'degraded',
      overallLabel: notes[0] || 'Provider works, but one or more noncritical checks produced warnings.',
      notes,
    };
  }

  return {
    overall: 'healthy',
    overallLabel: 'All critical provider tests passed.',
    notes,
  };
}

export function canActivateFromHealth(input: {
  healthStatus: ProviderHealthStatus;
  validationStale: boolean;
  activationStatus: ProviderActivationStatus;
}) {
  if (input.validationStale) return false;
  if (input.healthStatus !== 'healthy' && input.healthStatus !== 'degraded') return false;
  if (input.activationStatus === 'revoked') return false;
  return true;
}

export function displayHealthLabel(input: {
  activationStatus: ProviderActivationStatus;
  healthStatus: ProviderHealthStatus;
  validationStale: boolean;
}) {
  if (input.activationStatus === 'paused' || input.activationStatus === 'revoked') return 'DISABLED';
  if (input.activationStatus === 'draft' && (input.healthStatus === 'unvalidated' || input.validationStale)) return 'DRAFT';
  if (input.healthStatus === 'testing') return 'TESTING';
  if (input.validationStale) return 'VALIDATION REQUIRED';
  if (input.healthStatus === 'healthy') return 'HEALTHY';
  if (input.healthStatus === 'degraded') return 'DEGRADED';
  if (input.healthStatus === 'failed') return 'FAILED';
  return 'DRAFT';
}

export function buildXtreamPlayerApiUrl(baseUrl: string, username: string, password: string, action?: string, query: Record<string, string> = {}) {
  const url = new URL('/player_api.php', `${stripPlayerApiPath(baseUrl)}/`);
  url.searchParams.set('username', username);
  url.searchParams.set('password', password);
  if (action) url.searchParams.set('action', action);
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value);
  }
  return url;
}

export function buildXtreamStreamUrl(input: {
  baseUrl: string;
  username: string;
  password: string;
  kind: StreamProbeKind;
  streamId: string;
  extension: string;
}) {
  const folder = input.kind === 'movie' ? 'movie' : input.kind === 'episode' ? 'series' : 'live';
  const fallback = input.kind === 'movie' ? 'mp4' : 'ts';
  const ext = normalizePlaybackExtension(input.extension, fallback);
  return `${stripPlayerApiPath(input.baseUrl)}/${folder}/${encodeURIComponent(input.username)}/${encodeURIComponent(input.password)}/${encodeURIComponent(String(input.streamId).trim())}.${ext}`;
}

export function normalizePlaybackExtension(extension: string | undefined, fallback: string) {
  const raw = String(extension ?? '').trim().toLowerCase().replace(/[?#].*$/, '');
  const lastSegment = raw.split('/').pop() ?? '';
  const value = lastSegment.replace(/^\.+/, '').split('.').pop() ?? '';
  return value || fallback;
}

export function parseOptionalInt(value: unknown): number | null {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : null;
}

export function connectionSlotOccupied(maxConnections: number | null | undefined, activeConnections: number | null | undefined) {
  return maxConnections === 1 && activeConnections != null && activeConnections >= 1;
}

export function shouldRetryStreamWithoutRange(status: number | null | undefined) {
  return status === 416 || status === 405 || status === 406 || status === 501;
}

export function streamProbeMessage(code: StreamProbeCode, httpStatus?: number | null) {
  switch (code) {
    case 'ok':
      return 'Stream endpoint returned plausible media.';
    case 'stream_connection_limit':
      return "Stream probe could not be verified because the provider's single allowed connection appears to be in use.";
    case 'stream_http_401':
      return 'Playback request returned HTTP 401.';
    case 'stream_http_403':
      return 'Playback request returned HTTP 403.';
    case 'stream_http_404':
      return 'Playback request returned HTTP 404.';
    case 'stream_http_429':
      return 'Playback request returned HTTP 429.';
    case 'stream_timeout':
      return 'Stream probe timed out.';
    case 'stream_redirect_blocked':
      return 'Stream redirect was blocked by SSRF validation.';
    case 'stream_html_response':
      return 'Endpoint returned an HTML/error page instead of media.';
    case 'stream_invalid_media':
      return 'Response was not recognizable as playable media.';
    case 'stream_range_rejected':
      return `Range request was rejected${httpStatus ? ` (HTTP ${httpStatus})` : ''}.`;
    case 'stream_empty_body':
      return 'Playback endpoint returned an empty body.';
    default:
      return httpStatus ? `Playback request returned HTTP ${httpStatus}.` : 'Stream endpoint was unavailable.';
  }
}

export function formatStreamProbeDiagnostic(result: StreamProbeResult) {
  const status = result.httpStatus != null ? `HTTP ${result.httpStatus}` : 'no-status';
  const type = String(result.contentType ?? '').split(';')[0].trim().slice(0, 48);
  const bytes = result.byteCount != null ? `${result.byteCount}B` : '';
  const redirect = result.redirected ? 'redirected' : 'direct';
  const range = result.rangeRetried ? 'range-fallback' : '';
  return [result.kind, result.ok ? 'PASS' : 'FAIL', result.code ?? '', status, type, bytes, redirect, range]
    .filter(Boolean)
    .join(' · ');
}

export function maybeConnectionLimitCode(
  code: StreamProbeCode,
  maxConnections: number | null | undefined,
  activeConnections?: number | null,
): StreamProbeCode {
  if (maxConnections !== 1) return code;
  if (code !== 'stream_http_403' && code !== 'stream_http_429' && code !== 'stream_empty_body') return code;
  if (activeConnections === 0) return code;
  return 'stream_connection_limit';
}

export function aggregateStreamProbeCheck(input: {
  probes: StreamProbeResult[];
  skippedForConnectionLimit: boolean;
  live: { passed: number; total: number };
  movies: { passed: number; total: number };
  episodes: { passed: number; total: number };
}): { verdict: CheckVerdict; severity: CheckSeverity; detail: string } {
  if (input.skippedForConnectionLimit) {
    return {
      verdict: 'warn',
      severity: 'noncritical',
      detail: streamProbeMessage('stream_connection_limit'),
    };
  }
  const attempted = input.live.total + input.movies.total + input.episodes.total;
  const passed = input.live.passed + input.movies.passed + input.episodes.passed;
  const counts = `Live ${input.live.passed}/${input.live.total} · Movies ${input.movies.passed}/${input.movies.total} · Episodes ${input.episodes.passed}/${input.episodes.total}`;
  if (attempted === 0) {
    return { verdict: 'fail', severity: 'critical', detail: 'No representative streams were available to probe.' };
  }
  if (passed === attempted) {
    return { verdict: 'pass', severity: 'critical', detail: `${counts} sampled streams responded.` };
  }
  const failed = input.probes.filter((item) => !item.ok);
  const reasons = [...new Set(failed.map((item) => item.reason).filter(Boolean))];
  const codes = [...new Set(failed.map((item) => item.code).filter(Boolean))];
  const statuses = [...new Set(failed.map((item) => item.httpStatus).filter((value): value is number => typeof value === 'number'))];
  const statusSuffix = statuses.length ? ` HTTP ${statuses.join('/')}.` : '';
  const allConnectionLimit = input.probes.length > 0 && input.probes.every((item) => !item.ok && item.code === 'stream_connection_limit');
  if (allConnectionLimit || (passed === 0 && input.probes.some((item) => item.code === 'stream_connection_limit'))) {
    return {
      verdict: 'warn',
      severity: 'noncritical',
      detail: `${counts}. ${streamProbeMessage('stream_connection_limit')}${statusSuffix}`.slice(0, 240),
    };
  }
  if (passed === 0) {
    return {
      verdict: 'fail',
      severity: 'critical',
      detail: `${counts}. ${reasons[0] ?? streamProbeMessage('stream_endpoint_unavailable')}${statusSuffix}${codes.length ? ` [${codes.join(', ')}]` : ''}`.slice(0, 240),
    };
  }
  return {
    verdict: 'warn',
    severity: 'noncritical',
    detail: `${counts} sampled streams responded.`,
  };
}

export function catalogItemId(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'string' && value.trim()) return value.trim();
  return null;
}

export function isInactiveXtreamStatus(status: string | null | undefined) {
  const value = String(status ?? '').trim().toLowerCase();
  return ['expired', 'banned', 'disabled', 'inactive', 'closed'].includes(value);
}
