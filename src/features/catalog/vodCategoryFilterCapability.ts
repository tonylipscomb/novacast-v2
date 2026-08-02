/**
 * Stage 3C.2 — detect whether a provider honors get_vod_streams?category_id=.
 * Cache the result per provider so Movies sync can choose full-dump vs per-category.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import type { NativeCatalogRecord } from './nativeCatalogDecodeTypes.ts';

export const MOVIES_UNCATEGORIZED_CATEGORY_ID = 'uncategorized';

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
  filteringReliable: boolean;
  testedCategoryIds: string[];
  overlapRatio: number;
  returnedCategoryIdCounts: number[];
  reason: string;
  probedAt: number;
};

const STORAGE_PREFIX = '@novacast/vod-category-filter-capability/v3/';
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

export function evaluateVodCategoryFilterCapability(input: {
  providerId: string;
  probes: VodCategoryProbeSample[];
  estimatedCatalogSize?: number;
}): VodCategoryFilterCapability {
  const testedCategoryIds = input.probes.map((probe) => probe.requestedCategoryId);
  const returnedCategoryIdCounts = input.probes.map((probe) => probe.distinctReturnedCategoryIds);
  const overlapRatio =
    input.probes.length >= 2
      ? computeContentIdOverlapRatio(input.probes[0]!.contentIdSample, input.probes[1]!.contentIdSample)
      : 0;

  let filteringReliable = true;
  let reason = 'category-filter-appears-reliable';

  for (const probe of input.probes) {
    const matchRatio =
      probe.returnedCount > 0 ? probe.matchingRequestedCategoryCount / probe.returnedCount : 1;
    if (probe.returnedCount >= 800 && probe.distinctReturnedCategoryIds >= 8 && matchRatio < 0.35) {
      filteringReliable = false;
      reason = 'response-contains-many-foreign-category-ids';
      break;
    }
    if (
      input.estimatedCatalogSize &&
      input.estimatedCatalogSize >= 1500 &&
      probe.returnedCount >= Math.floor(input.estimatedCatalogSize * 0.85)
    ) {
      filteringReliable = false;
      reason = 'response-size-near-full-catalog';
      break;
    }
    if (probe.returnedCount >= 1500 && matchRatio < 0.2) {
      filteringReliable = false;
      reason = 'low-requested-category-match-ratio';
      break;
    }
  }

  if (
    filteringReliable &&
    input.probes.length >= 2 &&
    input.probes.every((probe) => probe.returnedCount >= 1500)
  ) {
    const left = input.probes[0]!.returnedCount;
    const right = input.probes[1]!.returnedCount;
    const sizeRatio = Math.min(left, right) / Math.max(left, right);
    const catalogSize = input.estimatedCatalogSize ?? Math.max(left, right);
    // Only treat identical sizes as suspicious when both look like a full (or near-full) dump.
    // Two legitimately large categories of similar size must not force full-dump mode.
    const nearCatalog =
      catalogSize >= 1500 && Math.min(left, right) >= Math.floor(catalogSize * 0.7);
    if (sizeRatio >= 0.85 && nearCatalog) {
      filteringReliable = false;
      reason = 'category-responses-nearly-identical-size';
    }
  }

  if (filteringReliable && overlapRatio >= 0.55 && input.probes.every((probe) => probe.returnedCount >= 500)) {
    filteringReliable = false;
    reason = 'high-content-id-overlap-across-category-requests';
  }

  const result: VodCategoryFilterCapability = {
    providerId: input.providerId,
    filteringReliable,
    testedCategoryIds,
    overlapRatio: Math.round(overlapRatio * 1000) / 1000,
    returnedCategoryIdCounts,
    reason,
    probedAt: Date.now(),
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
        filteringReliable: result.filteringReliable,
        reason: result.reason,
        marker: 'stage3c2-vod-full-dump-sync-v1',
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
    cache.set(providerId, parsed);
    return parsed;
  } catch {
    return null;
  }
}

export async function writeVodCategoryFilterCapability(capability: VodCategoryFilterCapability) {
  cache.set(capability.providerId, capability);
  if (typeof AsyncStorage.setItem === 'function') {
    await AsyncStorage.setItem(storageKey(capability.providerId), JSON.stringify(capability)).catch(
      () => undefined,
    );
  }
}

export function getVodCategoryFilterCapabilitySync(providerId: string) {
  return cache.get(providerId) ?? null;
}

export function clearVodCategoryFilterCapabilityForTests() {
  cache.clear();
}
