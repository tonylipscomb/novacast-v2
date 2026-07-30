/**
 * VOD region ranking — derived once per unique item.
 * Must not run inside per-category get_vod_streams ingestion.
 */

import { processTimeBudgeted } from '../catalog/jsChunkBudget.ts';
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
): Promise<{ ranked: number; skipped: number; batches: number }> {
  const contentType = options.contentType ?? 'movie';
  const maxItems = Math.max(1, options.batchSize ?? VOD_REGION_RANK_BATCH_SIZE);
  let ranked = 0;
  let skipped = 0;

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
      const regionRank = computeVodRegionRank(item, contentType);
      options.apply(item.id, regionRank);
      ranked += 1;
    },
    {
      maxItems,
      minItems: Math.max(8, Math.floor(maxItems / 4)),
      isCancelled: options.isCancelled,
    },
  );

  return { ranked, skipped, batches: result.chunks };
}
