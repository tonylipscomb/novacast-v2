/**
 * Stage 4.2Q ΓÇö Series counterpart to `../movies/moviesSparseCatalogRepair.ts`:
 * detect and repair an already-active sparse Series generation. Bounded once
 * per provider/generation, same as the Movies original.
 *
 * Series has no dedicated "force full dump" mode the way Movies does (see
 * `forceMoviesFullDumpForProvider` in `providerCatalogSync.ts` ΓÇö a Movies-only
 * optimization for a specific provider-API quirk). A degraded Series
 * generation is instead repaired by invalidating the shared, provider-wide
 * catalog sync checkpoint (the same checkpoint Movies' repair also
 * invalidates ΓÇö it tracks both Movies and Series stage progress together)
 * and requesting a fresh `bundle.syncCatalog()` pass, which re-walks every
 * Series category from scratch. Does not touch credentials, activation,
 * Live TV, or Movies data.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  getCatalogGenerationLargestCategory,
  getCatalogGenerationPhysicalStats,
  getCatalogProvider,
  resolveReadableCatalogGeneration,
} from '../catalog/catalogRepository.ts';
import { assessCatalogIntegrity } from '../catalog/moviesCategoryDistributionValidation.ts';

const REPAIR_STORAGE_PREFIX = '@novacast/series-sparse-repair/v1/';
const repairInFlight = new Set<string>();
const repairScheduled = new Set<string>();
const repairingUiByProvider = new Map<string, boolean>();

export type SeriesSparseRepairAssessment = {
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

export function isSeriesCatalogRepairing(providerId: string): boolean {
  return repairingUiByProvider.get(providerId) === true || repairScheduled.has(providerId);
}

export function setSeriesCatalogRepairingUi(providerId: string, repairing: boolean) {
  if (repairing) {
    repairingUiByProvider.set(providerId, true);
  } else {
    repairingUiByProvider.delete(providerId);
  }
}

/** Clear in-flight repair UI/schedule after a healthy generation activates. */
export function clearSeriesSparseRepairSchedule(providerId: string) {
  repairScheduled.delete(providerId);
  setSeriesCatalogRepairingUi(providerId, false);
}

export async function assessActiveSeriesCatalogIntegrity(
  providerId: string,
): Promise<SeriesSparseRepairAssessment> {
  // Prefer the integrity-selected readable generation. If none exists, assess the
  // provider pointer so a degraded-only DB can still schedule one bounded repair.
  const readableGeneration = await resolveReadableCatalogGeneration(providerId, 'series');
  const provider = await getCatalogProvider(providerId);
  const generation =
    readableGeneration > 0 ? readableGeneration : provider?.catalogGeneration ?? 0;

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
    getCatalogGenerationPhysicalStats(providerId, 'series', generation),
    getCatalogGenerationLargestCategory(providerId, 'series', generation),
    hasRepairedGeneration(providerId, generation),
  ]);

  const integrity = assessCatalogIntegrity('series', {
    generation,
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

export type SeriesSparseRepairScheduleFn = (input: { providerId: string; reason: string }) => void;

/**
 * If the active readable Series generation is sparse/degraded, schedule a
 * Series-only full-resync repair once (bounded per provider/generation).
 */
export async function repairDegradedSeriesCatalogIfNeeded(
  providerId: string,
  scheduleRepair: SeriesSparseRepairScheduleFn,
): Promise<'healthy' | 'repairing' | 'skipped'> {
  if (repairInFlight.has(providerId)) {
    return 'skipped';
  }
  if (repairScheduled.has(providerId)) {
    // Repair already kicked off this session ΓÇö wait for activation; do not relaunch.
    return 'repairing';
  }

  const assessment = await assessActiveSeriesCatalogIntegrity(providerId);
  if (!assessment.degraded || assessment.generation <= 0) {
    clearSeriesSparseRepairSchedule(providerId);
    return 'healthy';
  }
  // Degraded active generation: schedule at most one bounded repair.
  if (assessment.alreadyRepaired) {
    // Bound once per degraded generation ΓÇö never launch gen N+1 for the same reason.
    return 'skipped';
  }

  repairInFlight.add(providerId);
  try {
    console.info(
      '[NovaCast Series Sparse Catalog Repair] ' +
        JSON.stringify({
          providerId,
          generation: assessment.generation,
          reason: assessment.reason,
          metadataCategoryCount: assessment.metadataCategoryCount,
          nonzeroCategoryCount: assessment.nonzeroCategoryCount,
          distinctItemCategoryIds: assessment.distinctItemCategoryIds,
          totalItems: assessment.totalItems,
          action: 'schedule-full-resync-repair',
          marker: 'stage4q-series-sparse-catalog-validation-v1',
        }),
    );

    await markRepairedGeneration(providerId, assessment.generation);
    repairScheduled.add(providerId);
    setSeriesCatalogRepairingUi(providerId, true);

    // Confirm provider still exists; never clear credentials/activation.
    const provider = await getCatalogProvider(providerId);
    if (!provider) {
      return 'skipped';
    }

    // Series has no dedicated full-dump flag (unlike Movies' forceMoviesFullDumpForProvider) ΓÇö
    // invalidating the shared provider-wide sync checkpoint is enough to make the
    // next syncCatalog() pass re-walk every category from scratch.
    const { invalidateMoviesCatalogSyncCheckpoint } = await import(
      '../providers/providerCatalogSync.ts'
    );
    await invalidateMoviesCatalogSyncCheckpoint(providerId);

    scheduleRepair({
      providerId,
      reason: assessment.reason ?? 'sparse-active-generation',
    });
    return 'repairing';
  } finally {
    repairInFlight.delete(providerId);
  }
}

export function clearSeriesSparseCatalogRepairForTests() {
  repairInFlight.clear();
  repairScheduled.clear();
  repairingUiByProvider.clear();
}
