/**
 * Stage 3C.2 / 4.2D — reject collapsed / sparse Movies generations before activation.
 */

export type MoviesCategoryDistributionStats = {
  totalItems: number;
  distinctCategoryIds: number;
  metadataCategoryCount: number;
  nonzeroCategoryCount: number;
  largestCategoryId: string | null;
  largestCategoryCount: number;
  largestCategoryShare: number;
  coverageRatio: number;
};

export type MoviesCategoryDistributionValidation = MoviesCategoryDistributionStats & {
  generation: number;
  previousGeneration: number | null;
  previousTotalItems: number | null;
  previousNonzeroCategoryCount: number | null;
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
  previousGeneration?: number | null;
  previousTotalItems?: number | null;
  previousNonzeroCategoryCount?: number | null;
}): MoviesCategoryDistributionValidation {
  const totalItems = Math.max(0, Math.floor(input.totalItems));
  const largestCategoryCount = Math.max(0, Math.floor(input.largestCategoryCount));
  const metadataCategoryCount = Math.max(0, Math.floor(input.metadataCategoryCount));
  const nonzeroCategoryCount = Math.max(0, Math.floor(input.nonzeroCategoryCount));
  const largestCategoryShare = totalItems > 0 ? largestCategoryCount / totalItems : 0;
  const coverageRatio =
    metadataCategoryCount > 0 ? nonzeroCategoryCount / metadataCategoryCount : 0;

  const previousGeneration =
    typeof input.previousGeneration === 'number' && input.previousGeneration > 0
      ? input.previousGeneration
      : null;
  const previousTotalItems =
    typeof input.previousTotalItems === 'number' && input.previousTotalItems >= 0
      ? input.previousTotalItems
      : null;
  const previousNonzeroCategoryCount =
    typeof input.previousNonzeroCategoryCount === 'number' &&
    input.previousNonzeroCategoryCount >= 0
      ? input.previousNonzeroCategoryCount
      : null;

  const stats: MoviesCategoryDistributionStats = {
    totalItems,
    distinctCategoryIds: Math.max(0, Math.floor(input.distinctCategoryIds)),
    metadataCategoryCount,
    nonzeroCategoryCount,
    largestCategoryId: input.largestCategoryId,
    largestCategoryCount,
    largestCategoryShare: Math.round(largestCategoryShare * 10000) / 10000,
    coverageRatio: Math.round(coverageRatio * 10000) / 10000,
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
  } else if (stats.metadataCategoryCount >= 100 && stats.nonzeroCategoryCount < 10) {
    // Large providers: 5 populated categories is not enough.
    validationPassed = false;
    rejectionReason = 'sparse-nonzero-categories-vs-large-metadata';
  } else if (
    stats.metadataCategoryCount >= 100 &&
    stats.coverageRatio < 0.03
  ) {
    validationPassed = false;
    rejectionReason = 'sparse-coverage-vs-metadata';
  } else if (stats.metadataCategoryCount >= 10 && stats.nonzeroCategoryCount < 5) {
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
    stats.metadataCategoryCount >= 50 &&
    stats.totalItems >= 500 &&
    stats.largestCategoryShare >= 0.85
  ) {
    validationPassed = false;
    rejectionReason = 'single-category-owns-extreme-share';
  } else if (
    stats.metadataCategoryCount >= 10 &&
    stats.totalItems >= 1000 &&
    stats.largestCategoryShare >= 0.85
  ) {
    validationPassed = false;
    rejectionReason = 'single-category-owns-extreme-share';
  } else if (
    previousNonzeroCategoryCount != null &&
    previousNonzeroCategoryCount >= 20 &&
    stats.nonzeroCategoryCount < previousNonzeroCategoryCount * 0.25
  ) {
    validationPassed = false;
    rejectionReason = 'nonzero-coverage-collapsed-vs-previous';
  } else if (
    previousTotalItems != null &&
    previousTotalItems >= 1000 &&
    stats.totalItems < previousTotalItems * 0.5
  ) {
    validationPassed = false;
    rejectionReason = 'item-total-collapsed-vs-previous';
  }

  const result: MoviesCategoryDistributionValidation = {
    generation: input.generation,
    ...stats,
    previousGeneration,
    previousTotalItems,
    previousNonzeroCategoryCount,
    validationPassed,
    rejectionReason,
  };

  console.info(
    '[NovaCast Movies Category Distribution Validation] ' +
      JSON.stringify({
        generation: result.generation,
        totalItems: result.totalItems,
        metadataCategoryCount: result.metadataCategoryCount,
        distinctItemCategoryIds: result.distinctCategoryIds,
        nonzeroCategoryCount: result.nonzeroCategoryCount,
        coverageRatio: result.coverageRatio,
        largestCategoryShare: result.largestCategoryShare,
        previousGeneration: result.previousGeneration,
        previousTotalItems: result.previousTotalItems,
        previousNonzeroCategoryCount: result.previousNonzeroCategoryCount,
        validationPassed: result.validationPassed,
        rejectionReason: result.rejectionReason,
        marker: 'stage4d-vod-ingestion-repair-v1',
      }),
  );

  return result;
}

/** Integrity check for an already-active readable generation (startup repair). */
export function assessMoviesCatalogIntegrity(input: {
  /** Actual readable generation under assessment — never invent 0 when known. */
  generation?: number;
  metadataCategoryCount: number;
  nonzeroCategoryCount: number;
  distinctItemCategoryIds: number;
  totalItems: number;
  largestCategoryShare?: number;
}): { healthy: boolean; degraded: boolean; reason: string | null } {
  const check = validateMoviesCategoryDistribution({
    generation:
      typeof input.generation === 'number' && input.generation > 0 ? input.generation : 0,
    totalItems: input.totalItems,
    distinctCategoryIds: input.distinctItemCategoryIds,
    metadataCategoryCount: input.metadataCategoryCount,
    nonzeroCategoryCount: input.nonzeroCategoryCount,
    largestCategoryId: null,
    largestCategoryCount: Math.round(
      (input.largestCategoryShare ?? 0) * Math.max(input.totalItems, 0),
    ),
  });
  if (check.validationPassed) {
    return { healthy: true, degraded: false, reason: null };
  }
  return {
    healthy: false,
    degraded: true,
    reason: check.rejectionReason ?? 'sparse-active-generation',
  };
}
