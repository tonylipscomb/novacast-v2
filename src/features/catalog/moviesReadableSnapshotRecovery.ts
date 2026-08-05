/**
 * Stage 4.2I — Durable Movies readable snapshot recovery.
 * Pure selection / integrity helpers. SQLite I/O stays in catalogRepository.
 */

import {
  assessMoviesCatalogIntegrity,
  validateMoviesCategoryDistribution,
  type MoviesCategoryDistributionValidation,
} from './moviesCategoryDistributionValidation.ts';

export const MOVIES_FOCUS_STAGE4I_MARKER = 'stage4i-movies-readable-snapshot-recovery-v1';

export type MoviesGenerationPhysicalSnapshot = {
  generation: number;
  itemRows: number;
  distinctContentIds: number;
  categoryRows: number;
  distinctItemCategoryIds: number;
  nonzeroCategoryCount: number;
  largestCategoryId: string | null;
  largestCategoryCount: number;
};

export type MoviesGenerationIntegrityAssessment = {
  generation: number;
  itemRows: number;
  distinctContentIds: number;
  categoryRows: number;
  distinctItemCategoryIds: number;
  nonzeroCategoryCount: number;
  healthy: boolean;
  degraded: boolean;
  reason: string | null;
  physicalPassed: boolean;
  distribution: MoviesCategoryDistributionValidation | null;
};

export type MoviesReadableRecoveryDecision = {
  readableGeneration: number;
  reason:
    | 'active-integrity-passed'
    | 'recovered-prior-integrity-passed'
    | 'no-valid-snapshot'
    | 'active-degraded-recovered'
    | 'active-degraded-no-recovery';
  activeGeneration: number;
  syncingGeneration: number;
  rejectedActiveGeneration: number | null;
  rejectedActiveReason: string | null;
  pointerRepairNeeded: boolean;
};

/** Absolute + relative integrity for a Movies generation candidate. */
export function assessMoviesGenerationSnapshotIntegrity(input: {
  snapshot: MoviesGenerationPhysicalSnapshot;
  previousValidated?: {
    generation: number;
    totalItems: number;
    nonzeroCategoryCount: number;
  } | null;
}): MoviesGenerationIntegrityAssessment {
  const snap = input.snapshot;
  const physicalPassed =
    snap.itemRows > 0 &&
    snap.itemRows === snap.distinctContentIds &&
    snap.categoryRows > 0;

  if (!physicalPassed) {
    return {
      generation: snap.generation,
      itemRows: snap.itemRows,
      distinctContentIds: snap.distinctContentIds,
      categoryRows: snap.categoryRows,
      distinctItemCategoryIds: snap.distinctItemCategoryIds,
      nonzeroCategoryCount: snap.nonzeroCategoryCount,
      healthy: false,
      degraded: true,
      reason:
        snap.itemRows <= 0
          ? 'empty-generation'
          : snap.itemRows !== snap.distinctContentIds
            ? 'duplicate-content-ids'
            : 'missing-category-rows',
      physicalPassed: false,
      distribution: null,
    };
  }

  const distribution = validateMoviesCategoryDistribution({
    generation: snap.generation,
    totalItems: snap.itemRows,
    distinctCategoryIds: snap.distinctItemCategoryIds,
    metadataCategoryCount: snap.categoryRows,
    nonzeroCategoryCount: snap.nonzeroCategoryCount,
    largestCategoryId: snap.largestCategoryId,
    largestCategoryCount: snap.largestCategoryCount,
    previousGeneration: input.previousValidated?.generation ?? null,
    previousTotalItems: input.previousValidated?.totalItems ?? null,
    previousNonzeroCategoryCount: input.previousValidated?.nonzeroCategoryCount ?? null,
  });

  const integrity = assessMoviesCatalogIntegrity({
    generation: snap.generation,
    metadataCategoryCount: snap.categoryRows,
    nonzeroCategoryCount: snap.nonzeroCategoryCount,
    distinctItemCategoryIds: snap.distinctItemCategoryIds,
    totalItems: snap.itemRows,
    largestCategoryShare:
      snap.itemRows > 0 ? snap.largestCategoryCount / snap.itemRows : 0,
  });

  // Collapse vs previous is only in validateMoviesCategoryDistribution when previous is provided.
  const healthy = distribution.validationPassed && integrity.healthy;

  return {
    generation: snap.generation,
    itemRows: snap.itemRows,
    distinctContentIds: snap.distinctContentIds,
    categoryRows: snap.categoryRows,
    distinctItemCategoryIds: snap.distinctItemCategoryIds,
    nonzeroCategoryCount: snap.nonzeroCategoryCount,
    healthy,
    degraded: !healthy,
    reason: healthy
      ? null
      : distribution.rejectionReason ?? integrity.reason ?? 'sparse-active-generation',
    physicalPassed: true,
    distribution,
  };
}

/**
 * Select readable Movies generation from assessed candidates.
 * Excludes the incomplete syncing generation unless it is also the only
 * completed/ready candidate (handled by caller via candidate list).
 */
export function selectMoviesReadableRecoveryGeneration(input: {
  activeGeneration: number;
  syncingGeneration: number;
  syncStatus: string | null;
  /** Newest-first assessed candidates (must exclude incomplete syncing gen). */
  candidates: MoviesGenerationIntegrityAssessment[];
}): MoviesReadableRecoveryDecision {
  const active =
    input.activeGeneration > 0
      ? input.candidates.find((c) => c.generation === input.activeGeneration) ?? null
      : null;

  if (active?.healthy) {
    return {
      readableGeneration: active.generation,
      reason: 'active-integrity-passed',
      activeGeneration: input.activeGeneration,
      syncingGeneration: input.syncingGeneration,
      rejectedActiveGeneration: null,
      rejectedActiveReason: null,
      pointerRepairNeeded: false,
    };
  }

  const recovery = input.candidates.find(
    (c) =>
      c.healthy &&
      c.generation !== input.activeGeneration &&
      !(
        input.syncStatus === 'syncing' &&
        c.generation === input.syncingGeneration &&
        input.syncingGeneration !== input.activeGeneration
      ),
  );

  if (active && !active.healthy) {
    if (recovery) {
      return {
        readableGeneration: recovery.generation,
        reason: 'active-degraded-recovered',
        activeGeneration: input.activeGeneration,
        syncingGeneration: input.syncingGeneration,
        rejectedActiveGeneration: active.generation,
        rejectedActiveReason: active.reason,
        pointerRepairNeeded: recovery.generation !== input.activeGeneration,
      };
    }
    return {
      readableGeneration: 0,
      reason: 'active-degraded-no-recovery',
      activeGeneration: input.activeGeneration,
      syncingGeneration: input.syncingGeneration,
      rejectedActiveGeneration: active.generation,
      rejectedActiveReason: active.reason,
      pointerRepairNeeded: false,
    };
  }

  if (recovery) {
    return {
      readableGeneration: recovery.generation,
      reason: 'recovered-prior-integrity-passed',
      activeGeneration: input.activeGeneration,
      syncingGeneration: input.syncingGeneration,
      rejectedActiveGeneration: null,
      rejectedActiveReason: null,
      pointerRepairNeeded:
        input.activeGeneration > 0 && recovery.generation !== input.activeGeneration,
    };
  }

  // No active pointer — pick newest healthy candidate.
  const newestHealthy = input.candidates.find((c) => c.healthy);
  if (newestHealthy) {
    return {
      readableGeneration: newestHealthy.generation,
      reason: 'recovered-prior-integrity-passed',
      activeGeneration: input.activeGeneration,
      syncingGeneration: input.syncingGeneration,
      rejectedActiveGeneration: null,
      rejectedActiveReason: null,
      pointerRepairNeeded: newestHealthy.generation !== input.activeGeneration,
    };
  }

  return {
    readableGeneration: 0,
    reason: 'no-valid-snapshot',
    activeGeneration: input.activeGeneration,
    syncingGeneration: input.syncingGeneration,
    rejectedActiveGeneration: active?.generation ?? null,
    rejectedActiveReason: active?.reason ?? null,
    pointerRepairNeeded: false,
  };
}

/** Whether background sparse repair may blank the Movies UI. */
export function shouldBlankMoviesUiDuringSparseRepair(input: {
  hasValidatedReadableGeneration: boolean;
  hasPreservedCategories: boolean;
}): boolean {
  return !input.hasValidatedReadableGeneration && !input.hasPreservedCategories;
}

/** Full-screen repairing gate only when no validated snapshot exists. */
export function shouldShowMoviesFullScreenRepairGate(input: {
  repairing: boolean;
  hasValidatedReadableGeneration: boolean;
  hasCategories: boolean;
}): boolean {
  return input.repairing && !input.hasValidatedReadableGeneration && !input.hasCategories;
}
