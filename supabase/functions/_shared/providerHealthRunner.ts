import {
  LIVE_PROBE_SAMPLE,
  MOVIE_PROBE_SAMPLE,
  EPISODE_PROBE_SAMPLE,
  STREAM_PROBE_CAVEAT,
  buildXtreamPlayerApiUrl,
  buildXtreamStreamUrl,
  catalogItemId,
  classifyOverallHealth,
  classifyStreamProbePayload,
  isInactiveXtreamStatus,
  pickRepresentativeIndexes,
  sanitizeFailureMessage,
  shouldSkipPlaceholderName,
  shouldRetryStreamWithoutRange,
  summarizeProbeGroup,
  aggregateStreamProbeCheck,
  connectionSlotOccupied,
  isCloudPlaybackProbeRestricted,
  maybeConnectionLimitCode,
  normalizePlaybackExtension,
  parseOptionalInt,
  NOVACAST_STREAM_PROBE_UA,
  streamProbeMessage,
  formatStreamProbeDiagnostic,
  type ProviderHealthCheck,
  type ProviderHealthSummary,
  type StreamProbeCode,
  type StreamProbeKind,
  type StreamProbeResult,
} from './providerHealth.ts';
import { parseProviderBaseUrl } from './providerHealth.ts';
import {
  CATALOG_READ_LIMIT_BYTES,
  CATALOG_ITEM_SCAN_LIMIT,
  catalogDiagnosticMessage,
  createXtreamCatalogScanner,
  type CatalogScanResult,
  type CatalogStopReason,
} from './providerHealthCatalog.ts';

const REACHABILITY_TIMEOUT_MS = 8_000;
const AUTH_TIMEOUT_MS = 10_000;
const CATALOG_TIMEOUT_MS = 45_000;
const PROBE_TIMEOUT_MS = 8_000;
const PROBE_MAX_BYTES = 2_048;
const CATALOG_MAX_BYTES = CATALOG_READ_LIMIT_BYTES;
const PROBE_YIELD_MS = 120;
export const PROVIDER_HEALTH_WATCHDOG_MS = 90_000;

type XtreamCredentials = {
  baseUrl: string;
  username: string;
  password: string;
};

type CatalogRow = Record<string, unknown>;

function timeoutSignal(ms: number, parentSignal?: AbortSignal) {
  const controller = new AbortController();
  const abortFromParent = () => controller.abort();
  if (parentSignal) {
    if (parentSignal.aborted) controller.abort();
    else parentSignal.addEventListener('abort', abortFromParent, { once: true });
  }
  const timer = setTimeout(() => controller.abort(), ms);
  return {
    controller,
    timer,
    cleanup: () => {
      clearTimeout(timer);
      parentSignal?.removeEventListener('abort', abortFromParent);
    },
  };
}

async function readLimited(response: Response, maxBytes: number) {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('bounded_response_body_unavailable');
  }
  const chunks: Uint8Array[] = [];
  let received = 0;
  while (received < maxBytes) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    chunks.push(value);
    received += value.byteLength;
    if (received >= maxBytes) break;
  }
  await reader.cancel().catch(() => undefined);
  const merged = new Uint8Array(Math.min(received, maxBytes));
  let offset = 0;
  for (const chunk of chunks) {
    const slice = chunk.slice(0, merged.length - offset);
    merged.set(slice, offset);
    offset += slice.byteLength;
    if (offset >= merged.length) break;
  }
  return merged;
}

async function fetchSafe(url: URL, init: RequestInit & { timeoutMs: number; maxBytes?: number; hop?: number; maxHops?: number; skipBody?: boolean }) {
  const { controller, cleanup } = timeoutSignal(init.timeoutMs, init.signal ?? undefined);
  const maxHops = init.maxHops ?? 1;
  try {
    const response = await fetch(url, {
      method: init.method ?? 'GET',
      headers: init.headers,
      redirect: 'manual',
      signal: controller.signal,
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location || (init.hop ?? 0) >= maxHops) throw new Error('unsafe_provider_redirect');
      let next: URL;
      try {
        next = new URL(location, url);
      } catch {
        throw new Error('unsafe_provider_redirect');
      }
      parseProviderBaseUrl(`${next.protocol}//${next.host}`);
      return await fetchSafe(next, { ...init, hop: (init.hop ?? 0) + 1, maxHops });
    }
    if (init.skipBody) {
      return { response, bytes: new Uint8Array(), latencyHint: 0, redirected: (init.hop ?? 0) > 0 };
    }
    const bytes = await readLimited(response, init.maxBytes ?? CATALOG_MAX_BYTES);
    return { response, bytes, latencyHint: 0, redirected: (init.hop ?? 0) > 0 };
  } finally {
    cleanup();
  }
}

async function fetchXtreamCatalog(
  url: URL,
  timeoutMs: number,
  options: { keepAll?: boolean; maxBytes?: number; signal?: AbortSignal; exactCount?: boolean } = {},
): Promise<CatalogScanResult> {
  const started = Date.now();
  const { controller, cleanup } = timeoutSignal(timeoutMs, options.signal);
  const scanner = createXtreamCatalogScanner({
    keepAll: options.keepAll,
    maxBytes: options.maxBytes ?? CATALOG_MAX_BYTES,
    exactCount: options.exactCount,
  });
  const fail = (reason: CatalogScanResult['reason'], httpStatus?: number | null, stopReason: CatalogStopReason = 'parse_failure'): CatalogScanResult => ({
    ok: false,
    reason,
    detail: catalogDiagnosticMessage(reason, { httpStatus, limitBytes: options.maxBytes ?? CATALOG_MAX_BYTES }),
    items: [],
    count: 0,
    totalCount: null,
    inspectedCount: 0,
    exactCountAvailable: false,
    diagnosticTruncated: false,
    stopReason,
    truncated: false,
    complete: false,
    bytesRead: scanner.bytesRead,
    httpStatus,
    latencyMs: Date.now() - started,
  });
  try {
    let current = url;
    let response = await fetch(current, { redirect: 'manual', signal: controller.signal });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) return fail('catalog_invalid_json', response.status);
      const next = new URL(location, current);
      parseProviderBaseUrl(`${next.protocol}//${next.host}`);
      response = await fetch(next, { redirect: 'manual', signal: controller.signal });
      if (response.status >= 300 && response.status < 400) return fail('catalog_http', response.status);
    }
    scanner.setHttpStatus(response.status);
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return fail('catalog_http', response.status);
    }
    const reader = response.body?.getReader();
    if (!reader) {
      return fail('catalog_unexpected_shape', response.status);
    } else {
      let upstreamEnded = false;
      while (!scanner.finished) {
        const { done, value } = await reader.read();
        if (done || !value) {
          upstreamEnded = done === true;
          break;
        }
        scanner.push(value);
      }
      await reader.cancel().catch(() => undefined);
      if (upstreamEnded && !scanner.complete) {
        const partial = scanner.finish(true, 'upstream_incomplete');
        return {
          ...partial,
          ok: false,
          reason: 'catalog_invalid_json',
          detail: catalogDiagnosticMessage('catalog_invalid_json', { limitBytes: options.maxBytes ?? CATALOG_MAX_BYTES }),
          totalCount: null,
          exactCountAvailable: false,
          stopReason: 'upstream_incomplete',
          latencyMs: Date.now() - started,
        };
      }
    }
    return { ...scanner.finish(), latencyMs: Date.now() - started };
  } catch (error) {
    const aborted = error instanceof DOMException && error.name === 'AbortError';
    if (aborted) {
      const partial = scanner.finish(true, 'timeout');
      return {
        ...partial,
        ok: false,
        reason: 'catalog_timeout',
        detail: catalogDiagnosticMessage('catalog_timeout'),
        totalCount: null,
        exactCountAvailable: false,
        stopReason: 'timeout',
        latencyMs: Date.now() - started,
      };
    }
    return fail('catalog_invalid_json');
  } finally {
    cleanup();
  }
}

async function fetchJsonObject(url: URL, timeoutMs: number, signal?: AbortSignal) {
  const started = Date.now();
  const { response, bytes } = await fetchSafe(url, { timeoutMs, maxBytes: 1_000_000, signal });
  const latencyMs = Date.now() - started;
  if (!response.ok) throw new Error(`http_${response.status}`);
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('provider_response_invalid');
    return { payload: parsed, latencyMs };
  } catch (error) {
    if (error instanceof Error && error.message === 'provider_response_invalid') throw error;
    throw new Error('provider_response_invalid');
  }
}

function check(
  id: string,
  label: string,
  verdict: ProviderHealthCheck['verdict'],
  severity: ProviderHealthCheck['severity'],
  detail: string,
  extra: Partial<ProviderHealthCheck> = {},
): ProviderHealthCheck {
  return { id, label, verdict, severity, detail, ...extra };
}

function usableRows(rows: CatalogRow[], nameKey: string, idKey: string) {
  return rows.filter((row) => {
    const id = catalogItemId(row[idKey] ?? row.stream_id ?? row.series_id ?? row.category_id);
    const name = String(row[nameKey] ?? row.name ?? '');
    return Boolean(id) && !shouldSkipPlaceholderName(name);
  });
}

function sampleRows(rows: CatalogRow[], take: number, idKey: string, nameKey: string) {
  const usable = usableRows(rows, nameKey, idKey);
  const indexes = pickRepresentativeIndexes(usable.length, take);
  return indexes.map((index) => usable[index]).filter(Boolean);
}

export async function probeStream(input: {
  credentials: XtreamCredentials;
  kind: StreamProbeKind;
  streamId: string;
  extension: string;
  directSource?: string | null;
  maxConnections?: number | null;
  activeConnections?: number | null;
  signal?: AbortSignal;
}): Promise<StreamProbeResult> {
  const started = Date.now();
  const fail = (code: StreamProbeCode, httpStatus: number | null = null, extra: Partial<StreamProbeResult> = {}): StreamProbeResult => ({
    kind: input.kind,
    ok: false,
    latencyMs: Date.now() - started,
    httpStatus,
    mediaHint: null,
    contentType: extra.contentType ?? null,
    byteCount: extra.byteCount ?? 0,
    code: maybeConnectionLimitCode(code, input.maxConnections, input.activeConnections),
    reason: streamProbeMessage(maybeConnectionLimitCode(code, input.maxConnections, input.activeConnections), httpStatus),
    ...extra,
  });

  let target: URL;
  try {
    const direct = String(input.directSource ?? '').trim();
    if (input.kind === 'live' && /^https?:\/\//i.test(direct)) {
      const parsed = new URL(direct);
      parseProviderBaseUrl(`${parsed.protocol}//${parsed.host}`);
      target = parsed;
    } else {
      target = new URL(
        buildXtreamStreamUrl({
          ...input.credentials,
          kind: input.kind,
          streamId: input.streamId,
          extension: input.extension,
        }),
      );
      parseProviderBaseUrl(`${target.protocol}//${target.host}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    return fail(message === 'unsafe_provider_target' ? 'stream_redirect_blocked' : 'stream_endpoint_unavailable');
  }

  const headers = (range: boolean) => ({
    'User-Agent': NOVACAST_STREAM_PROBE_UA,
    Accept: '*/*',
    ...(range ? { Range: `bytes=0-${PROBE_MAX_BYTES - 1}` } : {}),
  });

  const run = async (range: boolean) => {
    const { response, bytes, redirected } = await fetchSafe(target, {
      timeoutMs: PROBE_TIMEOUT_MS,
      maxBytes: PROBE_MAX_BYTES,
      maxHops: 2,
      headers: headers(range),
      signal: input.signal,
    });
    return { response, bytes, redirected: Boolean(redirected) };
  };

  try {
    let rangeRetried = false;
    let redirected = false;
    let attempt = await run(true);
    redirected = attempt.redirected;
    if (shouldRetryStreamWithoutRange(attempt.response.status)) {
      rangeRetried = true;
      await yieldMs(80);
      attempt = await run(false);
      redirected = redirected || attempt.redirected;
    }
    const contentType = attempt.response.headers.get('content-type');
    const classified = classifyStreamProbePayload({
      httpStatus: attempt.response.status,
      contentType,
      bytes: attempt.bytes,
      extension: input.extension,
    });
    const code = maybeConnectionLimitCode(classified.code, input.maxConnections, input.activeConnections);
    return {
      kind: input.kind,
      ok: classified.ok,
      latencyMs: Date.now() - started,
      httpStatus: attempt.response.status,
      mediaHint: classified.mediaHint,
      contentType,
      byteCount: attempt.bytes.byteLength,
      reason: classified.ok ? classified.reason : streamProbeMessage(code, attempt.response.status),
      code,
      rangeRetried,
      redirected,
    };
  } catch (error) {
    const aborted = error instanceof DOMException && error.name === 'AbortError';
    const message = error instanceof Error ? error.message : '';
    if (message === 'unsafe_provider_redirect' || message === 'unsafe_provider_target') {
      return fail('stream_redirect_blocked');
    }
    return fail(aborted ? 'stream_timeout' : 'stream_endpoint_unavailable');
  }
}

function yieldMs(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function catalogCheck(
  id: string,
  label: string,
  result: CatalogScanResult,
  options: { required: boolean; categories: number; countLabel: string },
): ProviderHealthCheck {
  if (!result.ok && result.reason === 'catalog_empty') {
    return check(
      id,
      label,
      options.required ? 'fail' : 'warn',
      options.required ? 'critical' : 'noncritical',
      `${result.detail} Categories: ${options.categories}.`,
      { latencyMs: result.latencyMs, counts: { categories: options.categories, items: 0 } },
    );
  }
  if (!result.ok) {
    return check(id, label, 'fail', 'critical', result.detail, {
      latencyMs: result.latencyMs,
      counts: { categories: options.categories, items: result.count },
    });
  }
  const counted = result.exactCountAvailable ? String(result.totalCount) : `at least ${result.inspectedCount}`;
  const bound = result.exactCountAvailable ? '' : ' Bounded catalog inspection; exact total unavailable.';
  return check(
    id,
    label,
    'pass',
    'critical',
    `Categories: ${options.categories}. ${options.countLabel}: ${counted}.${bound}`,
    { latencyMs: result.latencyMs, counts: { categories: options.categories, items: result.totalCount ?? result.inspectedCount } },
  );
}

async function fetchContentList(
  baseUrl: string,
  credentials: XtreamCredentials,
  action: string,
  categories: CatalogRow[],
  signal?: AbortSignal,
): Promise<CatalogScanResult> {
  const global = await fetchXtreamCatalog(
    buildXtreamPlayerApiUrl(baseUrl, credentials.username, credentials.password, action),
    CATALOG_TIMEOUT_MS,
    { signal, exactCount: false },
  );
  if (global.ok && global.count > 0) return global;
  if (!categories.length) return global;

  const indexes = pickRepresentativeIndexes(categories.length, 3);
  const samples: CatalogRow[] = [];
  let inspectedCount = 0;
  let bytesRead = 0;
  let latencyMs = global.latencyMs ?? 0;
  let lastFail = global;
  for (const index of indexes) {
    const categoryId = catalogItemId(categories[index]?.category_id);
    if (!categoryId) continue;
    const part = await fetchXtreamCatalog(
      buildXtreamPlayerApiUrl(baseUrl, credentials.username, credentials.password, action, { category_id: categoryId }),
      CATALOG_TIMEOUT_MS,
      { signal, exactCount: false },
    );
    latencyMs += part.latencyMs ?? 0;
    bytesRead += part.bytesRead;
    if (part.ok) {
      inspectedCount = Math.min(CATALOG_ITEM_SCAN_LIMIT, inspectedCount + part.inspectedCount);
      samples.push(...part.items);
    } else {
      lastFail = part;
    }
    await yieldMs(80);
  }
  if (inspectedCount === 0) return lastFail;
  return {
    ok: true,
    reason: 'ok',
    detail: catalogDiagnosticMessage('ok', { count: inspectedCount }),
    items: samples.slice(0, 40),
    count: inspectedCount,
    totalCount: null,
    inspectedCount,
    exactCountAvailable: false,
    diagnosticTruncated: true,
    stopReason: 'fallback_sample',
    truncated: true,
    complete: false,
    bytesRead,
    latencyMs,
  };
}

export async function fetchLiveChannelsForEpgMapping(credentials: XtreamCredentials) {
  const result = await fetchXtreamCatalog(
    buildXtreamPlayerApiUrl(credentials.baseUrl, credentials.username, credentials.password, 'get_live_streams'),
    CATALOG_TIMEOUT_MS,
    { keepAll: true },
  );
  return {
    ...result,
    items: result.items.map((row) => ({
      streamId: catalogItemId(row.stream_id),
      name: String(row.name ?? ''),
      epgChannelId: String(row.epg_channel_id ?? row['tvg-id'] ?? row.tvg_id ?? '').trim() || null,
      category: String(row.category_name ?? row.category_id ?? '').trim() || null,
    })),
  };
}

async function runProviderHealthCheckInternal(credentials: XtreamCredentials, options: { isGoldManaged?: boolean; signal?: AbortSignal } = {}): Promise<ProviderHealthSummary> {
  const startedAt = Date.now();
  const checks: ProviderHealthCheck[] = [];
  const notes: string[] = [];
  let account: ProviderHealthSummary['account'];
  let catalogs: ProviderHealthSummary['catalogs'] = {
    liveCategories: 0,
    liveChannels: 0,
    movieCategories: 0,
    movies: 0,
    seriesCategories: 0,
    series: 0,
    episodeLookupOk: false,
    countDetails: {
      liveChannels: { totalCount: null, inspectedCount: 0, exactCountAvailable: false, diagnosticTruncated: false, bytesRead: 0, complete: false, stopReason: 'parse_failure' },
      movies: { totalCount: null, inspectedCount: 0, exactCountAvailable: false, diagnosticTruncated: false, bytesRead: 0, complete: false, stopReason: 'parse_failure' },
      series: { totalCount: null, inspectedCount: 0, exactCountAvailable: false, diagnosticTruncated: false, bytesRead: 0, complete: false, stopReason: 'parse_failure' },
    },
    truncated: {
      liveChannels: false,
      movies: false,
      series: false,
    },
  };
  const probes: StreamProbeResult[] = [];

  const base = parseProviderBaseUrl(credentials.baseUrl);
  const normalizedBase = base.toString().replace(/\/$/, '');
  const safeCreds = { ...credentials, baseUrl: normalizedBase };

  try {
    const origin = new URL('/', normalizedBase.endsWith('/') ? normalizedBase : `${normalizedBase}/`);
    const started = Date.now();
    const { response } = await fetchSafe(origin, { timeoutMs: REACHABILITY_TIMEOUT_MS, maxBytes: 256, signal: options.signal });
    checks.push(
      check(
        'server',
        'Server Reachable',
        response.status > 0 ? 'pass' : 'fail',
        'critical',
        response.status > 0
          ? `Host responded (HTTP ${response.status}). Anonymous root access is not required when player_api authentication succeeds.`
          : 'Server did not respond.',
        { latencyMs: Date.now() - started },
      ),
    );
  } catch (error) {
    const aborted = error instanceof DOMException && error.name === 'AbortError';
    checks.push(
      check(
        'server',
        'Server Reachable',
        'fail',
        'critical',
        aborted ? 'Server timed out.' : sanitizeFailureMessage(error, safeCreds.username, safeCreds.password),
      ),
    );
    return finish(checks, notes, startedAt, account, catalogs, probes);
  }

  try {
    const authUrl = buildXtreamPlayerApiUrl(normalizedBase, safeCreds.username, safeCreds.password);
    const { payload, latencyMs } = await fetchJsonObject(authUrl, AUTH_TIMEOUT_MS, options.signal);
    const userInfo = (payload.user_info ?? {}) as Record<string, unknown>;
    const serverInfo = (payload.server_info ?? {}) as Record<string, unknown>;
    const authenticated = userInfo.auth === 1 || userInfo.auth === '1';
    const status = typeof userInfo.status === 'string' ? userInfo.status : authenticated ? 'Active' : 'Unknown';
    const expiresRaw = userInfo.exp_date;
    const expiresAt =
      typeof expiresRaw === 'string' || typeof expiresRaw === 'number'
        ? new Date(Number(expiresRaw) * (Number(expiresRaw) < 100000000000 ? 1000 : 1)).toISOString()
        : null;
    account = {
      status,
      expiresAt,
      maxConnections: parseOptionalInt(userInfo.max_connections),
      activeConnections: parseOptionalInt(userInfo.active_cons),
      timezone: typeof serverInfo.timezone === 'string' ? serverInfo.timezone : null,
      allowedOutputFormats: Array.isArray(userInfo.allowed_output_formats)
        ? userInfo.allowed_output_formats.map((item) => String(item)).filter(Boolean).slice(0, 12)
        : typeof userInfo.allowed_output_formats === 'string'
          ? userInfo.allowed_output_formats.split(',').map((item) => item.trim()).filter(Boolean).slice(0, 12)
          : null,
    };
    if (!authenticated) {
      checks.push(check('authentication', 'Authentication', 'fail', 'critical', 'The provider rejected those credentials.', { latencyMs }));
      return finish(checks, notes, startedAt, account, catalogs, probes);
    }
    if ((account.maxConnections ?? 0) === 1) {
      notes.push('Account max connections is 1. Stream probes run one at a time to avoid lockouts.');
    }
    if (account.allowedOutputFormats?.length) {
      notes.push(`Allowed output formats: ${account.allowedOutputFormats.join(', ')}.`);
    }
    if (latencyMs >= 5000) {
      notes.push('Authentication was unusually slow.');
    }
    if (isInactiveXtreamStatus(status) || (expiresAt && Date.parse(expiresAt) <= Date.now())) {
      checks.push(
        check('authentication', 'Authentication', 'fail', 'critical', `Account status is ${status}${expiresAt ? `; expiration ${expiresAt}` : ''}.`, {
          latencyMs,
        }),
      );
      return finish(checks, notes, startedAt, account, catalogs, probes);
    }
    checks.push(
      check(
        'authentication',
        'Authentication',
        'pass',
        'critical',
        `Account Status: ${status}${account.maxConnections != null ? `; Max Connections: ${account.maxConnections}` : ''}${account.activeConnections != null ? `; Active Connections: ${account.activeConnections}` : ''}${account.allowedOutputFormats?.length ? `; Formats: ${account.allowedOutputFormats.join(', ')}` : ''}`,
        { latencyMs },
      ),
    );
  } catch (error) {
    const aborted = error instanceof DOMException && error.name === 'AbortError';
    checks.push(
      check(
        'authentication',
        'Authentication',
        'fail',
        'critical',
        aborted ? 'Authentication timed out.' : sanitizeFailureMessage(error, safeCreds.username, safeCreds.password),
      ),
    );
    return finish(checks, notes, startedAt, account, catalogs, probes);
  }

  let liveCategories: CatalogRow[] = [];
  let liveStreams: CatalogRow[] = [];
  let vodCategories: CatalogRow[] = [];
  let vodStreams: CatalogRow[] = [];
  let seriesCategories: CatalogRow[] = [];
  let seriesList: CatalogRow[] = [];

  const liveCategoryResult = await fetchXtreamCatalog(
    buildXtreamPlayerApiUrl(normalizedBase, safeCreds.username, safeCreds.password, 'get_live_categories'),
    CATALOG_TIMEOUT_MS,
    { signal: options.signal, exactCount: false },
  );
  const vodCategoryResult = await fetchXtreamCatalog(
    buildXtreamPlayerApiUrl(normalizedBase, safeCreds.username, safeCreds.password, 'get_vod_categories'),
    CATALOG_TIMEOUT_MS,
    { signal: options.signal, exactCount: false },
  );
  const seriesCategoryResult = await fetchXtreamCatalog(
    buildXtreamPlayerApiUrl(normalizedBase, safeCreds.username, safeCreds.password, 'get_series_categories'),
    CATALOG_TIMEOUT_MS,
    { signal: options.signal, exactCount: false },
  );
  liveCategories = liveCategoryResult.items;
  vodCategories = vodCategoryResult.items;
  seriesCategories = seriesCategoryResult.items;

  const liveStreamResult = await fetchContentList(
    normalizedBase,
    safeCreds,
    'get_live_streams',
    liveCategories,
    options.signal,
  );
  const vodStreamResult = await fetchContentList(
    normalizedBase,
    safeCreds,
    'get_vod_streams',
    vodCategories,
    options.signal,
  );
  const seriesListResult = await fetchContentList(
    normalizedBase,
    safeCreds,
    'get_series',
    seriesCategories,
    options.signal,
  );
  liveStreams = liveStreamResult.items;
  vodStreams = vodStreamResult.items;
  seriesList = seriesListResult.items;

  catalogs.liveCategories = liveCategoryResult.count;
  catalogs.liveChannels = liveStreamResult.totalCount ?? liveStreamResult.inspectedCount;
  catalogs.movieCategories = vodCategoryResult.count;
  catalogs.movies = vodStreamResult.totalCount ?? vodStreamResult.inspectedCount;
  catalogs.seriesCategories = seriesCategoryResult.count;
  catalogs.series = seriesListResult.totalCount ?? seriesListResult.inspectedCount;
  catalogs.countDetails = {
    liveChannels: {
      totalCount: liveStreamResult.totalCount,
      inspectedCount: liveStreamResult.inspectedCount,
      exactCountAvailable: liveStreamResult.exactCountAvailable,
      diagnosticTruncated: liveStreamResult.diagnosticTruncated,
      bytesRead: liveStreamResult.bytesRead,
      complete: liveStreamResult.complete,
      stopReason: liveStreamResult.stopReason,
    },
    movies: {
      totalCount: vodStreamResult.totalCount,
      inspectedCount: vodStreamResult.inspectedCount,
      exactCountAvailable: vodStreamResult.exactCountAvailable,
      diagnosticTruncated: vodStreamResult.diagnosticTruncated,
      bytesRead: vodStreamResult.bytesRead,
      complete: vodStreamResult.complete,
      stopReason: vodStreamResult.stopReason,
    },
    series: {
      totalCount: seriesListResult.totalCount,
      inspectedCount: seriesListResult.inspectedCount,
      exactCountAvailable: seriesListResult.exactCountAvailable,
      diagnosticTruncated: seriesListResult.diagnosticTruncated,
      bytesRead: seriesListResult.bytesRead,
      complete: seriesListResult.complete,
      stopReason: seriesListResult.stopReason,
    },
  };
  catalogs.truncated = {
    liveChannels: liveStreamResult.diagnosticTruncated,
    movies: vodStreamResult.diagnosticTruncated,
    series: seriesListResult.diagnosticTruncated,
  };

  checks.push(catalogCheck('live-catalog', 'Live TV Catalog', liveStreamResult, {
    required: true,
    categories: liveCategoryResult.count,
    countLabel: 'Channels',
  }));
  checks.push(catalogCheck('movie-catalog', 'Movies', vodStreamResult, {
    required: false,
    categories: vodCategoryResult.count,
    countLabel: 'Movies',
  }));

  let episodeOk = false;
  let episodePayload: Record<string, unknown> | null = null;
  if (seriesListResult.ok && seriesList.length) {
    try {
      const sample = sampleRows(seriesList, 1, 'series_id', 'name')[0];
      const seriesId = catalogItemId(sample?.series_id);
      if (seriesId) {
        const infoUrl = buildXtreamPlayerApiUrl(normalizedBase, safeCreds.username, safeCreds.password, 'get_series_info', {
          series_id: seriesId,
        });
        const { payload } = await fetchJsonObject(infoUrl, CATALOG_TIMEOUT_MS, options.signal);
        episodePayload = payload;
        const episodes = payload.episodes;
        episodeOk = Boolean(episodes && typeof episodes === 'object');
        catalogs.episodeLookupOk = episodeOk;
      }
    } catch {
      episodeOk = false;
    }
  }
  const seriesCheck = catalogCheck('series-catalog', 'Series', seriesListResult, {
    required: false,
    categories: seriesCategoryResult.count,
    countLabel: 'Series',
  });
  if (seriesListResult.ok) {
    seriesCheck.detail += ` Episode lookup: ${episodeOk ? 'PASS' : 'WARNING'}.`;
    if (!episodeOk) {
      seriesCheck.verdict = 'warn';
      seriesCheck.severity = 'noncritical';
    }
  }
  checks.push(seriesCheck);

  const liveIdsOk = liveStreams.slice(0, 25).filter((row) => catalogItemId(row.stream_id)).length;
  const movieIdsOk = vodStreams.slice(0, 25).filter((row) => catalogItemId(row.stream_id)).length;
  const seriesIdsOk = seriesList.slice(0, 25).filter((row) => catalogItemId(row.series_id)).length;
  const categoryIdsOk =
    liveCategories.filter((row) => catalogItemId(row.category_id)).length +
    vodCategories.filter((row) => catalogItemId(row.category_id)).length +
    seriesCategories.filter((row) => catalogItemId(row.category_id)).length;
  const compatibilityFail = liveStreams.length > 0 && liveIdsOk === 0;
  checks.push(
    check(
      'compatibility',
      'NovaCast Compatibility',
      compatibilityFail ? 'fail' : 'pass',
      'critical',
      compatibilityFail
        ? 'Live channel IDs could not be normalized into NovaCast models.'
        : `Live normalization: ${liveIdsOk ? 'PASS' : 'SKIP'}. Movie normalization: ${movieIdsOk ? 'PASS' : 'SKIP'}. Series normalization: ${seriesIdsOk ? 'PASS' : 'SKIP'}. Category IDs: ${categoryIdsOk}. Fatal parsing errors: 0.`,
    ),
  );

  const skippedForConnectionLimit = connectionSlotOccupied(account?.maxConnections, account?.activeConnections);
  if (skippedForConnectionLimit) {
    notes.push(streamProbeMessage('stream_connection_limit'));
  }

  if (!skippedForConnectionLimit) {
    const liveSamples = sampleRows(liveStreams, LIVE_PROBE_SAMPLE, 'stream_id', 'name');
    for (const row of liveSamples) {
      const streamId = catalogItemId(row.stream_id);
      if (!streamId) continue;
      probes.push(
        await probeStream({
          credentials: safeCreds,
          kind: 'live',
          streamId,
          extension: normalizePlaybackExtension(String(row.container_extension ?? ''), 'ts'),
          directSource: typeof row.direct_source === 'string' ? row.direct_source : null,
          maxConnections: account?.maxConnections,
          activeConnections: account?.activeConnections,
          signal: options.signal,
        }),
      );
      await yieldMs(PROBE_YIELD_MS);
    }

    const movieSamples = sampleRows(vodStreams, MOVIE_PROBE_SAMPLE, 'stream_id', 'name');
    for (const row of movieSamples) {
      const streamId = catalogItemId(row.stream_id);
      if (!streamId) continue;
      probes.push(
        await probeStream({
          credentials: safeCreds,
          kind: 'movie',
          streamId,
          extension: normalizePlaybackExtension(String(row.container_extension ?? ''), 'mp4'),
          maxConnections: account?.maxConnections,
          activeConnections: account?.activeConnections,
          signal: options.signal,
        }),
      );
      await yieldMs(PROBE_YIELD_MS);
    }

    let episodeSamples: { id: string; extension: string }[] = [];
    try {
      const seriesSample = sampleRows(seriesList, 1, 'series_id', 'name')[0];
      const seriesId = catalogItemId(seriesSample?.series_id);
      if (seriesId) {
        const infoUrl = buildXtreamPlayerApiUrl(normalizedBase, safeCreds.username, safeCreds.password, 'get_series_info', {
          series_id: seriesId,
        });
        const { payload } = episodePayload
          ? { payload: episodePayload }
          : await fetchJsonObject(infoUrl, CATALOG_TIMEOUT_MS, options.signal);
        const seasons = payload.episodes && typeof payload.episodes === 'object' ? Object.values(payload.episodes as Record<string, unknown>) : [];
        const flat: CatalogRow[] = [];
        for (const season of seasons) {
          if (Array.isArray(season)) flat.push(...(season as CatalogRow[]));
        }
        episodeSamples = sampleRows(flat, EPISODE_PROBE_SAMPLE, 'id', 'title').map((row) => ({
          id: catalogItemId(row.id ?? row.stream_id) ?? '',
          extension: normalizePlaybackExtension(String(row.container_extension ?? ''), 'ts'),
        })).filter((row) => row.id);
      }
    } catch {
      episodeSamples = [];
    }

    for (const episode of episodeSamples) {
      probes.push(
        await probeStream({
          credentials: safeCreds,
          kind: 'episode',
          streamId: episode.id,
          extension: episode.extension,
          maxConnections: account?.maxConnections,
          activeConnections: account?.activeConnections,
          signal: options.signal,
        }),
      );
      await yieldMs(PROBE_YIELD_MS);
    }
  }

  const liveGroup = summarizeProbeGroup(probes.filter((item) => item.kind === 'live'));
  const movieGroup = summarizeProbeGroup(probes.filter((item) => item.kind === 'movie'));
  const episodeGroup = summarizeProbeGroup(probes.filter((item) => item.kind === 'episode'));
  const playback = aggregateStreamProbeCheck({
    probes,
    skippedForConnectionLimit,
    live: liveGroup,
    movies: movieGroup,
    episodes: episodeGroup,
  });
  checks.push(
    check('playback', 'Stream Probe', playback.verdict, playback.severity, playback.detail, {
      counts: {
        livePassed: liveGroup.passed,
        liveTotal: liveGroup.total,
        moviePassed: movieGroup.passed,
        movieTotal: movieGroup.total,
        episodePassed: episodeGroup.passed,
        episodeTotal: episodeGroup.total,
      },
    }),
  );

  try {
    const epgChannel = sampleRows(liveStreams, 1, 'stream_id', 'name')[0];
    const streamId = catalogItemId(epgChannel?.stream_id);
    if (!streamId) throw new Error('epg_unavailable');
    const epgUrl = buildXtreamPlayerApiUrl(normalizedBase, safeCreds.username, safeCreds.password, 'get_short_epg', {
      stream_id: streamId,
      limit: '6',
    });
    const { payload, latencyMs } = await fetchJsonObject(epgUrl, REACHABILITY_TIMEOUT_MS, options.signal);
    const listings = Array.isArray((payload as { epg_listings?: unknown[] }).epg_listings)
      ? (payload as { epg_listings: unknown[] }).epg_listings
      : [];
    if (listings.length === 0) {
      checks.push(check('epg', 'EPG', 'warn', 'noncritical', 'EPG endpoint responds but coverage appears limited.', { latencyMs }));
    } else {
      checks.push(check('epg', 'EPG', 'pass', 'noncritical', `EPG listings available (${listings.length} sampled).`, { latencyMs }));
    }
  } catch {
    checks.push(check('epg', 'EPG', 'warn', 'noncritical', 'EPG unavailable.'));
  }

  return finish(checks, notes, startedAt, account, catalogs, probes, options);
}

function terminalHealthSummary(startedAt: number, detail: string): ProviderHealthSummary {
  const checkDefinitions = [
    ['server', 'Server Reachable', 'critical'],
    ['authentication', 'Authentication', 'critical'],
    ['live-catalog', 'Live TV Catalog', 'critical'],
    ['movie-catalog', 'Movies', 'critical'],
    ['series-catalog', 'Series', 'noncritical'],
    ['compatibility', 'NovaCast Compatibility', 'critical'],
    ['playback', 'Stream Probe', 'noncritical'],
    ['epg', 'EPG', 'noncritical'],
  ] as const;
  return {
    overall: 'failed',
    overallLabel: 'Provider validation failed before checks completed.',
    testedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    checks: checkDefinitions.map(([id, label, severity]) => check(id, label, 'fail', severity, detail)),
    catalogs: {
      liveCategories: 0,
      liveChannels: 0,
      movieCategories: 0,
      movies: 0,
      seriesCategories: 0,
      series: 0,
      episodeLookupOk: false,
      countDetails: {
        liveChannels: { totalCount: null, inspectedCount: 0, exactCountAvailable: false, diagnosticTruncated: false, bytesRead: 0, complete: false, stopReason: 'timeout' },
        movies: { totalCount: null, inspectedCount: 0, exactCountAvailable: false, diagnosticTruncated: false, bytesRead: 0, complete: false, stopReason: 'timeout' },
        series: { totalCount: null, inspectedCount: 0, exactCountAvailable: false, diagnosticTruncated: false, bytesRead: 0, complete: false, stopReason: 'timeout' },
      },
      truncated: { liveChannels: false, movies: false, series: false },
    },
    probes: {
      live: { passed: 0, total: 0, averageMs: null },
      movies: { passed: 0, total: 0, averageMs: null },
      episodes: { passed: 0, total: 0, averageMs: null },
    },
    notes: [detail],
    decoderCaveat: STREAM_PROBE_CAVEAT,
  };
}

export async function runProviderHealthCheck(
  credentials: XtreamCredentials,
  options: { isGoldManaged?: boolean } = {},
): Promise<ProviderHealthSummary> {
  const startedAt = Date.now();
  const controller = new AbortController();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const watchdog = new Promise<ProviderHealthSummary>((resolve) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      resolve(terminalHealthSummary(startedAt, `Provider diagnostic timed out after ${PROVIDER_HEALTH_WATCHDOG_MS / 1000}s.`));
    }, PROVIDER_HEALTH_WATCHDOG_MS);
  });

  try {
    const result = await Promise.race([
      runProviderHealthCheckInternal(credentials, { ...options, signal: controller.signal }),
      watchdog,
    ]);
    return timedOut ? terminalHealthSummary(startedAt, `Provider diagnostic timed out after ${PROVIDER_HEALTH_WATCHDOG_MS / 1000}s.`) : result;
  } catch (error) {
    return terminalHealthSummary(
      startedAt,
      timedOut
        ? `Provider diagnostic timed out after ${PROVIDER_HEALTH_WATCHDOG_MS / 1000}s.`
        : `Provider diagnostic failed before checks completed. ${sanitizeFailureMessage(error, credentials.username, credentials.password)}`,
    );
  } finally {
    if (timer) clearTimeout(timer);
    controller.abort();
  }
}

function finish(
  checks: ProviderHealthCheck[],
  notes: string[],
  startedAt: number,
  account: ProviderHealthSummary['account'],
  catalogs: ProviderHealthSummary['catalogs'],
  probes: StreamProbeResult[],
  options: { isGoldManaged?: boolean } = {},
): ProviderHealthSummary {
  const live = summarizeProbeGroup(probes.filter((item) => item.kind === 'live'));
  const movies = summarizeProbeGroup(probes.filter((item) => item.kind === 'movie'));
  const episodes = summarizeProbeGroup(probes.filter((item) => item.kind === 'episode'));
  const cloudPlaybackProbeRestricted = isCloudPlaybackProbeRestricted({ checks, probes, catalogs });
  const playback = checks.find((check) => check.id === 'playback');
  if (cloudPlaybackProbeRestricted && playback) {
    playback.verdict = 'warn';
    playback.severity = 'noncritical';
    playback.detail = `Cloud playback probe restricted. ${playback.detail}`;
  }
  const classified = classifyOverallHealth(cloudPlaybackProbeRestricted ? checks.filter((check) => check.id !== 'playback') : checks);
  return {
    overall: classified.overall,
    overallLabel: classified.overallLabel,
    ...(cloudPlaybackProbeRestricted ? { cloudPlaybackProbeRestricted: true, cloudPlaybackProbeReason: 'cloud_playback_restricted' as const } : {}),
    testedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    checks,
    account,
    catalogs,
    probes: { live, movies, episodes },
    notes: [
      ...notes,
      ...classified.notes,
      ...probes.map((item) => formatStreamProbeDiagnostic(item)),
      STREAM_PROBE_CAVEAT,
    ],
    decoderCaveat: STREAM_PROBE_CAVEAT,
  };
}
