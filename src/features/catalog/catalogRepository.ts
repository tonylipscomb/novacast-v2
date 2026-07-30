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
  const row = await db.getFirst<{ max_g: number | null }>(
    `SELECT MAX(g) AS max_g FROM (
       SELECT catalog_generation AS g FROM catalog_providers WHERE provider_id = ?
       UNION ALL
       SELECT generation AS g FROM catalog_sync_state WHERE provider_id = ? AND media_type = ?
       UNION ALL
       SELECT COALESCE(MAX(sync_generation), 0) AS g FROM catalog_items WHERE provider_id = ? AND media_type = ?
       UNION ALL
       SELECT COALESCE(MAX(sync_generation), 0) AS g FROM catalog_categories WHERE provider_id = ? AND media_type = ?
       UNION ALL
       SELECT COALESCE(MAX(sync_generation), 0) AS g FROM catalog_seasons WHERE provider_id = ?
     )`,
    [providerId, providerId, mediaType, providerId, mediaType, providerId, mediaType, providerId],
  );
  return asNumber(row?.max_g, 0) + 1;
}

/**
 * Starts a sync generation for provider+mediaType.
 * Does not delete prior successful data â€” that happens on completeCatalogSync.
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

  const sql = `INSERT INTO catalog_categories (
      provider_id, media_type, category_id, category_name, sort_order,
      item_count, sync_generation, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(provider_id, media_type, category_id) DO UPDATE SET
      category_name = excluded.category_name,
      sort_order = excluded.sort_order,
      item_count = excluded.item_count,
      sync_generation = excluded.sync_generation,
      updated_at = excluded.updated_at`;

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
  const sql = `INSERT INTO catalog_items (
      provider_id, media_type, content_id, category_id, title, normalized_title,
      artwork_url, backdrop_url, release_date, release_year, rating, description,
      stream_extension, provider_sort_order, series_id, season_number, episode_number,
      sync_generation, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(provider_id, media_type, content_id) DO UPDATE SET
      category_id = excluded.category_id,
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
  const aggregateStart = perfNowMs();
  const aggregates = await db.getAll<{ category_id: string; cnt: number | string }>(
    `SELECT category_id, COUNT(*) AS cnt
     FROM catalog_items
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
    `UPDATE catalog_categories
     SET item_count = 0, updated_at = ?
     WHERE provider_id = ? AND media_type = ? AND sync_generation = ?`,
    [updatedAt, providerId, mediaType, generation],
  );

  const statement = await db.prepare(
    `UPDATE catalog_categories
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

export async function deleteStaleCatalogGeneration(
  providerId: string,
  mediaType: CatalogMediaType,
  keepGeneration: number,
): Promise<void> {
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

export async function completeCatalogSync(
  providerId: string,
  mediaType: CatalogMediaType,
  generation: number,
  options?: { processedCount?: number },
): Promise<void> {
  await withCatalogTransaction(async () => {
    const db = await getCatalogDatabase();
    await recomputeCategoryCounts(providerId, mediaType, generation);
    await deleteStaleCatalogGeneration(providerId, mediaType, generation);

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

    await db.run(
      `UPDATE catalog_providers
       SET catalog_generation = CASE
             WHEN catalog_generation > ? THEN catalog_generation
             ELSE ?
           END,
           last_successful_sync_at = ?,
           sync_status = 'ready',
           sync_error_code = NULL
       WHERE provider_id = ?`,
      [generation, generation, completedAt, providerId],
    );
  });
}

export async function failCatalogSync(
  providerId: string,
  mediaType: CatalogMediaType,
  errorCode: string,
): Promise<void> {
  const db = await getCatalogDatabase();
  const failedAt = nowMs();
  await db.run(
    `UPDATE catalog_sync_state
     SET status = 'error',
         error_code = ?,
         completed_at = ?
     WHERE provider_id = ? AND media_type = ?`,
    [errorCode, failedAt, providerId, mediaType],
  );
  await db.run(
    `UPDATE catalog_providers
     SET sync_status = 'error',
         sync_error_code = ?
     WHERE provider_id = ?`,
    [errorCode, providerId],
  );
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

async function resolveActiveGeneration(
  providerId: string,
  mediaType: CatalogMediaType,
): Promise<number> {
  const state = await getCatalogSyncState(providerId, mediaType);
  if (state?.status === 'ready' && state.generation > 0) {
    return state.generation;
  }

  // While a new sync is in progress, keep serving the prior successful generation.
  if (state?.status === 'syncing' || state?.status === 'error') {
    const rows = await (await getCatalogDatabase()).getFirst<{ max_ready: number | null }>(
      `SELECT MAX(sync_generation) AS max_ready
       FROM catalog_items
       WHERE provider_id = ? AND media_type = ?
         AND sync_generation < ?`,
      [providerId, mediaType, state.generation || Number.MAX_SAFE_INTEGER],
    );
    if (rows?.max_ready && Number(rows.max_ready) > 0) {
      return Number(rows.max_ready);
    }
  }

  const provider = await getCatalogProvider(providerId);
  return provider?.catalogGeneration ?? 0;
}

export async function getCatalogCategoryCounts(
  providerId: string,
  mediaType: CatalogMediaType,
): Promise<Array<{ categoryId: string; categoryName: string; itemCount: number; sortOrder: number | null }>> {
  const db = await getCatalogDatabase();
  const generation = await resolveActiveGeneration(providerId, mediaType);
  if (generation <= 0) {
    return [];
  }

  const rows = await db.getAll(
    `SELECT category_id, category_name, item_count, sort_order
     FROM catalog_categories
     WHERE provider_id = ? AND media_type = ? AND sync_generation = ?
     ORDER BY (sort_order IS NULL) ASC, sort_order ASC, category_name ASC`,
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

  const params: CatalogSqlParams = [providerId, mediaType, generation];
  let sql = `SELECT COUNT(*) AS total
    FROM catalog_items
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
  const generation = await resolveActiveGeneration(query.providerId, query.mediaType);
  const limit = Math.min(Math.max(query.limit ?? CATALOG_DEFAULT_PAGE_SIZE, 1), 100);
  const offset = Math.max(query.offset ?? 0, 0);

  if (generation <= 0) {
    return { items: [], totalCount: 0, limit, offset, hasMore: false };
  }

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

  const totalRow = await db.getFirst<{ total: number }>(
    `SELECT COUNT(*) AS total FROM catalog_items WHERE ${where}`,
    params,
  );
  const totalCount = asNumber(totalRow?.total);

  const rows = await db.getAll(
    `SELECT * FROM catalog_items
     WHERE ${where}
     ORDER BY ${orderByClauseCompatible(query.sort)}
     LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );

  const items = rows.map(mapItem);
  return {
    items,
    totalCount,
    limit,
    offset,
    hasMore: offset + items.length < totalCount,
  };
}

export async function clearProviderCatalog(providerId: string): Promise<void> {
  await withCatalogTransaction(async () => {
    const db = await getCatalogDatabase();
    await db.run(`DELETE FROM catalog_items WHERE provider_id = ?`, [providerId]);
    await db.run(`DELETE FROM catalog_categories WHERE provider_id = ?`, [providerId]);
    await db.run(`DELETE FROM catalog_seasons WHERE provider_id = ?`, [providerId]);
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
  const rows = await db.getAll(
    `SELECT * FROM catalog_items
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
  const rows = await db.getAll(
    `SELECT * FROM catalog_categories
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
