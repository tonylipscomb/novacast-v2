/**
 * Stage 4.2D — detect and repair an already-active sparse Movies generation.
 * Bounded once per provider/generation. Does not touch credentials, activation,
 * Live TV, or Series data.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  getCatalogGenerationLargestCategory,
  getCatalogGenerationPhysicalStats,
  getCatalogProvider,
  resolveReadableCatalogGeneration,
} from '../catalog/catalogRepository.ts';
import { assessMoviesCatalogIntegrity } from '../catalog/moviesCategoryDistributionValidation.ts';
import { invalidateVodCategoryFilterCapability } from '../catalog/vodCategoryFilterCapability.ts';

const REPAIR_STORAGE_PREFIX = '@novacast/movies-sparse-repair/v1/';
const repairInFlight = new Set<string>();
const repairScheduled = new Set<string>();
const repairingUiByProvider = new Map<string, boolean>();

export type MoviesSparseRepairAssessment = {
  providerId: string;
  generation: number;
  degraded: boolean;
  reason: string | null;
  metadataCategoryCount: number;
  nonzeroCategoryCount: number;
  distinctItemCategoryIds: number;
  totalItems: number;
  alreadyRepaired: boolean;
};

function repairKey(providerId: string, generation: number) {
  return `${REPAIR_STORAGE_PREFIX}${providerId}:${generation}`;
}

async function hasRepairedGeneration(providerId: string, generation: number): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(repairKey(providerId, generation));
    return Boolean(raw);
  } catch {
    return false;
  }
}

async function markRepairedGeneration(providerId: string, generation: number): Promise<void> {
  try {
    await AsyncStorage.setItem(
      repairKey(providerId, generation),
      JSON.stringify({ repairedAt: Date.now(), generation }),
    );
  } catch {
    // Best-effort bound.
  }
}

export function isMoviesCatalogRepairing(providerId: string): boolean {
  return repairingUiByProvider.get(providerId) === true || repairScheduled.has(providerId);
}

export function setMoviesCatalogRepairingUi(providerId: string, repairing: boolean) {
  if (repairing) {
    repairingUiByProvider.set(providerId, true);
  } else {
    repairingUiByProvider.delete(providerId);
  }
}

export async function assessActiveMoviesCatalogIntegrity(
  providerId: string,
): Promise<MoviesSparseRepairAssessment> {
  const generation = await resolveReadableCatalogGeneration(providerId, 'movie');
  if (generation <= 0) {
    return {
      providerId,
      generation: 0,
      degraded: false,
      reason: null,
      metadataCategoryCount: 0,
      nonzeroCategoryCount: 0,
      distinctItemCategoryIds: 0,
      totalItems: 0,
      alreadyRepaired: false,
    };
  }

  const [physical, largest, alreadyRepaired] = await Promise.all([
    getCatalogGenerationPhysicalStats(providerId, 'movie', generation),
    getCatalogGenerationLargestCategory(providerId, 'movie', generation),
    hasRepairedGeneration(providerId, generation),
  ]);

  const integrity = assessMoviesCatalogIntegrity({
    metadataCategoryCount: physical.categoryRows,
    nonzeroCategoryCount: largest.nonzeroCategoryCount,
    distinctItemCategoryIds: physical.distinctItemCategoryIds,
    totalItems: physical.itemRows,
    largestCategoryShare:
      physical.itemRows > 0 ? largest.itemCount / physical.itemRows : 0,
  });

  return {
    providerId,
    generation,
    degraded: integrity.degraded,
    reason: integrity.reason,
    metadataCategoryCount: physical.categoryRows,
    nonzeroCategoryCount: largest.nonzeroCategoryCount,
    distinctItemCategoryIds: physical.distinctItemCategoryIds,
    totalItems: physical.itemRows,
    alreadyRepaired,
  };
}

export type MoviesSparseRepairScheduleFn = (input: {
  providerId: string;
  forceFullDump: boolean;
  reason: string;
}) => void;

/**
 * If the active readable Movies generation is sparse/degraded, invalidate the
 * cached filter capability and schedule a Movies-only full-dump repair once.
 */
export async function repairDegradedMoviesCatalogIfNeeded(
  providerId: string,
  scheduleRepair: MoviesSparseRepairScheduleFn,
): Promise<'healthy' | 'repairing' | 'skipped'> {
  if (repairInFlight.has(providerId) || repairScheduled.has(providerId)) {
    if (repairScheduled.has(providerId)) {
      setMoviesCatalogRepairingUi(providerId, true);
      return 'repairing';
    }
    return 'skipped';
  }

  const assessment = await assessActiveMoviesCatalogIntegrity(providerId);
  if (!assessment.degraded || assessment.generation <= 0) {
    setMoviesCatalogRepairingUi(providerId, false);
    return 'healthy';
  }
  if (assessment.alreadyRepaired) {
    // Bound: do not launch-loop. Still hide the bad rail while a sync may run.
    setMoviesCatalogRepairingUi(providerId, true);
    return 'skipped';
  }

  repairInFlight.add(providerId);
  try {
    console.info(
      '[NovaCast Movies Sparse Catalog Repair] ' +
        JSON.stringify({
          providerId,
          generation: assessment.generation,
          reason: assessment.reason,
          metadataCategoryCount: assessment.metadataCategoryCount,
          nonzeroCategoryCount: assessment.nonzeroCategoryCount,
          distinctItemCategoryIds: assessment.distinctItemCategoryIds,
          totalItems: assessment.totalItems,
          action: 'schedule-full-dump-repair',
          marker: 'stage4d-vod-ingestion-repair-v1',
        }),
    );

    await invalidateVodCategoryFilterCapability(providerId);
    await markRepairedGeneration(providerId, assessment.generation);
    repairScheduled.add(providerId);
    setMoviesCatalogRepairingUi(providerId, true);

    // Confirm provider still exists; never clear credentials/activation.
    const provider = await getCatalogProvider(providerId);
    if (!provider) {
      return 'skipped';
    }

    const {
      forceMoviesFullDumpForProvider,
      invalidateMoviesCatalogSyncCheckpoint,
    } = await import('../providers/providerCatalogSync.ts');
    forceMoviesFullDumpForProvider(providerId, assessment.reason ?? 'sparse-active-generation');
    await invalidateMoviesCatalogSyncCheckpoint(providerId);

    scheduleRepair({
      providerId,
      forceFullDump: true,
      reason: assessment.reason ?? 'sparse-active-generation',
    });
    return 'repairing';
  } finally {
    repairInFlight.delete(providerId);
  }
}

export function clearMoviesSparseCatalogRepairForTests() {
  repairInFlight.clear();
  repairScheduled.clear();
  repairingUiByProvider.clear();
}
