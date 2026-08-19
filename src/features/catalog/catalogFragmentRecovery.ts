import {
  beginCatalogSync,
  completeCatalogSync,
  deleteCatalogGenerationV2,
  getCatalogGenerationPhysicalStats,
  getCatalogItemsPage,
  getCatalogCategoryCounts,
  getCatalogTotalCount,
  resolveReadableCatalogGeneration,
  writeCatalogCategoriesBatch,
  writeCatalogItemsBatch,
} from './catalogRepository.ts';
import { getCatalogDatabase, withCatalogTransaction } from './catalogDatabase.ts';
import { STAGE3C_GENERATION_SAFE_MARKER } from './catalogTableRouting.ts';

/** Verified ONN fragment generations that still hold movie item rows. */
const RECOVERY_SOURCE_GENERATIONS = [44, 43, 39, 36] as const;
/** Failed / current empty generations must never be recovery sources. */
const RECOVERY_EXCLUDED_GENERATIONS = new Set([48, 49]);
const CATEGORY_METADATA_SOURCE_GENERATION = 36;
const WRITE_BATCH_SIZE = 500;

const recoveryAttempted = new Set<string>();

export type MovieFragmentRecoveryResult = {
  sourceGenerations: number[];
  sourceRows: number;
  sourceDistinctContentIds: number;
  duplicateCount: number;
  recoveredGeneration: number | null;
  recoveredRows: number;
  recoveredCategoryRows: number;
  validationPassed: boolean;
  activated: boolean;
  skippedReason?: string;
};

function asNumber(value: unknown, fallback = 0) {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function asString(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : value == null ? fallback : String(value);
}

function asNullableNumber(value: unknown) {
  if (value == null || value === '') {
    return null;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function asNullableString(value: unknown) {
  return value == null ? null : asString(value);
}

function logRecovery(payload: MovieFragmentRecoveryResult & { providerId: string }) {
  console.info(
    '[NovaCast Movies Fragment Recovery] ' +
      JSON.stringify({
        providerId: payload.providerId,
        sourceGenerations: payload.sourceGenerations,
        sourceRows: payload.sourceRows,
        sourceDistinctContentIds: payload.sourceDistinctContentIds,
        duplicateCount: payload.duplicateCount,
        recoveredGeneration: payload.recoveredGeneration,
        recoveredRows: payload.recoveredRows,
        recoveredCategoryRows: payload.recoveredCategoryRows,
        validationPassed: payload.validationPassed,
        activated: payload.activated,
        skippedReason: payload.skippedReason ?? null,
        marker: STAGE3C_GENERATION_SAFE_MARKER,
      }),
  );
}

async function v2AlreadyRecovered(providerId: string): Promise<boolean> {
  const generation = await resolveReadableCatalogGeneration(providerId, 'movie');
  if (generation <= 0) {
    return false;
  }
  const stats = await getCatalogGenerationPhysicalStats(providerId, 'movie', generation);
  return (
    stats.itemRows > 1000 &&
    stats.itemRows === stats.distinctContentIds &&
    stats.categoryRows >= 439 &&
    stats.distinctItemCategoryIds > 4
  );
}

/**
 * One-time Stage 3C recovery: merge verified legacy movie fragments into a new
 * generation-safe v2 generation. Never mutates legacy fragment rows.
 */
export async function recoverFragmentedMovieCatalogOnce(
  providerId: string,
): Promise<MovieFragmentRecoveryResult> {
  if (recoveryAttempted.has(providerId)) {
    return {
      sourceGenerations: [],
      sourceRows: 0,
      sourceDistinctContentIds: 0,
      duplicateCount: 0,
      recoveredGeneration: null,
      recoveredRows: 0,
      recoveredCategoryRows: 0,
      validationPassed: false,
      activated: false,
      skippedReason: 'already-attempted',
    };
  }
  recoveryAttempted.add(providerId);

  if (await v2AlreadyRecovered(providerId)) {
    const result: MovieFragmentRecoveryResult = {
      sourceGenerations: [],
      sourceRows: 0,
      sourceDistinctContentIds: 0,
      duplicateCount: 0,
      recoveredGeneration: null,
      recoveredRows: 0,
      recoveredCategoryRows: 0,
      validationPassed: true,
      activated: false,
      skippedReason: 'v2-already-recovered',
    };
    logRecovery({ providerId, ...result });
    return result;
  }

  const db = await getCatalogDatabase();
  const sourceGenerations = RECOVERY_SOURCE_GENERATIONS.filter(
    (generation) => !RECOVERY_EXCLUDED_GENERATIONS.has(generation),
  );

  const sourceCountRow = await db.getFirst<{ total: number | string; distinct_total: number | string }>(
    `SELECT COUNT(*) AS total, COUNT(DISTINCT content_id) AS distinct_total
     FROM catalog_items
     WHERE provider_id = ?
       AND media_type = 'movie'
       AND sync_generation IN (${sourceGenerations.map(() => '?').join(', ')})`,
    [providerId, ...sourceGenerations],
  );
  const sourceRows = asNumber(sourceCountRow?.total);
  const sourceDistinctContentIds = asNumber(sourceCountRow?.distinct_total);
  const duplicateCount = Math.max(0, sourceRows - sourceDistinctContentIds);

  if (sourceDistinctContentIds <= 0) {
    const result: MovieFragmentRecoveryResult = {
      sourceGenerations: [...sourceGenerations],
      sourceRows,
      sourceDistinctContentIds,
      duplicateCount,
      recoveredGeneration: null,
      recoveredRows: 0,
      recoveredCategoryRows: 0,
      validationPassed: false,
      activated: false,
      skippedReason: 'no-legacy-source-rows',
    };
    logRecovery({ providerId, ...result });
    return result;
  }

  // Prefer highest source generation per content_id.
  const dedupedRows = await db.getAll<Record<string, unknown>>(
    `SELECT i.*
     FROM catalog_items i
     INNER JOIN (
       SELECT content_id, MAX(sync_generation) AS max_generation
       FROM catalog_items
       WHERE provider_id = ?
         AND media_type = 'movie'
         AND sync_generation IN (${sourceGenerations.map(() => '?').join(', ')})
       GROUP BY content_id
     ) best
       ON best.content_id = i.content_id
      AND best.max_generation = i.sync_generation
     WHERE i.provider_id = ?
       AND i.media_type = 'movie'`,
    [providerId, ...sourceGenerations, providerId],
  );

  const categoryRows = await db.getAll<Record<string, unknown>>(
    `SELECT *
     FROM catalog_categories
     WHERE provider_id = ?
       AND media_type = 'movie'
       AND sync_generation = ?`,
    [providerId, CATEGORY_METADATA_SOURCE_GENERATION],
  );

  const recoveredGeneration = await beginCatalogSync(providerId, 'movie', {
    phase: 'fragment-recovery',
    totalCount: dedupedRows.length,
  });

  for (let offset = 0; offset < dedupedRows.length; offset += WRITE_BATCH_SIZE) {
    const chunk = dedupedRows.slice(offset, offset + WRITE_BATCH_SIZE);
    await writeCatalogItemsBatch(
      chunk.map((row) => ({
        providerId,
        mediaType: 'movie' as const,
        contentId: asString(row.content_id),
        categoryId: asNullableString(row.category_id),
        title: asString(row.title),
        normalizedTitle: asString(row.normalized_title),
        artworkUrl: asNullableString(row.artwork_url),
        backdropUrl: asNullableString(row.backdrop_url),
        releaseDate: asNullableString(row.release_date),
        releaseYear: asNullableNumber(row.release_year),
        rating: asNullableNumber(row.rating),
        addedAt: asNullableNumber(row.added_at),
        popularity: asNullableNumber(row.popularity),
        description: asNullableString(row.description),
        streamExtension: asNullableString(row.stream_extension),
        providerSortOrder: asNullableNumber(row.provider_sort_order),
        seriesId: asNullableString(row.series_id),
        seasonNumber: asNullableNumber(row.season_number),
        episodeNumber: asNullableNumber(row.episode_number),
        syncGeneration: recoveredGeneration,
      })),
    );
  }

  await writeCatalogCategoriesBatch(
    categoryRows.map((row) => ({
      providerId,
      mediaType: 'movie' as const,
      categoryId: asString(row.category_id),
      categoryName: asString(row.category_name),
      sortOrder: asNullableNumber(row.sort_order),
      itemCount: asNumber(row.item_count),
      syncGeneration: recoveredGeneration,
    })),
    { mediaType: 'movie' },
  );

  const physical = await getCatalogGenerationPhysicalStats(providerId, 'movie', recoveredGeneration);
  const totalCount = await getCatalogTotalCount(providerId, 'movie', {
    generation: recoveredGeneration,
  });
  const categories = await getCatalogCategoryCounts(providerId, 'movie', {
    generation: recoveredGeneration,
  });
  const sampleChecks: boolean[] = [];
  for (const category of categories.slice(0, 8)) {
    const page = await getCatalogItemsPage({
      providerId,
      mediaType: 'movie',
      categoryId: category.categoryId,
      generation: recoveredGeneration,
      limit: 5,
      offset: 0,
    });
    sampleChecks.push(page.items.length > 0);
  }
  const allMoviesPage = await getCatalogItemsPage({
    providerId,
    mediaType: 'movie',
    generation: recoveredGeneration,
    limit: 5,
    offset: 0,
  });

  const validationPassed =
    physical.itemRows === physical.distinctContentIds &&
    physical.itemRows === dedupedRows.length &&
    physical.categoryRows === categoryRows.length &&
    physical.categoryRows === 439 &&
    physical.distinctItemCategoryIds > 4 &&
    totalCount === physical.itemRows &&
    allMoviesPage.items.length > 0 &&
    categories.length >= 5 &&
    sampleChecks.filter(Boolean).length >= 5;

  if (!validationPassed) {
    await withCatalogTransaction(async () => {
      const handle = await getCatalogDatabase();
      await handle.run(
        `UPDATE catalog_sync_state
         SET status = 'error',
             phase = 'fragment-recovery-failed',
             error_code = 'recovery_validation_failed',
             completed_at = ?
         WHERE provider_id = ? AND media_type = 'movie'`,
        [Date.now(), providerId],
      );
      await handle.run(
        `UPDATE catalog_providers
         SET sync_status = 'error',
             sync_error_code = 'recovery_validation_failed'
         WHERE provider_id = ?`,
        [providerId],
      );
    });
    await deleteCatalogGenerationV2(providerId, 'movie', recoveredGeneration);

    const result: MovieFragmentRecoveryResult = {
      sourceGenerations: [...sourceGenerations],
      sourceRows,
      sourceDistinctContentIds,
      duplicateCount,
      recoveredGeneration,
      recoveredRows: physical.itemRows,
      recoveredCategoryRows: physical.categoryRows,
      validationPassed: false,
      activated: false,
      skippedReason: `validation-failed:items=${physical.itemRows},distinct=${physical.distinctContentIds},categories=${physical.categoryRows},itemCats=${physical.distinctItemCategoryIds},providerCats=${categories.length},sampleOk=${sampleChecks.filter(Boolean).length}`,
    };
    logRecovery({ providerId, ...result });
    return result;
  }

  await completeCatalogSync(providerId, 'movie', recoveredGeneration, {
    processedCount: dedupedRows.length,
  });

  const activatedStats = await getCatalogGenerationPhysicalStats(
    providerId,
    'movie',
    recoveredGeneration,
  );
  const activated =
    activatedStats.itemRows === physical.itemRows &&
    (await resolveReadableCatalogGeneration(providerId, 'movie')) === recoveredGeneration;

  const result: MovieFragmentRecoveryResult = {
    sourceGenerations: [...sourceGenerations],
    sourceRows,
    sourceDistinctContentIds,
    duplicateCount,
    recoveredGeneration,
    recoveredRows: activatedStats.itemRows,
    recoveredCategoryRows: activatedStats.categoryRows,
    validationPassed: true,
    activated,
  };
  logRecovery({ providerId, ...result });
  return result;
}

export function resetMovieFragmentRecoveryForTests() {
  recoveryAttempted.clear();
}
