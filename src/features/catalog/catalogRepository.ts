import { novacastCatalogTrace } from '../diagnostics/novacastLogPolicy.ts';
import {
  beginCatalogForegroundRead,
  getCatalogDatabase,
  getCatalogReadDatabase,
  logCatalogWalAudit,
  waitForForegroundCatalogReadsToDrain,
  withCatalogTransaction,
  type CatalogTransactionDiagnostics,
} from './catalogDatabase.ts';
import type { CatalogDatabaseHandle, CatalogSqlParams } from './catalogDatabaseDriver.ts';
import {
  CATALOG_DEFAULT_PAGE_SIZE,
  normalizeCatalogTitle,
  type CatalogCategoryRecord,
  type CatalogItemRecord,
  type CatalogItemsPage,
  type CatalogItemsPageQuery,
  type CatalogMediaType,
  type CatalogProviderRecord,
  type CatalogSeasonRecord,
  type CatalogSyncStateRecord,
  type CatalogSyncStatus,
} from './catalogTypes.ts';
import {
  getCatalogSortMetadataCoverage,
  markSortMetadataUpgradeSatisfied,
} from './catalogSortMetadataUpgrade.ts';
import { orderByClauseCompatible, resolveContentSortEffectivePrimary } from './catalogSortOrder.ts';
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

function logMovieCompletionPhase(phase: string, generation: number, startedAt: number) {
  novacastCatalogTrace('[NovaCast Movie Completion Phase]', {
    phase,
    generation,
    durationMs: Math.round(perfNowMs() - startedAt),
  });
}

function logMovieCompletionTailAudit(input: {
  phase: string;
  generation: number;
  connection: string;
  queryType: string;
  querySignature: string;
  callCount: number;
  durationMs: number;
  reusedCachedResult: boolean;
  rowsOrGenerationsInspected?: number;
  fallbackScanPerformed?: boolean;
  fallbackCandidateCount?: number;
  pointerRepairPerformed?: boolean;
  avoidedAggregateQuery?: string | boolean;
  avoidedCategoryRowCountQuery?: boolean;
  currentGeneration?: number;
  readableGeneration?: number;
}) {
  novacastCatalogTrace('[NovaCast Movie Completion Tail Audit]', input);
}

function logMovieActiveReadyResolverFastPath(input: Record<string, unknown>) {
  novacastCatalogTrace('[NovaCast Movie Active Ready Resolver Fast Path]', input);
}

export type CatalogCompletionStatsSnapshot = {
  providerId: string;
  mediaType: 'movie';
  generation: number;
  itemRows: number;
  distinctContentIds: number;
  distinctItemCategoryIds: number;
  categoryRows: number;
};
import {
  STAGE3C_GENERATION_SAFE_MARKER,
  catalogCategoriesConflictTarget,
  catalogCategoriesTable,
  catalogItemsConflictTarget,
  catalogItemsTable,
  catalogSeasonsTable,
  usesGenerationSafeCatalog,
} from './catalogTableRouting.ts';
import {
  validateCatalogCategoryDistribution,
  validateMoviesCategoryDistribution,
} from './moviesCategoryDistributionValidation.ts';
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
import { isCatalogSyncRunning } from './catalogSyncCoordinator.ts';
import {
  CATALOG_READABLE_RESTORE_LOG,
  incompleteGenerationToExclude,
  resolveMoviePointerCandidate,
  shouldExcludeSyncingGenerationFromRecovery,
} from './catalogReadableGenerationRestore.ts';


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
    addedAt: asNullableNumber(row.added_at),
    popularity: asNullableNumber(row.popularity),
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

let movieProviderPointerAuditOrder = 0;

async function logMovieProviderGenerationPointer(input: {
  event: string;
  providerId: string;
  database?: CatalogDatabaseHandle;
  requestedProviderCatalogGeneration?: number | null;
  sourceFunction: string;
  sourcePhase: string;
  pointerReason: string;
}): Promise<void> {
  const database = input.database ?? (await getCatalogDatabase());
  const [provider, syncState] = await Promise.all([
    getCatalogProvider(input.providerId, database),
    getCatalogSyncState(input.providerId, 'movie', database),
  ]);
  const lifecycleGeneration = syncState?.generation ?? 0;
  const lifecycle = lifecycleGeneration > 0
    ? await database.getFirst<{ sync_generation: number | string; status: string }>(
        `SELECT sync_generation, status
         FROM catalog_generation_state
         WHERE provider_id = ? AND media_type = 'movie'
           AND sync_generation = ?`,
        [input.providerId, lifecycleGeneration],
      )
    : null;
  novacastCatalogTrace('[NovaCast Movie Provider Generation Pointer]', {
    event: input.event,
    providerId: input.providerId,
    currentAttemptGeneration: syncState?.generation ?? 0,
    currentSyncStatus: syncState?.status ?? null,
    lifecycleGeneration: lifecycle ? asNumber(lifecycle.sync_generation) : 0,
    lifecycleStatus: lifecycle?.status ?? null,
    previousProviderCatalogGeneration: provider?.catalogGeneration ?? 0,
    requestedProviderCatalogGeneration: input.requestedProviderCatalogGeneration ?? null,
    resultingProviderCatalogGeneration: provider?.catalogGeneration ?? 0,
    sourceFunction: input.sourceFunction,
    sourcePhase: input.sourcePhase,
    pointerReason: input.pointerReason,
    order: ++movieProviderPointerAuditOrder,
    timestamp: new Date().toISOString(),
  });
}


export async function upsertCatalogProvider(input: {
  providerId: string;
  providerType: string;
  displayName?: string | null;
}): Promise<void> {
  const db = await getCatalogDatabase();
  await logMovieProviderGenerationPointer({
    event: 'before-provider-upsert',
    providerId: input.providerId,
    database: db,
    requestedProviderCatalogGeneration: 0,
    sourceFunction: 'upsertCatalogProvider',
    sourcePhase: 'provider-metadata',
    pointerReason: 'provider-upsert-default-only',
  });
  await db.run(
    `INSERT INTO catalog_providers (
      provider_id, provider_type, display_name, catalog_generation, sync_status
    ) VALUES (?, ?, ?, 0, 'idle')
    ON CONFLICT(provider_id) DO UPDATE SET
      provider_type = excluded.provider_type,
      display_name = excluded.display_name`,
    [input.providerId, input.providerType, input.displayName ?? null],
  );
  await logMovieProviderGenerationPointer({
    event: 'after-provider-upsert',
    providerId: input.providerId,
    database: db,
    requestedProviderCatalogGeneration: 0,
    sourceFunction: 'upsertCatalogProvider',
    sourcePhase: 'provider-metadata',
    pointerReason: 'provider-upsert-default-only',
  });
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
       UNION ALL
       SELECT COALESCE(MAX(sync_generation), 0) AS g FROM catalog_generation_state WHERE provider_id = ? AND media_type = ?
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
  novacastCatalogTrace('[NovaCast Catalog V2 Generation] ' + JSON.stringify(payload));
}

/**
 * Starts a sync generation for provider+mediaType.
 * Does not delete prior successful data ├â╞Æ├é┬ó├â┬ó├óΓé¼┼í├é┬¼├â┬ó├óΓÇÜ┬¼├é┬¥ that happens on completeCatalogSync.
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

    if (mediaType === 'movie') {
      await logMovieProviderGenerationPointer({
        event: 'sync-begin-pointer-snapshot',
        providerId,
        database: db,
        requestedProviderCatalogGeneration: null,
        sourceFunction: 'beginCatalogSync',
        sourcePhase: 'before-sync-state-writes',
        pointerReason: 'sync-begin-snapshot',
      });
    }

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

    await db.run(
      `INSERT INTO catalog_generation_state (
         provider_id, media_type, sync_generation, status, phase,
         processed_count, started_at, completed_at, error_code
       ) VALUES (?, ?, ?, 'syncing', ?, 0, ?, NULL, NULL)
       ON CONFLICT(provider_id, media_type, sync_generation) DO UPDATE SET
         status = 'syncing',
         phase = excluded.phase,
         processed_count = 0,
         started_at = excluded.started_at,
         completed_at = NULL,
         error_code = NULL,
         activation_total_items = NULL,
         activation_nonzero_category_count = NULL`,
      [providerId, mediaType, generation, options?.phase ?? 'categories', startedAt],
    );

    if (mediaType === 'movie') {
      await logMovieProviderGenerationPointer({
        event: 'sync-begin-pointer-snapshot-after',
        providerId,
        database: db,
        requestedProviderCatalogGeneration: null,
        sourceFunction: 'beginCatalogSync',
        sourcePhase: 'after-sync-state-writes',
        pointerReason: 'sync-begin-snapshot',
      });
    }

    return generation;
  });
}

export async function writeCatalogCategoriesBatch(
  categories: Array<Omit<CatalogCategoryRecord, 'itemCount' | 'updatedAt'> & {
    itemCount?: number;
    updatedAt?: number;
  }>,
  options?: {
    mediaType?: CatalogMediaType;
    timing?: {
      prepareMs?: number;
      queueWaitMs?: number;
      transactionBodyMs?: number;
      finalizeMs?: number;
      busyMs?: number;
    };
  },
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
  const transactionDiagnostics: CatalogTransactionDiagnostics = {
    providerId: categories[0]?.providerId,
    mediaType: resolvedMediaType,
    generation: categories[0]?.syncGeneration,
    writeType: 'category',
  };
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
    }, transactionDiagnostics);

    return written;
  } finally {
    const finalizeStart = perfNowMs();
    await statement.finalize();
    finalizeMs = perfNowMs() - finalizeStart;
    if (options?.timing) {
      options.timing.prepareMs = prepareMs;
      options.timing.queueWaitMs = transactionDiagnostics.queueWaitMs ?? 0;
      options.timing.transactionBodyMs = transactionDiagnostics.transactionBodyMs ?? 0;
      options.timing.finalizeMs = finalizeMs;
      options.timing.busyMs = prepareMs + (transactionDiagnostics.transactionBodyMs ?? 0) + finalizeMs;
    }
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
      novacastCatalogTrace('[NovaCast ColdCategorySpike]', {
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

  const ITEM_PARAMS_PER_ROW = 21;
  const CONSERVATIVE_SQLITE_VARIABLE_LIMIT = 999;
  const maxItemsPerStatement = Math.floor(CONSERVATIVE_SQLITE_VARIABLE_LIMIT / ITEM_PARAMS_PER_ROW);
  if (items.length > maxItemsPerStatement) {
    let written = 0;
    for (let offset = 0; offset < items.length; offset += maxItemsPerStatement) {
      written += await writeCatalogItemsBatch(items.slice(offset, offset + maxItemsPerStatement));
    }
    return written;
  }

  await waitForForegroundCatalogReadsToDrain();
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
      added_at = excluded.added_at,
      popularity = excluded.popularity,
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
      added_at = excluded.added_at,
      popularity = excluded.popularity,
      description = excluded.description,
      stream_extension = excluded.stream_extension,
      provider_sort_order = excluded.provider_sort_order,
      series_id = excluded.series_id,
      season_number = excluded.season_number,
      episode_number = excluded.episode_number,
      sync_generation = excluded.sync_generation,
      updated_at = excluded.updated_at`;
  const valuePlaceholders = items
    .map(() => `(${Array.from({ length: ITEM_PARAMS_PER_ROW }, () => '?').join(', ')})`)
    .join(',\n      ');
  const sql = `INSERT INTO ${itemsTable} (
      provider_id, media_type, content_id, category_id, title, normalized_title,
      artwork_url, backdrop_url, release_date, release_year, rating, added_at, popularity, description,
      stream_extension, provider_sort_order, series_id, season_number, episode_number,
      sync_generation, updated_at
    ) VALUES ${valuePlaceholders}
    ON CONFLICT(${itemConflict}) DO UPDATE SET
      ${itemConflictUpdate}`;

  const totalWriteStart = perfNowMs();
  const parameters: CatalogSqlParams = [];
  for (const item of items) {
    const updatedAt = item.updatedAt ?? nowMs();
    const normalizedTitle = item.normalizedTitle ?? normalizeCatalogTitle(item.title);
    parameters.push(
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
      item.addedAt ?? null,
      item.popularity ?? null,
      item.description ?? null,
      item.streamExtension ?? null,
      item.providerSortOrder ?? null,
      item.seriesId ?? null,
      item.seasonNumber ?? null,
      item.episodeNumber ?? null,
      item.syncGeneration,
      updatedAt,
    );
  }

  const prepareStart = perfNowMs();
  const statement = await db.prepare(sql);
  const prepareMs = perfNowMs() - prepareStart;
  recordCatalogWritePhase('item.prepare', {
    wallMs: prepareMs,
    itemCount: items.length,
  });

  const transactionDiagnostics: CatalogTransactionDiagnostics = {
    providerId: items[0]?.providerId,
    mediaType,
    generation: items[0]?.syncGeneration,
    writeType: 'item',
  };
  let statementExecuteTotalMs = 0;
  let maxStatementExecuteMs = 0;
  let statementExecuteCount = 0;
  let finalized = false;

  try {
    const result = await withCatalogTransaction(async () => {
      const writeStart = perfNowMs();
      const executeStart = perfNowMs();
      await statement.execute(parameters);
      const executeMs = perfNowMs() - executeStart;
      statementExecuteTotalMs = executeMs;
      maxStatementExecuteMs = executeMs;
      statementExecuteCount = 1;
      recordCatalogWritePhase('item.write', {
        wallMs: perfNowMs() - writeStart,
        itemCount: items.length,
      });
      return items.length;
    }, transactionDiagnostics);
    const finalizeStart = perfNowMs();
    await statement.finalize();
    finalized = true;
    const finalizeMs = perfNowMs() - finalizeStart;
    const totalWriteCallMs = perfNowMs() - totalWriteStart;
    const queueWaitMs = transactionDiagnostics.queueWaitMs ?? 0;
    const transactionBodyMs = transactionDiagnostics.transactionBodyMs ?? 0;
    if (
      totalWriteCallMs >= 250 ||
      queueWaitMs >= 100 ||
      transactionBodyMs >= 150 ||
      maxStatementExecuteMs >= 50
    ) {
      novacastCatalogTrace('[NovaCast Catalog Write Breakdown]', {
        timestamp: new Date().toISOString(),
        providerId: items[0]?.providerId,
        mediaType,
        generation: items[0]?.syncGeneration,
        writeMode: 'multi-row',
        prepareMs: Math.round(prepareMs),
        queueWaitMs: Math.round(queueWaitMs),
        transactionBodyMs: Math.round(transactionBodyMs),
        statementExecuteTotalMs: Math.round(statementExecuteTotalMs),
        maxStatementExecuteMs: Math.round(maxStatementExecuteMs),
        statementExecuteCount,
        parameterCount: items.length * ITEM_PARAMS_PER_ROW,
        rowCount: items.length,
        finalizeMs: Math.round(finalizeMs),
        totalWriteCallMs: Math.round(totalWriteCallMs),
        slowWrite: totalWriteCallMs >= 500,
      });
      if (statementExecuteTotalMs >= 500) {
        void logCatalogWalAudit(db, {
          reason: 'slow-write',
          providerId: items[0]?.providerId,
          mediaType,
          generation: items[0]?.syncGeneration,
          writeMode: 'multi-row',
          rowCount: items.length,
          statementExecuteMs: Math.round(statementExecuteTotalMs),
        });
      }
    }
    return result;
  } finally {
    if (!finalized) {
      await statement.finalize();
    }
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
  if (mediaType === 'movie') {
    logMovieCompletionPhase('recompute-category-counts-aggregate', generation, aggregateStart);
  }

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
  if (mediaType === 'movie') {
    logMovieCompletionPhase('recompute-category-counts-update', generation, updateStart);
  }

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
 * Movies v2 cleanup: retain newly active + immediately previous validated
 * generations (current + previous completed) and delete only other
 * incomplete/failed v2 generations. Never touches legacy tables.
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
  const batchSize = 2000;
  const db = await getCatalogDatabase();
  const generationRows = await db.getAll<{ sync_generation: number | string }>(
    `SELECT sync_generation FROM catalog_items_v2
     WHERE provider_id = ? AND media_type = ?
     GROUP BY sync_generation ORDER BY sync_generation ASC`,
    [providerId, mediaType],
  );
  const targets = generationRows
    .map((row) => asNumber(row.sync_generation))
    .filter((generation) => generation > 0 && !keep.includes(generation));
  let batchNumber = 0;
  let cumulativeRowsDeleted = 0;

  const protectCurrentGenerations = async () => {
    const provider = await getCatalogProvider(providerId, db);
    const state = await getCatalogSyncState(providerId, mediaType, db);
    const readable = await resolveReadableCatalogGeneration(providerId, mediaType);
    return new Set([provider?.catalogGeneration ?? 0, state?.generation ?? 0, readable, ...keep]);
  };

  for (const targetGeneration of targets) {
    for (const table of ['catalog_items_v2', 'catalog_categories_v2', 'catalog_seasons_v2']) {
      while (true) {
        const protectedGenerations = await protectCurrentGenerations();
        if (protectedGenerations.has(targetGeneration)) {
          novacastCatalogTrace('[NovaCast Movie Post Activation Cleanup]', {
            event: 'aborted',
            providerId,
            mediaType,
            targetGeneration,
            reason: 'generation-state-changed',
            retainedGenerations: [...protectedGenerations],
          });
          return;
        }
        const batchStarted = perfNowMs();
        let batchRowsDeleted = 0;
        const transactionStarted = perfNowMs();
        await withCatalogTransaction(async () => {
          const batch = await db.run(
            `DELETE FROM ${table}
             WHERE rowid IN (
               SELECT rowid FROM ${table}
               WHERE provider_id = ? AND media_type = ? AND sync_generation = ?
               LIMIT ?
             )`,
            [providerId, mediaType, targetGeneration, batchSize],
          );
          batchRowsDeleted = Number(batch.changes ?? 0);
        });
        const transactionMs = perfNowMs() - transactionStarted;
        cumulativeRowsDeleted += batchRowsDeleted;
        batchNumber += 1;
        const yieldStarted = perfNowMs();
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        const yieldMs = perfNowMs() - yieldStarted;
        novacastCatalogTrace('[NovaCast Movie Cleanup Audit]', {
          cleanupMode: 'post-activation',
          batchNumber,
          table,
          targetGeneration,
          batchRowsDeleted,
          cumulativeRowsDeleted,
          batchDeleteMs: Math.round(perfNowMs() - batchStarted),
          transactionMs: Math.round(transactionMs),
          yieldMs: Math.round(yieldMs),
          retainedGenerations: [...protectedGenerations],
          activeGenerationAtBatch: [...protectedGenerations][0] ?? 0,
          readableGenerationAtBatch: [...protectedGenerations][2] ?? 0,
          cleanupCompleted: batchRowsDeleted === 0,
          indexUsed: table === 'catalog_items_v2'
            ? 'idx_catalog_items_v2_provider_media_gen'
            : table === 'catalog_categories_v2'
              ? 'idx_catalog_categories_v2_provider_media_gen'
              : 'idx_catalog_seasons_v2_provider_media_gen',
        });
        if (batchRowsDeleted === 0 || batchRowsDeleted < batchSize) {
          break;
        }
      }
    }
    await db.run(
      `UPDATE catalog_generation_state
       SET activation_total_items = NULL,
           activation_nonzero_category_count = NULL
       WHERE provider_id = ? AND media_type = ? AND sync_generation = ?`,
      [providerId, mediaType, targetGeneration],
    );
  }
  novacastCatalogTrace('[NovaCast Movie Post Activation Cleanup]', {
    event: 'completed',
    providerId,
    mediaType,
    batchNumber,
    cumulativeRowsDeleted,
    retainedGenerations: keep,
  });
  recordCatalogWritePhase('stale.delete', {
    wallMs: 0,
    itemCount: cumulativeRowsDeleted,
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
  await db.run(
    `UPDATE catalog_generation_state
     SET activation_total_items = NULL,
         activation_nonzero_category_count = NULL
     WHERE provider_id = ? AND media_type = ? AND sync_generation = ?`,
    [providerId, mediaType, generation],
  );
}

export async function getCatalogGenerationPhysicalStats(
  providerId: string,
  mediaType: CatalogMediaType,
  generation: number,
  database?: CatalogDatabaseHandle,
): Promise<{
  itemRows: number;
  distinctContentIds: number;
  categoryRows: number;
  distinctItemCategoryIds: number;
}> {
  const started = perfNowMs();
  const db = database ?? (await getCatalogDatabase());
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
  const result = {
    itemRows: asNumber(itemStats?.total),
    distinctContentIds: asNumber(itemStats?.distinct_total),
    categoryRows: asNumber(categoryStats?.total),
    distinctItemCategoryIds: asNumber(itemStats?.distinct_categories),
  };
  if (mediaType === 'movie') {
    logMovieCompletionTailAudit({
      phase: 'physical-stats-query',
      generation,
      connection: database ? 'catalog-read' : 'catalog-primary',
      queryType: 'aggregate-read',
      querySignature: 'item-count-distinct-content-distinct-category+category-count',
      callCount: 2,
      durationMs: Math.round(perfNowMs() - started),
      reusedCachedResult: false,
      rowsOrGenerationsInspected: result.itemRows + result.categoryRows,
    });
  }
  return result;
}

/** Stage 3C.2: largest category share from item rows (pre-activation). */
export async function getCatalogGenerationLargestCategory(
  providerId: string,
  mediaType: CatalogMediaType,
  generation: number,
  database?: CatalogDatabaseHandle,
  consumerPhase = 'unspecified',
): Promise<{ categoryId: string | null; itemCount: number; nonzeroCategoryCount: number }> {
  const totalStarted = perfNowMs();
  const connectionStarted = perfNowMs();
  const db = database ?? (await getCatalogDatabase());
  const connectionAcquireMs = perfNowMs() - connectionStarted;
  const itemsTable = catalogItemsTable(mediaType);
  const sqlStarted = perfNowMs();
  const rows = await db.getAll<{ category_id: string; item_count: number | string }>(
    `SELECT category_id, COUNT(*) AS item_count
     FROM ${itemsTable}
     WHERE provider_id = ? AND media_type = ? AND sync_generation = ?
     GROUP BY category_id
     ORDER BY item_count DESC`,
    [providerId, mediaType, generation],
  );
  const sqlMs = perfNowMs() - sqlStarted;
  const top = rows[0];
  const result = {
    categoryId: top ? asString(top.category_id) : null,
    itemCount: top ? asNumber(top.item_count) : 0,
    nonzeroCategoryCount: rows.filter((row) => asNumber(row.item_count) > 0).length,
  };
  if (mediaType === 'movie') {
    const totalMs = perfNowMs() - totalStarted;
    const rowPopulation = rows.reduce((sum, row) => sum + asNumber(row.item_count), 0);
    novacastCatalogTrace('[NovaCast Movie Largest Category Timing]', {
      generation,
      consumerPhase,
      connection: database ? 'catalog-read' : 'catalog-primary',
      sqlSignature: 'category-count-group-by-order-by',
      tableScanned: itemsTable,
      rowPopulation,
      distinctCategoryCount: rows.length,
      connectionAcquireMs: Math.round(connectionAcquireMs),
      queueWaitMs: 0,
      sqlMs: Math.round(sqlMs),
      totalMs: Math.round(totalMs),
      indexUsed: 'idx_catalog_items_v2_provider_media_gen_category (static candidate)',
      tempBtreeUsed: true,
      queryPlan: 'EXPLAIN QUERY PLAN not executed; static index analysis only',
      resultCategoryId: result.categoryId,
      resultCount: result.itemCount,
      source: 'sqlite-group-by-count-order-by',
      callCount: 1,
    });
    logMovieCompletionTailAudit({
      phase: 'largest-category-query',
      generation,
      connection: database ? 'catalog-read' : 'catalog-primary',
      queryType: 'aggregate-read',
      querySignature: 'category-count-group-by-order-by',
      callCount: 1,
      durationMs: Math.round(totalMs),
      reusedCachedResult: false,
      rowsOrGenerationsInspected: rows.length,
    });
  }
  return result;
}

export async function completeCatalogSync(
  providerId: string,
  mediaType: CatalogMediaType,
  generation: number,
  options?: {
    processedCount?: number;
    completionStats?: CatalogCompletionStatsSnapshot;
    categories?: Array<Omit<CatalogCategoryRecord, 'itemCount' | 'updatedAt'> & {
      itemCount?: number;
      updatedAt?: number;
    }>;
  },
): Promise<boolean> {
  const completionTailStarted = perfNowMs();
  let categoryRecomputeMs = 0;
  let physicalStatsMs = 0;
  let previousGenerationStatsMs = 0;
  let distributionValidationMs = 0;
  let pointerPromotionMs = 0;
  let previousCompletedGenerationForCleanup = 0;
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
  let validatedMovieNonzeroCategoryCount: number | null = null;

  await withCatalogTransaction(async () => {
    const db = await getCatalogDatabase();
    const provider = await getCatalogProvider(providerId);
    const previousCompletedGeneration = provider?.catalogGeneration ?? 0;
    previousCompletedGenerationForCleanup = previousCompletedGeneration;

    if (options?.categories?.length) {
      const categoryUpsertStarted = perfNowMs();
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
      if (mediaType === 'movie') {
        logMovieCompletionPhase('category-upsert', generation, categoryUpsertStarted);
      }
    }

    const recomputeStarted = perfNowMs();
    await recomputeCategoryCounts(providerId, mediaType, generation);
    categoryRecomputeMs = perfNowMs() - recomputeStarted;
    if (mediaType === 'movie') {
      logMovieCompletionTailAudit({
        phase: 'category-recompute',
        generation,
        connection: 'catalog-primary',
        queryType: 'aggregate-and-update',
        querySignature: 'recompute-category-counts',
        callCount: 1,
        durationMs: Math.round(categoryRecomputeMs),
        reusedCachedResult: false,
      });
    }
    if (mediaType === 'movie') {
      logMovieCompletionPhase('recompute-category-counts', generation, recomputeStarted);
    }
    const physicalStarted = perfNowMs();
    const reusableSnapshot =
      mediaType === 'movie' &&
      options?.completionStats?.providerId === providerId &&
      options.completionStats.mediaType === 'movie' &&
      options.completionStats.generation === generation
        ? options.completionStats
        : null;
    if (reusableSnapshot) {
      const categoryRows = await db.getFirst<{ total: number | string }>(
        `SELECT COUNT(*) AS total
         FROM ${categoriesTable}
         WHERE provider_id = ? AND media_type = ? AND sync_generation = ?`,
        [providerId, mediaType, generation],
      );
      physical = {
        itemRows: reusableSnapshot.itemRows,
        distinctContentIds: reusableSnapshot.distinctContentIds,
        categoryRows: asNumber(categoryRows?.total),
        distinctItemCategoryIds: reusableSnapshot.distinctItemCategoryIds,
      };
      physicalStatsMs = perfNowMs() - physicalStarted;
      logMovieCompletionTailAudit({
        phase: 'activation-physical-stats',
        generation,
        connection: 'catalog-primary',
        queryType: 'category-metadata-refresh',
        querySignature: 'category-row-count-after-upsert-recompute',
        callCount: 1,
        durationMs: Math.round(physicalStatsMs),
        reusedCachedResult: true,
        avoidedAggregateQuery: 'item-count-distinct-content-distinct-category',
      });
      novacastCatalogTrace('[NovaCast Movie Completion Stats Reuse]', {
        generation,
        snapshotCreated: true,
        sourcePhase: 'writer-drain-completion-barrier',
        itemRows: reusableSnapshot.itemRows,
        distinctContentIds: reusableSnapshot.distinctContentIds,
        distinctItemCategoryIds: reusableSnapshot.distinctItemCategoryIds,
        categoryRows: physical.categoryRows,
        reusedItemStats: true,
        refreshedCategoryRows: true,
        invalidated: false,
        invalidationReason: null,
        avoidedAggregateQuery: true,
        estimatedRowsAvoided: reusableSnapshot.itemRows,
      });
    } else {
      physical = await getCatalogGenerationPhysicalStats(providerId, mediaType, generation);
      physicalStatsMs = perfNowMs() - physicalStarted;
      if (mediaType === 'movie') {
        novacastCatalogTrace('[NovaCast Movie Completion Stats Reuse]', {
          generation,
          snapshotCreated: false,
          sourcePhase: 'activation-fallback',
          itemRows: physical.itemRows,
          distinctContentIds: physical.distinctContentIds,
          distinctItemCategoryIds: physical.distinctItemCategoryIds,
          categoryRows: physical.categoryRows,
          reusedItemStats: false,
          refreshedCategoryRows: false,
          invalidated: true,
          invalidationReason: 'missing-or-mismatched-completion-snapshot',
          avoidedAggregateQuery: false,
          estimatedRowsAvoided: 0,
        });
      }
    }
    if (mediaType === 'movie') {
      logMovieCompletionPhase('get-physical-stats', generation, physicalStarted);
    }

    let previousItemRows = 0;
    let previousPhysicalMs = 0;
    let previousLargestMs = 0;
    let previousLifecycleState: string | null = null;
    let previousBaseline: MovieActivationBaseline | null = null;
    let previousBaselineValid = false;
    let baselineLookupMs = 0;
    if (
      usesGenerationSafeCatalog(mediaType) &&
      previousCompletedGeneration > 0 &&
      previousCompletedGeneration !== generation
    ) {
      const previousGenerationStarted = perfNowMs();
      if (mediaType === 'movie') {
        const baselineLookupStarted = perfNowMs();
        previousBaseline = await getMovieActivationBaseline(
          providerId,
          previousCompletedGeneration,
          db,
        );
        baselineLookupMs = perfNowMs() - baselineLookupStarted;
        previousLifecycleState = previousBaseline.lifecycleState;
        previousBaselineValid =
          previousBaseline.lifecycleState === 'ready' &&
          previousBaseline.totalItems != null &&
          previousBaseline.nonzeroCategoryCount != null &&
          Number.isFinite(previousBaseline.totalItems) &&
          Number.isFinite(previousBaseline.nonzeroCategoryCount) &&
          previousBaseline.totalItems >= 0 &&
            previousBaseline.nonzeroCategoryCount >= 0;
      } else {
        previousLifecycleState = await getCatalogGenerationLifecycleState(
          providerId,
          mediaType,
          previousCompletedGeneration,
          db,
        );
      }
      if (mediaType !== 'movie' || !previousBaselineValid) {
        const previousPhysicalStarted = perfNowMs();
        previousItemRows = (
          await getCatalogGenerationPhysicalStats(providerId, mediaType, previousCompletedGeneration)
        ).itemRows;
        previousPhysicalMs = perfNowMs() - previousPhysicalStarted;
      } else {
        previousItemRows = previousBaseline?.totalItems ?? 0;
      }
      previousGenerationStatsMs = perfNowMs() - previousGenerationStarted;
      if (mediaType === 'movie') {
        logMovieCompletionTailAudit({
          phase: 'previous-generation-stats',
          generation,
          connection: previousBaselineValid ? 'catalog-primary' : 'catalog-primary',
          queryType: previousBaselineValid ? 'completion-baseline-reuse' : 'aggregate-read',
          querySignature: previousBaselineValid
            ? 'previous-ready-baseline'
            : 'previous-generation-physical-stats',
          callCount: 1,
          durationMs: Math.round(previousGenerationStatsMs),
          reusedCachedResult: previousBaselineValid,
          avoidedAggregateQuery: previousBaselineValid
            ? 'previous-item-count-distinct-content-distinct-category'
            : false,
          readableGeneration: previousCompletedGeneration,
        });
      }
      if (mediaType === 'movie') {
        if (!previousBaselineValid) {
          logMovieCompletionPhase(
            'previous-generation-physical-stats',
            generation,
            previousGenerationStarted,
          );
        }
      }
    }

    // Ghost-completion guard: never publish an empty or inconsistent generation.
    // Stage 4.2I: Movies also require full distribution / integrity validation.
    let rejectionCode = 'complete_validation_failed';
    let validationPassed =
      physical.itemRows > 0 &&
      physical.itemRows === physical.distinctContentIds &&
      (mediaType !== 'movie' || physical.categoryRows > 0);

    if (validationPassed && mediaType === 'movie') {
      const distributionStarted = perfNowMs();
      const largestStarted = perfNowMs();
      const largest = await getCatalogGenerationLargestCategory(
        providerId,
        mediaType,
        generation,
        undefined,
        'completion-validation',
      );
      logMovieCompletionPhase('get-largest-category', generation, largestStarted);
      let previousTotalItems: number | null = null;
      let previousNonzero: number | null = null;
      if (previousCompletedGeneration > 0 && previousCompletedGeneration !== generation) {
        previousTotalItems = previousItemRows;
        if (previousBaselineValid && previousBaseline) {
          previousNonzero = previousBaseline.nonzeroCategoryCount;
        } else {
          const previousLargestStarted = perfNowMs();
          const prevLargest = await getCatalogGenerationLargestCategory(
            providerId,
            mediaType,
            previousCompletedGeneration,
            undefined,
            'previous-generation-validation',
          );
          previousLargestMs = perfNowMs() - previousLargestStarted;
          logMovieCompletionPhase('previous-generation-largest-category', generation, previousLargestStarted);
          previousNonzero = prevLargest.nonzeroCategoryCount;
        }
        novacastCatalogTrace('[NovaCast Movie Previous Ready Baseline Reuse]', {
          currentGeneration: generation,
          previousGeneration: previousCompletedGeneration,
          previousLifecycleState,
          baselineFound: previousBaseline?.lifecycleState != null,
          baselineValid: previousBaselineValid,
          baselineSource: previousBaselineValid ? 'catalog_generation_state' : null,
          previousTotalItems,
          previousNonzeroCategoryCount: previousNonzero,
          reusedPreviousTotalItems: previousBaselineValid,
          reusedPreviousNonzeroCategoryCount: previousBaselineValid,
          avoidedPreviousPhysicalStatsQuery: previousBaselineValid,
          avoidedPreviousLargestCategoryQuery: previousBaselineValid,
          fallbackUsed: !previousBaselineValid,
          fallbackReason: previousBaselineValid ? null : 'missing-or-invalid-ready-baseline',
          baselineLookupMs: Math.round(baselineLookupMs),
          physicalStatsMs: Math.round(previousPhysicalMs),
          largestCategoryMs: Math.round(previousLargestMs),
          totalBaselineMs: Math.round(previousPhysicalMs + previousLargestMs),
          sourcePhase: 'activation-validation',
          consumerPhase: 'completeCatalogSync',
        });
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
        novacastCatalogTrace(
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
        validatedMovieNonzeroCategoryCount = largest.nonzeroCategoryCount;
        novacastCatalogTrace(
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
      distributionValidationMs = perfNowMs() - distributionStarted;
    }

    // Stage 4.2Q: Series previously had no equivalent sparse-distribution
    // check here at all (only the baseline item-row/distinct-content check
    // above) ΓÇö a Series generation could promote even when its category
    // coverage was collapsed/sparse in the same way an unvalidated Movies
    // generation could before Stage 4.2I. Reuses the exact same thresholds
    // as Movies via `validateCatalogCategoryDistribution` (Stage 4.2Q
    // generalization of `validateMoviesCategoryDistribution`) ΓÇö no new
    // validation logic, no change to Movies' branch above.
    if (validationPassed && mediaType === 'series') {
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
      const distribution = validateCatalogCategoryDistribution('series', {
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
        novacastCatalogTrace(
          '[NovaCast Series Generation Activation] ' +
            JSON.stringify({
              event: 'series_generation_activation_rejected',
              providerId,
              generation,
              itemRows: physical.itemRows,
              categoryRows: physical.categoryRows,
              distinctItemCategoryIds: physical.distinctItemCategoryIds,
              nonzeroCategoryCount: largest.nonzeroCategoryCount,
              integrityDecision: 'rejected',
              reason: rejectionCode,
              marker: 'stage4q-series-sparse-catalog-validation-v1',
            }),
        );
      } else {
        novacastCatalogTrace(
          '[NovaCast Series Generation Activation] ' +
            JSON.stringify({
              event: 'series_generation_activation_passed',
              providerId,
              generation,
              itemRows: physical.itemRows,
              categoryRows: physical.categoryRows,
              distinctItemCategoryIds: physical.distinctItemCategoryIds,
              nonzeroCategoryCount: largest.nonzeroCategoryCount,
              integrityDecision: 'passed',
              reason: null,
              marker: 'stage4q-series-sparse-catalog-validation-v1',
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
      await db.run(
        `UPDATE catalog_generation_state
         SET status = 'error', phase = 'complete-rejected', completed_at = ?, error_code = ?,
             activation_total_items = NULL,
             activation_nonzero_category_count = NULL
         WHERE provider_id = ? AND media_type = ? AND sync_generation = ?`,
        [nowMs(), rejectionCode, providerId, mediaType, generation],
      );
      // Keep provider.catalogGeneration unchanged; do not delete older candidates.
      return;
    }

    // Stale-generation cleanup is scheduled after this activation transaction
    // commits. It must never hold the publication transaction open.
    if (!usesGenerationSafeCatalog(mediaType)) {
      await deleteStaleCatalogGeneration(providerId, mediaType, generation);
    }

    let movieBaselinePersistStarted = 0;
    if (mediaType === 'movie') {
      movieBaselinePersistStarted = perfNowMs();
      const lifecycleBefore = await getCatalogGenerationLifecycleState(
        providerId,
        mediaType,
        generation,
        db,
      );
      novacastCatalogTrace('[NovaCast Movie Activation Baseline Persist]', {
        event: 'before',
        generation,
        totalItems: physical.itemRows,
        nonzeroCategoryCount: validatedMovieNonzeroCategoryCount,
        validationPassed,
        lifecycleStatusBefore: lifecycleBefore,
        transactionScoped: true,
      });
      if (validatedMovieNonzeroCategoryCount == null) {
        throw new Error('movie_activation_baseline_missing');
      }
      const baselineWrite = await db.run(
        `UPDATE catalog_generation_state
         SET activation_total_items = ?,
             activation_nonzero_category_count = ?
         WHERE provider_id = ? AND media_type = 'movie' AND sync_generation = ?`,
        [
          physical.itemRows,
          validatedMovieNonzeroCategoryCount,
          providerId,
          generation,
        ],
      );
      if (Number(baselineWrite.changes ?? 0) !== 1) {
        throw new Error('movie_activation_baseline_persist_failed');
      }
    }

    const promotionStarted = perfNowMs();
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
    if (mediaType === 'movie') {
      await logMovieProviderGenerationPointer({
        event: 'before-provider-generation-write',
        providerId,
        database: db,
        requestedProviderCatalogGeneration: generation,
        sourceFunction: 'completeCatalogSync',
        sourcePhase: 'activation-promotion',
        pointerReason: 'validated-generation-activation',
      });
    }
    await db.run(
      `UPDATE catalog_providers
       SET catalog_generation = ?,
           last_successful_sync_at = ?,
           sync_status = 'ready',
           sync_error_code = NULL
       WHERE provider_id = ?`,
      [generation, completedAt, providerId],
    );
    if (mediaType === 'movie') {
      await logMovieProviderGenerationPointer({
        event: 'after-provider-generation-write',
        providerId,
        database: db,
        requestedProviderCatalogGeneration: generation,
        sourceFunction: 'completeCatalogSync',
        sourcePhase: 'activation-promotion',
        pointerReason: 'validated-generation-activation',
      });
    }
    await db.run(
      `UPDATE catalog_generation_state
       SET status = 'ready', phase = 'complete', completed_at = ?, error_code = NULL,
           processed_count = COALESCE(?, processed_count)
       WHERE provider_id = ? AND media_type = ? AND sync_generation = ?`,
      [completedAt, options?.processedCount ?? null, providerId, mediaType, generation],
    );
    if (mediaType === 'movie') {
      novacastCatalogTrace('[NovaCast Movie Activation Baseline Persist]', {
        event: 'after',
        generation,
        totalItems: physical.itemRows,
        nonzeroCategoryCount: validatedMovieNonzeroCategoryCount,
        validationPassed: true,
        lifecycleStatusBefore: 'syncing',
        lifecycleStatusAfter: 'ready',
        persisted: true,
        transactionScoped: true,
        totalPersistMs: Math.round(perfNowMs() - movieBaselinePersistStarted),
      });
    }
    if (mediaType === 'movie') {
      logMovieCompletionPhase('promotion-pointer-update', generation, promotionStarted);
      pointerPromotionMs = perfNowMs() - promotionStarted;
    }
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
  void markSortMetadataUpgradeSatisfied(providerId, mediaType).catch(() => undefined);
  if (usesGenerationSafeCatalog(mediaType)) {
    const keep = [generation];
    if (previousCompletedGenerationForCleanup > 0 && previousCompletedGenerationForCleanup !== generation) {
      keep.push(previousCompletedGenerationForCleanup);
    }
    if (mediaType === 'movie') {
      novacastCatalogTrace('[NovaCast Movie Post Activation Cleanup]', {
        event: 'scheduled',
        providerId,
        mediaType,
        generation,
        retainedGenerations: keep,
      });
    }
    void cleanupIncompleteCatalogGenerationsV2(providerId, mediaType, keep).catch((error) => {
      novacastCatalogTrace('[NovaCast Movie Post Activation Cleanup]', {
        event: 'failed',
        providerId,
        mediaType,
        generation,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }
  if (mediaType === 'movie') {
    novacastCatalogTrace(
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
  if (mediaType === 'series') {
    novacastCatalogTrace(
      '[NovaCast Series Generation Activation] ' +
        JSON.stringify({
          event: 'series_generation_swap_committed',
          providerId,
          generation,
          itemRows: physical.itemRows,
          categoryRows: physical.categoryRows,
          distinctItemCategoryIds: physical.distinctItemCategoryIds,
          integrityDecision: 'activated',
          reason: null,
          marker: 'stage4q-series-sparse-catalog-validation-v1',
        }),
    );
  }
  novacastCatalogTrace('[Catalog Categories Published]', {
    providerId,
    mediaType,
    generation,
    categoryCount: publishedCategoryCount,
  });
  if (mediaType === 'movie') {
    novacastCatalogTrace('[NovaCast Movie Completion Tail Summary]', {
      generation,
      totalTimeMs: Math.round(perfNowMs() - completionTailStarted),
      barrierStatsMs: null,
      recoveryMs: null,
      distributionValidationMs: Math.round(distributionValidationMs),
      physicalStatsMs: Math.round(physicalStatsMs),
      previousGenerationStatsMs: Math.round(previousGenerationStatsMs),
      categoryRecomputeMs: Math.round(categoryRecomputeMs),
      activationValidationMs: Math.round(distributionValidationMs),
      pointerPromotionMs: Math.round(pointerPromotionMs),
      transactionOverheadMs: null,
      otherMs: null,
      note: 'repository-activation-tail-only; outer barrier/recovery timings are emitted by the writer',
    });
  }
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
 * Stage 4.2L: lightweight generation presence check ΓÇö COUNT(*) only.
 * Avoids COUNT(DISTINCT ΓÇª) used by physical stats during startup.
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
  const started = perfNowMs();
  const stats = await getCatalogGenerationPhysicalStats(providerId, mediaType, generation);
  const result = {
    rowCount: stats.itemRows,
    distinctContentCount: stats.distinctContentIds,
  };
  if (mediaType === 'movie') {
    logMovieCompletionTailAudit({
      phase: 'item-stats-wrapper',
      generation,
      connection: 'catalog-primary',
      queryType: 'aggregate-read-wrapper',
      querySignature: 'getCatalogGenerationItemStats->getCatalogGenerationPhysicalStats',
      callCount: 1,
      durationMs: Math.round(perfNowMs() - started),
      reusedCachedResult: false,
      rowsOrGenerationsInspected: result.rowCount,
    });
  }
  return result;
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

  if (failedGeneration > 0) {
    await db.run(
      `UPDATE catalog_generation_state
       SET status = 'error', phase = 'failed', completed_at = ?, error_code = ?,
           activation_total_items = NULL,
           activation_nonzero_category_count = NULL
       WHERE provider_id = ? AND media_type = ? AND sync_generation = ?`,
      [failedAt, errorCode, providerId, mediaType, failedGeneration],
    );
  }

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
    const restoredReady = await db.getFirst<{ g: number | string | null }>(
      `SELECT MAX(sync_generation) AS g
       FROM catalog_generation_state
       WHERE provider_id = ? AND media_type = ? AND status = 'ready'
         AND (? = 0 OR sync_generation != ?)`,
      [providerId, mediaType, failedGeneration, failedGeneration],
    );
    const restoredGeneration = asNumber(restoredReady?.g);
    if (mediaType === 'movie') {
      await logMovieProviderGenerationPointer({
        event: 'before-provider-generation-write',
        providerId,
        database: db,
        requestedProviderCatalogGeneration: restoredGeneration,
        sourceFunction: 'failCatalogSync',
        sourcePhase: 'failure-ghost-clear',
        pointerReason:
          restoredGeneration > 0 ? 'restore-prior-ready-generation' : 'clear-empty-failed-generation',
      });
    }
    await db.run(
      `UPDATE catalog_providers
       SET catalog_generation = ?,
           sync_status = 'error',
           sync_error_code = ?
       WHERE provider_id = ?`,
      [restoredGeneration, errorCode, providerId],
    );
    if (mediaType === 'movie') {
      await logMovieProviderGenerationPointer({
        event: 'after-provider-generation-write',
        providerId,
        database: db,
        requestedProviderCatalogGeneration: restoredGeneration,
        sourceFunction: 'failCatalogSync',
        sourcePhase: 'failure-ghost-clear',
        pointerReason:
          restoredGeneration > 0 ? 'restore-prior-ready-generation' : 'clear-empty-failed-generation',
      });
    }
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
  database?: CatalogDatabaseHandle,
): Promise<CatalogSyncStateRecord | null> {
  const db = database ?? (await getCatalogDatabase());
  const row = await db.getFirst(
    `SELECT * FROM catalog_sync_state WHERE provider_id = ? AND media_type = ?`,
    [providerId, mediaType],
  );
  return row ? mapSyncState(row) : null;
}

export type CatalogBootstrapState = {
  providerCatalogGeneration: number;
  currentAttemptGeneration: number;
  currentStatus: CatalogSyncStatus | null;
  durableReadyGeneration: number;
  durableReadyLifecycleState: string | null;
};

/** Read-only durable gate used before provider activation requests a bootstrap. */
export async function getCatalogBootstrapState(
  providerId: string,
  mediaType: CatalogMediaType,
): Promise<CatalogBootstrapState> {
  const db = await getCatalogDatabase();
  const [provider, current, ready] = await Promise.all([
    db.getFirst<{ catalog_generation: number | string | null }>(
      `SELECT catalog_generation FROM catalog_providers WHERE provider_id = ?`,
      [providerId],
    ),
    db.getFirst<{ generation: number | string | null; status: string | null }>(
      `SELECT generation, status
       FROM catalog_sync_state
       WHERE provider_id = ? AND media_type = ?`,
      [providerId, mediaType],
    ),
    db.getFirst<{ sync_generation: number | string | null; status: string | null }>(
      `SELECT sync_generation, status
       FROM catalog_generation_state
       WHERE provider_id = ? AND media_type = ? AND status = 'ready'
       ORDER BY sync_generation DESC
       LIMIT 1`,
      [providerId, mediaType],
    ),
  ]);
  return {
    providerCatalogGeneration: asNumber(provider?.catalog_generation),
    currentAttemptGeneration: asNumber(current?.generation),
    currentStatus: (current?.status as CatalogSyncStatus | null | undefined) ?? null,
    durableReadyGeneration: asNumber(ready?.sync_generation),
    durableReadyLifecycleState: ready?.status ?? null,
  };
}

export async function getCatalogGenerationLifecycleState(
  providerId: string,
  mediaType: CatalogMediaType,
  generation: number,
  database?: CatalogDatabaseHandle,
): Promise<string | null> {
  if (generation <= 0) {
    return null;
  }
  const db = database ?? (await getCatalogDatabase());
  const row = await db.getFirst<{ status: string }>(
    `SELECT status
     FROM catalog_generation_state
     WHERE provider_id = ? AND media_type = ? AND sync_generation = ?`,
    [providerId, mediaType, generation],
  );
  return row?.status ?? null;
}

export type MovieActivationBaseline = {
  lifecycleState: string | null;
  totalItems: number | null;
  nonzeroCategoryCount: number | null;
};

export async function getMovieActivationBaseline(
  providerId: string,
  generation: number,
  database?: CatalogDatabaseHandle,
): Promise<MovieActivationBaseline> {
  if (generation <= 0) {
    return { lifecycleState: null, totalItems: null, nonzeroCategoryCount: null };
  }
  const db = database ?? (await getCatalogDatabase());
  const row = await db.getFirst<{
    status: string;
    activation_total_items: number | string | null;
    activation_nonzero_category_count: number | string | null;
  }>(
    `SELECT status, activation_total_items, activation_nonzero_category_count
     FROM catalog_generation_state
     WHERE provider_id = ? AND media_type = 'movie' AND sync_generation = ?`,
    [providerId, generation],
  );
  return {
    lifecycleState: row?.status ?? null,
    totalItems: row?.activation_total_items == null ? null : asNumber(row.activation_total_items),
    nonzeroCategoryCount:
      row?.activation_nonzero_category_count == null
        ? null
        : asNumber(row.activation_nonzero_category_count),
  };
}

export async function getCatalogProvider(
  providerId: string,
  database?: CatalogDatabaseHandle,
): Promise<CatalogProviderRecord | null> {
  const db = database ?? (await getCatalogDatabase());
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

    novacastCatalogTrace(
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
    novacastCatalogTrace(
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
  if (lastCompletedGeneration <= 0) {
    const readyLifecycle = await db.getFirst<{ g: number | string | null }>(
      `SELECT MAX(sync_generation) AS g
       FROM catalog_generation_state
       WHERE provider_id = ? AND media_type = ? AND status = 'ready'`,
      [providerId, mediaType],
    );
    lastCompletedGeneration = asNumber(readyLifecycle?.g);
  }
  const lastFailedGeneration = incompleteGenerationToExclude({
    currentAttemptGeneration,
    currentStatus: state?.status ?? null,
    lastCompletedGeneration,
  });
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
  novacastCatalogTrace(
    '[Catalog Read Generation] ' +
      JSON.stringify({
        providerId,
        mediaType,
        currentAttemptGeneration,
        currentStatus: state?.status ?? null,
        lastCompletedGeneration,
        resolvedReadableGeneration,
        readableRowCount,
        reason: resolvedReason,
        marker: usesGenerationSafeCatalog(mediaType) ? STAGE3C_GENERATION_SAFE_MARKER : null,
      }),
  );
  novacastCatalogTrace(CATALOG_READABLE_RESTORE_LOG, {
    providerId,
    mediaType,
    physicalRowCount: readableRowCount,
    activeGeneration: provider?.catalogGeneration ?? 0,
    lastCompletedGeneration,
    readableGeneration: resolvedReadableGeneration,
    lifecycleState: state?.status ?? null,
    currentAttemptGeneration,
    currentStatus: state?.status ?? null,
    priorReadyRestoredOnBoot:
      lastCompletedGeneration > 0 && lastCompletedGeneration !== (provider?.catalogGeneration ?? 0),
    canonicalResolutionEligible: resolvedReadableGeneration > 0,
    coordinatorInFlight: isCatalogSyncRunning(providerId, mediaType),
    reason: resolvedReason,
  });

  // Diagnostics only ΓÇö never changes the resolved generation above.
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
  database: CatalogDatabaseHandle,
): Promise<{
  snapshot: MoviesGenerationPhysicalSnapshot;
  physicalStatsMs: number;
  largestCategoryMs: number;
}> {
  const physicalStarted = perfNowMs();
  const physicalPromise = getCatalogGenerationPhysicalStats(
    providerId,
    'movie',
    generation,
    database,
  ).then((value) => ({ value, durationMs: perfNowMs() - physicalStarted }));
  const largestStarted = perfNowMs();
  const largestPromise = getCatalogGenerationLargestCategory(
    providerId,
    'movie',
    generation,
    database,
    'readable-recovery-candidate',
  ).then((value) => ({ value, durationMs: perfNowMs() - largestStarted }));
  const [{ value: physical, durationMs: physicalStatsMs }, { value: largest, durationMs: largestCategoryMs }] = await Promise.all([
    physicalPromise,
    largestPromise,
  ]);
  return {
    snapshot: {
      generation,
      itemRows: physical.itemRows,
      distinctContentIds: physical.distinctContentIds,
      categoryRows: physical.categoryRows,
      distinctItemCategoryIds: physical.distinctItemCategoryIds,
      nonzeroCategoryCount: largest.nonzeroCategoryCount,
      largestCategoryId: largest.categoryId,
      largestCategoryCount: largest.itemCount,
    },
    physicalStatsMs,
    largestCategoryMs,
  };
}

async function listMoviesGenerationCandidateNumbers(
  providerId: string,
  excludeIncompleteSyncingGeneration: number,
  database: CatalogDatabaseHandle,
): Promise<number[]> {
  const rows = await database.getAll<{ sync_generation: number | string }>(
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

async function findDurableReadyMovieRecoveryGeneration(
  providerId: string,
  currentAttemptGeneration: number,
  currentStatus: string | null,
  providerCatalogGeneration: number,
  database: CatalogDatabaseHandle,
): Promise<number> {
  const started = perfNowMs();
  let durableReadyGeneration = 0;
  let durableReadyLifecycleState: string | null = null;
  let retainedEligibility = false;
  let fallbackReason: string | null = null;

  const lifecycle = await database.getFirst<{
    sync_generation: number | string;
    status: string;
  }>(
    `SELECT sync_generation, status
     FROM catalog_generation_state
     WHERE provider_id = ? AND media_type = 'movie'
       AND status = 'ready'
       AND (
         ? = 0
         OR sync_generation != ?
         OR ? != 'syncing'
       )
     ORDER BY sync_generation DESC
     LIMIT 1`,
    [providerId, currentAttemptGeneration, currentAttemptGeneration, currentStatus ?? ''],
  );
  durableReadyGeneration = asNumber(lifecycle?.sync_generation);
  durableReadyLifecycleState = lifecycle?.status ?? null;

  if (durableReadyGeneration > 0 && durableReadyLifecycleState === 'ready') {
    const [itemExists, categoryExists] = await Promise.all([
      database.getFirst<{ present: number }>(
        `SELECT 1 AS present
         FROM catalog_items_v2
         WHERE provider_id = ? AND media_type = 'movie' AND sync_generation = ?
         LIMIT 1`,
        [providerId, durableReadyGeneration],
      ),
      database.getFirst<{ present: number }>(
        `SELECT 1 AS present
         FROM catalog_categories_v2
         WHERE provider_id = ? AND media_type = 'movie' AND sync_generation = ?
         LIMIT 1`,
        [providerId, durableReadyGeneration],
      ),
    ]);
    retainedEligibility = Boolean(itemExists?.present && categoryExists?.present);
    if (!retainedEligibility) {
      fallbackReason = 'durable-ready-generation-has-no-retained-rows';
    }
  } else {
    fallbackReason = 'no-prior-durable-ready-movie-generation';
  }

  const fastPathEligible = retainedEligibility;
  const totalFastPathMs = perfNowMs() - started;
  novacastCatalogTrace('[NovaCast Movie Durable Ready Recovery]', {
    currentAttemptGeneration,
    currentStatus,
    providerCatalogGeneration,
    durableReadyGeneration,
    durableReadyLifecycleState,
    durableReadyFound: durableReadyGeneration > 0,
    retainedEligibility,
    fastPathEligible,
    fastPathUsed: fastPathEligible,
    fallbackReason,
    selectedGeneration: fastPathEligible ? durableReadyGeneration : 0,
    avoidedHistoricalEnumeration: fastPathEligible,
    avoidedPhysicalStatsQuery: fastPathEligible,
    avoidedLargestCategoryQuery: fastPathEligible,
    avoidedDistributionValidation: fastPathEligible,
    totalFastPathMs: Math.round(totalFastPathMs),
  });
  return fastPathEligible ? durableReadyGeneration : 0;
}

async function assessMoviesGenerationCandidate(
  providerId: string,
  generation: number,
  database: CatalogDatabaseHandle,
  previousValidated: {
    generation: number;
    totalItems: number;
    nonzeroCategoryCount: number;
  } | null,
  context: {
    generationState: { status: string; errorCode: string | null } | undefined;
    candidateSource: string;
    wasAlreadyKnownReadable: boolean;
    wasProviderCatalogGeneration: boolean;
    wasLastReadyGeneration: boolean;
  },
): Promise<MoviesGenerationIntegrityAssessment> {
  const candidateStarted = perfNowMs();
  const stateLookupStarted = perfNowMs();
  const generationState = context.generationState;
  const stateLookupMs = perfNowMs() - stateLookupStarted;
  const loaded = await loadMoviesGenerationPhysicalSnapshot(providerId, generation, database);
  const validationStarted = perfNowMs();
  const assessment = assessMoviesGenerationSnapshotIntegrity({
    snapshot: loaded.snapshot,
    previousValidated,
  });
  const categoryDistributionValidationMs = perfNowMs() - validationStarted;
  const totalCandidateMs = perfNowMs() - candidateStarted;
  novacastCatalogTrace('[NovaCast Movie Recovery Timing]', {
    phase: 'candidate',
    generation,
    generationState: generationState?.status ?? null,
    markedReady: generationState?.status === 'ready',
    markedFailed: generationState?.status === 'error',
    candidateSource: context.candidateSource,
    physicalStatsMs: Math.round(loaded.physicalStatsMs),
    largestCategoryMs: Math.round(loaded.largestCategoryMs),
    categoryDistributionValidationMs: Math.round(categoryDistributionValidationMs),
    stateLookupMs: Math.round(stateLookupMs),
    totalCandidateMs: Math.round(totalCandidateMs),
    itemRows: assessment.itemRows,
    categoryRows: assessment.categoryRows,
    distinctItemCategoryIds: assessment.distinctItemCategoryIds,
    integrityDecision: assessment.healthy ? 'passed' : 'rejected',
    rejectionReason: assessment.healthy ? null : assessment.reason,
    resultUsed: false,
    wasAlreadyKnownReadable: context.wasAlreadyKnownReadable,
    wasProviderCatalogGeneration: context.wasProviderCatalogGeneration,
    wasLastReadyGeneration: context.wasLastReadyGeneration,
  });
  novacastCatalogTrace(
    '[NovaCast Movies Readable Recovery] ' +
      JSON.stringify({
        event: 'movies_readable_candidate_assessed',
        providerId,
        generation,
        itemRows: assessment.itemRows,
        categoryRows: assessment.categoryRows,
        distinctItemCategoryIds: assessment.distinctItemCategoryIds,
        nonzeroCategoryCount: assessment.nonzeroCategoryCount,
        coverageRatio: assessment.distribution?.coverageRatio ?? null,
        totalItems: assessment.itemRows,
        integrityDecision: assessment.healthy ? 'passed' : 'rejected',
        reason: assessment.reason,
        recoveryComparedWithPrevious: false,
        marker: MOVIES_FOCUS_STAGE4I_MARKER,
      }),
  );
  return assessment;
}

async function getMovieGenerationLifecycleStates(providerId: string, database: CatalogDatabaseHandle) {
  const rows = await database.getAll<{ sync_generation: number | string; status: string; error_code: string | null }>(
    `SELECT sync_generation, status, error_code
     FROM catalog_generation_state
     WHERE provider_id = ? AND media_type = 'movie'`,
    [providerId],
  );
  return new Map(
    rows.map((row) => [asNumber(row.sync_generation), { status: row.status, errorCode: row.error_code }]),
  );
}

/** Bounded transactional pointer repair ΓÇö credentials/activation untouched. */
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
    await logMovieProviderGenerationPointer({
      event: 'before-provider-generation-write',
      providerId,
      database: db,
      requestedProviderCatalogGeneration: recoveredGeneration,
      sourceFunction: 'repairMoviesProviderCatalogGenerationPointer',
      sourcePhase: 'readable-recovery-pointer-repair',
      pointerReason: 'recovered-validated-generation',
    });
    await db.run(
      `UPDATE catalog_providers
       SET catalog_generation = ?
       WHERE provider_id = ?`,
      [recoveredGeneration, providerId],
    );
    await logMovieProviderGenerationPointer({
      event: 'after-provider-generation-write',
      providerId,
      database: db,
      requestedProviderCatalogGeneration: recoveredGeneration,
      sourceFunction: 'repairMoviesProviderCatalogGenerationPointer',
      sourcePhase: 'readable-recovery-pointer-repair',
      pointerReason: 'recovered-validated-generation',
    });
    repaired = true;
    novacastCatalogTrace(
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
  const recoveryStarted = perfNowMs();
  const stateStarted = perfNowMs();
  const readDb = await getCatalogDatabase();
  const lifecycleStates = await getMovieGenerationLifecycleStates(providerId, readDb);
  const state = await getCatalogSyncState(providerId, 'movie', readDb);
  const provider = await getCatalogProvider(providerId, readDb);
  const stateLookupMs = perfNowMs() - stateStarted;
  const currentAttemptGeneration = state?.generation ?? 0;
  const syncStatus = state?.status ?? null;
  const activeGeneration = provider?.catalogGeneration ?? 0;
  const knownReadableGeneration = getCachedMoviesReadableGeneration(providerId)?.generation ?? 0;
  const lastReadyMovieGeneration = [...lifecycleStates.entries()]
    .filter(([, value]) => value.status === 'ready')
    .reduce((max, [generation]) => Math.max(max, generation), 0);
  const physicalMovieRow = await readDb.getFirst<{ row_count: number | string }>(
    `SELECT COUNT(*) AS row_count
     FROM catalog_items_v2
     WHERE provider_id = ? AND media_type = 'movie'`,
    [providerId],
  );
  const physicalMovieRowCount = asNumber(physicalMovieRow?.row_count);
  const pointerCandidate = resolveMoviePointerCandidate({
    providerCatalogGeneration: activeGeneration,
    providerPointerLifecycleStatus: lifecycleStates.get(activeGeneration)?.status ?? null,
    lastReadyMovieGeneration,
  });
  const logReadableRestore = (input: {
    readableGeneration: number;
    readableRowCount: number;
    reason: string;
    lifecycleState: string | null;
  }) => {
    novacastCatalogTrace(CATALOG_READABLE_RESTORE_LOG, {
      providerId,
      mediaType: 'movie',
      physicalRowCount: physicalMovieRowCount,
      activeGeneration,
      lastCompletedGeneration: lastReadyMovieGeneration,
      readableGeneration: input.readableGeneration,
      lifecycleState: input.lifecycleState,
      currentAttemptGeneration,
      currentStatus: syncStatus,
      priorReadyRestoredOnBoot:
        pointerCandidate.restoredPriorReady ||
        (lastReadyMovieGeneration > 0 && lastReadyMovieGeneration !== activeGeneration),
      canonicalResolutionEligible: input.readableGeneration > 0,
      coordinatorInFlight: isCatalogSyncRunning(providerId, 'movie'),
      reason: input.reason,
    });
  };
  const pointerGeneration = pointerCandidate.pointerGeneration;
  const excludeSyncing =
    syncStatus === 'syncing' &&
    currentAttemptGeneration > 0 &&
    lastReadyMovieGeneration > 0
      ? currentAttemptGeneration
      : 0;

  const pointerLifecycleState = lifecycleStates.get(pointerGeneration);
  const pointerIsExcludedSyncingGeneration =
    pointerGeneration > 0 &&
    (pointerLifecycleState?.status === 'syncing' ||
      (excludeSyncing > 0 && pointerGeneration === excludeSyncing));
  const activeLifecycleState = pointerLifecycleState;
  const pointerMediaEligibility = pointerLifecycleState?.status === 'ready';
  const pointerEligibilityReason =
    pointerLifecycleState?.status === 'ready'
      ? 'movie-lifecycle-ready'
      : pointerLifecycleState?.status === 'syncing'
        ? 'movie-lifecycle-syncing'
        : pointerLifecycleState?.status === 'error'
          ? 'movie-lifecycle-failed'
          : pointerGeneration > 0
            ? 'movie-lifecycle-record-missing'
            : 'movie-lifecycle-record-missing';
  let activeAssessment: MoviesGenerationIntegrityAssessment | null = null;

  novacastCatalogTrace('[NovaCast Movie Provider Generation Pointer]', {
    event: 'movie-pointer-candidate-evaluation',
    providerCatalogGeneration: activeGeneration,
    lifecycleGeneration: pointerGeneration,
    movieLifecycleStateForPointer: pointerLifecycleState?.status ?? null,
    pointerMediaEligibility,
    pointerEligibilityReason,
    pointerAcceptedAsMovieCandidate: pointerMediaEligibility,
    pointerSource: pointerCandidate.source,
    restoredPriorReady: pointerCandidate.restoredPriorReady,
  });

  await logMovieProviderGenerationPointer({
    event: 'pre-recovery-pointer-snapshot',
    providerId,
    database: readDb,
    requestedProviderCatalogGeneration: null,
    sourceFunction: 'resolveMoviesReadableCatalogGenerationUncached',
    sourcePhase: 'before-recovery-assessment',
    pointerReason: 'recovery-start-snapshot',
  });

  if (pointerIsExcludedSyncingGeneration) {
    novacastCatalogTrace('[NovaCast Movie Recovery Eligibility]', {
      generation: pointerGeneration,
      generationState: pointerLifecycleState?.status ?? 'syncing',
      markedReady: false,
      markedFailed: false,
      eligibilityDecision: 'excluded',
      eligibilityReason: 'explicit-syncing-generation-not-readable',
    });
  }

  let activeBaselineFound = false;
  let activeBaselineValid = false;
  let activeBaselineTotalItems: number | null = null;
  let activeBaselineNonzeroCategoryCount: number | null = null;
  let retainedItemSanityPassed = false;
  let retainedCategorySanityPassed = false;
  let fastPathEligible = false;
  let fastPathUsed = false;
  let fallbackReason: string | null = null;
  let baselineLookupMs = 0;
  let sanityCheckMs = 0;

  if (pointerGeneration <= 0) {
    fallbackReason = 'no-provider-pointer-candidate';
  } else if (!pointerMediaEligibility) {
    fallbackReason = pointerLifecycleState?.status === 'syncing'
      ? 'movie-pointer-generation-syncing'
      : pointerLifecycleState?.status === 'error'
        ? 'movie-pointer-generation-failed'
        : 'movie-pointer-lifecycle-record-missing';
  } else if (pointerIsExcludedSyncingGeneration) {
    fallbackReason = 'movie-pointer-generation-excluded-syncing';
  } else {
    const baselineStarted = perfNowMs();
    const baseline = await getMovieActivationBaseline(providerId, pointerGeneration, readDb);
    baselineLookupMs = perfNowMs() - baselineStarted;
    activeBaselineFound = baseline.lifecycleState != null;
    activeBaselineTotalItems = baseline.totalItems;
    activeBaselineNonzeroCategoryCount = baseline.nonzeroCategoryCount;
    activeBaselineValid =
      baseline.lifecycleState === 'ready' &&
      baseline.totalItems != null &&
      baseline.nonzeroCategoryCount != null &&
      Number.isFinite(baseline.totalItems) &&
      Number.isFinite(baseline.nonzeroCategoryCount) &&
      baseline.totalItems > 0 &&
      baseline.nonzeroCategoryCount > 0;
    const sanityStarted = perfNowMs();
    const [itemExists, categoryExists] = await Promise.all([
      readDb.getFirst<{ present: number }>(
        `SELECT 1 AS present
         FROM catalog_items_v2
         WHERE provider_id = ? AND media_type = 'movie' AND sync_generation = ?
         LIMIT 1`,
        [providerId, pointerGeneration],
      ),
      readDb.getFirst<{ present: number }>(
        `SELECT 1 AS present
         FROM catalog_categories_v2
         WHERE provider_id = ? AND media_type = 'movie' AND sync_generation = ?
         LIMIT 1`,
        [providerId, pointerGeneration],
      ),
    ]);
    sanityCheckMs = perfNowMs() - sanityStarted;
    retainedItemSanityPassed = Boolean(itemExists?.present);
    retainedCategorySanityPassed = Boolean(categoryExists?.present);
    // A previously completed generation stays readable even if activation
    // baseline columns were never persisted. Do not re-run sparse integrity.
    fastPathEligible = retainedItemSanityPassed && retainedCategorySanityPassed;
    if (!fastPathEligible) {
      fallbackReason = !retainedItemSanityPassed
        ? 'retained-movie-items-missing'
        : 'retained-movie-categories-missing';
    } else if (!activeBaselineValid) {
      fallbackReason = null;
    }
  }

  if (fastPathEligible) {
    fastPathUsed = true;
    logMovieActiveReadyResolverFastPath({
      providerId,
      candidateGeneration: pointerGeneration,
      providerCatalogGeneration: activeGeneration,
      movieLifecycleGeneration: pointerGeneration,
      movieLifecycleState: activeLifecycleState?.status ?? null,
      pointerMediaEligibility,
      baselineFound: activeBaselineFound,
      baselineValid: activeBaselineValid,
      activationTotalItems: activeBaselineTotalItems,
      activationNonzeroCategoryCount: activeBaselineNonzeroCategoryCount,
      retainedItemSanityPassed,
      retainedCategorySanityPassed,
      fastPathEligible,
      fastPathUsed,
      fallbackUsed: false,
      fallbackReason: null,
      avoidedPhysicalStatsQuery: true,
      avoidedLargestCategoryQuery: true,
      avoidedDistributionValidation: true,
      avoidedHistoricalEnumeration: true,
      baselineLookupMs: Math.round(baselineLookupMs),
      sanityCheckMs: Math.round(sanityCheckMs),
      totalFastPathMs: Math.round(perfNowMs() - recoveryStarted),
      sourceFunction: 'resolveMoviesReadableCatalogGenerationUncached',
      sourcePhase: 'active-ready-baseline-short-circuit',
    });
    await logMovieProviderGenerationPointer({
      event: 'post-recovery-pointer-snapshot',
      providerId,
      database: readDb,
      requestedProviderCatalogGeneration: pointerGeneration,
      sourceFunction: 'resolveMoviesReadableCatalogGenerationUncached',
      sourcePhase: 'active-ready-baseline-short-circuit',
      pointerReason: pointerCandidate.restoredPriorReady
        ? 'restored-prior-ready-generation'
        : 'active-ready-baseline-fast-path',
    });
    if (pointerCandidate.restoredPriorReady) {
      void repairMoviesProviderCatalogGenerationPointer(providerId, pointerGeneration);
    }
    logReadableRestore({
      readableGeneration: pointerGeneration,
      readableRowCount: activeBaselineTotalItems ?? physicalMovieRowCount,
      reason: pointerCandidate.restoredPriorReady ? 'restored-prior-ready-generation' : 'active-ready-baseline-fast-path',
      lifecycleState: pointerLifecycleState?.status ?? null,
    });
    return pointerGeneration;
  }

  logMovieActiveReadyResolverFastPath({
    providerId,
    candidateGeneration: pointerGeneration,
    providerCatalogGeneration: activeGeneration,
    movieLifecycleGeneration: pointerGeneration,
    movieLifecycleState: activeLifecycleState?.status ?? null,
    pointerMediaEligibility,
    baselineFound: activeBaselineFound,
    baselineValid: activeBaselineValid,
    activationTotalItems: activeBaselineTotalItems,
    activationNonzeroCategoryCount: activeBaselineNonzeroCategoryCount,
    retainedItemSanityPassed,
    retainedCategorySanityPassed,
    fastPathEligible,
    fastPathUsed,
    fallbackUsed: true,
    fallbackReason: fallbackReason ?? 'active-ready-fast-path-not-eligible',
    avoidedPhysicalStatsQuery: false,
    avoidedLargestCategoryQuery: false,
    avoidedDistributionValidation: false,
    avoidedHistoricalEnumeration: false,
    baselineLookupMs: Math.round(baselineLookupMs),
    sanityCheckMs: Math.round(sanityCheckMs),
    totalFastPathMs: Math.round(perfNowMs() - recoveryStarted),
    sourceFunction: 'resolveMoviesReadableCatalogGenerationUncached',
    sourcePhase: 'active-ready-baseline-fallback',
  });

  if (
    pointerGeneration > 0 &&
    pointerMediaEligibility &&
    !pointerIsExcludedSyncingGeneration
  ) {
    activeAssessment = await assessMoviesGenerationCandidate(providerId, pointerGeneration, readDb, null, {
      generationState: lifecycleStates.get(pointerGeneration),
      candidateSource: pointerCandidate.source === 'durable-ready' ? 'durable-ready-generation' : 'provider-catalog-generation',
      wasAlreadyKnownReadable: knownReadableGeneration === pointerGeneration,
      wasProviderCatalogGeneration: activeGeneration === pointerGeneration,
      wasLastReadyGeneration: pointerLifecycleState?.status === 'ready',
    });
    if (pointerLifecycleState?.status === 'error') {
      activeAssessment = {
        ...activeAssessment,
        healthy: false,
        degraded: true,
        reason: 'explicit-failed-generation',
      };
      novacastCatalogTrace('[NovaCast Movie Recovery Eligibility]', {
        providerId,
        generation: pointerGeneration,
        activeIntegrityPassed: activeAssessment.healthy,
        eligible: false,
        reason: 'explicit-failed-generation',
        errorCode: pointerLifecycleState.errorCode,
      });
    } else if (activeAssessment.healthy) {
      setCachedMoviesReadableGeneration({
        providerId,
        generation: pointerGeneration,
        resolvedAt: Date.now(),
        itemRows: activeAssessment.itemRows,
        categoryRows: activeAssessment.categoryRows,
        distinctItemCategoryIds: activeAssessment.distinctItemCategoryIds,
      });
      novacastCatalogTrace('[NovaCast Movies Readable Recovery Optimization]', {
        activeGeneration,
        activeIntegrityPassed: true,
        fallbackScanPerformed: false,
        fallbackCandidateCount: 0,
        selectedGeneration: pointerGeneration,
        reason: 'active-integrity-passed-short-circuit',
        readConnection: 'catalog-read',
      });
      novacastCatalogTrace('[NovaCast Movie Recovery Timing]', {
        phase: 'overall',
        currentAttemptGeneration,
        currentStatus: syncStatus,
        providerCatalogGeneration: activeGeneration,
        knownReadableGeneration,
        candidateCount: 1,
        fallbackScanPerformed: false,
        selectedGeneration: pointerGeneration,
        selectedReason: 'active-integrity-passed-short-circuit',
        totalMs: Math.round(perfNowMs() - recoveryStarted),
      });
      await logMovieProviderGenerationPointer({
        event: 'post-recovery-pointer-snapshot',
        providerId,
        database: readDb,
        requestedProviderCatalogGeneration: pointerGeneration,
        sourceFunction: 'resolveMoviesReadableCatalogGenerationUncached',
        sourcePhase: 'active-generation-short-circuit',
        pointerReason: 'active-integrity-passed-short-circuit',
      });
      logReadableRestore({
        readableGeneration: pointerGeneration,
        readableRowCount: activeAssessment.itemRows,
        reason: 'active-integrity-passed-short-circuit',
        lifecycleState: pointerLifecycleState?.status ?? null,
      });
      return pointerGeneration;
    }
  }

  const durableReadyRecoveryGeneration = await findDurableReadyMovieRecoveryGeneration(
    providerId,
    currentAttemptGeneration,
    syncStatus,
    activeGeneration,
    readDb,
  );
  if (durableReadyRecoveryGeneration > 0) {
    if (durableReadyRecoveryGeneration !== activeGeneration) {
      void repairMoviesProviderCatalogGenerationPointer(providerId, durableReadyRecoveryGeneration);
    }
    logReadableRestore({
      readableGeneration: durableReadyRecoveryGeneration,
      readableRowCount: physicalMovieRowCount,
      reason: 'durable-ready-generation',
      lifecycleState: lifecycleStates.get(durableReadyRecoveryGeneration)?.status ?? 'ready',
    });
    return durableReadyRecoveryGeneration;
  }

  const candidateListStarted = perfNowMs();
  const enumeratedCandidateNumbers = await listMoviesGenerationCandidateNumbers(
    providerId,
    excludeSyncing,
    readDb,
  );
  const candidateEnumerationMs = perfNowMs() - candidateListStarted;
  const failedFilteringStarted = perfNowMs();
  const candidateNumbers = enumeratedCandidateNumbers.filter(
    (generation) => {
      const generationState = lifecycleStates.get(generation);
      const excluded = shouldExcludeSyncingGenerationFromRecovery({
        generationLifecycleStatus: generationState?.status,
        hasReadyGeneration: lastReadyMovieGeneration > 0,
      });
      if (excluded) {
        novacastCatalogTrace('[NovaCast Movie Recovery Eligibility]', {
          generation,
          generationState: generationState?.status ?? null,
          markedReady: generationState?.status === 'ready',
          markedFailed: generationState?.status === 'error',
          eligibilityDecision: 'excluded',
          eligibilityReason:
            generationState?.status === 'syncing'
              ? 'explicit-syncing-generation-not-readable'
              : 'explicit-failed-generation-never-eligible',
        });
      }
      return !excluded;
    },
  );
  const failedFilteringMs = perfNowMs() - failedFilteringStarted;
  // Always consider the active pointer even if it equals an excluded syncing gen
  // that somehow completed with rows (ready path). When syncing, exclude incomplete.
  if (
    activeGeneration > 0 &&
    !candidateNumbers.includes(activeGeneration) &&
    !(excludeSyncing > 0 && activeGeneration === excludeSyncing) &&
    lifecycleStates.get(activeGeneration)?.status !== 'error' &&
    lifecycleStates.get(activeGeneration)?.status !== 'syncing'
  ) {
    candidateNumbers.unshift(activeGeneration);
  }

  // Assess newest-first on absolute integrity. Collapse-vs-previous is enforced
  // at activation time; recovery must still reopen a prior validated snapshot.
  const assessments: MoviesGenerationIntegrityAssessment[] = [];
  for (const generation of candidateNumbers) {
    assessments.push(
      generation === activeAssessment?.generation && activeAssessment
        ? activeAssessment
        : await assessMoviesGenerationCandidate(providerId, generation, readDb, null, {
            generationState: lifecycleStates.get(generation),
            candidateSource: 'historical-candidate-enumeration',
            wasAlreadyKnownReadable: knownReadableGeneration === generation,
            wasProviderCatalogGeneration: activeGeneration === generation,
            wasLastReadyGeneration: lifecycleStates.get(generation)?.status === 'ready',
          }),
    );
  }

  novacastCatalogTrace('[NovaCast Movie Recovery Timing]', {
    phase: 'candidate-list-and-filtering',
    currentAttemptGeneration,
    currentStatus: syncStatus,
    providerCatalogGeneration: activeGeneration,
    knownReadableGeneration,
    candidateCount: candidateNumbers.length,
    fallbackScanPerformed: true,
    candidateEnumerationMs: Math.round(candidateEnumerationMs),
    failedFilteringMs: Math.round(failedFilteringMs),
    stateLookupMs: Math.round(stateLookupMs),
    totalMs: Math.round(perfNowMs() - recoveryStarted),
  });

  novacastCatalogTrace('[NovaCast Movie Recovery Eligibility]', {
    providerId,
    activeGeneration,
    syncingGeneration: currentAttemptGeneration,
    excludedFailedGenerations: [...lifecycleStates.entries()]
      .filter(([, stateValue]) => stateValue.status === 'error')
      .map(([generation]) => generation),
    candidateCount: candidateNumbers.length,
    rule: 'explicit-failed-generation-never-eligible',
  });

  const decision = selectMoviesReadableRecoveryGeneration({
    activeGeneration,
    syncingGeneration: currentAttemptGeneration,
    syncStatus,
    candidates: assessments,
  });

  for (const assessment of assessments) {
    novacastCatalogTrace('[NovaCast Movie Recovery Timing]', {
      phase: 'candidate-result',
      generation: assessment.generation,
      resultUsed: assessment.generation === decision.readableGeneration,
      selectedGeneration: decision.readableGeneration,
      selectedReason: decision.reason,
    });
  }

  if (decision.rejectedActiveGeneration != null) {
    const rejected = assessments.find((a) => a.generation === decision.rejectedActiveGeneration);
    novacastCatalogTrace(
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
    novacastCatalogTrace(
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
    const pointerRepairStarted = perfNowMs();
    if (decision.pointerRepairNeeded) {
      await repairMoviesProviderCatalogGenerationPointer(providerId, decision.readableGeneration);
    }
    const pointerRepairMs = perfNowMs() - pointerRepairStarted;
    const publicationStarted = perfNowMs();
    setCachedMoviesReadableGeneration({
      providerId,
      generation: decision.readableGeneration,
      resolvedAt: Date.now(),
      itemRows: selected?.itemRows ?? 0,
      categoryRows: selected?.categoryRows ?? 0,
      distinctItemCategoryIds: selected?.distinctItemCategoryIds ?? 0,
    });
    novacastCatalogTrace('[NovaCast Movie Recovery Timing]', {
      phase: 'final-selected-generation-publication',
      generation: decision.readableGeneration,
      totalMs: Math.round(perfNowMs() - publicationStarted),
      selectedGeneration: decision.readableGeneration,
    });
    novacastCatalogTrace('[NovaCast Movies Readable Recovery Optimization]', {
      activeGeneration,
      activeIntegrityPassed: activeAssessment?.healthy === true,
      fallbackScanPerformed: true,
      fallbackCandidateCount: candidateNumbers.length,
      selectedGeneration: decision.readableGeneration,
      reason: 'fallback-selected',
      readConnection: 'catalog-read',
    });
    novacastCatalogTrace('[NovaCast Movie Recovery Timing]', {
      phase: 'overall',
      currentAttemptGeneration,
      currentStatus: syncStatus,
      providerCatalogGeneration: activeGeneration,
      knownReadableGeneration,
      candidateCount: candidateNumbers.length,
      fallbackScanPerformed: true,
      selectedGeneration: decision.readableGeneration,
      selectedReason: decision.reason,
      pointerRepairMs: Math.round(pointerRepairMs),
      totalMs: Math.round(perfNowMs() - recoveryStarted),
    });
    await logMovieProviderGenerationPointer({
      event: 'post-recovery-pointer-snapshot',
      providerId,
      database: readDb,
      requestedProviderCatalogGeneration: decision.readableGeneration,
      sourceFunction: 'resolveMoviesReadableCatalogGenerationUncached',
      sourcePhase: 'recovery-selected-generation',
      pointerReason: decision.reason,
    });
  } else {
    novacastCatalogTrace(
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
    novacastCatalogTrace('[NovaCast Movies Readable Recovery Optimization]', {
      activeGeneration,
      activeIntegrityPassed: activeAssessment?.healthy === true,
      fallbackScanPerformed: true,
      fallbackCandidateCount: candidateNumbers.length,
      selectedGeneration: 0,
      reason: 'no-valid-fallback',
      readConnection: 'catalog-read',
    });
    novacastCatalogTrace('[NovaCast Movie Recovery Timing]', {
      phase: 'overall',
      currentAttemptGeneration,
      currentStatus: syncStatus,
      providerCatalogGeneration: activeGeneration,
      knownReadableGeneration,
      candidateCount: candidateNumbers.length,
      fallbackScanPerformed: true,
      selectedGeneration: 0,
      selectedReason: 'no-valid-fallback',
      pointerRepairMs: 0,
      totalMs: Math.round(perfNowMs() - recoveryStarted),
    });
    await logMovieProviderGenerationPointer({
      event: 'post-recovery-pointer-snapshot',
      providerId,
      database: readDb,
      requestedProviderCatalogGeneration: 0,
      sourceFunction: 'resolveMoviesReadableCatalogGenerationUncached',
      sourcePhase: 'recovery-no-valid-generation',
      pointerReason: 'no-valid-fallback',
    });
  }

  const readableRowCount =
    decision.readableGeneration > 0
      ? (assessments.find((a) => a.generation === decision.readableGeneration)?.itemRows ?? 0)
      : 0;

  novacastCatalogTrace(
    '[Catalog Read Generation] ' +
      JSON.stringify({
        providerId,
        mediaType: 'movie',
        currentAttemptGeneration,
        currentStatus: syncStatus,
        lastCompletedGeneration: lastReadyMovieGeneration || activeGeneration,
        resolvedReadableGeneration: decision.readableGeneration,
        readableRowCount,
        reason: decision.reason,
        marker: MOVIES_FOCUS_STAGE4I_MARKER,
      }),
  );
  logReadableRestore({
    readableGeneration: decision.readableGeneration,
    readableRowCount,
    reason: decision.reason,
    lifecycleState:
      (decision.readableGeneration > 0
        ? lifecycleStates.get(decision.readableGeneration)?.status
        : pointerLifecycleState?.status) ?? null,
  });

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

  novacastCatalogTrace(
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

    novacastCatalogTrace(
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
  // Foreground Movies/Series/Search reads must not share the writer connection.
  const releaseForegroundRead = beginCatalogForegroundRead();
  try {
  const db = await getCatalogReadDatabase();
  const generation = query.generation ?? (await resolveActiveGeneration(query.providerId, query.mediaType));
  const limit = Math.min(Math.max(query.limit ?? CATALOG_DEFAULT_PAGE_SIZE, 1), 100);
  const offset = Math.max(query.offset ?? 0, 0);

  if (generation <= 0) {
    if (process.env.EXPO_PUBLIC_MOVIES_SQLITE_DIAGNOSTICS === 'true' && query.mediaType === 'movie') {
      novacastCatalogTrace('[Movies SQLite Query Diagnostic]', JSON.stringify({
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
    const normalizedSearch = normalizeCatalogTitle(query.query);
    // search-s5-exact-title-fast-path
    const exactTitleRow = await db.getFirst<{ content_id: string }>(
      `SELECT content_id FROM ${itemsTable}
       WHERE ${where} AND normalized_title = ?
       LIMIT 1`,
      [...params, normalizedSearch],
    );

    if (exactTitleRow) {
      where += ' AND normalized_title = ?';
      params.push(normalizedSearch);
    } else {
      where += ' AND normalized_title LIKE ?';
      params.push(`%${normalizedSearch}%`);
    }
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
      novacastCatalogTrace(
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
      novacastCatalogTrace(
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
  if (!query.query?.trim() && offset === 0) {
    try {
      const coverage = await getCatalogSortMetadataCoverage({
        providerId: query.providerId,
        mediaType: query.mediaType,
        generation,
        categoryId: query.categoryId,
      });
      const { effectivePrimary, fallbackUsed } = resolveContentSortEffectivePrimary(query.sort, coverage);
      novacastCatalogTrace(
        '[NovaCast Content Sort Audit] ' +
          JSON.stringify({
            mediaType: query.mediaType,
            sort: query.sort ?? 'title',
            categoryId: query.categoryId ?? null,
            rowCount: coverage.rowCount,
            primaryMetadata: {
              releaseDatePresentCount: coverage.releaseDatePresentCount,
              releaseYearPresentCount: coverage.releaseYearPresentCount,
              addedAtPresentCount: coverage.addedAtPresentCount,
              popularityPresentCount: coverage.popularityPresentCount,
            },
            effectivePrimary,
            fallbackUsed,
          }),
      );
    } catch {
      // Audit must never fail a page read.
    }
  }
  if (query.mediaType === 'movie') {
    novacastCatalogTrace(
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
    novacastCatalogTrace('[Movies SQLite Query Diagnostic]', JSON.stringify({
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
  } finally {
    releaseForegroundRead?.();
  }
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
    novacastCatalogTrace('[NovaCast Catalog Canonical Resolve]', {
      mediaType: 'movie',
      providerId,
      contentId: trimmedId,
      readableGeneration: generation,
      canonicalRowFound: false,
    });
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
  const mapped = row ? mapItem(row as Record<string, unknown>) : null;
  novacastCatalogTrace('[NovaCast Catalog Canonical Resolve]', {
    mediaType: 'movie',
    providerId,
    contentId: trimmedId,
    readableGeneration: generation,
    canonicalRowFound: Boolean(mapped),
  });

  return mapped;
}

/**
 * Stage 4.2O.2: canonical single-series catalog row for Detail/browse card
 * metadata. Reads catalog_items_v2 at the readable sync generation
 * (content_id === Xtream series_id). Mirrors getCatalogMovieItem.
 */
export async function getCatalogSeriesItem(
  providerId: string,
  contentId: string,
  options?: { generation?: number },
): Promise<CatalogItemRecord | null> {
  const trimmedId = String(contentId ?? '').trim();
  if (!providerId || !trimmedId) {
    return null;
  }

  const generation =
    options?.generation ?? (await resolveReadableCatalogGeneration(providerId, 'series'));
  if (generation <= 0) {
    novacastCatalogTrace('[NovaCast Catalog Canonical Resolve]', {
      mediaType: 'series',
      providerId,
      contentId: trimmedId,
      readableGeneration: generation,
      canonicalRowFound: false,
    });
    return null;
  }

  const db = await getCatalogDatabase();
  const itemsTable = catalogItemsTable('series');
  const row = await db.getFirst(
    `SELECT * FROM ${itemsTable}
     WHERE provider_id = ?
       AND media_type = ?
       AND sync_generation = ?
       AND (content_id = ? OR series_id = ?)
     LIMIT 1`,
    [providerId, 'series', generation, trimmedId, trimmedId],
  );
  const mapped = row ? mapItem(row as Record<string, unknown>) : null;
  novacastCatalogTrace('[NovaCast Catalog Canonical Resolve]', {
    mediaType: 'series',
    providerId,
    contentId: trimmedId,
    readableGeneration: generation,
    canonicalRowFound: Boolean(mapped),
  });

  return mapped;
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

export async function listKnownSeriesCategoryNames(
  providerId: string,
): Promise<Array<{ categoryId: string; categoryName: string; syncGeneration: number }>> {
  if (!providerId) {
    return [];
  }
  const db = await getCatalogDatabase();
  const categoriesTable = catalogCategoriesTable('series');
  const rows = await db.getAll<{
    category_id: string;
    category_name: string;
    sync_generation: number | string;
  }>(
    `SELECT category_id, category_name, sync_generation
     FROM ${categoriesTable}
     WHERE provider_id = ? AND media_type = ?
     ORDER BY sync_generation DESC`,
    [providerId, 'series'],
  );
  return rows.map((row) => ({
    categoryId: asString(row.category_id),
    categoryName: asString(row.category_name),
    syncGeneration: asNumber(row.sync_generation),
  }));
}

/**
 * Label-only Series update. Never changes category_id, item associations, or counts.
 */
export async function updatePublishedSeriesCategoryNames(
  providerId: string,
  generation: number,
  updates: Array<{ categoryId: string; categoryName: string }>,
): Promise<number> {
  if (!providerId || generation <= 0 || !updates.length) {
    return 0;
  }
  const categoriesTable = catalogCategoriesTable('series');
  const db = await getCatalogDatabase();
  return withCatalogTransaction(async () => {
    let written = 0;
    const updatedAt = nowMs();
    for (const update of updates) {
      const categoryId = asString(update.categoryId).trim();
      const categoryName = asString(update.categoryName).trim();
      if (!categoryId || !categoryName) {
        continue;
      }
      const result = await db.run(
        `UPDATE ${categoriesTable}
            SET category_name = ?, updated_at = ?
          WHERE provider_id = ? AND media_type = ? AND sync_generation = ? AND category_id = ?`,
        [categoryName, updatedAt, providerId, 'series', generation, categoryId],
      );
      written += Number(result?.changes ?? 0);
    }
    return written;
  });
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
