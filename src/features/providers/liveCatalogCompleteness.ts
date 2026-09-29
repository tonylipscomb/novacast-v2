import { normalizeStreamCategoryId } from '../catalog/vodCategoryFilterCapability.ts';
import type { NativeCatalogRecord } from '../catalog/nativeCatalogDecodeTypes.ts';
import type { StreamXtreamCategoryDecodeResult } from '../catalog/nativeCatalogDecodeTypes.ts';
import { retrySeriesCategoryDecode } from './seriesCategoryDecodeRetry.ts';
import { canonicalLiveStreamId } from './liveCatalogCompletion.ts';
import { claimLiveUnfilteredDump, resetLiveDecodeOwnershipForTests, type LiveDecodeCaller } from './liveDecodeOwnership.ts';
import { resetProviderCatalogNetworkGateForTests, withProviderCatalogNetworkGate } from './providerCatalogNetworkGate.ts';
import { XTREAM_MAX_ITEMS_PER_RESPONSE } from './xtreamClient.ts';
import { logSampledLiveStreamHint } from './liveStreamRowDiagnostics.ts';

export const LIVE_COMPLETENESS_PROBE = '[NovaCast Live Completeness Probe]';

let lastLiveDumpDistinctCount: number | null = null;
let lastLiveDumpUsedNative = false;

export function getLastLiveCompletenessDumpStats() {
  return {
    distinctLiveStreamIds: lastLiveDumpDistinctCount,
    usedNativeDump: lastLiveDumpUsedNative,
  };
}

export type LiveIdSetComparison = {
  overlapCount: number;
  liveOnlyInFullDump: number;
  liveOnlyInCategoryCrawl: number;
};

export function compareLiveCatalogIdSets(
  categoryCrawlIds: Iterable<string>,
  fullDumpIds: Iterable<string>,
): LiveIdSetComparison {
  const crawl = categoryCrawlIds instanceof Set ? categoryCrawlIds : new Set(
    Array.from(categoryCrawlIds).filter(Boolean),
  );
  const dump = fullDumpIds instanceof Set ? fullDumpIds : new Set(Array.from(fullDumpIds).filter(Boolean));
  let overlapCount = 0;
  let liveOnlyInFullDump = 0;
  for (const id of dump) {
    if (crawl.has(id)) {
      overlapCount += 1;
    } else {
      liveOnlyInFullDump += 1;
    }
  }
  let liveOnlyInCategoryCrawl = 0;
  for (const id of crawl) {
    if (!dump.has(id)) {
      liveOnlyInCategoryCrawl += 1;
    }
  }
  return { overlapCount, liveOnlyInFullDump, liveOnlyInCategoryCrawl };
}

export function countLiveCategoryIdsMissingFromMetadata(
  metadataCategoryIds: Iterable<string>,
  streamCategoryIds: Iterable<string>,
): number {
  const known = new Set(
    Array.from(metadataCategoryIds)
      .map((id) => String(id).trim())
      .filter(Boolean),
  );
  let missing = 0;
  for (const raw of streamCategoryIds) {
    const id = String(raw).trim();
    if (id && !known.has(id)) {
      missing += 1;
    }
  }
  return missing;
}

export function resolveLiveCompletionConfidence(input: {
  dumpAvailable: boolean;
  dumpFailed: boolean;
  dumpMayBeClientCapped: boolean;
  metadataCategoryCount: number;
  distinctStreamCategoryIds: number;
  categoryCrawlDistinctCount: number;
  fullDumpDistinctCount: number;
  liveOnlyInFullDump: number;
  overlapCount: number;
}): string {
  if (!input.dumpAvailable) {
    return input.dumpFailed ? 'dump-failed' : 'dump-unavailable';
  }
  if (input.fullDumpDistinctCount <= 0) {
    return 'dump-empty';
  }
  if (input.dumpMayBeClientCapped) {
    return 'dump-may-be-client-capped';
  }
  if (
    input.distinctStreamCategoryIds > 0 &&
    input.metadataCategoryCount > 0 &&
    input.distinctStreamCategoryIds >= Math.max(input.metadataCategoryCount * 2, input.metadataCategoryCount + 8)
  ) {
    return 'metadata-categories-incomplete';
  }
  if (input.categoryCrawlDistinctCount <= 0) {
    return 'category-probes-only';
  }
  const dump = input.fullDumpDistinctCount;
  if (input.liveOnlyInFullDump >= Math.max(1, Math.floor(dump * 0.1))) {
    return 'category-crawl-incomplete';
  }
  return 'inconclusive';
}

export function resolveLiveExclusionReason(input: {
  visibleLiveCount: number;
  fullDumpDistinctCount: number;
  usedNativeDump: boolean;
  dumpMayBeClientCapped: boolean;
  streamCategoryIdsMissingFromMetadata: number;
}): string | null {
  const difference = input.fullDumpDistinctCount - input.visibleLiveCount;
  if (difference <= 0) {
    return null;
  }
  if (!input.usedNativeDump || input.dumpMayBeClientCapped) {
    return 'js-getLiveStreams-boundList-10000';
  }
  if (input.visibleLiveCount >= XTREAM_MAX_ITEMS_PER_RESPONSE) {
    return 'visible-all-channels-uses-js-boundList-10000';
  }
  if (input.streamCategoryIdsMissingFromMetadata > 0) {
    return 'live-category-metadata-incomplete';
  }
  return 'visible-count-below-unfiltered-dump';
}

export function logLiveCompletenessProbe(fields: Record<string, unknown>) {
  console.info(
    LIVE_COMPLETENESS_PROBE,
    JSON.stringify({
      mediaType: 'live',
      ...fields,
    }),
  );
}

export function emitLiveCompletenessFromAuthoritativeDump(input: {
  providerId: string;
  rawLiveCount: number;
  decodedLiveCount: number;
  distinctLiveStreamIds: number;
  duplicateLiveStreamCount: number;
  metadataCategoryCount: number;
  distinctStreamCategoryIds: number;
  missingCategoryIdCount: number;
  streamCategoryIdsMissingFromMetadata: number;
  visibleLiveCount: number;
  usedNativeDump: boolean;
  publishedLiveCount: number | null;
}) {
  lastLiveDumpDistinctCount = input.distinctLiveStreamIds;
  lastLiveDumpUsedNative = input.usedNativeDump;
  const dumpMayBeClientCapped = !input.usedNativeDump;
  logLiveCompletenessProbe({
    providerId: input.providerId,
    rawLiveCount: input.rawLiveCount,
    decodedLiveCount: input.decodedLiveCount,
    distinctLiveStreamIds: input.distinctLiveStreamIds,
    duplicateLiveStreamCount: input.duplicateLiveStreamCount,
    metadataCategoryCount: input.metadataCategoryCount,
    distinctStreamCategoryIds: input.distinctStreamCategoryIds,
    missingCategoryIdCount: input.missingCategoryIdCount,
    streamCategoryIdsMissingFromMetadata: input.streamCategoryIdsMissingFromMetadata,
    categoryCrawlRawCount: 0,
    categoryCrawlDistinctCount: 0,
    crawlScope: 'authoritative-live-worker',
    liveOnlyInFullDump: input.distinctLiveStreamIds,
    liveOnlyInCategoryCrawl: 0,
    overlapCount: 0,
    filteringReliable: false,
    filterReason: 'derived-from-live-worker-dump',
    completionConfidence: resolveLiveCompletionConfidence({
      dumpAvailable: true,
      dumpFailed: false,
      dumpMayBeClientCapped,
      metadataCategoryCount: input.metadataCategoryCount,
      distinctStreamCategoryIds: input.distinctStreamCategoryIds,
      categoryCrawlDistinctCount: 0,
      fullDumpDistinctCount: input.distinctLiveStreamIds,
      liveOnlyInFullDump: input.distinctLiveStreamIds,
      overlapCount: 0,
    }),
    visibleLiveCount: input.visibleLiveCount,
    jsLiveListCap: XTREAM_MAX_ITEMS_PER_RESPONSE,
    usedNativeDump: input.usedNativeDump,
    dumpMayBeClientCapped,
    differenceFromVisible: input.distinctLiveStreamIds - input.visibleLiveCount,
    exclusionReason: resolveLiveExclusionReason({
      visibleLiveCount: input.visibleLiveCount,
      fullDumpDistinctCount: input.distinctLiveStreamIds,
      usedNativeDump: input.usedNativeDump,
      dumpMayBeClientCapped,
      streamCategoryIdsMissingFromMetadata: input.streamCategoryIdsMissingFromMetadata,
    }),
    publishedLiveCount: input.publishedLiveCount,
    liveCatalogActionsUsed: ['get_live_streams'],
    source: 'runLiveCatalogSync',
  });
}

export async function decodeUnfilteredLiveDump(input: {
  providerId: string;
  requestUrl: string;
  caller?: LiveDecodeCaller;
  runId?: string | null;
  isCancelled?: () => boolean;
  streamDecode: (options: {
    requestUrl: string;
    mediaType: 'movie';
    filterCategoryId: string;
    providerId: string;
    isCancelled?: () => boolean;
    skipCatalogNetworkGate?: boolean;
    catalogNetworkMediaType?: 'movie' | 'series' | 'live';
    catalogNetworkOperation?: string;
    runId?: string | null;
    onBatch: (records: NativeCatalogRecord[]) => Promise<void>;
  }) => Promise<StreamXtreamCategoryDecodeResult>;
}): Promise<{
  rawCount: number;
  decodedCount: number;
  missingCategoryIdCount: number;
  distinctIds: Set<string>;
  distinctCategoryIds: Set<string>;
  usedNative: boolean;
}> {
  return withProviderCatalogNetworkGate(
    input.providerId,
    'live',
    'get_live_streams',
    async () => {
  const claim = claimLiveUnfilteredDump({
    providerId: input.providerId,
    caller: input.caller ?? 'completeness-audit',
    runId: input.runId ?? null,
  });
  try {
    return await retrySeriesCategoryDecode({
    providerId: input.providerId,
    generation: null,
    categoryId: 'all',
    categoryIndex: -1,
    categoryPosition: 0,
    totalCategoryCount: 0,
    isCancelled: input.isCancelled,
    work: async () => {
      const distinctIds = new Set<string>();
      const distinctCategoryIds = new Set<string>();
      let decodedCount = 0;
      let missingCategoryIdCount = 0;
      const decodeResult = await input.streamDecode({
        requestUrl: input.requestUrl,
        mediaType: 'movie',
        filterCategoryId: 'all',
        providerId: input.providerId,
        isCancelled: input.isCancelled,
        skipCatalogNetworkGate: true,
        catalogNetworkMediaType: 'live',
        catalogNetworkOperation: 'get_live_streams',
        runId: input.runId ?? null,
        onBatch: async (records) => {
          decodedCount += records.length;
          for (const record of records) {
            const contentId = typeof record.contentId === 'string' ? record.contentId.trim() : '';
            if (contentId) {
              distinctIds.add(contentId);
            }
            const source =
              record.categoryId != null && String(record.categoryId).trim() !== ''
                ? String(record.categoryId).trim()
                : null;
            if (!source) {
              missingCategoryIdCount += 1;
            } else {
              distinctCategoryIds.add(normalizeStreamCategoryId(source));
            }
          }
        },
      });
      if (decodeResult.cancelled || input.isCancelled?.()) {
        throw Object.assign(new Error('cancelled'), { errorReason: 'cancelled' });
      }
      const rawCount =
        typeof decodeResult.stats.rawSeen === 'number' ? decodeResult.stats.rawSeen : decodedCount;
      return {
        rawCount,
        decodedCount,
        missingCategoryIdCount,
        distinctIds,
        distinctCategoryIds,
        usedNative: Boolean(decodeResult.usedNative),
      };
    },
    });
  } finally {
    claim.release();
  }
    },
    { isCancelled: input.isCancelled, runId: input.runId ?? null },
  );
}

export async function decodeLiveFullDumpUnique(input: {
  providerId: string;
  generation?: number | null;
  requestUrl: string;
  caller?: LiveDecodeCaller;
  runId?: string | null;
  isCancelled?: () => boolean;
  streamDecode: (options: {
    requestUrl: string;
    mediaType: 'movie';
    filterCategoryId: string;
    providerId: string;
    generation?: number;
    requestAttempt?: number;
    isCancelled?: () => boolean;
    skipCatalogNetworkGate?: boolean;
    catalogNetworkMediaType?: 'movie' | 'series' | 'live';
    catalogNetworkOperation?: string;
    runId?: string | null;
    onBatch: (records: NativeCatalogRecord[]) => Promise<void>;
  }) => Promise<StreamXtreamCategoryDecodeResult>;
}): Promise<{
  uniqueRecords: NativeCatalogRecord[];
  rawCount: number;
  decodedCount: number;
  distinctIds: Set<string>;
  distinctCategoryIds: Set<string>;
  missingCategoryIdCount: number;
  duplicateLiveStreamCount: number;
  usedNative: boolean;
}> {
  return withProviderCatalogNetworkGate(
    input.providerId,
    'live',
    'get_live_streams',
    async () => {
  const claim = claimLiveUnfilteredDump({
    providerId: input.providerId,
    caller: input.caller ?? 'live-worker',
    runId: input.runId ?? null,
  });
  try {
    return await retrySeriesCategoryDecode({
    providerId: input.providerId,
    generation: input.generation ?? null,
    categoryId: 'all',
    categoryIndex: -1,
    categoryPosition: 0,
    totalCategoryCount: 0,
    isCancelled: input.isCancelled,
    work: async (attempt) => {
      const unique = new Map<string, NativeCatalogRecord>();
      const distinctCategoryIds = new Set<string>();
      let rawCount = 0;
      let missingCategoryIdCount = 0;
      const decodeResult = await input.streamDecode({
        requestUrl: input.requestUrl,
        mediaType: 'movie',
        filterCategoryId: 'all',
        providerId: input.providerId,
        generation: input.generation ?? undefined,
        requestAttempt: attempt,
        isCancelled: input.isCancelled,
        skipCatalogNetworkGate: true,
        catalogNetworkMediaType: 'live',
        catalogNetworkOperation: 'get_live_streams',
        runId: input.runId ?? null,
        onBatch: async (records) => {
          for (const record of records) {
            rawCount += 1;
            const source =
              record.categoryId != null && String(record.categoryId).trim() !== ''
                ? String(record.categoryId).trim()
                : null;
            if (!source) {
              missingCategoryIdCount += 1;
            } else {
              distinctCategoryIds.add(normalizeStreamCategoryId(source));
            }
            const contentId = canonicalLiveStreamId(record);
            if (contentId && !unique.has(contentId)) {
              unique.set(contentId, record);
            }
          }
        },
      });
      if (decodeResult.cancelled || input.isCancelled?.()) {
        unique.clear();
        throw Object.assign(new Error('cancelled'), { errorReason: 'cancelled' });
      }
      const hint = decodeResult.stats.firstItemPlaybackHint;
      if (hint || Array.isArray(decodeResult.stats.firstItemKeys)) {
        logSampledLiveStreamHint('xtream-api-row', {
          fieldNames: hint?.fieldNames ?? decodeResult.stats.firstItemKeys ?? [],
          directSourcePresent: hint?.directSourcePresent,
          containerExtensionKeyPresent: hint?.containerExtensionKeyPresent,
          containerExtension: hint?.containerExtension,
          streamType: hint?.streamType,
          customSidPresent: hint?.customSidPresent,
          urlLikeFieldPresent: hint?.urlLikeFieldPresent,
          streamId: hint?.streamId,
          categoryId: hint?.categoryId,
        });
      }
      const statsRawSeen =
        typeof decodeResult.stats.rawSeen === 'number' ? decodeResult.stats.rawSeen : rawCount;
      const distinctIds = new Set(unique.keys());
      return {
        uniqueRecords: Array.from(unique.values()),
        rawCount: statsRawSeen,
        decodedCount: unique.size,
        distinctIds,
        distinctCategoryIds,
        missingCategoryIdCount,
        duplicateLiveStreamCount: Math.max(0, statsRawSeen - unique.size),
        usedNative: Boolean(decodeResult.usedNative),
      };
    },
    });
  } finally {
    claim.release();
  }
    },
    { isCancelled: input.isCancelled, runId: input.runId ?? null },
  );
}

const liveAuditKeys = new Set<string>();

export function resetLiveCompletenessAuditLatchForTests() {
  liveAuditKeys.clear();
  lastLiveDumpDistinctCount = null;
  lastLiveDumpUsedNative = false;
  resetLiveDecodeOwnershipForTests();
  resetProviderCatalogNetworkGateForTests();
}

export async function runLiveCatalogCompletenessAudit(input: {
  providerId: string;
  runToken: number;
  metadataCategoryCount: number;
  metadataCategoryIds: string[];
  visibleLiveCount: number;
  dumpRequestUrl: string | null;
  probeRequestUrl: (categoryId: string) => string | null;
  probeCategoryIds: string[];
  nativeAvailable: boolean;
  isCancelled?: () => boolean;
  streamDecode: (options: {
    requestUrl: string;
    mediaType: 'movie';
    filterCategoryId: string;
    providerId: string;
    isCancelled?: () => boolean;
    onBatch: (records: NativeCatalogRecord[]) => Promise<void>;
  }) => Promise<StreamXtreamCategoryDecodeResult>;
}): Promise<void> {
  const latchKey = `${input.providerId}:${input.runToken}`;
  if (liveAuditKeys.has(latchKey)) {
    return;
  }
  liveAuditKeys.add(latchKey);

  const crawlIds = new Set<string>();
  let categoryCrawlRawCount = 0;
  let filteringReliable = false;
  let filterReason = 'not-probed';
  let dumpAvailable = false;
  let dumpFailed = false;
  let rawLiveCount: number | null = null;
  let decodedLiveCount: number | null = null;
  let missingCategoryIdCount = 0;
  const dumpIds = new Set<string>();
  const dumpCategoryIds = new Set<string>();
  let usedNativeDump = false;

  try {
    const probeIds = input.probeCategoryIds.filter(Boolean).slice(0, 3);
    const probeSamples: Array<{ requestedCategoryId: string; returnedCount: number; matchingCount: number }> = [];
    if (input.nativeAvailable) {
      for (const categoryId of probeIds) {
        if (input.isCancelled?.()) {
          return;
        }
        const requestUrl = input.probeRequestUrl(categoryId);
        if (!requestUrl) {
          continue;
        }
        let matchingCount = 0;
        let returnedCount = 0;
        const probeResult = await input.streamDecode({
          requestUrl,
          mediaType: 'movie',
          filterCategoryId: categoryId,
          providerId: input.providerId,
          isCancelled: input.isCancelled,
          onBatch: async (records) => {
            returnedCount += records.length;
            for (const record of records) {
              const contentId = typeof record.contentId === 'string' ? record.contentId.trim() : '';
              if (contentId) {
                crawlIds.add(contentId);
              }
              if (String(record.categoryId ?? '').trim() === categoryId) {
                matchingCount += 1;
              }
            }
          },
        });
        if (probeResult.cancelled || input.isCancelled?.()) {
          return;
        }
        categoryCrawlRawCount +=
          typeof probeResult.stats.rawSeen === 'number' ? probeResult.stats.rawSeen : returnedCount;
        probeSamples.push({ requestedCategoryId: categoryId, returnedCount, matchingCount });
      }
    }
    if (probeSamples.length >= 1) {
      const populated = probeSamples.filter((sample) => sample.returnedCount >= 20);
      filteringReliable =
        populated.length >= 1 &&
        populated.every((sample) => sample.matchingCount >= Math.floor(sample.returnedCount * 0.8));
      filterReason = filteringReliable ? 'category-filter-confirmed' : 'live-probes-inconclusive';
    }

    if (!input.nativeAvailable || !input.dumpRequestUrl) {
      dumpFailed = false;
      dumpAvailable = false;
      filterReason = input.nativeAvailable ? 'live-full-dump-url-unavailable' : 'native-unavailable';
    } else {
      const dump = await decodeUnfilteredLiveDump({
        providerId: input.providerId,
        requestUrl: input.dumpRequestUrl,
        isCancelled: input.isCancelled,
        streamDecode: input.streamDecode,
      });
      dumpAvailable = true;
      usedNativeDump = dump.usedNative;
      rawLiveCount = dump.rawCount;
      decodedLiveCount = dump.decodedCount;
      missingCategoryIdCount = dump.missingCategoryIdCount;
      for (const id of dump.distinctIds) {
        dumpIds.add(id);
      }
      for (const id of dump.distinctCategoryIds) {
        dumpCategoryIds.add(id);
      }
    }
  } catch (error) {
    if (error && typeof error === 'object' && 'errorReason' in error && (error as { errorReason?: string }).errorReason === 'cancelled') {
      return;
    }
    dumpFailed = true;
    dumpAvailable = false;
    filterReason = error instanceof Error ? error.message : String(error);
  }

  const comparison = compareLiveCatalogIdSets(crawlIds, dumpIds);
  const distinctLiveStreamIds = dumpIds.size;
  const distinctStreamCategoryIds = dumpCategoryIds.size;
  const streamCategoryIdsMissingFromMetadata = countLiveCategoryIdsMissingFromMetadata(
    input.metadataCategoryIds,
    dumpCategoryIds,
  );
  lastLiveDumpDistinctCount = dumpAvailable ? distinctLiveStreamIds : lastLiveDumpDistinctCount;
  lastLiveDumpUsedNative = usedNativeDump;
  const dumpMayBeClientCapped = dumpAvailable && !usedNativeDump;
  const difference = dumpAvailable ? distinctLiveStreamIds - input.visibleLiveCount : null;
  logLiveCompletenessProbe({
    providerId: input.providerId,
    rawLiveCount,
    decodedLiveCount,
    distinctLiveStreamIds,
    duplicateLiveStreamCount: Math.max(0, (rawLiveCount ?? 0) - distinctLiveStreamIds),
    metadataCategoryCount: input.metadataCategoryCount,
    distinctStreamCategoryIds,
    missingCategoryIdCount,
    streamCategoryIdsMissingFromMetadata,
    categoryCrawlRawCount,
    categoryCrawlDistinctCount: crawlIds.size,
    crawlScope: 'probe-only',
    liveOnlyInFullDump: comparison.liveOnlyInFullDump,
    liveOnlyInCategoryCrawl: comparison.liveOnlyInCategoryCrawl,
    overlapCount: comparison.overlapCount,
    filteringReliable,
    filterReason,
    completionConfidence: resolveLiveCompletionConfidence({
      dumpAvailable,
      dumpFailed,
      dumpMayBeClientCapped: dumpAvailable && dumpMayBeClientCapped,
      metadataCategoryCount: input.metadataCategoryCount,
      distinctStreamCategoryIds,
      categoryCrawlDistinctCount: crawlIds.size,
      fullDumpDistinctCount: distinctLiveStreamIds,
      liveOnlyInFullDump: comparison.liveOnlyInFullDump,
      overlapCount: comparison.overlapCount,
    }),
    visibleLiveCount: input.visibleLiveCount,
    jsLiveListCap: XTREAM_MAX_ITEMS_PER_RESPONSE,
    usedNativeDump,
    dumpMayBeClientCapped,
    differenceFromVisible: difference,
    exclusionReason: dumpAvailable
      ? resolveLiveExclusionReason({
          visibleLiveCount: input.visibleLiveCount,
          fullDumpDistinctCount: distinctLiveStreamIds,
          usedNativeDump,
          dumpMayBeClientCapped,
          streamCategoryIdsMissingFromMetadata,
        })
      : 'dump-unavailable',
    liveCatalogActionsUsed: ['get_live_categories', 'get_live_streams'],
  });
}
