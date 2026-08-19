/**
 * Stage 3C.2 / 4.2D / 4.2I ΓÇö reject collapsed / sparse Movies generations before activation.
 * Stage 4.2I also rejects partial dumps (tiny item totals with collapsed category coverage)
 * even when provider.catalogGeneration is zero.
 *
 * Stage 4.2Q: the actual threshold logic below was never Movies-specific data
 * (it's pure arithmetic over item/category counts) ΓÇö generalized to
 * `validateCatalogCategoryDistribution(mediaType, input)` / `assessCatalogIntegrity(mediaType, input)`
 * so Series can share the exact same validation (same thresholds, same
 * rejection reasons) instead of having no promotion-time sparse check of its
 * own. `validateMoviesCategoryDistribution` / `assessMoviesCatalogIntegrity`
 * remain as-is (same signature, same behavior, same log text) ΓÇö thin
 * `mediaType: 'movie'` wrappers over the shared implementation.
 */

import type { CatalogMediaType } from './catalogTypes.ts';

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

/** Same stats shape, reused for any catalog media type (Movies today, Series as of Stage 4.2Q). */
export type CatalogCategoryDistributionStats = MoviesCategoryDistributionStats;
export type CatalogCategoryDistributionValidation = MoviesCategoryDistributionValidation & {
  mediaType: CatalogMediaType;
};

function computeCategoryDistributionStatsAndVerdict(input: {
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
    // Stage 4.2I: partial dumps (e.g. 53 rows / 1 category) must never activate.
    stats.totalItems < 500 &&
    stats.distinctCategoryIds <= 2 &&
    stats.nonzeroCategoryCount <= 2
  ) {
    validationPassed = false;
    rejectionReason = 'sparse-partial-dump';
  } else if (
    stats.metadataCategoryCount >= 50 &&
    stats.totalItems < 200
  ) {
    validationPassed = false;
    rejectionReason = 'sparse-item-total-vs-large-metadata';
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

  return result;
}

const CATALOG_MEDIA_TYPE_LOG_LABEL: Record<CatalogMediaType, string> = {
  movie: 'Movies',
  series: 'Series',
};

const CATALOG_MEDIA_TYPE_MARKER: Record<CatalogMediaType, string> = {
  movie: 'stage4d-vod-ingestion-repair-v1',
  series: 'stage4q-series-sparse-catalog-validation-v1',
};

/**
 * Stage 4.2Q ΓÇö generalized entry point: identical thresholds/logic as
 * `validateMoviesCategoryDistribution` (below), parameterized by
 * `mediaType` purely for the diagnostic log line/marker. Movies callers
 * should keep using `validateMoviesCategoryDistribution` unchanged; this is
 * for Series' new promotion-time sparse check.
 */
export function validateCatalogCategoryDistribution(
  mediaType: CatalogMediaType,
  input: {
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
  },
): CatalogCategoryDistributionValidation {
  const result = computeCategoryDistributionStatsAndVerdict(input);

  console.info(
    `[NovaCast ${CATALOG_MEDIA_TYPE_LOG_LABEL[mediaType]} Category Distribution Validation] ` +
      JSON.stringify({
        mediaType,
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
        marker: CATALOG_MEDIA_TYPE_MARKER[mediaType],
        stage4iMarker: 'stage4i-movies-readable-snapshot-recovery-v1',
      }),
  );

  return { ...result, mediaType };
}

/**
 * Stage 3C.2/4.2D/4.2I Movies entry point ΓÇö unchanged signature, unchanged
 * behavior, unchanged log text/marker. Thin `mediaType: 'movie'` wrapper over
 * the shared `validateCatalogCategoryDistribution` (Stage 4.2Q).
 */
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
  const { mediaType: _mediaType, ...result } = validateCatalogCategoryDistribution('movie', input);
  return result;
}

/** Integrity check for an already-active readable generation (startup repair). Generic over media type. */
export function assessCatalogIntegrity(
  mediaType: CatalogMediaType,
  input: {
    /** Actual readable generation under assessment ΓÇö never invent 0 when known. */
    generation?: number;
    metadataCategoryCount: number;
    nonzeroCategoryCount: number;
    distinctItemCategoryIds: number;
    totalItems: number;
    largestCategoryShare?: number;
  },
): { healthy: boolean; degraded: boolean; reason: string | null } {
  const check = validateCatalogCategoryDistribution(mediaType, {
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

/** Movies entry point ΓÇö unchanged signature/behavior. Thin wrapper over `assessCatalogIntegrity`. */
export function assessMoviesCatalogIntegrity(input: {
  /** Actual readable generation under assessment ΓÇö never invent 0 when known. */
  generation?: number;
  metadataCategoryCount: number;
  nonzeroCategoryCount: number;
  distinctItemCategoryIds: number;
  totalItems: number;
  largestCategoryShare?: number;
}): { healthy: boolean; degraded: boolean; reason: string | null } {
  return assessCatalogIntegrity('movie', input);
}
