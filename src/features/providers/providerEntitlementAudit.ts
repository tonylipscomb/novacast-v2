import type { NativeCatalogRecord } from '../catalog/nativeCatalogDecodeTypes.ts';
import type { StreamXtreamCategoryDecodeInput } from '../catalog/nativeCatalogDecodeTypes.ts';
import type { StreamXtreamCategoryDecodeResult } from '../catalog/nativeCatalogDecodeTypes.ts';
import { inspectAccountOutputFormats } from './accountOutputFormats.ts';
import type { XtreamAccountResponse } from './xtreamClient.ts';
import { XTREAM_MAX_ITEMS_PER_RESPONSE } from './xtreamClient.ts';

export const PROVIDER_ENTITLEMENT_AUDIT_PROBE = '[NovaCast Provider Entitlement Audit]';

export const EXPECTED_MOVIE_COUNT = 182650;
export const EXPECTED_SERIES_COUNT = 41190;
export const EXPECTED_LIVE_COUNT = 48830;

const SECRET_KEY_PATTERN = /^(user(name)?|password|pass|token|secret|url|host|ip|portal|dns|auth_key)$/i;
const BOUQUET_KEY_PATTERN = /bouquet|package|pkg_|offer|reseller|group_id|member_group|allowed_categor/i;

export type XtreamAccountEntitlementSnapshot = {
  status: string | null;
  authPresent: boolean;
  isTrial: boolean | null;
  maxConnections: number | null;
  activeConnections: number | null;
  allowedOutputFormats: string[];
  userInfoKeys: string[];
  serverInfoKeys: string[];
  bouquetOrPackageKeys: string[];
  bouquetSegmentationDetected: boolean;
  serverInfoHostDiffersFromConfigured: boolean | null;
};

type StreamDecode = (options: StreamXtreamCategoryDecodeInput) => Promise<StreamXtreamCategoryDecodeResult>;

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function hostnameOf(value: string): string | null {
  try {
    return new URL(value).hostname.trim().toLowerCase() || null;
  } catch {
    return null;
  }
}

function withQuery(requestUrl: string, extra: Record<string, string>): string {
  const url = new URL(requestUrl);
  for (const [key, value] of Object.entries(extra)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

export function summarizeXtreamAccountEntitlements(
  response: XtreamAccountResponse | null | undefined,
  configuredBaseUrl?: string | null,
): XtreamAccountEntitlementSnapshot {
  const userInfo = (response?.user_info ?? {}) as Record<string, unknown>;
  const serverInfo = (response?.server_info ?? {}) as Record<string, unknown>;
  const userInfoKeys = Object.keys(userInfo).filter((key) => !SECRET_KEY_PATTERN.test(key) || BOUQUET_KEY_PATTERN.test(key));
  const serverInfoKeys = Object.keys(serverInfo).filter((key) => !SECRET_KEY_PATTERN.test(key));
  const bouquetOrPackageKeys = Object.keys(userInfo).filter((key) => BOUQUET_KEY_PATTERN.test(key));
  const formats = inspectAccountOutputFormats(response).allowedOutputFormats;
  const allowedOutputFormats = formats;

  let serverInfoHostDiffersFromConfigured: boolean | null = null;
  if (configuredBaseUrl && typeof serverInfo.url === 'string' && serverInfo.url.trim()) {
    const configuredHost = hostnameOf(configuredBaseUrl);
    const advertisedHost = hostnameOf(
      /^https?:\/\//i.test(serverInfo.url) ? serverInfo.url : `https://${serverInfo.url}`,
    );
    if (configuredHost && advertisedHost) {
      serverInfoHostDiffersFromConfigured = configuredHost !== advertisedHost;
    }
  }

  const auth = userInfo.auth;
  return {
    status: typeof userInfo.status === 'string' ? userInfo.status : null,
    authPresent: auth === 1 || auth === '1' || auth === true,
    isTrial:
      userInfo.is_trial === 1 || userInfo.is_trial === '1' || userInfo.is_trial === true
        ? true
        : userInfo.is_trial === 0 || userInfo.is_trial === '0' || userInfo.is_trial === false
          ? false
          : null,
    maxConnections: asFiniteNumber(userInfo.max_connections),
    activeConnections: asFiniteNumber(userInfo.active_cons),
    allowedOutputFormats,
    userInfoKeys,
    serverInfoKeys,
    bouquetOrPackageKeys,
    bouquetSegmentationDetected: bouquetOrPackageKeys.length > 0,
    serverInfoHostDiffersFromConfigured,
  };
}

async function sampleDumpIds(input: {
  requestUrl: string;
  mediaType: 'movie' | 'series';
  providerId: string;
  streamDecode: StreamDecode;
  isCancelled?: () => boolean;
  cap: number;
  catalogNetworkMediaType?: 'movie' | 'series' | 'live';
  catalogNetworkOperation?: string;
}): Promise<{ ids: string[]; hitCap: boolean; rawSeen: number | null }> {
  const ids: string[] = [];
  let hitCap = false;
  const result = await input.streamDecode({
    requestUrl: input.requestUrl,
    mediaType: input.mediaType,
    filterCategoryId: 'all',
    providerId: input.providerId,
    isCancelled: () => hitCap || Boolean(input.isCancelled?.()),
    catalogNetworkMediaType: input.catalogNetworkMediaType,
    catalogNetworkOperation: input.catalogNetworkOperation,
    onBatch: async (records: NativeCatalogRecord[]) => {
      for (const record of records) {
        const id = typeof record.contentId === 'string' ? record.contentId.trim() : '';
        if (id) {
          ids.push(id);
        }
        if (ids.length >= input.cap) {
          hitCap = true;
          break;
        }
      }
    },
  });
  return {
    ids,
    hitCap,
    rawSeen: typeof result.stats.rawSeen === 'number' ? result.stats.rawSeen : ids.length,
  };
}

export async function probeXtreamListPagination(input: {
  requestUrl: string;
  mediaType: 'movie' | 'series';
  providerId: string;
  streamDecode: StreamDecode;
  isCancelled?: () => boolean;
  catalogNetworkMediaType?: 'movie' | 'series' | 'live';
  catalogNetworkOperation?: string;
}): Promise<{
  paginationDetected: boolean;
  limitHonored: boolean | null;
  page2Disjoint: boolean | null;
  repeatSampleDiverged: boolean | null;
}> {
  const limitUrl = withQuery(input.requestUrl, { limit: '50' });
  const page1Url = withQuery(input.requestUrl, { page: '1', limit: '50' });
  const page2Url = withQuery(input.requestUrl, { page: '2', limit: '50' });

  const limited = await sampleDumpIds({ ...input, requestUrl: limitUrl, cap: 80 });
  const limitHonored = !limited.hitCap && limited.ids.length > 0 && limited.ids.length <= 50;

  let page2Disjoint: boolean | null = null;
  if (limitHonored) {
    const page1 = await sampleDumpIds({ ...input, requestUrl: page1Url, cap: 80 });
    const page2 = await sampleDumpIds({ ...input, requestUrl: page2Url, cap: 80 });
    if (page1.ids.length && page2.ids.length) {
      const page1Set = new Set(page1.ids);
      const overlap = page2.ids.filter((id) => page1Set.has(id)).length;
      page2Disjoint = overlap < Math.min(page1.ids.length, page2.ids.length) * 0.2;
    }
  }

  const first = await sampleDumpIds({ ...input, requestUrl: input.requestUrl, cap: 80 });
  const second = await sampleDumpIds({ ...input, requestUrl: input.requestUrl, cap: 80 });
  let repeatSampleDiverged: boolean | null = null;
  if (first.ids.length && second.ids.length) {
    const firstSet = new Set(first.ids);
    const overlap = second.ids.filter((id) => firstSet.has(id)).length;
    repeatSampleDiverged = overlap < Math.min(first.ids.length, second.ids.length) * 0.5;
  }

  return {
    paginationDetected: Boolean(limitHonored && page2Disjoint),
    limitHonored,
    page2Disjoint,
    repeatSampleDiverged,
  };
}

export function resolveProviderEntitlementLikelyCause(input: {
  movieGap: number;
  seriesGap: number;
  liveGap: number;
  paginationDetected: boolean;
  bouquetSegmentationDetected: boolean;
  alternateEndpointDetected: boolean;
  clusterSegmentationDetected: boolean;
  movieDumpCompleted: boolean;
  liveDumpMayBeClientCapped: boolean;
}): string {
  if (input.alternateEndpointDetected) {
    return 'alternate-catalog-endpoint-unused';
  }
  if (input.paginationDetected) {
    return 'api-pagination-not-consumed';
  }
  if (input.clusterSegmentationDetected) {
    return 'server-cluster-or-host-mismatch';
  }
  if (input.liveDumpMayBeClientCapped && input.liveGap > 0) {
    return input.movieDumpCompleted && input.movieGap > 1000
      ? 'player-api-package-subset-and-live-js-10k-cap'
      : 'novacast-live-js-boundList-10000';
  }
  if (input.bouquetSegmentationDetected && (input.movieGap > 1000 || input.seriesGap > 1000)) {
    return 'account-package-or-bouquet-subset';
  }
  if (input.movieDumpCompleted && input.movieGap > 1000 && input.seriesGap > 1000) {
    return 'player-api-returns-assigned-package-subset';
  }
  if (input.movieGap > 1000 || input.seriesGap > 1000 || input.liveGap > 1000) {
    return 'player-api-subset-smaller-than-panel-totals';
  }
  return 'api-totals-match-panel';
}

const entitlementAuditKeys = new Set<string>();

export function resetProviderEntitlementAuditLatchForTests() {
  entitlementAuditKeys.clear();
}

export function logProviderEntitlementAudit(fields: Record<string, unknown>) {
  console.info(PROVIDER_ENTITLEMENT_AUDIT_PROBE, JSON.stringify(fields));
}

export async function runProviderEntitlementAudit(input: {
  providerId: string;
  runToken: number;
  apiMovieDistinctCount: number | null;
  apiSeriesDistinctCount: number | null;
  apiLiveDistinctCount: number | null;
  movieDumpCompleted: boolean;
  liveDumpMayBeClientCapped: boolean;
  movieDumpUrl: string | null;
  seriesDumpUrl: string | null;
  liveDumpUrl: string | null;
  nativeAvailable: boolean;
  getAccountSnapshot?: () => Promise<XtreamAccountEntitlementSnapshot | null>;
  streamDecode: StreamDecode;
  isCancelled?: () => boolean;
}): Promise<void> {
  const latchKey = `${input.providerId}:${input.runToken}`;
  if (entitlementAuditKeys.has(latchKey)) {
    return;
  }
  entitlementAuditKeys.add(latchKey);

  const apiMovieDistinctCount = input.apiMovieDistinctCount ?? 0;
  const apiSeriesDistinctCount = input.apiSeriesDistinctCount ?? 0;
  const apiLiveDistinctCount = input.apiLiveDistinctCount ?? 0;
  const movieGap = EXPECTED_MOVIE_COUNT - apiMovieDistinctCount;
  const seriesGap = EXPECTED_SERIES_COUNT - apiSeriesDistinctCount;
  const liveGap = EXPECTED_LIVE_COUNT - apiLiveDistinctCount;

  let account: XtreamAccountEntitlementSnapshot | null = null;
  try {
    account = (await input.getAccountSnapshot?.()) ?? null;
  } catch {
    account = null;
  }

  let paginationDetected = false;
  let clusterSegmentationDetected = Boolean(account?.serverInfoHostDiffersFromConfigured);
  if (input.nativeAvailable && !input.isCancelled?.()) {
    const probes: Array<{
      url: string | null;
      mediaType: 'movie' | 'series';
      catalogNetworkMediaType: 'movie' | 'series' | 'live';
      catalogNetworkOperation: string;
    }> = [
      {
        url: input.movieDumpUrl,
        mediaType: 'movie',
        catalogNetworkMediaType: 'movie',
        catalogNetworkOperation: 'get_vod_streams',
      },
      {
        url: input.seriesDumpUrl,
        mediaType: 'series',
        catalogNetworkMediaType: 'series',
        catalogNetworkOperation: 'get_series',
      },
      {
        url: input.liveDumpUrl,
        mediaType: 'movie',
        catalogNetworkMediaType: 'live',
        catalogNetworkOperation: 'get_live_streams',
      },
    ];
    for (const probe of probes) {
      if (!probe.url || input.isCancelled?.()) {
        continue;
      }
      try {
        const result = await probeXtreamListPagination({
          requestUrl: probe.url,
          mediaType: probe.mediaType,
          providerId: input.providerId,
          streamDecode: input.streamDecode,
          isCancelled: input.isCancelled,
          catalogNetworkMediaType: probe.catalogNetworkMediaType,
          catalogNetworkOperation: probe.catalogNetworkOperation,
        });
        if (result.paginationDetected) {
          paginationDetected = true;
        }
        if (result.repeatSampleDiverged) {
          clusterSegmentationDetected = true;
        }
      } catch {
        // Diagnostic-only.
      }
    }
  }

  const bouquetSegmentationDetected = Boolean(account?.bouquetSegmentationDetected);
  const alternateEndpointDetected = false;
  const likelyCause = resolveProviderEntitlementLikelyCause({
    movieGap,
    seriesGap,
    liveGap,
    paginationDetected,
    bouquetSegmentationDetected,
    alternateEndpointDetected,
    clusterSegmentationDetected,
    movieDumpCompleted: input.movieDumpCompleted,
    liveDumpMayBeClientCapped: input.liveDumpMayBeClientCapped,
  });

  logProviderEntitlementAudit({
    providerId: input.providerId,
    expectedMovieCount: EXPECTED_MOVIE_COUNT,
    apiMovieDistinctCount: input.apiMovieDistinctCount,
    expectedSeriesCount: EXPECTED_SERIES_COUNT,
    apiSeriesDistinctCount: input.apiSeriesDistinctCount,
    expectedLiveCount: EXPECTED_LIVE_COUNT,
    apiLiveDistinctCount: input.apiLiveDistinctCount,
    movieGap,
    seriesGap,
    liveGap,
    paginationDetected,
    bouquetSegmentationDetected,
    alternateEndpointDetected,
    clusterSegmentationDetected,
    likelyCause,
    jsLiveListCap: XTREAM_MAX_ITEMS_PER_RESPONSE,
    jsVodResponseByteCap: 32 * 1024 * 1024,
    nativeDecodeHasItemCap: false,
    m3uCatalogEndpointUsed: false,
    accountStatus: account?.status ?? null,
    maxConnections: account?.maxConnections ?? null,
    activeConnections: account?.activeConnections ?? null,
    allowedOutputFormats: account?.allowedOutputFormats ?? [],
    userInfoKeys: account?.userInfoKeys ?? [],
    serverInfoKeys: account?.serverInfoKeys ?? [],
    bouquetOrPackageKeys: account?.bouquetOrPackageKeys ?? [],
  });
}
