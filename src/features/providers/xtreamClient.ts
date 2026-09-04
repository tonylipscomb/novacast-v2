import type { ProviderCredentialRecord } from './providerModel.ts';
import { normalizePlaybackExtension } from './playbackSourceDiagnostics.ts';
import {
  coerceOutputFormatList,
  extractXtreamUserInfoRecord,
  inspectAccountOutputFormats,
  logAccountOutputFormatPropagation,
} from './accountOutputFormats.ts';
import { markCatalogAuditHttp, getActiveVodCategoryPhaseProfile, addVodCategoryPhaseMs } from '../diagnostics/novaCastCatalogAudit.ts';
import { isNovaCastTraceLoggingEnabled } from '../diagnostics/novacastLogPolicy.ts';
import {
  classifyNonJsonBody,
  classifyXtreamHttpStatus,
  createXtreamFailureError,
  retryXtreamCategoryFetch,
} from './xtreamTransientRetry.ts';

export type XtreamUserInfo = {
  username?: string;
  password?: string;
  status?: string;
  exp_date?: string | number | null;
  created_at?: string | number | null;
  is_trial?: string | number | boolean | null;
  active_cons?: string | number | null;
  max_connections?: string | number | null;
  allowed_output_formats?: string[] | string | null;
  [key: string]: unknown;
};

export type XtreamServerInfo = {
  url?: string;
  port?: string | number | null;
  https_port?: string | number | null;
  server_protocol?: string;
  rtmp_port?: string | number | null;
  timezone?: string;
  timestamp_now?: string | number | null;
  time_now?: string;
  [key: string]: unknown;
};

export type XtreamAccountResponse = {
  user_info?: XtreamUserInfo;
  server_info?: XtreamServerInfo;
  [key: string]: unknown;
};

export type XtreamCategoryResponse = {
  category_id?: string | number | null;
  category_name?: unknown;
  parent_id?: string | number | null;
  [key: string]: unknown;
};

export type XtreamLiveStreamResponse = {
  num?: number | string;
  name?: string;
  stream_id?: number | string;
  category_id?: string;
  stream_icon?: string;
  epg_channel_id?: string;
  added?: string;
  custom_sid?: string;
  tv_archive?: number | string;
  tv_archive_duration?: number | string;
  stream_type?: string;
  direct_source?: string;
  container_extension?: string;
  [key: string]: unknown;
};

export type XtreamVodStreamResponse = {
  num?: number | string;
  name?: string;
  stream_id?: number | string;
  category_id?: string;
  stream_icon?: string;
  cover?: string;
  movie_image?: string;
  poster?: string;
  added?: string;
  releasedate?: string;
  last_modified?: string | number;
  popularity?: string | number;
  rating?: string | number;
  container_extension?: string;
  [key: string]: unknown;
};

export type XtreamVodInfoResponse = {
  info?: Record<string, unknown>;
  movie_data?: Record<string, unknown>;
  [key: string]: unknown;
};

export type XtreamSeriesResponse = {
  series_id?: number | string;
  name?: string;
  category_id?: string;
  cover?: string;
  plot?: string;
  rating?: string | number;
  releasedate?: string;
  added?: string;
  last_modified?: string | number;
  popularity?: string | number;
  [key: string]: unknown;
};

export type XtreamSeriesInfoResponse = {
  episodes?: Record<string, Record<string, XtreamSeriesEpisodeResponse>>;
  seasons?: Record<string, unknown>[];
  info?: Record<string, unknown>;
  [key: string]: unknown;
};

export type XtreamSeriesEpisodeResponse = {
  id?: string | number;
  title?: string;
  container_extension?: string;
  episode_num?: string | number;
  season?: string | number;
  plot?: string;
  duration?: string | number;
  stream_id?: string | number;
  releasedate?: string;
  [key: string]: unknown;
};

export type XtreamShortEpgResponse = {
  epg_listings?: {
    id?: string | number;
    title?: string;
    description?: string;
    start?: string | number;
    end?: string | number;
    start_timestamp?: string | number;
    stop_timestamp?: string | number;
    has_archive?: number | string;
    now_playing?: number | string;
    [key: string]: unknown;
  }[];
  [key: string]: unknown;
};

export type XtreamRequestInit = Omit<RequestInit, 'body'> & {
  signal?: AbortSignal;
};

export type XtreamClientOptions = {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  providerId?: string;
};

const MAX_XTREAM_RESPONSE_BYTES = 32 * 1024 * 1024;
/** Safety cap for live/channel list responses only â€” not applied to VOD/series category catalogs. */
export const XTREAM_MAX_ITEMS_PER_RESPONSE = 10_000;

function boundList<T>(value: T[] | null | undefined) {
  return Array.isArray(value) ? value.slice(0, XTREAM_MAX_ITEMS_PER_RESPONSE) : [];
}

function mediaList<T>(value: T[] | null | undefined) {
  return Array.isArray(value) ? value : [];
}

function normalizeBaseUrl(baseUrl: string) {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  const withoutApiFile = trimmed.replace(/\/(?:player|panel)_api\.php$/i, '');
  if (/^https?:\/\//i.test(withoutApiFile)) {
    return withoutApiFile;
  }

  return `https://${withoutApiFile}`;
}

function toSearchParamValue(value: string | number | boolean | null | undefined) {
  if (value === null || value === undefined) {
    return null;
  }

  return String(value);
}

function toNumberOrNull(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return undefined;
}

function toEpochMilliseconds(value: unknown) {
  const timestamp = toNumberOrNull(value);
  if (timestamp === null || timestamp === undefined || timestamp <= 0) {
    return null;
  }

  return timestamp < 100000000000 ? timestamp * 1000 : timestamp;
}

function toStringOrNull(value: unknown) {
  if (typeof value === 'string' && value.trim()) {
    return value;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  return undefined;
}

export function normalizeOutputFormats(value: unknown) {
  return coerceOutputFormatList(value);
}

export function resolvePreferredOutputFormat(userInfo: XtreamUserInfo | Record<string, unknown>) {
  const inspection = inspectAccountOutputFormats({ user_info: userInfo });
  return inspection.preferredOutputFormat ?? undefined;
}

type XtreamResponseAudit = (payload: {
  stage: 'http-response' | 'json-parsed';
  response: Response;
  bodyLength?: number;
  parsed?: unknown;
}) => void;

async function parseJsonResponse<T>(response: Response, audit?: XtreamResponseAudit) {
  const contentType = response.headers.get('content-type');
  const contentLengthHeader = Number(response.headers.get('content-length') ?? 0);
  if (contentLengthHeader > MAX_XTREAM_RESPONSE_BYTES) {
    throw createXtreamFailureError('Xtream provider response is too large to process safely.', {
      classification: 'response_too_large',
      httpStatus: response.status,
      contentType,
      contentLength: contentLengthHeader,
      errorReason: 'response_too_large',
    });
  }

  const bodyStarted = Date.now();
  const text = await response.text();
  const bodyDownloadMs = Date.now() - bodyStarted;
  const profile = getActiveVodCategoryPhaseProfile();
  if (profile) {
    addVodCategoryPhaseMs('bodyDownloadMs', bodyDownloadMs);
    profile.responseBytes = text.length;
  }

  if (text.length > MAX_XTREAM_RESPONSE_BYTES) {
    throw createXtreamFailureError('Xtream provider response is too large to process safely.', {
      classification: 'response_too_large',
      httpStatus: response.status,
      contentType,
      contentLength: text.length,
      errorReason: 'response_too_large',
    });
  }

  const parseStarted = Date.now();
  if (!text.trim()) {
    throw createXtreamFailureError('Xtream provider returned a non-JSON response.', {
      classification: 'empty_body',
      httpStatus: response.status,
      contentType,
      contentLength: text.length,
      errorReason: 'empty_body',
    });
  }
  try {
    const parsed = JSON.parse(text) as T;
    audit?.({ stage: 'json-parsed', response, bodyLength: text.length, parsed });
    const jsonParseMs = Date.now() - parseStarted;
    if (profile) {
      addVodCategoryPhaseMs('jsonParseMs', jsonParseMs);
    }
    return parsed;
  } catch {
    if (profile) {
      addVodCategoryPhaseMs('jsonParseMs', Date.now() - parseStarted);
    }
    const classification = classifyNonJsonBody(text);
    throw createXtreamFailureError('Xtream provider returned a non-JSON response.', {
      classification,
      httpStatus: response.status,
      contentType,
      contentLength: text.length,
      errorReason: classification,
    });
  }
}

export class XtreamClient {
  readonly baseUrl: string;
  readonly username: string;
  readonly password: string;
  readonly fetchImpl: typeof fetch;
  readonly timeoutMs: number;
  readonly providerId: string | null;

  constructor(connection: ProviderCredentialRecord, options: XtreamClientOptions = {}) {
    this.baseUrl = normalizeBaseUrl(connection.baseUrl);
    this.username = connection.username;
    this.password = connection.password;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 10000;
    this.providerId = options.providerId ?? null;
  }

  private buildUrl(action?: string, query: Record<string, string | number | boolean | null | undefined> = {}) {
    const url = new URL('/player_api.php', this.baseUrl);
    url.searchParams.set('username', this.username);
    url.searchParams.set('password', this.password);

    if (action) {
      url.searchParams.set('action', action);
    }

    for (const [key, value] of Object.entries(query)) {
      const next = toSearchParamValue(value);
      if (next !== null) {
        url.searchParams.set(key, next);
      }
    }

    return url;
  }

  /** Absolute player_api URL for catalog native decode. Callers must never log this value. */
  buildPlayerApiUrl(
    action?: string,
    query: Record<string, string | number | boolean | null | undefined> = {},
  ) {
    return this.buildUrl(action, query).toString();
  }

  private async request<T>(url: URL, init: XtreamRequestInit = {}, audit?: XtreamResponseAudit) {
    const action = url.searchParams.get('action') ?? 'account';
    const startedAt = Date.now();
    markCatalogAuditHttp('start', { action });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    if (init.signal) {
      if (init.signal.aborted) {
        controller.abort();
      } else {
        init.signal.addEventListener('abort', () => controller.abort(), { once: true });
      }
    }

    try {
      const fetchStarted = Date.now();
      const response = await this.fetchImpl(url, {
        ...init,
        signal: controller.signal,
      });
      audit?.({ stage: 'http-response', response });
      const fetchHeadersMs = Date.now() - fetchStarted;
      const profile = getActiveVodCategoryPhaseProfile();
      if (profile && action === 'get_vod_streams') {
        addVodCategoryPhaseMs('fetchHeadersMs', fetchHeadersMs);
      }

      if (!response.ok) {
        throw createXtreamFailureError(`Xtream request failed with status ${response.status}.`, {
          classification: classifyXtreamHttpStatus(response.status),
          httpStatus: response.status,
          contentType: response.headers.get('content-type'),
          contentLength: Number(response.headers.get('content-length') ?? 0) || null,
          errorReason: `http_${response.status}`,
        });
      }

      const payload = await parseJsonResponse<T>(response, audit);
      const httpWallMs = Date.now() - startedAt;
      if (profile && action === 'get_vod_streams') {
        profile.httpWallMs = httpWallMs;
      }
      markCatalogAuditHttp('end', {
        action,
        ok: true,
        durationMs: httpWallMs,
        fetchHeadersMs,
        responseBytes: profile?.responseBytes,
      });
      return payload;
    } catch (error) {
      markCatalogAuditHttp('end', {
        action,
        ok: false,
        durationMs: Date.now() - startedAt,
        error: true,
      });
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async getAccountInfo(signal?: AbortSignal) {
    return this.request<XtreamAccountResponse>(this.buildUrl(undefined), { signal });
  }

  async getLiveCategories(signal?: AbortSignal) {
    return boundList(await this.request<XtreamCategoryResponse[]>(this.buildUrl('get_live_categories'), { signal }));
  }

  async getLiveStreams(categoryId?: string | number, signal?: AbortSignal) {
    return boundList(
      await this.request<XtreamLiveStreamResponse[]>(
        this.buildUrl('get_live_streams', categoryId ? { category_id: categoryId } : {}),
        { signal },
      ),
    );
  }

  async getVodCategories(signal?: AbortSignal) {
    return boundList(
      await retryXtreamCategoryFetch({
        providerId: this.providerId,
        mediaType: 'movie',
        work: () => this.request<XtreamCategoryResponse[]>(this.buildUrl('get_vod_categories'), { signal }),
      }),
    );
  }

  async getVodStreams(categoryId?: string | number, signal?: AbortSignal) {
    const raw = await this.request<XtreamVodStreamResponse[]>(
      this.buildUrl('get_vod_streams', categoryId ? { category_id: categoryId } : {}),
      { signal },
    );
    const boundStarted = Date.now();
    const bounded = mediaList(raw);
    const profile = getActiveVodCategoryPhaseProfile();
    if (profile) {
      addVodCategoryPhaseMs('mediaListBoundMs', Date.now() - boundStarted);
      profile.rawStreamCount = Array.isArray(raw) ? raw.length : 0;
    }
    return bounded;
  }

  async getVodInfo(vodId: string | number, signal?: AbortSignal) {
    return this.request<XtreamVodInfoResponse>(
      this.buildUrl('get_vod_info', { vod_id: vodId }),
      { signal },
    );
  }

  async getSeriesCategories(signal?: AbortSignal) {
    return boundList(
      await retryXtreamCategoryFetch({
        providerId: this.providerId,
        mediaType: 'series',
        work: () => this.request<XtreamCategoryResponse[]>(this.buildUrl('get_series_categories'), { signal }),
      }),
    );
  }

  async getSeries(categoryId?: string | number, signal?: AbortSignal) {
    return mediaList(
      await this.request<XtreamSeriesResponse[]>(
        this.buildUrl('get_series', categoryId ? { category_id: categoryId } : {}),
        { signal },
      ),
    );
  }

  async getSeriesInfo(seriesId: string | number, signal?: AbortSignal) {
    const audit: XtreamResponseAudit = ({ stage, response, bodyLength, parsed }) => {
      if (!isNovaCastTraceLoggingEnabled()) {
        return;
      }
      console.info('[NovaCast Series Compatibility Audit]', {
        event: stage,
        action: 'get_series_info',
        idFieldName: 'series_id',
        providerSeriesIdPresent: Boolean(String(seriesId).trim()),
        httpStatus: response.status,
        contentType: response.headers.get('content-type'),
        rawBodyKind: stage === 'http-response' ? 'pending' : parsed === null ? 'null' : 'json',
        rawTopLevelType: stage === 'http-response' ? null : parsed === null ? 'null' : Array.isArray(parsed) ? 'array' : typeof parsed,
        rawTopLevelKeys: parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? Object.keys(parsed) : [],
        bodyLength: bodyLength ?? null,
        parsedNull: parsed === null,
        timestamp: Date.now(),
      });
    };
    return this.request<XtreamSeriesInfoResponse>(
      this.buildUrl('get_series_info', { series_id: seriesId }),
      { signal },
      audit,
    );
  }

  async getShortEpg(streamId: string | number, limit?: number, signal?: AbortSignal) {
    return this.request<XtreamShortEpgResponse>(
      this.buildUrl('get_short_epg', {
        stream_id: streamId,
        limit: limit ?? undefined,
      }),
      { signal },
    );
  }

  // NOVACAST_GUIDE_V2_3_XMLTV_LOCAL_EPG_V1
  // Bulk XMLTV source for local Guide EPG. Never log the returned URL.
  buildXmltvUrl() {
    return `${this.baseUrl}/xmltv.php?username=${encodeURIComponent(this.username)}&password=${encodeURIComponent(this.password)}`;
  }

  async getXmltvText(signal?: AbortSignal): Promise<string> {
    const response = await fetch(this.buildXmltvUrl(), { signal });

    if (!response.ok) {
      throw new Error(`XMLTV request failed (${response.status})`);
    }

    return response.text();
  }

  // NOVACAST_GUIDE_V2_3C_STREAMING_XMLTV_V1
  // Guide XMLTV uses the response body stream instead of response.text()
  // so large provider guides are never materialized as one giant JS string.
  async getXmltvResponse(signal?: AbortSignal) {
    const response = await fetch(this.buildXmltvUrl(), { signal });

    if (!response.ok) {
      throw new Error(`XMLTV request failed (${response.status})`);
    }

    return response;
  }

  // NOVACAST_GUIDE_V2_3B_LOCAL_GUIDE_READ_V1
  // Stable provider-account cache key without persisting the plaintext username/password.
  getXmltvCacheKey() {
    const input = `${this.baseUrl}|${this.username}`;
    let hash = 2166136261;

    for (let index = 0; index < input.length; index += 1) {
      hash ^= input.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }

    return `xtream:${this.baseUrl}:${(hash >>> 0).toString(16)}`;
  }
  buildLiveStreamUrl(streamId: string | number, extension?: string) {
    const id = encodeURIComponent(String(streamId).trim());
    const user = encodeURIComponent(this.username);
    const pass = encodeURIComponent(this.password);
    if (extension === '') {
      return `${this.baseUrl}/live/${user}/${pass}/${id}`;
    }
    const resolvedExtension = normalizePlaybackExtension(extension, 'ts');
    return `${this.baseUrl}/live/${user}/${pass}/${id}.${resolvedExtension}`;
  }

  buildVodStreamUrl(streamId: string | number, extension?: string) {
    const resolvedExtension = normalizePlaybackExtension(extension, 'mp4');
    return `${this.baseUrl}/movie/${encodeURIComponent(this.username)}/${encodeURIComponent(this.password)}/${encodeURIComponent(String(streamId).trim())}.${resolvedExtension}`;
  }

  buildSeriesStreamUrl(streamId: string | number, extension?: string) {
    const resolvedExtension = normalizePlaybackExtension(extension, 'ts');
    return `${this.baseUrl}/series/${encodeURIComponent(this.username)}/${encodeURIComponent(this.password)}/${encodeURIComponent(String(streamId).trim())}.${resolvedExtension}`;
  }
}

export function normalizeXtreamAccountMetadata(response: XtreamAccountResponse | null | undefined) {
  const userInfo = extractXtreamUserInfoRecord(response);
  const expiresAt = toEpochMilliseconds(userInfo.exp_date);
  const createdAt = toEpochMilliseconds(userInfo.created_at);
  const inspection = inspectAccountOutputFormats(response);

  logAccountOutputFormatPropagation({
    stage: 'account-response',
    userInfoPresent: inspection.userInfoPresent,
    outputFormatKeyPresent: inspection.outputFormatKeyPresent,
    outputFormatValueKind: inspection.outputFormatValueKind,
    allowedOutputFormats: inspection.allowedOutputFormats,
    preferredOutputFormat: inspection.preferredOutputFormat,
  });

  const normalized = {
    status: toStringOrNull(userInfo.status)?.trim().toLowerCase(),
    expiresAt,
    createdAt,
    updatedAt: Date.now(),
    preferredOutputFormat: inspection.preferredOutputFormat,
    allowedOutputFormats: inspection.allowedOutputFormats,
  };

  logAccountOutputFormatPropagation({
    stage: 'normalized',
    userInfoPresent: inspection.userInfoPresent,
    outputFormatKeyPresent: inspection.outputFormatKeyPresent,
    outputFormatValueKind: inspection.outputFormatValueKind,
    allowedOutputFormats: normalized.allowedOutputFormats,
    preferredOutputFormat: normalized.preferredOutputFormat,
  });

  return normalized;
}

