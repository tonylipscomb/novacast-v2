/**
 * Stage 3C.2 — reject collapsed Movies generations before activation.
 */

export type MoviesCategoryDistributionStats = {
  totalItems: number;
  distinctCategoryIds: number;
  metadataCategoryCount: number;
  nonzeroCategoryCount: number;
  largestCategoryId: string | null;
  largestCategoryCount: number;
  largestCategoryShare: number;
};

export type MoviesCategoryDistributionValidation = MoviesCategoryDistributionStats & {
  generation: number;
  validationPassed: boolean;
  rejectionReason: string | null;
};

export function validateMoviesCategoryDistribution(input: {
  generation: number;
  totalItems: number;
  distinctCategoryIds: number;
  metadataCategoryCount: number;
  nonzeroCategoryCount: number;
  largestCategoryId: string | null;
  largestCategoryCount: number;
}): MoviesCategoryDistributionValidation {
  const totalItems = Math.max(0, Math.floor(input.totalItems));
  const largestCategoryCount = Math.max(0, Math.floor(input.largestCategoryCount));
  const largestCategoryShare = totalItems > 0 ? largestCategoryCount / totalItems : 0;

  const stats: MoviesCategoryDistributionStats = {
    totalItems,
    distinctCategoryIds: Math.max(0, Math.floor(input.distinctCategoryIds)),
    metadataCategoryCount: Math.max(0, Math.floor(input.metadataCategoryCount)),
    nonzeroCategoryCount: Math.max(0, Math.floor(input.nonzeroCategoryCount)),
    largestCategoryId: input.largestCategoryId,
    largestCategoryCount,
    largestCategoryShare: Math.round(largestCategoryShare * 10000) / 10000,
  };

  let validationPassed = true;
  let rejectionReason: string | null = null;

  if (stats.totalItems <= 0) {
    validationPassed = false;
    rejectionReason = 'empty-generation';
  } else if (
    stats.metadataCategoryCount >= 20 &&
    stats.distinctCategoryIds > 0 &&
    stats.distinctCategoryIds < 5
  ) {
    validationPassed = false;
    rejectionReason = 'distinct-item-categories-too-small-vs-metadata';
  } else if (
    stats.metadataCategoryCount >= 10 &&
    stats.nonzeroCategoryCount < 5
  ) {
    validationPassed = false;
    rejectionReason = 'fewer-than-five-nonzero-provider-categories';
  } else if (
    stats.metadataCategoryCount >= 15 &&
    stats.nonzeroCategoryCount > 0 &&
    stats.nonzeroCategoryCount <= 2 &&
    stats.nonzeroCategoryCount < stats.metadataCategoryCount * 0.15
  ) {
    validationPassed = false;
    rejectionReason = 'collapsed-nonzero-category-rail';
  } else if (
    stats.metadataCategoryCount >= 10 &&
    stats.totalItems >= 1000 &&
    stats.largestCategoryShare >= 0.85
  ) {
    validationPassed = false;
    rejectionReason = 'single-category-owns-extreme-share';
  }

  const result: MoviesCategoryDistributionValidation = {
    generation: input.generation,
    ...stats,
    validationPassed,
    rejectionReason,
  };

  console.info(
    '[NovaCast Movies Category Distribution Validation] ' +
      JSON.stringify({
        generation: result.generation,
        totalItems: result.totalItems,
        distinctCategoryIds: result.distinctCategoryIds,
        metadataCategoryCount: result.metadataCategoryCount,
        nonzeroCategoryCount: result.nonzeroCategoryCount,
        largestCategoryId: result.largestCategoryId,
        largestCategoryCount: result.largestCategoryCount,
        largestCategoryShare: result.largestCategoryShare,
        validationPassed: result.validationPassed,
        rejectionReason: result.rejectionReason,
        marker: 'stage3c2-vod-full-dump-sync-v1',
      }),
  );

  return result;
}
