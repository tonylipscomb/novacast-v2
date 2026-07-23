import type { ProviderCredentialRecord } from './providerModel.ts';

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
};

const MAX_XTREAM_RESPONSE_BYTES = 32 * 1024 * 1024;
/** Safety cap for live/channel list responses only — not applied to VOD/series category catalogs. */
export const XTREAM_MAX_ITEMS_PER_RESPONSE = 10_000;

function boundList<T>(value: T[] | null | undefined) {
  return Array.isArray(value) ? value.slice(0, XTREAM_MAX_ITEMS_PER_RESPONSE) : [];
}

function mediaList<T>(value: T[] | null | undefined) {
  return Array.isArray(value) ? value : [];
}

function normalizeBaseUrl(baseUrl: string) {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  return `https://${trimmed}`;
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

function normalizeOutputFormats(value: XtreamUserInfo['allowed_output_formats']) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item)).filter(Boolean);
  }

  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

function resolvePreferredOutputFormat(userInfo: XtreamUserInfo) {
  const outputs = normalizeOutputFormats(userInfo.allowed_output_formats);
  if (outputs.includes('m3u8')) {
    return 'm3u8';
  }
  if (outputs.includes('ts')) {
    return 'ts';
  }
  return outputs[0] ?? 'ts';
}

async function parseJsonResponse<T>(response: Response) {
  const contentLength = Number(response.headers.get('content-length') ?? 0);
  if (contentLength > MAX_XTREAM_RESPONSE_BYTES) {
    throw new Error('Xtream provider response is too large to process safely.');
  }

  const text = await response.text();
  if (text.length > MAX_XTREAM_RESPONSE_BYTES) {
    throw new Error('Xtream provider response is too large to process safely.');
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error('Xtream provider returned a non-JSON response.');
  }
}

export class XtreamClient {
  readonly baseUrl: string;
  readonly username: string;
  readonly password: string;
  readonly fetchImpl: typeof fetch;
  readonly timeoutMs: number;

  constructor(connection: ProviderCredentialRecord, options: XtreamClientOptions = {}) {
    this.baseUrl = normalizeBaseUrl(connection.baseUrl);
    this.username = connection.username;
    this.password = connection.password;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 10000;
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

  private async request<T>(url: URL, init: XtreamRequestInit = {}) {
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
      const response = await this.fetchImpl(url, {
        ...init,
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Xtream request failed with status ${response.status}.`);
      }

      return parseJsonResponse<T>(response);
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
    return boundList(await this.request<XtreamCategoryResponse[]>(this.buildUrl('get_vod_categories'), { signal }));
  }

  async getVodStreams(categoryId?: string | number, signal?: AbortSignal) {
    return mediaList(
      await this.request<XtreamVodStreamResponse[]>(
        this.buildUrl('get_vod_streams', categoryId ? { category_id: categoryId } : {}),
        { signal },
      ),
    );
  }

  async getVodInfo(vodId: string | number, signal?: AbortSignal) {
    return this.request<XtreamVodInfoResponse>(
      this.buildUrl('get_vod_info', { vod_id: vodId }),
      { signal },
    );
  }

  async getSeriesCategories(signal?: AbortSignal) {
    return boundList(await this.request<XtreamCategoryResponse[]>(this.buildUrl('get_series_categories'), { signal }));
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
    return this.request<XtreamSeriesInfoResponse>(
      this.buildUrl('get_series_info', { series_id: seriesId }),
      { signal },
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

  buildLiveStreamUrl(streamId: string | number, extension?: string) {
    const resolvedExtension = extension ?? 'ts';
    return `${this.baseUrl}/live/${encodeURIComponent(this.username)}/${encodeURIComponent(this.password)}/${streamId}.${resolvedExtension}`;
  }

  buildVodStreamUrl(streamId: string | number, extension?: string) {
    const resolvedExtension = extension ?? 'mp4';
    return `${this.baseUrl}/movie/${encodeURIComponent(this.username)}/${encodeURIComponent(this.password)}/${streamId}.${resolvedExtension}`;
  }

  buildSeriesStreamUrl(streamId: string | number, extension?: string) {
    const resolvedExtension = extension ?? 'ts';
    return `${this.baseUrl}/series/${encodeURIComponent(this.username)}/${encodeURIComponent(this.password)}/${streamId}.${resolvedExtension}`;
  }
}

export function normalizeXtreamAccountMetadata(response: XtreamAccountResponse | null | undefined) {
  const userInfo = response?.user_info ?? {};
  const expiresAt = toEpochMilliseconds(userInfo.exp_date);
  const createdAt = toEpochMilliseconds(userInfo.created_at);

  return {
    status: toStringOrNull(userInfo.status)?.trim().toLowerCase(),
    expiresAt,
    createdAt,
    updatedAt: Date.now(),
    preferredOutputFormat: resolvePreferredOutputFormat(userInfo),
  };
}
