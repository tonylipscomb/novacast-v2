/**
 * VOD region ranking — derived once per unique item.
 * Must not run inside per-category get_vod_streams ingestion.
 */

import { getLearnedBatchSize, nowMs, processTimeBudgeted } from '../catalog/jsChunkBudget.ts';
import type { ProviderCategoryContentType } from './categoryNormalization.ts';
import { categoryRegionalSortRank } from './categoryRegionalPipeline.ts';

export const VOD_REGION_RANK_BATCH_SIZE = 80;
export const VOD_REGION_RANK_YIELD_MS = 0;

export type VodRegionRankInput = {
  id: string;
  title: string;
  rawTitle?: string;
  countryCode?: string;
};

/**
 * Deterministic region_rank for Movies/Series local sorting.
 * Lower = preferred (US-first). Matches legacy providerRegionalSortRank tiers.
 */
export function computeVodRegionRank(
  item: Omit<VodRegionRankInput, 'id'>,
  contentType: ProviderCategoryContentType = 'movie',
): number {
  const priority = categoryRegionalSortRank(
    {
      name: item.title,
      rawName: item.rawTitle,
      countryCode: item.countryCode,
    },
    contentType,
  );
  if (priority <= 3) {
    return 0;
  }
  if (priority >= 7) {
    return 2;
  }
  return 1;
}

/**
 * Rank unique items that do not yet have regionRank.
 * Yields between time-budgeted chunks so Home/TV focus can run.
 */
export async function rankUniqueItemsInBatches<T extends VodRegionRankInput & { regionRank?: number }>(
  items: readonly T[],
  options: {
    contentType?: ProviderCategoryContentType;
    batchSize?: number;
    isCancelled?: () => boolean;
    apply: (id: string, regionRank: number) => void;
    hasRank?: (id: string) => boolean;
  },
): Promise<{
  ranked: number;
  skipped: number;
  batches: number;
  initialBatchSize: number;
  minBatchSizeSeen: number;
  maxBatchSizeSeen: number;
  averageBatchSize: number;
  finalBatchSize: number;
  yieldCount: number;
  pressureReductionCount: number;
  pressureIncreaseCount: number;
  measuredMacrotaskLagMaxMs: number;
  measuredMacrotaskLagAverageMs: number;
  totalYieldMs: number;
  computeMs: number;
  computeVodRegionRankMs: number;
  setRegionRankMs: number;
  averageComputeVodRegionRankUsPerItem: number;
  averageSetRegionRankUsPerItem: number;
}> {
  const contentType = options.contentType ?? 'movie';
  const maxItems = Math.max(1, options.batchSize ?? VOD_REGION_RANK_BATCH_SIZE);
  const initialBatchSize = Math.min(maxItems, getLearnedBatchSize('regionRanking'));
  let ranked = 0;
  let skipped = 0;
  let computeMs = 0;
  let computeVodRegionRankMs = 0;
  let setRegionRankMs = 0;
  let batchItemTotal = 0;
  let minBatchSizeSeen = Number.POSITIVE_INFINITY;
  let maxBatchSizeSeen = 0;
  let yieldCount = 0;
  let totalYieldMs = 0;
  let pressureReductionCount = 0;
  let pressureIncreaseCount = 0;
  let measuredMacrotaskLagMaxMs = 0;
  let measuredMacrotaskLagTotalMs = 0;

  const pending: T[] = [];
  const seenIds = new Set<string>();
  for (const item of items) {
    if (typeof item.regionRank === 'number' || options.hasRank?.(item.id)) {
      skipped += 1;
      continue;
    }
    if (seenIds.has(item.id)) {
      skipped += 1;
      continue;
    }
    seenIds.add(item.id);
    pending.push(item);
  }

  const result = await processTimeBudgeted(
    pending,
    (item) => {
      const computeStarted = nowMs();
      const regionRank = computeVodRegionRank(item, contentType);
      computeVodRegionRankMs += nowMs() - computeStarted;
      const setStarted = nowMs();
      options.apply(item.id, regionRank);
      setRegionRankMs += nowMs() - setStarted;
      computeMs += nowMs() - computeStarted;
      ranked += 1;
    },
    {
      kind: 'regionRanking',
      maxItems,
      minItems: Math.max(8, Math.floor(maxItems / 4)),
      isCancelled: options.isCancelled,
      onChunk: (info) => {
        batchItemTotal += info.chunkItems;
        minBatchSizeSeen = Math.min(minBatchSizeSeen, info.chunkItems);
        maxBatchSizeSeen = Math.max(maxBatchSizeSeen, info.chunkItems);
      },
      onYield: (yieldMs) => {
        yieldCount += 1;
        totalYieldMs += yieldMs;
        measuredMacrotaskLagMaxMs = Math.max(measuredMacrotaskLagMaxMs, yieldMs);
        measuredMacrotaskLagTotalMs += yieldMs;
      },
      onBatchSizeChange: (previousSize, nextSize) => {
        if (nextSize < previousSize) pressureReductionCount += 1;
        if (nextSize > previousSize) pressureIncreaseCount += 1;
      },
    },
  );

  return {
    ranked,
    skipped,
    batches: result.chunks,
    initialBatchSize,
    minBatchSizeSeen: minBatchSizeSeen === Number.POSITIVE_INFINITY ? 0 : minBatchSizeSeen,
    maxBatchSizeSeen,
    averageBatchSize: result.chunks > 0 ? batchItemTotal / result.chunks : 0,
    finalBatchSize: getLearnedBatchSize('regionRanking'),
    yieldCount,
    pressureReductionCount,
    pressureIncreaseCount,
    measuredMacrotaskLagMaxMs,
    measuredMacrotaskLagAverageMs: yieldCount > 0 ? measuredMacrotaskLagTotalMs / yieldCount : 0,
    totalYieldMs,
    computeMs,
    computeVodRegionRankMs,
    setRegionRankMs,
    averageComputeVodRegionRankUsPerItem:
      ranked > 0 ? (computeVodRegionRankMs * 1000) / ranked : 0,
    averageSetRegionRankUsPerItem: ranked > 0 ? (setRegionRankMs * 1000) / ranked : 0,
  };
}
