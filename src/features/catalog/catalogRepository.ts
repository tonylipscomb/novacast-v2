import {
  getCatalogDatabase,
  withCatalogTransaction,
} from './catalogDatabase.ts';
import type { CatalogSqlParams } from './catalogDatabaseDriver.ts';
import {
  CATALOG_DEFAULT_PAGE_SIZE,
  normalizeCatalogTitle,
  type CatalogCategoryRecord,
  type CatalogItemRecord,
  type CatalogItemSort,
  type CatalogItemsPage,
  type CatalogItemsPageQuery,
  type CatalogMediaType,
  type CatalogProviderRecord,
  type CatalogSeasonRecord,
  type CatalogSyncStateRecord,
  type CatalogSyncStatus,
} from './catalogTypes.ts';
import { recordCatalogWritePhase } from './catalogWritePhaseAudit.ts';
import { nowMs as perfNowMs } from './jsChunkBudget.ts';
import {
  isColdMovieCategoryBatch,
  markCategoryBatchFinished,
  nextCategoryBatchIndex,
  noteCategoryBatchBoundary,
  recordColdCategorySubPhase,
  timedColdCategorySubPhase,
} from './coldCategorySpikeAudit.ts';
import {
  STAGE3C_GENERATION_SAFE_MARKER,
  catalogCategoriesConflictTarget,
  catalogCategoriesTable,
  catalogItemsConflictTarget,
  catalogItemsTable,
  catalogSeasonsTable,
  usesGenerationSafeCatalog,
} from './catalogTableRouting.ts';
import { validateMoviesCategoryDistribution } from './moviesCategoryDistributionValidation.ts';
import {
  assessMoviesGenerationSnapshotIntegrity,
  MOVIES_FOCUS_STAGE4I_MARKER,
  selectMoviesReadableRecoveryGeneration,
  type MoviesGenerationIntegrityAssessment,
  type MoviesGenerationPhysicalSnapshot,
} from './moviesReadableSnapshotRecovery.ts';
import {
  getCachedMoviesReadableGeneration,
  resolveMoviesReadableGenerationCached,
  setCachedMoviesReadableGeneration,
} from './moviesReadableGenerationCache.ts';
import { getMoviesDetailOpenForDiagnostics } from '../movies/moviesDiagnosticsState.ts';


function nowMs() {
  return Date.now();
}

function asNumber(value: unknown, fallback = 0) {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function asString(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : value == null ? fallback : String(value);
}

function asNullableString(value: unknown) {
  return value == null ? null : asString(value);
}

function asNullableNumber(value: unknown) {
  if (value == null || value === '') {
    return null;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function mapProvider(row: Record<string, unknown>): CatalogProviderRecord {
  return {
    providerId: asString(row.provider_id),
    providerType: asString(row.provider_type),
    displayName: asNullableString(row.display_name),
    catalogGeneration: asNumber(row.catalog_generation),
    lastSuccessfulSyncAt: asNullableNumber(row.last_successful_sync_at),
    lastAttemptedSyncAt: asNullableNumber(row.last_attempted_sync_at),
    syncStatus: (asNullableString(row.sync_status) as CatalogSyncStatus | null) ?? null,
    syncErrorCode: asNullableString(row.sync_error_code),
  };
}

function mapCategory(row: Record<string, unknown>): CatalogCategoryRecord {
  return {
    providerId: asString(row.provider_id),
    mediaType: asString(row.media_type) as CatalogMediaType,
    categoryId: asString(row.category_id),
    categoryName: asString(row.category_name),
    sortOrder: asNullableNumber(row.sort_order),
    itemCount: asNumber(row.item_count),
    syncGeneration: asNumber(row.sync_generation),
    updatedAt: asNumber(row.updated_at),
  };
}

function mapItem(row: Record<string, unknown>): CatalogItemRecord {
  return {
    providerId: asString(row.provider_id),
    mediaType: asString(row.media_type) as CatalogMediaType,
    contentId: asString(row.content_id),
    categoryId: asNullableString(row.category_id),
    title: asString(row.title),
    normalizedTitle: asString(row.normalized_title),
    artworkUrl: asNullableString(row.artwork_url),
    backdropUrl: asNullableString(row.backdrop_url),
    releaseDate: asNullableString(row.release_date),
    releaseYear: asNullableNumber(row.release_year),
    rating: asNullableNumber(row.rating),
    description: asNullableString(row.description),
    streamExtension: asNullableString(row.stream_extension),
    providerSortOrder: asNullableNumber(row.provider_sort_order),
    seriesId: asNullableString(row.series_id),
    seasonNumber: asNullableNumber(row.season_number),
    episodeNumber: asNullableNumber(row.episode_number),
    syncGeneration: asNumber(row.sync_generation),
    updatedAt: asNumber(row.updated_at),
  };
}

function mapSeason(row: Record<string, unknown>): CatalogSeasonRecord {
  return {
    providerId: asString(row.provider_id),
    seriesId: asString(row.series_id),
    seasonNumber: asNumber(row.season_number),
    title: asNullableString(row.title),
    artworkUrl: asNullableString(row.artwork_url),
    episodeCount: asNumber(row.episode_count),
    syncGeneration: asNumber(row.sync_generation),
    updatedAt: asNumber(row.updated_at),
  };
}

function mapSyncState(row: Record<string, unknown>): CatalogSyncStateRecord {
  return {
    providerId: asString(row.provider_id),
    mediaType: asString(row.media_type) as CatalogMediaType,
    status: asString(row.status) as CatalogSyncStatus,
    phase: asNullableString(row.phase),
    processedCount: asNumber(row.processed_count),
    totalCount: asNullableNumber(row.total_count),
    generation: asNumber(row.generation),
    startedAt: asNullableNumber(row.started_at),
    completedAt: asNullableNumber(row.completed_at),
    errorCode: asNullableString(row.error_code),
  };
}

function orderByClause(sort: CatalogItemSort | undefined) {
  switch (sort) {
    case 'newest':
      return 'release_year DESC NULLS LAST, normalized_title ASC, content_id ASC';
    case 'oldest':
      return 'release_year ASC NULLS LAST, normalized_title ASC, content_id ASC';
    case 'title-desc':
      return 'normalized_title DESC, content_id ASC';
    case 'rating':
      return 'rating DESC NULLS LAST, normalized_title ASC, content_id ASC';
    case 'provider':
      return 'provider_sort_order ASC NULLS LAST, normalized_title ASC, content_id ASC';
    case 'title':
    default:
      return 'normalized_title ASC, content_id ASC';
  }
}

/** SQLite before 3.30 may not support NULLS LAST; use IS NULL / CASE for broader compatibility. */
function orderByClauseCompatible(sort: CatalogItemSort | undefined) {
  switch (sort) {
    case 'newest':
      return '(release_year IS NULL) ASC, release_year DESC, normalized_title ASC, content_id ASC';
    case 'oldest':
      return '(release_year IS NULL) ASC, release_year ASC, normalized_title ASC, content_id ASC';
    case 'title-desc':
      return 'normalized_title DESC, content_id ASC';
    case 'rating':
      return '(rating IS NULL) ASC, rating DESC, normalized_title ASC, content_id ASC';
    case 'provider':
      return '(provider_sort_order IS NULL) ASC, provider_sort_order ASC, normalized_title ASC, content_id ASC';
    case 'title':
    default:
      return 'normalized_title ASC, content_id ASC';
  }
}

void orderByClause;

export async function upsertCatalogProvider(input: {
  providerId: string;
  providerType: string;
  displayName?: string | null;
}): Promise<void> {
  const db = await getCatalogDatabase();
  await db.run(
    `INSERT INTO catalog_providers (
      provider_id, provider_type, display_name, catalog_generation, sync_status
    ) VALUES (?, ?, ?, 0, 'idle')
    ON CONFLICT(provider_id) DO UPDATE SET
      provider_type = excluded.provider_type,
      display_name = excluded.display_name`,
    [input.providerId, input.providerType, input.displayName ?? null],
  );
}

async function resolveNextSyncGeneration(providerId: string, mediaType: CatalogMediaType) {
  const db = await getCatalogDatabase();
  const itemsTable = catalogItemsTable(mediaType);
  const categoriesTable = catalogCategoriesTable(mediaType);
  const seasonsTable = catalogSeasonsTable(mediaType);
  const row = await db.getFirst<{ max_g: number | null }>(
    `SELECT MAX(g) AS max_g FROM (
       SELECT catalog_generation AS g FROM catalog_providers WHERE provider_id = ?
       UNION ALL
       SELECT generation AS g FROM catalog_sync_state WHERE provider_id = ? AND media_type = ?
       UNION ALL
       SELECT COALESCE(MAX(sync_generation), 0) AS g FROM ${itemsTable} WHERE provider_id = ? AND media_type = ?
       UNION ALL
       SELECT COALESCE(MAX(sync_generation), 0) AS g FROM ${categoriesTable} WHERE provider_id = ? AND media_type = ?
       UNION ALL
       SELECT COALESCE(MAX(sync_generation), 0) AS g FROM ${seasonsTable} WHERE provider_id = ?
       UNION ALL
       SELECT COALESCE(MAX(sync_generation), 0) AS g FROM catalog_items WHERE provider_id = ? AND media_type = ?
       UNION ALL
       SELECT COALESCE(MAX(sync_generation), 0) AS g FROM catalog_categories WHERE provider_id = ? AND media_type = ?
     )`,
    [
      providerId,
      providerId,
      mediaType,
      providerId,
      mediaType,
      providerId,
      mediaType,
      providerId,
      providerId,
      mediaType,
      providerId,
      mediaType,
    ],
  );
  return asNumber(row?.max_g, 0) + 1;
}

function logCatalogV2Generation(payload: {
  providerId: string;
  mediaType: CatalogMediaType;
  generation: number;
  phase: string;
  itemRows: number;
  distinctContentIds: number;
  categoryRows: number;
  distinctItemCategoryIds: number;
  ready: boolean;
  activated: boolean;
}) {
  console.info('[NovaCast Catalog V2 Generation] ' + JSON.stringify(payload));
}

/**
 * Starts a sync generation for provider+mediaType.
 * Does not delete prior successful data ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â that happens on completeCatalogSync.
 */
export async function beginCatalogSync(
  providerId: string,
  mediaType: CatalogMediaType,
  options?: { phase?: string; totalCount?: number | null },
): Promise<number> {
  return withCatalogTransaction(async () => {
    const db = await getCatalogDatabase();
    const generation = await resolveNextSyncGeneration(providerId, mediaType);
    const startedAt = nowMs();

    await db.run(
      `INSERT INTO catalog_providers (
        provider_id, provider_type, display_name, catalog_generation,
        last_attempted_sync_at, sync_status, sync_error_code
      ) VALUES (?, 'unknown', NULL, 0, ?, 'syncing', NULL)
      ON CONFLICT(provider_id) DO UPDATE SET
        last_attempted_sync_at = excluded.last_attempted_sync_at,
        sync_status = 'syncing',
        sync_error_code = NULL`,
      [providerId, startedAt],
    );

    await db.run(
      `INSERT INTO catalog_sync_state (
        provider_id, media_type, status, phase, processed_count, total_count,
        generation, started_at, completed_at, error_code
      ) VALUES (?, ?, 'syncing', ?, 0, ?, ?, ?, NULL, NULL)
      ON CONFLICT(provider_id, media_type) DO UPDATE SET
        status = 'syncing',
        phase = excluded.phase,
        processed_count = 0,
        total_count = excluded.total_count,
        generation = excluded.generation,
        started_at = excluded.started_at,
        completed_at = NULL,
        error_code = NULL`,
      [
        providerId,
        mediaType,
        options?.phase ?? 'categories',
        options?.totalCount ?? null,
        generation,
        startedAt,
      ],
    );

    return generation;
  });
}

export async function writeCatalogCategoriesBatch(
  categories: Array<Omit<CatalogCategoryRecord, 'itemCount' | 'updatedAt'> & {
    itemCount?: number;
    updatedAt?: number;
  }>,
  options?: { mediaType?: CatalogMediaType },
): Promise<number> {
  if (!categories.length) {
    return 0;
  }

  const mediaType = options?.mediaType ?? categories[0]?.mediaType;
  const batchIndex = nextCategoryBatchIndex(mediaType ?? 'movie');
  const cold = mediaType === 'movie' && isColdMovieCategoryBatch(batchIndex);
  noteCategoryBatchBoundary(mediaType, batchIndex);
  const batchStart = perfNowMs();
  let mutexWaitMs = 0;
  let prepareMs = 0;
  let executeMs = 0;
  let finalizeMs = 0;

  const db = await timedColdCategorySubPhase(
    'getDb',
    { mediaType, batchIndex, itemCount: categories.length, cold },
    () => getCatalogDatabase(),
  );

  const resolvedMediaType = (mediaType ?? categories[0]?.mediaType ?? 'movie') as CatalogMediaType;
  const categoriesTable = catalogCategoriesTable(resolvedMediaType);
  const categoryConflict = catalogCategoriesConflictTarget(resolvedMediaType);
  const categoryConflictUpdate = usesGenerationSafeCatalog(resolvedMediaType)
    ? `category_name = excluded.category_name,
      sort_order = excluded.sort_order,
      item_count = excluded.item_count,
      updated_at = excluded.updated_at`
    : `category_name = excluded.category_name,
      sort_order = excluded.sort_order,
      item_count = excluded.item_count,
      sync_generation = excluded.sync_generation,
      updated_at = excluded.updated_at`;
  const sql = `INSERT INTO ${categoriesTable} (
      provider_id, media_type, category_id, category_name, sort_order,
      item_count, sync_generation, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(${categoryConflict}) DO UPDATE SET
      ${categoryConflictUpdate}`;

  const prepareStart = perfNowMs();
  const statement = await db.prepare(sql);
  prepareMs = perfNowMs() - prepareStart;
  recordColdCategorySubPhase({
    phase: 'prepare',
    mediaType,
    batchIndex,
    itemCount: categories.length,
    wallMs: prepareMs,
    cold,
  });
  if (cold || prepareMs >= 100) {
    recordCatalogWritePhase('category.prepare', {
      wallMs: prepareMs,
      itemCount: categories.length,
    });
  }

  try {
    const mutexStart = perfNowMs();
    const written = await withCatalogTransaction(async () => {
      mutexWaitMs = perfNowMs() - mutexStart;
      recordColdCategorySubPhase({
        phase: 'mutexWait',
        mediaType,
        batchIndex,
        itemCount: categories.length,
        wallMs: mutexWaitMs,
        cold,
      });

      let count = 0;
      const writeStart = perfNowMs();
      for (const category of categories) {
        const updatedAt = category.updatedAt ?? nowMs();
        await statement.execute([
          category.providerId,
          category.mediaType,
          category.categoryId,
          category.categoryName,
          category.sortOrder ?? null,
          category.itemCount ?? 0,
          category.syncGeneration,
          updatedAt,
        ]);
        count += 1;
      }
      executeMs = perfNowMs() - writeStart;
      recordColdCategorySubPhase({
        phase: 'bindExecute',
        mediaType,
        batchIndex,
        itemCount: count,
        wallMs: executeMs,
        cold,
      });
      if (cold || executeMs >= 100) {
        recordCatalogWritePhase('category.write', {
          wallMs: executeMs,
          itemCount: count,
        });
      }
      return count;
    });

    return written;
  } finally {
    const finalizeStart = perfNowMs();
    await statement.finalize();
    finalizeMs = perfNowMs() - finalizeStart;
    recordColdCategorySubPhase({
      phase: 'finalize',
      mediaType,
      batchIndex,
      itemCount: categories.length,
      wallMs: finalizeMs,
      cold,
    });
    recordColdCategorySubPhase({
      phase: 'batchTotal',
      mediaType,
      batchIndex,
      itemCount: categories.length,
      wallMs: perfNowMs() - batchStart,
      cold,
      yieldedBefore: true,
      yieldedAfter: true,
    });
    markCategoryBatchFinished(mediaType);
    const totalMs = perfNowMs() - batchStart;
    if (cold || totalMs >= 100) {
      console.info('[NovaCast ColdCategorySpike]', {
        phase: 'batchBreakdown',
        mediaType,
        batchIndex,
        itemCount: categories.length,
        cold,
        prepareMs: Math.round(prepareMs * 10) / 10,
        mutexWaitMs: Math.round(mutexWaitMs * 10) / 10,
        bindExecuteMs: Math.round(executeMs * 10) / 10,
        finalizeMs: Math.round(finalizeMs * 10) / 10,
        batchTotalMs: Math.round(totalMs * 10) / 10,
      });
    }
  }
}

export async function writeCatalogItemsBatch(
  items: Array<
    Omit<CatalogItemRecord, 'normalizedTitle' | 'updatedAt'> & {
      normalizedTitle?: string;
      updatedAt?: number;
    }
  >,
): Promise<number> {
  if (!items.length) {
    return 0;
  }

  const db = await getCatalogDatabase();
  const mediaType = (items[0]?.mediaType ?? 'movie') as CatalogMediaType;
  const itemsTable = catalogItemsTable(mediaType);
  const itemConflict = catalogItemsConflictTarget(mediaType);
  const itemConflictUpdate = usesGenerationSafeCatalog(mediaType)
    ? `category_id = excluded.category_id,
      title = excluded.title,
      normalized_title = excluded.normalized_title,
      artwork_url = excluded.artwork_url,
      backdrop_url = excluded.backdrop_url,
      release_date = excluded.release_date,
      release_year = excluded.release_year,
      rating = excluded.rating,
      description = excluded.description,
      stream_extension = excluded.stream_extension,
      provider_sort_order = excluded.provider_sort_order,
      series_id = excluded.series_id,
      season_number = excluded.season_number,
      episode_number = excluded.episode_number,
      updated_at = excluded.updated_at`
    : `category_id = excluded.category_id,
      title = excluded.title,
      normalized_title = excluded.normalized_title,
      artwork_url = excluded.artwork_url,
      backdrop_url = excluded.backdrop_url,
      release_date = excluded.release_date,
      release_year = excluded.release_year,
      rating = excluded.rating,
      description = excluded.description,
      stream_extension = excluded.stream_extension,
      provider_sort_order = excluded.provider_sort_order,
      series_id = excluded.series_id,
      season_number = excluded.season_number,
      episode_number = excluded.episode_number,
      sync_generation = excluded.sync_generation,
      updated_at = excluded.updated_at`;
  const sql = `INSERT INTO ${itemsTable} (
      provider_id, media_type, content_id, category_id, title, normalized_title,
      artwork_url, backdrop_url, release_date, release_year, rating, description,
      stream_extension, provider_sort_order, series_id, season_number, episode_number,
      sync_generation, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(${itemConflict}) DO UPDATE SET
      ${itemConflictUpdate}`;

  const prepareStart = perfNowMs();
  const statement = await db.prepare(sql);
  recordCatalogWritePhase('item.prepare', {
    wallMs: perfNowMs() - prepareStart,
    itemCount: items.length,
  });

  try {
    return await withCatalogTransaction(async () => {
      let written = 0;
      const writeStart = perfNowMs();
      for (const item of items) {
        const updatedAt = item.updatedAt ?? nowMs();
        const normalizedTitle = item.normalizedTitle ?? normalizeCatalogTitle(item.title);
        await statement.execute([
          item.providerId,
          item.mediaType,
          item.contentId,
          item.categoryId ?? null,
          item.title,
          normalizedTitle,
          item.artworkUrl ?? null,
          item.backdropUrl ?? null,
          item.releaseDate ?? null,
          item.releaseYear ?? null,
          item.rating ?? null,
          item.description ?? null,
          item.streamExtension ?? null,
          item.providerSortOrder ?? null,
          item.seriesId ?? null,
          item.seasonNumber ?? null,
          item.episodeNumber ?? null,
          item.syncGeneration,
          updatedAt,
        ]);
        written += 1;
      }
      recordCatalogWritePhase('item.write', {
        wallMs: perfNowMs() - writeStart,
        itemCount: written,
      });
      return written;
    });
  } finally {
    await statement.finalize();
  }
}

export async function writeCatalogSeasonsBatch(
  seasons: Array<Omit<CatalogSeasonRecord, 'updatedAt' | 'episodeCount'> & {
    episodeCount?: number;
    updatedAt?: number;
  }>,
): Promise<number> {
  if (!seasons.length) {
    return 0;
  }

  return withCatalogTransaction(async () => {
    const db = await getCatalogDatabase();
    const sql = `INSERT INTO catalog_seasons (
      provider_id, series_id, season_number, title, artwork_url,
      episode_count, sync_generation, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(provider_id, series_id, season_number) DO UPDATE SET
      title = excluded.title,
      artwork_url = excluded.artwork_url,
      episode_count = excluded.episode_count,
      sync_generation = excluded.sync_generation,
      updated_at = excluded.updated_at`;

    const statement = await db.prepare(sql);
    let written = 0;
    try {
      for (const season of seasons) {
        await statement.execute([
          season.providerId,
          season.seriesId,
          season.seasonNumber,
          season.title ?? null,
          season.artworkUrl ?? null,
          season.episodeCount ?? 0,
          season.syncGeneration,
          season.updatedAt ?? nowMs(),
        ]);
        written += 1;
      }
    } finally {
      await statement.finalize();
    }
    return written;
  });
}

/**
 * Prefer SQLite-native GROUP BY aggregation over a giant JS pass.
 * Old successful generation stays readable until completeCatalogSync swaps status.
 */
export async function recomputeCategoryCounts(
  providerId: string,
  mediaType: CatalogMediaType,
  generation: number,
): Promise<{ categoryCount: number; totalItems: number }> {
  const db = await getCatalogDatabase();
  const itemsTable = catalogItemsTable(mediaType);
  const categoriesTable = catalogCategoriesTable(mediaType);
  const aggregateStart = perfNowMs();
  const aggregates = await db.getAll<{ category_id: string; cnt: number | string }>(
    `SELECT category_id, COUNT(*) AS cnt
     FROM ${itemsTable}
     WHERE provider_id = ? AND media_type = ? AND sync_generation = ?
     GROUP BY category_id`,
    [providerId, mediaType, generation],
  );
  recordCatalogWritePhase('counts.aggregate', {
    wallMs: perfNowMs() - aggregateStart,
    itemCount: aggregates.length,
  });

  const updatedAt = nowMs();
  const updateStart = perfNowMs();

  // Zero counts for categories in this generation that may have no items.
  await db.run(
    `UPDATE ${categoriesTable}
     SET item_count = 0, updated_at = ?
     WHERE provider_id = ? AND media_type = ? AND sync_generation = ?`,
    [updatedAt, providerId, mediaType, generation],
  );

  const statement = await db.prepare(
    `UPDATE ${categoriesTable}
     SET item_count = ?, updated_at = ?
     WHERE provider_id = ? AND media_type = ? AND category_id = ? AND sync_generation = ?`,
  );
  let totalItems = 0;
  try {
    for (const row of aggregates) {
      const count = asNumber(row.cnt);
      totalItems += count;
      await statement.execute([
        count,
        updatedAt,
        providerId,
        mediaType,
        asString(row.category_id),
        generation,
      ]);
    }
  } finally {
    await statement.finalize();
  }

  recordCatalogWritePhase('counts.update', {
    wallMs: perfNowMs() - updateStart,
    itemCount: aggregates.length,
    meta: { totalItems },
  });

  return { categoryCount: aggregates.length, totalItems };
}

/**
 * Legacy series cleanup: delete every generation except keepGeneration.
 * Movies v2 uses {@link cleanupIncompleteCatalogGenerationsV2} instead so the
 * previous completed generation remains readable during and after publish.
 */
export async function deleteStaleCatalogGeneration(
  providerId: string,
  mediaType: CatalogMediaType,
  keepGeneration: number,
): Promise<void> {
  if (usesGenerationSafeCatalog(mediaType)) {
    await cleanupIncompleteCatalogGenerationsV2(providerId, mediaType, [keepGeneration]);
    return;
  }

  const db = await getCatalogDatabase();
  const start = perfNowMs();
  await db.run(
    `DELETE FROM catalog_items
     WHERE provider_id = ? AND media_type = ? AND sync_generation != ?`,
    [providerId, mediaType, keepGeneration],
  );
  await db.run(
    `DELETE FROM catalog_categories
     WHERE provider_id = ? AND media_type = ? AND sync_generation != ?`,
    [providerId, mediaType, keepGeneration],
  );
  if (mediaType === 'series') {
    await db.run(
      `DELETE FROM catalog_seasons
       WHERE provider_id = ? AND sync_generation != ?`,
      [providerId, keepGeneration],
    );
  }
  recordCatalogWritePhase('stale.delete', {
    wallMs: perfNowMs() - start,
    itemCount: 1,
    meta: { providerId, mediaType, keepGeneration },
  });
}

/**
 * Movies v2 cleanup: retain the listed generations (current + previous completed)
 * and delete only other incomplete/failed v2 generations. Never touches legacy tables.
 */
export async function cleanupIncompleteCatalogGenerationsV2(
  providerId: string,
  mediaType: CatalogMediaType,
  keepGenerations: number[],
): Promise<void> {
  if (!usesGenerationSafeCatalog(mediaType)) {
    return;
  }
  const keep = [...new Set(keepGenerations.filter((generation) => generation > 0))];
  const db = await getCatalogDatabase();
  const start = perfNowMs();

  if (!keep.length) {
    await db.run(
      `DELETE FROM catalog_items_v2 WHERE provider_id = ? AND media_type = ?`,
      [providerId, mediaType],
    );
    await db.run(
      `DELETE FROM catalog_categories_v2 WHERE provider_id = ? AND media_type = ?`,
      [providerId, mediaType],
    );
    await db.run(
      `DELETE FROM catalog_seasons_v2 WHERE provider_id = ? AND media_type = ?`,
      [providerId, mediaType],
    );
  } else {
    const placeholders = keep.map(() => '?').join(', ');
    const params: CatalogSqlParams = [providerId, mediaType, ...keep];
    await db.run(
      `DELETE FROM catalog_items_v2
       WHERE provider_id = ? AND media_type = ? AND sync_generation NOT IN (${placeholders})`,
      params,
    );
    await db.run(
      `DELETE FROM catalog_categories_v2
       WHERE provider_id = ? AND media_type = ? AND sync_generation NOT IN (${placeholders})`,
      params,
    );
    await db.run(
      `DELETE FROM catalog_seasons_v2
       WHERE provider_id = ? AND media_type = ? AND sync_generation NOT IN (${placeholders})`,
      params,
    );
  }

  recordCatalogWritePhase('stale.delete', {
    wallMs: perfNowMs() - start,
    itemCount: 1,
    meta: { providerId, mediaType, keepGenerations: keep, marker: STAGE3C_GENERATION_SAFE_MARKER },
  });
}

export async function deleteCatalogGenerationV2(
  providerId: string,
  mediaType: CatalogMediaType,
  generation: number,
): Promise<void> {
  if (!usesGenerationSafeCatalog(mediaType) || generation <= 0) {
    return;
  }
  const db = await getCatalogDatabase();
  await db.run(
    `DELETE FROM catalog_items_v2
     WHERE provider_id = ? AND media_type = ? AND sync_generation = ?`,
    [providerId, mediaType, generation],
  );
  await db.run(
    `DELETE FROM catalog_categories_v2
     WHERE provider_id = ? AND media_type = ? AND sync_generation = ?`,
    [providerId, mediaType, generation],
  );
  await db.run(
    `DELETE FROM catalog_seasons_v2
     WHERE provider_id = ? AND media_type = ? AND sync_generation = ?`,
    [providerId, mediaType, generation],
  );
}

export async function getCatalogGenerationPhysicalStats(
  providerId: string,
  mediaType: CatalogMediaType,
  generation: number,
): Promise<{
  itemRows: number;
  distinctContentIds: number;
  categoryRows: number;
  distinctItemCategoryIds: number;
}> {
  const db = await getCatalogDatabase();
  const itemsTable = catalogItemsTable(mediaType);
  const categoriesTable = catalogCategoriesTable(mediaType);
  const itemStats = await db.getFirst<{ total: number | string; distinct_total: number | string; distinct_categories: number | string }>(
    `SELECT COUNT(*) AS total,
            COUNT(DISTINCT content_id) AS distinct_total,
            COUNT(DISTINCT category_id) AS distinct_categories
     FROM ${itemsTable}
     WHERE provider_id = ? AND media_type = ? AND sync_generation = ?`,
    [providerId, mediaType, generation],
  );
  const categoryStats = await db.getFirst<{ total: number | string }>(
    `SELECT COUNT(*) AS total
     FROM ${categoriesTable}
     WHERE provider_id = ? AND media_type = ? AND sync_generation = ?`,
    [providerId, mediaType, generation],
  );
  return {
    itemRows: asNumber(itemStats?.total),
    distinctContentIds: asNumber(itemStats?.distinct_total),
    categoryRows: asNumber(categoryStats?.total),
    distinctItemCategoryIds: asNumber(itemStats?.distinct_categories),
  };
}

/** Stage 3C.2: largest category share from item rows (pre-activation). */
export async function getCatalogGenerationLargestCategory(
  providerId: string,
  mediaType: CatalogMediaType,
  generation: number,
): Promise<{ categoryId: string | null; itemCount: number; nonzeroCategoryCount: number }> {
  const db = await getCatalogDatabase();
  const itemsTable = catalogItemsTable(mediaType);
  const rows = await db.getAll<{ category_id: string; item_count: number | string }>(
    `SELECT category_id, COUNT(*) AS item_count
     FROM ${itemsTable}
     WHERE provider_id = ? AND media_type = ? AND sync_generation = ?
     GROUP BY category_id
     ORDER BY item_count DESC`,
    [providerId, mediaType, generation],
  );
  const top = rows[0];
  return {
    categoryId: top ? asString(top.category_id) : null,
    itemCount: top ? asNumber(top.item_count) : 0,
    nonzeroCategoryCount: rows.filter((row) => asNumber(row.item_count) > 0).length,
  };
}

export async function completeCatalogSync(
  providerId: string,
  mediaType: CatalogMediaType,
  generation: number,
  options?: {
    processedCount?: number;
    categories?: Array<Omit<CatalogCategoryRecord, 'itemCount' | 'updatedAt'> & {
      itemCount?: number;
      updatedAt?: number;
    }>;
  },
): Promise<boolean> {
  const publishedCategoryCount = options?.categories?.length ?? 0;
  const categoriesTable = catalogCategoriesTable(mediaType);
  const categoryConflict = catalogCategoriesConflictTarget(mediaType);
  const categoryConflictUpdate = usesGenerationSafeCatalog(mediaType)
    ? `category_name = excluded.category_name,
          sort_order = excluded.sort_order,
          item_count = excluded.item_count,
          updated_at = excluded.updated_at`
    : `category_name = excluded.category_name,
          sort_order = excluded.sort_order,
          item_count = excluded.item_count,
          sync_generation = excluded.sync_generation,
          updated_at = excluded.updated_at`;

  let activated = false;
  let physical = {
    itemRows: 0,
    distinctContentIds: 0,
    categoryRows: 0,
    distinctItemCategoryIds: 0,
  };

  await withCatalogTransaction(async () => {
    const db = await getCatalogDatabase();
    const provider = await getCatalogProvider(providerId);
    const previousCompletedGeneration = provider?.catalogGeneration ?? 0;

    if (options?.categories?.length) {
      const statement = await db.prepare(`
        INSERT INTO ${categoriesTable} (
          provider_id, media_type, category_id, category_name, sort_order,
          item_count, sync_generation, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(${categoryConflict}) DO UPDATE SET
          ${categoryConflictUpdate}
      `);
      try {
        for (const category of options.categories) {
          await statement.execute([
            category.providerId,
            category.mediaType,
            category.categoryId,
            category.categoryName,
            category.sortOrder ?? null,
            category.itemCount ?? 0,
            category.syncGeneration,
            category.updatedAt ?? nowMs(),
          ]);
        }
      } finally {
        await statement.finalize();
      }
    }

    await recomputeCategoryCounts(providerId, mediaType, generation);
    physical = await getCatalogGenerationPhysicalStats(providerId, mediaType, generation);

    let previousItemRows = 0;
    if (
      usesGenerationSafeCatalog(mediaType) &&
      previousCompletedGeneration > 0 &&
      previousCompletedGeneration !== generation
    ) {
      previousItemRows = (
        await getCatalogGenerationPhysicalStats(providerId, mediaType, previousCompletedGeneration)
      ).itemRows;
    }

    // Ghost-completion guard: never publish an empty or inconsistent generation.
    // Stage 4.2I: Movies also require full distribution / integrity validation.
    let rejectionCode = 'complete_validation_failed';
    let validationPassed =
      physical.itemRows > 0 &&
      physical.itemRows === physical.distinctContentIds &&
      (mediaType !== 'movie' || physical.categoryRows > 0);

    if (validationPassed && mediaType === 'movie') {
      const largest = await getCatalogGenerationLargestCategory(providerId, mediaType, generation);
      let previousTotalItems: number | null = null;
      let previousNonzero: number | null = null;
      if (previousCompletedGeneration > 0 && previousCompletedGeneration !== generation) {
        previousTotalItems = previousItemRows;
        const prevLargest = await getCatalogGenerationLargestCategory(
          providerId,
          mediaType,
          previousCompletedGeneration,
        );
        previousNonzero = prevLargest.nonzeroCategoryCount;
      }
      const distribution = validateMoviesCategoryDistribution({
        generation,
        totalItems: physical.itemRows,
        distinctCategoryIds: physical.distinctItemCategoryIds,
        metadataCategoryCount: physical.categoryRows,
        nonzeroCategoryCount: largest.nonzeroCategoryCount,
        largestCategoryId: largest.categoryId,
        largestCategoryCount: largest.itemCount,
        previousGeneration:
          previousCompletedGeneration > 0 ? previousCompletedGeneration : null,
        previousTotalItems,
        previousNonzeroCategoryCount: previousNonzero,
      });
      if (!distribution.validationPassed) {
        validationPassed = false;
        rejectionCode = distribution.rejectionReason ?? 'category_distribution_failed';
        console.info(
          '[NovaCast Movies Generation Activation] ' +
            JSON.stringify({
              event: 'movies_generation_activation_rejected',
              providerId,
              generation,
              itemRows: physical.itemRows,
              categoryRows: physical.categoryRows,
              distinctItemCategoryIds: physical.distinctItemCategoryIds,
              nonzeroCategoryCount: largest.nonzeroCategoryCount,
              integrityDecision: 'rejected',
              reason: rejectionCode,
              marker: MOVIES_FOCUS_STAGE4I_MARKER,
            }),
        );
      } else {
        console.info(
          '[NovaCast Movies Generation Activation] ' +
            JSON.stringify({
              event: 'movies_generation_activation_passed',
              providerId,
              generation,
              itemRows: physical.itemRows,
              categoryRows: physical.categoryRows,
              distinctItemCategoryIds: physical.distinctItemCategoryIds,
              nonzeroCategoryCount: largest.nonzeroCategoryCount,
              integrityDecision: 'passed',
              reason: null,
              marker: MOVIES_FOCUS_STAGE4I_MARKER,
            }),
        );
      }
    }

    if (!validationPassed) {
      logCatalogV2Generation({
        providerId,
        mediaType,
        generation,
        phase: 'complete-rejected',
        ...physical,
        ready: false,
        activated: false,
      });
      await db.run(
        `UPDATE catalog_sync_state
         SET status = 'error',
             phase = 'complete-rejected',
             processed_count = COALESCE(?, processed_count),
             completed_at = ?,
             error_code = ?,
             generation = ?
         WHERE provider_id = ? AND media_type = ?`,
        [
          options?.processedCount ?? null,
          nowMs(),
          rejectionCode,
          generation,
          providerId,
          mediaType,
        ],
      );
      // Keep provider.catalogGeneration unchanged; do not delete older candidates.
      return;
    }

    if (usesGenerationSafeCatalog(mediaType)) {
      // Stage 4.2I: retain newly active + immediately previous validated generation only.
      const keep = [generation];
      if (previousCompletedGeneration > 0 && previousCompletedGeneration !== generation) {
        const previousStats = await getCatalogGenerationPhysicalStats(
          providerId,
          mediaType,
          previousCompletedGeneration,
        );
        if (previousStats.itemRows > 0) {
          keep.push(previousCompletedGeneration);
        }
      }
      await cleanupIncompleteCatalogGenerationsV2(providerId, mediaType, keep);
    } else {
      await deleteStaleCatalogGeneration(providerId, mediaType, generation);
    }

    const completedAt = nowMs();
    await db.run(
      `UPDATE catalog_sync_state
       SET status = 'ready',
           phase = 'complete',
           processed_count = COALESCE(?, processed_count),
           completed_at = ?,
           error_code = NULL,
           generation = ?
       WHERE provider_id = ? AND media_type = ?`,
      [options?.processedCount ?? null, completedAt, generation, providerId, mediaType],
    );

    // catalog_generation updates only after physical validation passed above.
    await db.run(
      `UPDATE catalog_providers
       SET catalog_generation = ?,
           last_successful_sync_at = ?,
           sync_status = 'ready',
           sync_error_code = NULL
       WHERE provider_id = ?`,
      [generation, completedAt, providerId],
    );
    activated = true;
  });

  logCatalogV2Generation({
    providerId,
    mediaType,
    generation,
    phase: activated ? 'complete-activated' : 'complete-rejected',
    ...physical,
    ready: activated,
    activated,
  });
  if (!activated) {
    return false;
  }
  if (mediaType === 'movie') {
    console.info(
      '[NovaCast Movies Generation Activation] ' +
        JSON.stringify({
          event: 'movies_generation_swap_committed',
          providerId,
          generation,
          itemRows: physical.itemRows,
          categoryRows: physical.categoryRows,
          distinctItemCategoryIds: physical.distinctItemCategoryIds,
          integrityDecision: 'activated',
          reason: null,
          marker: MOVIES_FOCUS_STAGE4I_MARKER,
        }),
    );
  }
  console.info('[Catalog Categories Published]', {
    providerId,
    mediaType,
    generation,
    categoryCount: publishedCategoryCount,
  });
  return true;
}

export async function getCatalogGenerationItemCount(
  providerId: string,
  mediaType: CatalogMediaType,
  generation: number,
): Promise<number> {
  const stats = await getCatalogGenerationPhysicalStats(providerId, mediaType, generation);
  return stats.itemRows;
}

/**
 * Stage 4.2L: lightweight generation presence check — COUNT(*) only.
 * Avoids COUNT(DISTINCT …) used by physical stats during startup.
 */
export async function getCatalogGenerationRowCount(
  providerId: string,
  mediaType: CatalogMediaType,
  generation: number,
): Promise<number> {
  if (generation <= 0) {
    return 0;
  }
  const db = await getCatalogDatabase();
  const itemsTable = catalogItemsTable(mediaType);
  const row = await db.getFirst<{ total: number | string }>(
    `SELECT COUNT(*) AS total
     FROM ${itemsTable}
     WHERE provider_id = ? AND media_type = ? AND sync_generation = ?`,
    [providerId, mediaType, generation],
  );
  return asNumber(row?.total);
}

/**
 * Stage 4.2L: category rail metadata without GROUP BY item counts.
 * Startup paints the rail immediately; counts refresh in the background.
 */
export async function getCatalogCategoryMetadataOnly(
  providerId: string,
  mediaType: CatalogMediaType,
  options?: { generation?: number },
): Promise<Array<{ categoryId: string; categoryName: string; sortOrder: number | null }>> {
  const db = await getCatalogDatabase();
  const generation = options?.generation ?? (await resolveActiveGeneration(providerId, mediaType));
  if (generation <= 0) {
    return [];
  }
  const categoriesTable = catalogCategoriesTable(mediaType);
  const metadataRows = await db.getAll<{
    category_id: string;
    category_name: string;
    sort_order: number | string | null;
  }>(
    `SELECT category_id, category_name, sort_order
     FROM ${categoriesTable}
     WHERE provider_id = ? AND media_type = ? AND sync_generation = ?
     ORDER BY (sort_order IS NULL) ASC, sort_order ASC, category_name ASC`,
    [providerId, mediaType, generation],
  );
  return metadataRows
    .map((row) => ({
      categoryId: asString(row.category_id),
      categoryName: asString(row.category_name),
      sortOrder: asNullableNumber(row.sort_order),
    }))
    .filter((row) => row.categoryId.trim() && row.categoryName.trim());
}

export async function getCatalogGenerationItemStats(
  providerId: string,
  mediaType: CatalogMediaType,
  generation: number,
): Promise<{ rowCount: number; distinctContentCount: number }> {
  const stats = await getCatalogGenerationPhysicalStats(providerId, mediaType, generation);
  return {
    rowCount: stats.itemRows,
    distinctContentCount: stats.distinctContentIds,
  };
}

export async function failCatalogSync(
  providerId: string,
  mediaType: CatalogMediaType,
  errorCode: string,
): Promise<void> {
  const db = await getCatalogDatabase();
  const failedAt = nowMs();
  const state = await getCatalogSyncState(providerId, mediaType);
  const provider = await getCatalogProvider(providerId);
  const failedGeneration = state?.generation ?? 0;

  await db.run(
    `UPDATE catalog_sync_state
     SET status = 'error',
         error_code = ?,
         completed_at = ?
     WHERE provider_id = ? AND media_type = ?`,
    [errorCode, failedAt, providerId, mediaType],
  );

  // Never leave a failed empty generation as lastCompletedGeneration.
  let clearGhostCompletion = false;
  if (
    failedGeneration > 0 &&
    (provider?.catalogGeneration ?? 0) === failedGeneration
  ) {
    const physical = await getCatalogGenerationPhysicalStats(providerId, mediaType, failedGeneration);
    clearGhostCompletion = physical.itemRows <= 0;
  }

  if (clearGhostCompletion) {
    await db.run(
      `UPDATE catalog_providers
       SET catalog_generation = 0,
           sync_status = 'error',
           sync_error_code = ?
       WHERE provider_id = ?`,
      [errorCode, providerId],
    );
  } else {
    await db.run(
      `UPDATE catalog_providers
       SET sync_status = 'error',
           sync_error_code = ?
       WHERE provider_id = ?`,
      [errorCode, providerId],
    );
  }

  if (usesGenerationSafeCatalog(mediaType) && failedGeneration > 0) {
    const physical = await getCatalogGenerationPhysicalStats(providerId, mediaType, failedGeneration);
    logCatalogV2Generation({
      providerId,
      mediaType,
      generation: failedGeneration,
      phase: 'fail',
      ...physical,
      ready: false,
      activated: false,
    });
  }
}

export async function getCatalogSyncState(
  providerId: string,
  mediaType: CatalogMediaType,
): Promise<CatalogSyncStateRecord | null> {
  const db = await getCatalogDatabase();
  const row = await db.getFirst(
    `SELECT * FROM catalog_sync_state WHERE provider_id = ? AND media_type = ?`,
    [providerId, mediaType],
  );
  return row ? mapSyncState(row) : null;
}

export async function getCatalogProvider(providerId: string): Promise<CatalogProviderRecord | null> {
  const db = await getCatalogDatabase();
  const row = await db.getFirst(`SELECT * FROM catalog_providers WHERE provider_id = ?`, [providerId]);
  return row ? mapProvider(row) : null;
}

const catalogGenerationInventoryLogged = new Set<string>();

/**
 * Diagnostics-only one-shot inventory of every physical movie/series generation
 * still present in SQLite for a provider. Never mutates catalog state.
 */
export async function logCatalogGenerationInventoryOnce(
  providerId: string,
  mediaType: CatalogMediaType,
  resolverDecision: {
    currentAttemptGeneration: number;
    currentStatus: CatalogSyncStatus | null;
    lastCompletedGeneration: number;
    lastFailedGeneration: number;
    previousPathEligible: boolean;
    resolvedReadableGeneration: number;
    readableRowCount: number;
    reason: string;
  },
): Promise<void> {
  const key = `${providerId}:${mediaType}`;
  if (catalogGenerationInventoryLogged.has(key)) {
    return;
  }
  catalogGenerationInventoryLogged.add(key);

  try {
    const db = await getCatalogDatabase();
    const state = await getCatalogSyncState(providerId, mediaType);
    const provider = await getCatalogProvider(providerId);

    const itemsTable = catalogItemsTable(mediaType);
    const categoriesTable = catalogCategoriesTable(mediaType);
    const itemRows = await db.getAll<{
      sync_generation: number | string;
      item_rows: number | string;
      distinct_content_ids: number | string;
      distinct_item_category_ids: number | string;
    }>(
      `SELECT sync_generation,
              COUNT(*) AS item_rows,
              COUNT(DISTINCT content_id) AS distinct_content_ids,
              COUNT(DISTINCT category_id) AS distinct_item_category_ids
       FROM ${itemsTable}
       WHERE provider_id = ? AND media_type = ?
       GROUP BY sync_generation
       ORDER BY sync_generation DESC`,
      [providerId, mediaType],
    );

    const categoryRows = await db.getAll<{
      sync_generation: number | string;
      category_rows: number | string;
    }>(
      `SELECT sync_generation, COUNT(*) AS category_rows
       FROM ${categoriesTable}
       WHERE provider_id = ? AND media_type = ?
       GROUP BY sync_generation
       ORDER BY sync_generation DESC`,
      [providerId, mediaType],
    );

    const seasonRows = await db.getAll<{
      sync_generation: number | string;
      season_rows: number | string;
    }>(
      `SELECT sync_generation, COUNT(*) AS season_rows
       FROM catalog_seasons
       WHERE provider_id = ?
       GROUP BY sync_generation
       ORDER BY sync_generation DESC`,
      [providerId],
    );

    const itemByGen = new Map(
      itemRows.map((row) => [
        asNumber(row.sync_generation),
        {
          itemRows: asNumber(row.item_rows),
          distinctContentIds: asNumber(row.distinct_content_ids),
          distinctItemCategoryIds: asNumber(row.distinct_item_category_ids),
        },
      ]),
    );
    const categoryByGen = new Map(
      categoryRows.map((row) => [asNumber(row.sync_generation), asNumber(row.category_rows)]),
    );
    const seasonByGen = new Map(
      seasonRows.map((row) => [asNumber(row.sync_generation), asNumber(row.season_rows)]),
    );

    const generationNumbers = new Set<number>([
      ...itemByGen.keys(),
      ...categoryByGen.keys(),
      ...seasonByGen.keys(),
      state?.generation ?? 0,
      provider?.catalogGeneration ?? 0,
    ]);
    generationNumbers.delete(0);

    const generations = [...generationNumbers]
      .sort((left, right) => right - left)
      .map((generation) => {
        const items = itemByGen.get(generation);
        const isCurrentAttempt = (state?.generation ?? 0) === generation;
        return {
          generation,
          itemRows: items?.itemRows ?? 0,
          distinctContentIds: items?.distinctContentIds ?? 0,
          categoryRows: categoryByGen.get(generation) ?? 0,
          distinctItemCategoryIds: items?.distinctItemCategoryIds ?? 0,
          seasonRows: seasonByGen.get(generation) ?? 0,
          markedReady: (provider?.catalogGeneration ?? 0) === generation,
          markedFailed: isCurrentAttempt && state?.status === 'error',
          completedAt: isCurrentAttempt ? (state?.completedAt ?? null) : null,
          failureReason: isCurrentAttempt && state?.status === 'error' ? (state?.errorCode ?? null) : null,
        };
      });

    console.info(
      '[NovaCast Catalog Generation Inventory] ' +
        JSON.stringify({
          providerId,
          mediaType,
          syncState: {
            status: state?.status ?? null,
            phase: state?.phase ?? null,
            generation: state?.generation ?? 0,
            processedCount: state?.processedCount ?? 0,
            totalCount: state?.totalCount ?? null,
            startedAt: state?.startedAt ?? null,
            completedAt: state?.completedAt ?? null,
            errorCode: state?.errorCode ?? null,
            providerCatalogGeneration: provider?.catalogGeneration ?? 0,
            providerSyncStatus: provider?.syncStatus ?? null,
            providerSyncErrorCode: provider?.syncErrorCode ?? null,
            providerLastSuccessfulSyncAt: provider?.lastSuccessfulSyncAt ?? null,
            providerLastAttemptedSyncAt: provider?.lastAttemptedSyncAt ?? null,
          },
          generations,
          resolverDecision,
          schemaNotes:
            mediaType === 'movie'
              ? {
                  itemsTable: 'catalog_items_v2',
                  categoriesTable: 'catalog_categories_v2',
                  itemPrimaryKey: 'provider_id,media_type,sync_generation,content_id',
                  categoryPrimaryKey: 'provider_id,media_type,sync_generation,category_id',
                  syncGenerationInPrimaryKey: true,
                  staleDeleteOnComplete: true,
                }
              : {
                  itemsTable: 'catalog_items',
                  categoriesTable: 'catalog_categories',
                  itemPrimaryKey: 'provider_id,media_type,content_id',
                  categoryPrimaryKey: 'provider_id,media_type,category_id',
                  syncGenerationNotInPrimaryKey: true,
                  staleDeleteOnComplete: true,
                },
        }),
    );
  } catch (error) {
    console.info(
      '[NovaCast Catalog Generation Inventory] ' +
        JSON.stringify({
          providerId,
          mediaType,
          inventoryError: error instanceof Error ? error.message : String(error),
          resolverDecision,
        }),
    );
  }
}

export async function resolveReadableCatalogGeneration(
  providerId: string,
  mediaType: CatalogMediaType,
): Promise<number> {
  if (mediaType === 'movie') {
    return resolveMoviesReadableCatalogGeneration(providerId);
  }

  const db = await getCatalogDatabase();
  const itemsTable = catalogItemsTable(mediaType);
  const categoriesTable = catalogCategoriesTable(mediaType);
  const state = await getCatalogSyncState(providerId, mediaType);
  const provider = await getCatalogProvider(providerId);
  const currentAttemptGeneration = state?.generation ?? 0;
  let lastCompletedGeneration = provider?.catalogGeneration ?? 0;
  const lastFailedGeneration =
    state?.status === 'syncing' || state?.status === 'error' ? currentAttemptGeneration : 0;
  let resolvedReadableGeneration = 0;
  let reason:
    | 'current-ready'
    | 'previous-during-sync'
    | 'previous-after-failure'
    | 'recovered-completed-generation'
    | 'no-readable-generation'
    | 'ghost-completion-ignored' = 'no-readable-generation';

  const hasReadableRows = async (generation: number) => {
    if (generation <= 0) {
      return 0;
    }
    const row = await db.getFirst<{ row_count: number | string }>(
      `SELECT COUNT(*) AS row_count
       FROM ${itemsTable} i
       WHERE i.provider_id = ? AND i.media_type = ? AND i.sync_generation = ?
         AND (
           ? != 'movie' OR EXISTS (
             SELECT 1
             FROM ${categoriesTable} c
             WHERE c.provider_id = i.provider_id
               AND c.media_type = i.media_type
               AND c.sync_generation = i.sync_generation
           )
         )`,
      [providerId, mediaType, generation, mediaType],
    );
    return asNumber(row?.row_count);
  };

  // Ghost completion: catalog_generation pointing at zero rows is not completed.
  if (lastCompletedGeneration > 0) {
    const ghostRows = await hasReadableRows(lastCompletedGeneration);
    if (ghostRows <= 0) {
      reason = 'ghost-completion-ignored';
      lastCompletedGeneration = 0;
    }
  }

  if (state?.status === 'ready' && currentAttemptGeneration > 0) {
    const readyRows = await hasReadableRows(currentAttemptGeneration);
    if (readyRows > 0) {
      resolvedReadableGeneration = currentAttemptGeneration;
      reason = 'current-ready';
    }
  } else if (
    lastCompletedGeneration > 0 &&
    lastCompletedGeneration !== currentAttemptGeneration
  ) {
    resolvedReadableGeneration = lastCompletedGeneration;
    reason = state?.status === 'error' ? 'previous-after-failure' : 'previous-during-sync';
  }

  let readableRowCount = await hasReadableRows(resolvedReadableGeneration);
  if (readableRowCount <= 0) {
    const fallback = await db.getFirst<{ sync_generation: number | string; row_count: number | string }>(
      `SELECT i.sync_generation, COUNT(*) AS row_count
       FROM ${itemsTable} i
       WHERE i.provider_id = ? AND i.media_type = ?
         AND (? = 0 OR i.sync_generation != ?)
         AND (
           ? != 'movie' OR EXISTS (
             SELECT 1
             FROM ${categoriesTable} c
             WHERE c.provider_id = i.provider_id
               AND c.media_type = i.media_type
               AND c.sync_generation = i.sync_generation
           )
         )
       GROUP BY i.sync_generation
       HAVING COUNT(*) > 0
       ORDER BY i.sync_generation DESC
       LIMIT 1`,
      [providerId, mediaType, lastFailedGeneration, lastFailedGeneration, mediaType],
    );
    if (fallback) {
      resolvedReadableGeneration = asNumber(fallback.sync_generation);
      readableRowCount = asNumber(fallback.row_count);
      reason = 'recovered-completed-generation';
    } else {
      resolvedReadableGeneration = 0;
      if (reason !== 'ghost-completion-ignored') {
        reason = 'no-readable-generation';
      }
    }
  }

  const resolvedReason =
    resolvedReadableGeneration > 0
      ? reason === 'ghost-completion-ignored'
        ? 'recovered-completed-generation'
        : reason
      : reason === 'ghost-completion-ignored'
        ? 'no-readable-generation'
        : reason;
  console.info(
    '[Catalog Read Generation] ' +
      JSON.stringify({
        providerId,
        mediaType,
        currentAttemptGeneration,
        currentStatus: state?.status ?? null,
        lastCompletedGeneration: provider?.catalogGeneration ?? 0,
        resolvedReadableGeneration,
        readableRowCount,
        reason: resolvedReason,
        marker: usesGenerationSafeCatalog(mediaType) ? STAGE3C_GENERATION_SAFE_MARKER : null,
      }),
  );

  // Diagnostics only — never changes the resolved generation above.
  void logCatalogGenerationInventoryOnce(providerId, mediaType, {
    currentAttemptGeneration,
    currentStatus: state?.status ?? null,
    lastCompletedGeneration: provider?.catalogGeneration ?? 0,
    lastFailedGeneration,
    previousPathEligible:
      (provider?.catalogGeneration ?? 0) > 0 &&
      (provider?.catalogGeneration ?? 0) !== currentAttemptGeneration,
    resolvedReadableGeneration,
    readableRowCount,
    reason: resolvedReason,
  });

  return resolvedReadableGeneration;
}


async function loadMoviesGenerationPhysicalSnapshot(
  providerId: string,
  generation: number,
): Promise<MoviesGenerationPhysicalSnapshot> {
  const [physical, largest] = await Promise.all([
    getCatalogGenerationPhysicalStats(providerId, 'movie', generation),
    getCatalogGenerationLargestCategory(providerId, 'movie', generation),
  ]);
  return {
    generation,
    itemRows: physical.itemRows,
    distinctContentIds: physical.distinctContentIds,
    categoryRows: physical.categoryRows,
    distinctItemCategoryIds: physical.distinctItemCategoryIds,
    nonzeroCategoryCount: largest.nonzeroCategoryCount,
    largestCategoryId: largest.categoryId,
    largestCategoryCount: largest.itemCount,
  };
}

async function listMoviesGenerationCandidateNumbers(
  providerId: string,
  excludeIncompleteSyncingGeneration: number,
): Promise<number[]> {
  const db = await getCatalogDatabase();
  const rows = await db.getAll<{ sync_generation: number | string }>(
    `SELECT sync_generation
     FROM catalog_items_v2
     WHERE provider_id = ? AND media_type = 'movie'
       AND (? = 0 OR sync_generation != ?)
     GROUP BY sync_generation
     HAVING COUNT(*) > 0
     ORDER BY sync_generation DESC`,
    [providerId, excludeIncompleteSyncingGeneration, excludeIncompleteSyncingGeneration],
  );
  return rows.map((row) => asNumber(row.sync_generation)).filter((generation) => generation > 0);
}

async function assessMoviesGenerationCandidate(
  providerId: string,
  generation: number,
  previousValidated: {
    generation: number;
    totalItems: number;
    nonzeroCategoryCount: number;
  } | null,
): Promise<MoviesGenerationIntegrityAssessment> {
  const snapshot = await loadMoviesGenerationPhysicalSnapshot(providerId, generation);
  const assessment = assessMoviesGenerationSnapshotIntegrity({
    snapshot,
    previousValidated,
  });
  console.info(
    '[NovaCast Movies Readable Recovery] ' +
      JSON.stringify({
        event: 'movies_readable_candidate_assessed',
        providerId,
        generation,
        itemRows: assessment.itemRows,
        categoryRows: assessment.categoryRows,
        distinctItemCategoryIds: assessment.distinctItemCategoryIds,
        nonzeroCategoryCount: assessment.nonzeroCategoryCount,
        integrityDecision: assessment.healthy ? 'passed' : 'rejected',
        reason: assessment.reason,
        marker: MOVIES_FOCUS_STAGE4I_MARKER,
      }),
  );
  return assessment;
}

/** Bounded transactional pointer repair — credentials/activation untouched. */
export async function repairMoviesProviderCatalogGenerationPointer(
  providerId: string,
  recoveredGeneration: number,
): Promise<boolean> {
  if (recoveredGeneration <= 0) {
    return false;
  }
  let repaired = false;
  await withCatalogTransaction(async () => {
    const db = await getCatalogDatabase();
    const provider = await getCatalogProvider(providerId);
    if (!provider || provider.catalogGeneration === recoveredGeneration) {
      return;
    }
    const previous = provider.catalogGeneration;
    await db.run(
      `UPDATE catalog_providers
       SET catalog_generation = ?
       WHERE provider_id = ?`,
      [recoveredGeneration, providerId],
    );
    repaired = true;
    console.info(
      '[NovaCast Movies Readable Recovery] ' +
        JSON.stringify({
          event: 'movies_provider_generation_repaired',
          providerId,
          generation: recoveredGeneration,
          previousGeneration: previous,
          itemRows: null,
          categoryRows: null,
          distinctItemCategoryIds: null,
          integrityDecision: 'pointer-repaired',
          reason: 'recovered-validated-generation',
          marker: MOVIES_FOCUS_STAGE4I_MARKER,
        }),
    );
  });
  return repaired;
}

/**
 * Stage 4.2I: integrity-aware Movies readable generation selection.
 * Stage 4.2J: share one in-flight Promise + cache a validated generation so
 * syncing/errored newer gens do not rescan 16/15/14/13/8 on every read.
 * Never accepts a marked generation merely because it has one or more rows.
 */
async function resolveMoviesReadableCatalogGeneration(providerId: string): Promise<number> {
  return resolveMoviesReadableGenerationCached({
    providerId,
    getMeta: async () => {
      const state = await getCatalogSyncState(providerId, 'movie');
      const provider = await getCatalogProvider(providerId);
      const cached = getCachedMoviesReadableGeneration(providerId);
      return {
        itemRows: cached?.itemRows ?? 0,
        categoryRows: cached?.categoryRows ?? 0,
        distinctItemCategoryIds: cached?.distinctItemCategoryIds ?? 0,
        activeProviderGeneration: provider?.catalogGeneration ?? 0,
        syncingGeneration: state?.generation ?? 0,
        syncStatus: state?.status ?? null,
      };
    },
    resolve: async () => resolveMoviesReadableCatalogGenerationUncached(providerId),
  });
}

async function resolveMoviesReadableCatalogGenerationUncached(providerId: string): Promise<number> {
  const state = await getCatalogSyncState(providerId, 'movie');
  const provider = await getCatalogProvider(providerId);
  const currentAttemptGeneration = state?.generation ?? 0;
  const syncStatus = state?.status ?? null;
  const activeGeneration = provider?.catalogGeneration ?? 0;
  const excludeSyncing =
    syncStatus === 'syncing' && currentAttemptGeneration > 0 ? currentAttemptGeneration : 0;

  const candidateNumbers = await listMoviesGenerationCandidateNumbers(providerId, excludeSyncing);
  // Always consider the active pointer even if it equals an excluded syncing gen
  // that somehow completed with rows (ready path). When syncing, exclude incomplete.
  if (
    activeGeneration > 0 &&
    !candidateNumbers.includes(activeGeneration) &&
    !(excludeSyncing > 0 && activeGeneration === excludeSyncing)
  ) {
    candidateNumbers.unshift(activeGeneration);
  }

  // Assess newest-first on absolute integrity. Collapse-vs-previous is enforced
  // at activation time; recovery must still reopen a prior validated snapshot.
  const assessments: MoviesGenerationIntegrityAssessment[] = [];
  for (const generation of candidateNumbers) {
    assessments.push(await assessMoviesGenerationCandidate(providerId, generation, null));
  }

  const decision = selectMoviesReadableRecoveryGeneration({
    activeGeneration,
    syncingGeneration: currentAttemptGeneration,
    syncStatus,
    candidates: assessments,
  });

  if (decision.rejectedActiveGeneration != null) {
    const rejected = assessments.find((a) => a.generation === decision.rejectedActiveGeneration);
    console.info(
      '[NovaCast Movies Readable Recovery] ' +
        JSON.stringify({
          event: 'movies_degraded_active_rejected',
          providerId,
          generation: decision.rejectedActiveGeneration,
          itemRows: rejected?.itemRows ?? null,
          categoryRows: rejected?.categoryRows ?? null,
          distinctItemCategoryIds: rejected?.distinctItemCategoryIds ?? null,
          integrityDecision: 'rejected',
          reason: decision.rejectedActiveReason,
          marker: MOVIES_FOCUS_STAGE4I_MARKER,
        }),
    );
  }

  if (decision.readableGeneration > 0) {
    const selected = assessments.find((a) => a.generation === decision.readableGeneration);
    console.info(
      '[NovaCast Movies Readable Recovery] ' +
        JSON.stringify({
          event: 'movies_recovery_generation_selected',
          providerId,
          generation: decision.readableGeneration,
          itemRows: selected?.itemRows ?? null,
          categoryRows: selected?.categoryRows ?? null,
          distinctItemCategoryIds: selected?.distinctItemCategoryIds ?? null,
          integrityDecision: 'selected',
          reason: decision.reason,
          marker: MOVIES_FOCUS_STAGE4I_MARKER,
        }),
    );
    if (decision.pointerRepairNeeded) {
      await repairMoviesProviderCatalogGenerationPointer(providerId, decision.readableGeneration);
    }
    setCachedMoviesReadableGeneration({
      providerId,
      generation: decision.readableGeneration,
      resolvedAt: Date.now(),
      itemRows: selected?.itemRows ?? 0,
      categoryRows: selected?.categoryRows ?? 0,
      distinctItemCategoryIds: selected?.distinctItemCategoryIds ?? 0,
    });
  } else {
    console.info(
      '[NovaCast Movies Readable Recovery] ' +
        JSON.stringify({
          event: 'movies_no_valid_snapshot',
          providerId,
          generation: 0,
          itemRows: 0,
          categoryRows: 0,
          distinctItemCategoryIds: 0,
          integrityDecision: 'none',
          reason: decision.reason,
          marker: MOVIES_FOCUS_STAGE4I_MARKER,
        }),
    );
  }

  const readableRowCount =
    decision.readableGeneration > 0
      ? (assessments.find((a) => a.generation === decision.readableGeneration)?.itemRows ?? 0)
      : 0;

  console.info(
    '[Catalog Read Generation] ' +
      JSON.stringify({
        providerId,
        mediaType: 'movie',
        currentAttemptGeneration,
        currentStatus: syncStatus,
        lastCompletedGeneration: activeGeneration,
        resolvedReadableGeneration: decision.readableGeneration,
        readableRowCount,
        reason: decision.reason,
        marker: MOVIES_FOCUS_STAGE4I_MARKER,
      }),
  );

  // Stage 4.2J: defer diagnostic inventory while Detail owns the screen.
  if (!getMoviesDetailOpenForDiagnostics()) {
    void logCatalogGenerationInventoryOnce(providerId, 'movie', {
      currentAttemptGeneration,
      currentStatus: syncStatus,
      lastCompletedGeneration: activeGeneration,
      lastFailedGeneration:
        syncStatus === 'syncing' || syncStatus === 'error' ? currentAttemptGeneration : 0,
      previousPathEligible: activeGeneration > 0 && activeGeneration !== currentAttemptGeneration,
      resolvedReadableGeneration: decision.readableGeneration,
      readableRowCount,
      reason: decision.reason,
    });
  }

  return decision.readableGeneration;
}

export async function resolveReadableCategoryGeneration(
  providerId: string,
  mediaType: CatalogMediaType,
): Promise<number> {
  const db = await getCatalogDatabase();
  const categoriesTable = catalogCategoriesTable(mediaType);
  const state = await getCatalogSyncState(providerId, mediaType);
  const provider = await getCatalogProvider(providerId);
  const currentAttemptGeneration = state?.generation ?? 0;
  const currentStatus = state?.status ?? null;
  const lastCompletedGeneration = provider?.catalogGeneration ?? 0;

  const countValidCategoryRows = async (generation: number) => {
    if (generation <= 0) {
      return 0;
    }
    const row = await db.getFirst<{ row_count: number | string }>(
      `SELECT COUNT(*) AS row_count
       FROM ${categoriesTable}
       WHERE provider_id = ? AND media_type = ? AND sync_generation = ?
         AND TRIM(COALESCE(category_id, '')) != ''
         AND TRIM(COALESCE(category_name, '')) != ''`,
      [providerId, mediaType, generation],
    );
    return asNumber(row?.row_count);
  };

  let resolvedCategoryGeneration = 0;
  let categoryRowCount = 0;
  let reason:
    | 'current-sync-category-generation'
    | 'completed-category-generation'
    | 'no-readable-category-generation' = 'no-readable-category-generation';

  if (currentAttemptGeneration > 0) {
    const rows = await countValidCategoryRows(currentAttemptGeneration);
    if (rows > 0) {
      resolvedCategoryGeneration = currentAttemptGeneration;
      categoryRowCount = rows;
      reason =
        currentStatus === 'ready'
          ? 'completed-category-generation'
          : 'current-sync-category-generation';
    }
  }

  if (reason === 'no-readable-category-generation' && lastCompletedGeneration > 0) {
    const rows = await countValidCategoryRows(lastCompletedGeneration);
    if (rows > 0) {
      resolvedCategoryGeneration = lastCompletedGeneration;
      categoryRowCount = rows;
      reason = 'completed-category-generation';
    }
  }

  if (reason === 'no-readable-category-generation') {
    const row = await db.getFirst<{ sync_generation: number | string; row_count: number | string }>(
      `SELECT sync_generation, COUNT(*) AS row_count
       FROM ${categoriesTable}
       WHERE provider_id = ? AND media_type = ?
         AND TRIM(COALESCE(category_id, '')) != ''
         AND TRIM(COALESCE(category_name, '')) != ''
       GROUP BY sync_generation
       ORDER BY sync_generation DESC
       LIMIT 1`,
      [providerId, mediaType],
    );
    const newestGeneration = asNumber(row?.sync_generation);
    const rows = asNumber(row?.row_count);
    if (newestGeneration > 0 && rows > 0) {
      resolvedCategoryGeneration = newestGeneration;
      categoryRowCount = rows;
      reason = 'completed-category-generation';
    }
  }

  console.info(
    '[NovaCast Category Read Generation] ' +
      JSON.stringify({
        providerId,
        mediaType,
        currentAttemptGeneration,
        currentStatus,
        lastCompletedGeneration,
        resolvedCategoryGeneration,
        categoryRowCount,
        reason,
      }),
  );

  return resolvedCategoryGeneration;
}

const resolveActiveGeneration = resolveReadableCatalogGeneration;

export async function getCatalogCategoryCounts(
  providerId: string,
  mediaType: CatalogMediaType,
  options?: { generation?: number; includeZeroCountCategories?: boolean },
): Promise<Array<{ categoryId: string; categoryName: string; itemCount: number; sortOrder: number | null }>> {
  const db = await getCatalogDatabase();
  const generation = options?.generation ?? (await resolveActiveGeneration(providerId, mediaType));
  const includeZeroCountCategories = Boolean(options?.includeZeroCountCategories);
  if (generation <= 0) {
    return [];
  }

  const itemsTable = catalogItemsTable(mediaType);
  const categoriesTable = catalogCategoriesTable(mediaType);

  // Stage 3C.1 Movies: one metadata query + one grouped item-count query.
  // Never N+1 per category and never page-load to derive counts.
  if (usesGenerationSafeCatalog(mediaType)) {
    const [metadataRows, groupedCountRows, totalRow] = await Promise.all([
      db.getAll<{
        category_id: string;
        category_name: string;
        sort_order: number | string | null;
      }>(
        `SELECT category_id, category_name, sort_order
         FROM ${categoriesTable}
         WHERE provider_id = ? AND media_type = ? AND sync_generation = ?
         ORDER BY (sort_order IS NULL) ASC, sort_order ASC, category_name ASC`,
        [providerId, mediaType, generation],
      ),
      db.getAll<{ category_id: string; item_count: number | string }>(
        `SELECT category_id, COUNT(*) AS item_count
         FROM ${itemsTable}
         WHERE provider_id = ? AND media_type = ? AND sync_generation = ?
         GROUP BY category_id`,
        [providerId, mediaType, generation],
      ),
      db.getFirst<{ total: number | string }>(
        `SELECT COUNT(*) AS total
         FROM ${itemsTable}
         WHERE provider_id = ? AND media_type = ? AND sync_generation = ?`,
        [providerId, mediaType, generation],
      ),
    ]);

    const countsById = new Map(
      groupedCountRows.map((row) => [asString(row.category_id), asNumber(row.item_count)]),
    );
    const mapped = metadataRows.map((row) => {
      const categoryId = asString(row.category_id);
      return {
        categoryId,
        categoryName: asString(row.category_name),
        itemCount: countsById.get(categoryId) ?? 0,
        sortOrder: asNullableNumber(row.sort_order),
      };
    });
    // Category-rail readiness may include zero-count rows while items are still syncing.
    // Item pages remain gated by resolveReadableCatalogGeneration separately.
    const merged = includeZeroCountCategories
      ? mapped.filter((row) => row.categoryId.trim() && row.categoryName.trim())
      : mapped.filter((row) => row.itemCount > 0);
    const allMoviesTotal = asNumber(totalRow?.total);
    const looksCollapsed =
      metadataRows.length >= 8 &&
      allMoviesTotal >= 500 &&
      merged.length > 0 &&
      merged.length <= 2 &&
      merged.length < metadataRows.length * 0.2;

    const nonzeroCategoryCount = groupedCountRows.filter(
      (row) => asNumber(row.item_count) > 0,
    ).length;
    const zeroCountCategoryCount = Math.max(0, metadataRows.length - nonzeroCategoryCount);
    const interactiveCategoryCount = includeZeroCountCategories
      ? nonzeroCategoryCount
      : merged.length;

    console.info(
      '[NovaCast Movies Category Counts] ' +
        JSON.stringify({
          providerId,
          readableGeneration: generation,
          categoriesGeneration: generation,
          itemsGeneration: generation,
          generationAligned: true,
          metadataCategoryCount: metadataRows.length,
          categoryMetadataCount: metadataRows.length,
          groupedCountRows: groupedCountRows.length,
          nonzeroCategoryCount,
          zeroCountCategoryCount,
          interactiveCategoryCount,
          appliedCategoryCount: merged.length,
          allMoviesTotal,
          collapsedCategoryIds: looksCollapsed,
          firstCounts: merged.slice(0, 5).map((row) => ({
            categoryId: row.categoryId,
            itemCount: row.itemCount,
          })),
          reason: looksCollapsed
            ? 'grouped-items-v2-collapsed-diagnostic'
            : includeZeroCountCategories
              ? 'grouped-items-v2-metadata-including-zero'
              : 'grouped-items-v2-merge',
          marker: 'stage4e-atomic-generation-pinning-v1',
        }),
    );

    return merged;
  }

  const rows = await db.getAll(
    `SELECT
       c.category_id,
       c.category_name,
       COUNT(i.content_id) AS item_count,
       c.sort_order
     FROM ${categoriesTable} c
     LEFT JOIN ${itemsTable} i
       ON i.provider_id = c.provider_id
      AND i.media_type = c.media_type
      AND i.sync_generation = c.sync_generation
      AND i.category_id = c.category_id
     WHERE c.provider_id = ?
       AND c.media_type = ?
       AND c.sync_generation = ?
     GROUP BY c.category_id, c.category_name, c.sort_order
     HAVING COUNT(i.content_id) > 0
     ORDER BY (c.sort_order IS NULL) ASC, c.sort_order ASC, c.category_name ASC`,
    [providerId, mediaType, generation],
  );

  return rows.map((row) => ({
    categoryId: asString(row.category_id),
    categoryName: asString(row.category_name),
    itemCount: asNumber(row.item_count),
    sortOrder: asNullableNumber(row.sort_order),
  }));
}

export async function getCatalogTotalCount(
  providerId: string,
  mediaType: CatalogMediaType,
  options?: { categoryId?: string | null; query?: string | null; generation?: number },
): Promise<number> {
  const db = await getCatalogDatabase();
  const generation =
    options?.generation ?? (await resolveActiveGeneration(providerId, mediaType));
  if (generation <= 0) {
    return 0;
  }

  const itemsTable = catalogItemsTable(mediaType);
  const params: CatalogSqlParams = [providerId, mediaType, generation];
  let sql = `SELECT COUNT(*) AS total
    FROM ${itemsTable}
    WHERE provider_id = ? AND media_type = ? AND sync_generation = ?`;

  if (options?.categoryId) {
    sql += ' AND category_id = ?';
    params.push(options.categoryId);
  }

  if (options?.query?.trim()) {
    sql += ' AND normalized_title LIKE ?';
    params.push(`%${normalizeCatalogTitle(options.query)}%`);
  }

  const row = await db.getFirst<{ total: number }>(sql, params);
  return asNumber(row?.total);
}

export async function getCatalogItemsPage(query: CatalogItemsPageQuery): Promise<CatalogItemsPage> {
  const db = await getCatalogDatabase();
  const generation = query.generation ?? (await resolveActiveGeneration(query.providerId, query.mediaType));
  const limit = Math.min(Math.max(query.limit ?? CATALOG_DEFAULT_PAGE_SIZE, 1), 100);
  const offset = Math.max(query.offset ?? 0, 0);

  if (generation <= 0) {
    if (process.env.EXPO_PUBLIC_MOVIES_SQLITE_DIAGNOSTICS === 'true' && query.mediaType === 'movie') {
      console.info('[Movies SQLite Query Diagnostic]', JSON.stringify({
        providerId: query.providerId,
        categoryId: query.categoryId ?? null,
        generation,
        sqlRowCount: 0,
        firstFiveMovieIds: [],
      }));
    }
    return { items: [], totalCount: 0, limit, offset, hasMore: false };
  }

  const itemsTable = catalogItemsTable(query.mediaType);
  const params: CatalogSqlParams = [query.providerId, query.mediaType, generation];
  let where = `provider_id = ? AND media_type = ? AND sync_generation = ?`;

  if (query.categoryId) {
    where += ' AND category_id = ?';
    params.push(query.categoryId);
  }

  if (query.query?.trim()) {
    where += ' AND normalized_title LIKE ?';
    params.push(`%${normalizeCatalogTitle(query.query)}%`);
  }

  const pageSql = `SELECT * FROM ${itemsTable}
     WHERE ${where}
     ORDER BY ${orderByClauseCompatible(query.sort)}
     LIMIT ? OFFSET ?`;

  // Diagnostics-only: EXPLAIN QUERY PLAN for Movies search (no SQL behavior change).
  if (query.mediaType === 'movie' && query.query?.trim()) {
    try {
      const planRows = await db.getAll<{ detail?: string; id?: number; parent?: number; notused?: number }>(
        `EXPLAIN QUERY PLAN ${pageSql}`,
        [...params, limit, offset],
      );
      console.info(
        '[NovaCast Movies Search Query Plan] ' +
          JSON.stringify({
            table: itemsTable,
            generation,
            likePattern: `%${normalizeCatalogTitle(query.query)}%`,
            limit,
            offset,
            orderBy: orderByClauseCompatible(query.sort),
            plan: planRows.map((row) => ({
              id: row.id ?? null,
              parent: row.parent ?? null,
              detail: row.detail ?? String(row),
            })),
            marker: 'stage-movies-search-perf-audit-v1',
          }),
      );
    } catch (error) {
      console.info(
        '[NovaCast Movies Search Query Plan] ' +
          JSON.stringify({
            table: itemsTable,
            error: error instanceof Error ? error.message : String(error),
            marker: 'stage-movies-search-perf-audit-v1',
          }),
      );
    }
  }

  const rows = await db.getAll(pageSql, [...params, limit, offset]);

  let totalCount: number;
  if (query.skipTotalCount) {
    // First-page search: avoid a full LIKE COUNT over the generation.
    totalCount = offset + rows.length + (rows.length === limit ? 1 : 0);
  } else {
    const totalRow = await db.getFirst<{ total: number }>(
      `SELECT COUNT(*) AS total FROM ${itemsTable} WHERE ${where}`,
      params,
    );
    totalCount = asNumber(totalRow?.total);
  }

  const items = rows.map(mapItem);
  if (query.mediaType === 'movie') {
    console.info(
      '[NovaCast Movies Read Contract] ' +
        JSON.stringify({
          providerId: query.providerId,
          readableGeneration: generation,
          requestedCategoryId: query.categoryId ?? null,
          itemsGeneration: generation,
          categoriesGeneration: generation,
          pageOffset: offset,
          pageLimit: limit,
          pageRowCount: rows.length,
          totalCount,
          providerCategoryCount: null,
          reason: query.categoryId ? 'all-item-rows-category-filter' : 'all-item-rows-direct-count',
        }),
    );
  }
  if (process.env.EXPO_PUBLIC_MOVIES_SQLITE_DIAGNOSTICS === 'true' && query.mediaType === 'movie') {
    console.info('[Movies SQLite Query Diagnostic]', JSON.stringify({
      providerId: query.providerId,
      categoryId: query.categoryId ?? null,
      generation,
      sqlRowCount: rows.length,
      totalCount,
      firstFiveMovieIds: rows.slice(0, 5).map((row) => row.content_id),
    }));
  }

  return {
    items,
    totalCount,
    limit,
    offset,
    hasMore: query.skipTotalCount
      ? rows.length >= limit
      : offset + items.length < totalCount,
  };
}

/**
 * Canonical single-movie catalog row for Detail enrichment.
 * Reads catalog_items_v2 at the readable sync generation (content_id / stream_id).
 */
export async function getCatalogMovieItem(
  providerId: string,
  contentId: string,
  options?: { generation?: number },
): Promise<CatalogItemRecord | null> {
  const trimmedId = String(contentId ?? '').trim();
  if (!providerId || !trimmedId) {
    return null;
  }

  const generation =
    options?.generation ?? (await resolveReadableCatalogGeneration(providerId, 'movie'));
  if (generation <= 0) {
    return null;
  }

  const db = await getCatalogDatabase();
  const itemsTable = catalogItemsTable('movie');
  const row = await db.getFirst(
    `SELECT * FROM ${itemsTable}
     WHERE provider_id = ?
       AND media_type = ?
       AND sync_generation = ?
       AND content_id = ?
     LIMIT 1`,
    [providerId, 'movie', generation, trimmedId],
  );

  return row ? mapItem(row as Record<string, unknown>) : null;
}

export async function getCatalogDiagnosticSnapshot(
  providerId: string,
  mediaType: CatalogMediaType,
): Promise<Record<string, unknown>> {
  const db = await getCatalogDatabase();
  const state = await getCatalogSyncState(providerId, mediaType);
  const provider = await getCatalogProvider(providerId);
  const resolvedGeneration = await resolveActiveGeneration(providerId, mediaType);
  const itemsTable = catalogItemsTable(mediaType);
  const categoriesTable = catalogCategoriesTable(mediaType);

  const itemGenerationCounts = await db.getAll(
    `SELECT sync_generation, COUNT(*) AS item_count
     FROM ${itemsTable}
     WHERE provider_id = ? AND media_type = ?
     GROUP BY sync_generation
     ORDER BY sync_generation DESC`,
    [providerId, mediaType],
  );

  const categoryGenerationCounts = await db.getAll(
    `SELECT sync_generation, COUNT(*) AS category_count,
            COALESCE(SUM(item_count), 0) AS reported_item_count
     FROM ${categoriesTable}
     WHERE provider_id = ? AND media_type = ?
     GROUP BY sync_generation
     ORDER BY sync_generation DESC`,
    [providerId, mediaType],
  );

  const exactReadableItems = await db.getFirst<{ total: number }>(
    `SELECT COUNT(*) AS total
     FROM ${itemsTable}
     WHERE provider_id = ? AND media_type = ? AND sync_generation = ?`,
    [providerId, mediaType, resolvedGeneration],
  );

  const exactReadableCategories = await db.getFirst<{ total: number }>(
    `SELECT COUNT(*) AS total
     FROM ${categoriesTable}
     WHERE provider_id = ? AND media_type = ? AND sync_generation = ?`,
    [providerId, mediaType, resolvedGeneration],
  );

  const allItemContracts = await db.getAll(
    `SELECT provider_id, media_type, sync_generation, COUNT(*) AS item_count
     FROM ${itemsTable}
     GROUP BY provider_id, media_type, sync_generation
     ORDER BY item_count DESC
     LIMIT 30`,
  );

  const allCategoryContracts = await db.getAll(
    `SELECT provider_id, media_type, sync_generation, COUNT(*) AS category_count,
            COALESCE(SUM(item_count), 0) AS reported_item_count
     FROM ${categoriesTable}
     GROUP BY provider_id, media_type, sync_generation
     ORDER BY category_count DESC
     LIMIT 30`,
  );

  const itemSamples = await db.getAll(
    `SELECT provider_id, media_type, sync_generation, category_id,
            content_id, title, normalized_title
     FROM ${itemsTable}
     WHERE provider_id = ? AND media_type = ?
     ORDER BY sync_generation DESC, provider_sort_order ASC
     LIMIT 10`,
    [providerId, mediaType],
  );

  const categorySamples = await db.getAll(
    `SELECT provider_id, media_type, sync_generation, category_id,
            category_name, item_count, sort_order
     FROM ${categoriesTable}
     WHERE provider_id = ? AND media_type = ?
     ORDER BY sync_generation DESC, sort_order ASC
     LIMIT 10`,
    [providerId, mediaType],
  );

  return {
    requested: { providerId, mediaType },
    syncState: state,
    provider,
    resolvedGeneration,
    exactReadableItemCount: asNumber(exactReadableItems?.total),
    exactReadableCategoryCount: asNumber(exactReadableCategories?.total),
    itemGenerationCounts,
    categoryGenerationCounts,
    allItemContracts,
    allCategoryContracts,
    itemSamples,
    categorySamples,
    marker: usesGenerationSafeCatalog(mediaType) ? STAGE3C_GENERATION_SAFE_MARKER : null,
  };
}
export async function clearProviderCatalog(providerId: string): Promise<void> {
  await withCatalogTransaction(async () => {
    const db = await getCatalogDatabase();
    await db.run(`DELETE FROM catalog_items WHERE provider_id = ?`, [providerId]);
    await db.run(`DELETE FROM catalog_categories WHERE provider_id = ?`, [providerId]);
    await db.run(`DELETE FROM catalog_seasons WHERE provider_id = ?`, [providerId]);
    await db.run(`DELETE FROM catalog_items_v2 WHERE provider_id = ?`, [providerId]);
    await db.run(`DELETE FROM catalog_categories_v2 WHERE provider_id = ?`, [providerId]);
    await db.run(`DELETE FROM catalog_seasons_v2 WHERE provider_id = ?`, [providerId]);
    await db.run(`DELETE FROM catalog_sync_state WHERE provider_id = ?`, [providerId]);
    await db.run(`DELETE FROM catalog_providers WHERE provider_id = ?`, [providerId]);
  });
}

export async function listCatalogItemsForGeneration(
  providerId: string,
  mediaType: CatalogMediaType,
  generation: number,
): Promise<CatalogItemRecord[]> {
  const db = await getCatalogDatabase();
  const itemsTable = catalogItemsTable(mediaType);
  const rows = await db.getAll(
    `SELECT * FROM ${itemsTable}
     WHERE provider_id = ? AND media_type = ? AND sync_generation = ?
     ORDER BY normalized_title ASC, content_id ASC`,
    [providerId, mediaType, generation],
  );
  return rows.map(mapItem);
}

export async function listCatalogCategoriesForGeneration(
  providerId: string,
  mediaType: CatalogMediaType,
  generation: number,
): Promise<CatalogCategoryRecord[]> {
  const db = await getCatalogDatabase();
  const categoriesTable = catalogCategoriesTable(mediaType);
  const rows = await db.getAll(
    `SELECT * FROM ${categoriesTable}
     WHERE provider_id = ? AND media_type = ? AND sync_generation = ?
     ORDER BY (sort_order IS NULL) ASC, sort_order ASC, category_name ASC`,
    [providerId, mediaType, generation],
  );
  return rows.map(mapCategory);
}

export async function listCatalogSeasonsForGeneration(
  providerId: string,
  generation: number,
): Promise<CatalogSeasonRecord[]> {
  const db = await getCatalogDatabase();
  const rows = await db.getAll(
    `SELECT * FROM catalog_seasons
     WHERE provider_id = ? AND sync_generation = ?
     ORDER BY series_id ASC, season_number ASC`,
    [providerId, generation],
  );
  return rows.map(mapSeason);
}
