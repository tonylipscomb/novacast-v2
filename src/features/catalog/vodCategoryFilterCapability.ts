/**
 * Stage 3C.2 / 4.2D — detect whether a provider honors get_vod_streams?category_id=.
 * Tri-state capability: reliable | unreliable | inconclusive.
 * Inconclusive and unreliable both force the safer full-dump strategy.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import type { NativeCatalogRecord } from './nativeCatalogDecodeTypes.ts';

export const MOVIES_UNCATEGORIZED_CATEGORY_ID = 'uncategorized';

/** Bumped to v4 so incorrect v3 "reliable" caches are never reused. */
export const VOD_CATEGORY_FILTER_CAPABILITY_STORAGE_VERSION = 4;
const STORAGE_PREFIX = `@novacast/vod-category-filter-capability/v${VOD_CATEGORY_FILTER_CAPABILITY_STORAGE_VERSION}/`;

export type VodCategoryFilterStatus = 'reliable' | 'unreliable' | 'inconclusive';

export type VodCategoryProbeSample = {
  requestedCategoryId: string;
  returnedCount: number;
  distinctReturnedCategoryIds: number;
  matchingRequestedCategoryCount: number;
  firstContentIds: string[];
  contentIdSample: string[];
};

export type VodCategoryFilterCapability = {
  providerId: string;
  status: VodCategoryFilterStatus;
  /** Compatibility: true only when status === 'reliable'. */
  filteringReliable: boolean;
  testedCategoryIds: string[];
  overlapRatio: number;
  returnedCategoryIdCounts: number[];
  reason: string;
  probedAt: number;
  storageVersion: number;
};

const cache = new Map<string, VodCategoryFilterCapability>();

/** Keep "0"; never coerce missing onto a requested category. */
export function normalizeStreamCategoryId(raw: string | number | null | undefined): string {
  if (raw == null) {
    return MOVIES_UNCATEGORIZED_CATEGORY_ID;
  }
  const value = typeof raw === 'number' ? String(raw) : String(raw).trim();
  if (value.length === 0) {
    return MOVIES_UNCATEGORIZED_CATEGORY_ID;
  }
  return value;
}

/**
 * Stream category_id is authoritative when present (including "0").
 * Fallback to the requested category only for reliable filtered providers.
 * Full-dump mode must pass allowFallback: false.
 */
export function resolveCatalogItemCategoryId(
  recordCategoryId: string | number | null | undefined,
  fallbackCategoryId?: string | null,
  options?: { allowFallback?: boolean },
): string {
  if (recordCategoryId != null && String(recordCategoryId).trim() !== '') {
    return normalizeStreamCategoryId(recordCategoryId);
  }
  if (
    options?.allowFallback !== false &&
    fallbackCategoryId != null &&
    String(fallbackCategoryId).trim() !== '' &&
    String(fallbackCategoryId).trim() !== 'all'
  ) {
    return normalizeStreamCategoryId(fallbackCategoryId);
  }
  return MOVIES_UNCATEGORIZED_CATEGORY_ID;
}

/** Batch accumulator that tracks distinct category IDs accurately across batches. */
export function createVodCategoryProbeAccumulator(requestedCategoryId: string) {
  const requested = normalizeStreamCategoryId(requestedCategoryId);
  const categoryIds = new Set<string>();
  const sample: VodCategoryProbeSample = {
    requestedCategoryId: requested,
    returnedCount: 0,
    distinctReturnedCategoryIds: 0,
    matchingRequestedCategoryCount: 0,
    firstContentIds: [],
    contentIdSample: [],
  };

  return {
    sample,
    onRecords(records: NativeCatalogRecord[]) {
      for (const record of records) {
        sample.returnedCount += 1;
        const contentId = typeof record.contentId === 'string' ? record.contentId.trim() : '';
        const categoryId = normalizeStreamCategoryId(record.categoryId);
        categoryIds.add(categoryId);
        if (categoryId === requested) {
          sample.matchingRequestedCategoryCount += 1;
        }
        if (contentId && sample.firstContentIds.length < 8) {
          sample.firstContentIds.push(contentId);
        }
        if (contentId && sample.contentIdSample.length < 500) {
          sample.contentIdSample.push(contentId);
        }
      }
      sample.distinctReturnedCategoryIds = categoryIds.size;
    },
  };
}

export function computeContentIdOverlapRatio(left: string[], right: string[]): number {
  if (!left.length || !right.length) {
    return 0;
  }
  const rightSet = new Set(right);
  let overlap = 0;
  const seen = new Set<string>();
  for (const id of left) {
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    if (rightSet.has(id)) {
      overlap += 1;
    }
  }
  const denom = Math.min(seen.size, new Set(right).size);
  return denom > 0 ? overlap / denom : 0;
}

function matchRatio(probe: VodCategoryProbeSample): number {
  // Zero-result probes must NEVER count as a perfect match.
  if (probe.returnedCount <= 0) {
    return 0;
  }
  return probe.matchingRequestedCategoryCount / probe.returnedCount;
}

function isPopulatedProbe(probe: VodCategoryProbeSample): boolean {
  return probe.returnedCount >= 25;
}

function isStrongMatchingProbe(probe: VodCategoryProbeSample): boolean {
  return isPopulatedProbe(probe) && matchRatio(probe) >= 0.7 && probe.returnedCount >= 50;
}

/**
 * Select up to 6 unique provider category IDs for progressive probing.
 * Prefers positive count hints, then spread positions across the rail.
 */
export function selectVodCategoryProbeIds(
  categoryIds: string[],
  options?: { countHints?: Record<string, number>; limit?: number },
): string[] {
  const limit = options?.limit ?? 6;
  const hints = options?.countHints ?? {};
  const unique = Array.from(
    new Set(
      categoryIds.filter(
        (id) =>
          Boolean(id) &&
          id !== 'all' &&
          !String(id).startsWith('section:') &&
          !String(id).startsWith('smart:'),
      ),
    ),
  );
  if (!unique.length) {
    return [];
  }

  const selected: string[] = [];
  const push = (id: string | undefined) => {
    if (!id || selected.includes(id) || selected.length >= limit) {
      return;
    }
    selected.push(id);
  };

  const hinted = unique
    .filter((id) => (hints[id] ?? 0) > 0)
    .sort((left, right) => (hints[right] ?? 0) - (hints[left] ?? 0));
  for (const id of hinted.slice(0, 2)) {
    push(id);
  }

  const last = unique.length - 1;
  const positions = [0, 0.25, 0.5, 0.75, 1].map((ratio) =>
    unique[Math.min(last, Math.max(0, Math.floor(last * ratio)))]!,
  );
  for (const id of positions) {
    push(id);
  }

  return selected.slice(0, limit);
}

export function evaluateVodCategoryFilterCapability(input: {
  providerId: string;
  probes: VodCategoryProbeSample[];
  estimatedCatalogSize?: number;
  metadataCategoryCount?: number;
}): VodCategoryFilterCapability {
  const testedCategoryIds = input.probes.map((probe) => probe.requestedCategoryId);
  const returnedCategoryIdCounts = input.probes.map((probe) => probe.distinctReturnedCategoryIds);
  const populated = input.probes.filter(isPopulatedProbe);
  const zeroProbes = input.probes.filter((probe) => probe.returnedCount <= 0);
  const overlapPairs: number[] = [];
  for (let i = 0; i < populated.length; i += 1) {
    for (let j = i + 1; j < populated.length; j += 1) {
      overlapPairs.push(
        computeContentIdOverlapRatio(populated[i]!.contentIdSample, populated[j]!.contentIdSample),
      );
    }
  }
  const overlapRatio = overlapPairs.length ? Math.max(...overlapPairs) : 0;

  let status: VodCategoryFilterStatus = 'inconclusive';
  let reason = 'insufficient-populated-probes';

  // All-zero / mostly-zero on a large metadata rail → inconclusive (safe full dump).
  if (input.probes.length > 0 && populated.length === 0) {
    status = 'inconclusive';
    reason = 'zero-result-probes-inconclusive';
  } else if (
    (input.metadataCategoryCount ?? 0) >= 50 &&
    populated.length === 0 &&
    zeroProbes.length > 0
  ) {
    status = 'inconclusive';
    reason = 'zero-result-probes-inconclusive';
  } else {
    // Unreliability signals from foreign / near-full / overlapping dumps.
    for (const probe of populated) {
      const ratio = matchRatio(probe);
      if (probe.returnedCount >= 800 && probe.distinctReturnedCategoryIds >= 8 && ratio < 0.35) {
        status = 'unreliable';
        reason = 'foreign-category-response';
        break;
      }
      if (
        input.estimatedCatalogSize &&
        input.estimatedCatalogSize >= 1500 &&
        probe.returnedCount >= Math.floor(input.estimatedCatalogSize * 0.85)
      ) {
        status = 'unreliable';
        reason = 'response-size-near-full-catalog';
        break;
      }
      if (probe.returnedCount >= 1500 && ratio < 0.2) {
        status = 'unreliable';
        reason = 'low-requested-category-match-ratio';
        break;
      }
    }

    if (status !== 'unreliable' && overlapRatio >= 0.55 && populated.length >= 2) {
      status = 'unreliable';
      reason = 'high-content-overlap';
    }

    if (
      status !== 'unreliable' &&
      populated.length >= 2 &&
      populated.every((probe) => probe.returnedCount >= 1500)
    ) {
      const left = populated[0]!.returnedCount;
      const right = populated[1]!.returnedCount;
      const sizeRatio = Math.min(left, right) / Math.max(left, right);
      const catalogSize = input.estimatedCatalogSize ?? Math.max(left, right);
      const nearCatalog =
        catalogSize >= 1500 && Math.min(left, right) >= Math.floor(catalogSize * 0.7);
      if (sizeRatio >= 0.85 && nearCatalog) {
        status = 'unreliable';
        reason = 'category-responses-nearly-identical-size';
      }
    }

    // Reliable only with ≥2 strong, distinct-category populated samples.
    if (status !== 'unreliable') {
      const strong = populated.filter(isStrongMatchingProbe);
      if (strong.length >= 2 && overlapRatio < 0.35) {
        status = 'reliable';
        reason = 'category-filter-confirmed';
      } else if (populated.length === 1 && zeroProbes.length >= 1) {
        status = 'inconclusive';
        reason = 'insufficient-populated-probes';
      } else if (populated.length < 2) {
        status = 'inconclusive';
        reason = 'insufficient-populated-probes';
      } else {
        status = 'inconclusive';
        reason = 'insufficient-populated-probes';
      }
    }
  }

  const result: VodCategoryFilterCapability = {
    providerId: input.providerId,
    status,
    filteringReliable: status === 'reliable',
    testedCategoryIds,
    overlapRatio: Math.round(overlapRatio * 1000) / 1000,
    returnedCategoryIdCounts,
    reason,
    probedAt: Date.now(),
    storageVersion: VOD_CATEGORY_FILTER_CAPABILITY_STORAGE_VERSION,
  };

  console.info(
    '[NovaCast VOD Category Filter Capability] ' +
      JSON.stringify({
        providerId: result.providerId,
        testedCategoryIds: result.testedCategoryIds,
        overlapRatio: result.overlapRatio,
        returnedCategoryIdCounts: result.returnedCategoryIdCounts,
        returnedCounts: input.probes.map((probe) => probe.returnedCount),
        estimatedCatalogSize: input.estimatedCatalogSize ?? null,
        metadataCategoryCount: input.metadataCategoryCount ?? null,
        status: result.status,
        filteringReliable: result.filteringReliable,
        reason: result.reason,
        marker: 'stage4d-vod-ingestion-repair-v1',
      }),
  );

  return result;
}

function storageKey(providerId: string) {
  return `${STORAGE_PREFIX}${providerId}`;
}

export async function readVodCategoryFilterCapability(
  providerId: string,
): Promise<VodCategoryFilterCapability | null> {
  const cached = cache.get(providerId);
  if (cached) {
    return cached;
  }
  try {
    const raw = await AsyncStorage.getItem(storageKey(providerId));
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as VodCategoryFilterCapability;
    if (!parsed || typeof parsed.filteringReliable !== 'boolean') {
      return null;
    }
    // Reject stale shapes / wrong storage versions.
    if (
      parsed.storageVersion !== VOD_CATEGORY_FILTER_CAPABILITY_STORAGE_VERSION ||
      (parsed.status !== 'reliable' &&
        parsed.status !== 'unreliable' &&
        parsed.status !== 'inconclusive')
    ) {
      return null;
    }
    cache.set(providerId, parsed);
    return parsed;
  } catch {
    return null;
  }
}

export async function writeVodCategoryFilterCapability(capability: VodCategoryFilterCapability) {
  const normalized: VodCategoryFilterCapability = {
    ...capability,
    filteringReliable: capability.status === 'reliable',
    storageVersion: VOD_CATEGORY_FILTER_CAPABILITY_STORAGE_VERSION,
  };
  cache.set(normalized.providerId, normalized);
  if (typeof AsyncStorage.setItem === 'function') {
    await AsyncStorage.setItem(storageKey(normalized.providerId), JSON.stringify(normalized)).catch(
      () => undefined,
    );
  }
}

export async function invalidateVodCategoryFilterCapability(providerId: string): Promise<void> {
  cache.delete(providerId);
  if (typeof AsyncStorage.removeItem === 'function') {
    await AsyncStorage.removeItem(storageKey(providerId)).catch(() => undefined);
  }
}

export function getVodCategoryFilterCapabilitySync(providerId: string) {
  return cache.get(providerId) ?? null;
}

export function clearVodCategoryFilterCapabilityForTests() {
  cache.clear();
}

/** Mid-sync sparse coverage check for filtered-per-category ingestion. */
export function evaluateSparsePerCategoryCoverage(input: {
  categoriesAttempted: number;
  categoriesReturningItems: number;
  categoriesReturningZero: number;
  metadataCategoryCount: number;
  distinctItemCategoryIds: number;
  decodedItemCount: number;
}): { suspicious: boolean; reason: string | null } {
  const {
    categoriesAttempted,
    categoriesReturningItems,
    categoriesReturningZero,
    metadataCategoryCount,
    distinctItemCategoryIds,
    decodedItemCount,
  } = input;

  const sampleReady =
    categoriesAttempted >= 12 ||
    (metadataCategoryCount > 0 && categoriesAttempted >= Math.ceil(metadataCategoryCount * 0.1));

  if (!sampleReady) {
    return { suspicious: false, reason: null };
  }

  const zeroRatio = categoriesAttempted > 0 ? categoriesReturningZero / categoriesAttempted : 0;
  if (categoriesAttempted >= 12 && zeroRatio >= 0.9) {
    return { suspicious: true, reason: 'sparse-per-category-coverage' };
  }
  if (metadataCategoryCount >= 50 && categoriesReturningItems < 3) {
    return { suspicious: true, reason: 'sparse-per-category-coverage' };
  }
  if (decodedItemCount >= 100 && distinctItemCategoryIds <= 2 && metadataCategoryCount >= 50) {
    return { suspicious: true, reason: 'sparse-per-category-coverage' };
  }
  return { suspicious: false, reason: null };
}
