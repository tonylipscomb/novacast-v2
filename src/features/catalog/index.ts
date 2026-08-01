export {
  initializeCatalogDatabase,
  getCatalogDatabase,
  withCatalogTransaction,
  migrateCatalogDatabase,
  getCatalogSchemaVersion,
  resetCatalogDatabaseForTests,
  getCatalogMutexStatsForTests,
} from './catalogDatabase.ts';

export {
  setCatalogDatabaseOpenerForTests,
} from './catalogDatabaseDriver.ts';

export {
  upsertCatalogProvider,
  beginCatalogSync,
  writeCatalogCategoriesBatch,
  writeCatalogItemsBatch,
  writeCatalogSeasonsBatch,
  completeCatalogSync,
  failCatalogSync,
  getCatalogSyncState,
  getCatalogProvider,
  getCatalogCategoryCounts,
  getCatalogItemsPage,
  getCatalogTotalCount,
  resolveReadableCatalogGeneration,
  logCatalogGenerationInventoryOnce,
  deleteStaleCatalogGeneration,
  cleanupIncompleteCatalogGenerationsV2,
  deleteCatalogGenerationV2,
  getCatalogGenerationPhysicalStats,
  clearProviderCatalog,
  listCatalogItemsForGeneration,
  listCatalogCategoriesForGeneration,
  listCatalogSeasonsForGeneration,
  recomputeCategoryCounts,
  getCatalogGenerationItemStats,
} from './catalogRepository.ts';

export {
  CATALOG_SCHEMA_VERSION,
  CATALOG_DEFAULT_PAGE_SIZE,
  CATALOG_DATABASE_NAME,
  normalizeCatalogTitle,
} from './catalogTypes.ts';

export type {
  CatalogMediaType,
  CatalogSyncStatus,
  CatalogItemSort,
  CatalogProviderRecord,
  CatalogCategoryRecord,
  CatalogItemRecord,
  CatalogSeasonRecord,
  CatalogSyncStateRecord,
  CatalogItemsPageQuery,
  CatalogItemsPage,
} from './catalogTypes.ts';

export {
  CATALOG_REQUIRED_TABLES,
  CATALOG_REQUIRED_INDEXES,
  CATALOG_MIGRATION_SQL_V1,
  CATALOG_MIGRATION_SQL_V2,
} from './catalogSchema.ts';

export {
  STAGE3C_GENERATION_SAFE_MARKER,
  usesGenerationSafeCatalog,
  catalogItemsTable,
  catalogCategoriesTable,
} from './catalogTableRouting.ts';

export {
  recoverFragmentedMovieCatalogOnce,
  resetMovieFragmentRecoveryForTests,
} from './catalogFragmentRecovery.ts';

export type { MovieFragmentRecoveryResult } from './catalogFragmentRecovery.ts';

export {
  CATALOG_CHUNK_PREFERRED_MS,
  CATALOG_CHUNK_TARGET_MS,
  CATALOG_CHUNK_SOFT_MS,
  CATALOG_CHUNK_HARD_MS,
  CATALOG_CHUNK_MAX_ITEMS,
  CATALOG_CHUNK_MIN_ITEMS,
  nowMs,
  yieldMacrotask,
  yieldMacrotaskMeasured,
  processTimeBudgeted,
  processStreamingBatches,
  mapTimeBudgeted,
  getLearnedBatchSize,
  resetChunkBudgetLearningForTests,
} from './jsChunkBudget.ts';

export type { TimeBudgetOptions, TimeBudgetResult, ChunkWorkKind } from './jsChunkBudget.ts';

export {
  buildCatalogSyncKey,
  scheduleCatalogSync,
  runCatalogSyncNow,
  cancelCatalogSync,
  getCatalogSyncJobStatus,
  isCatalogSyncRunning,
  invalidateCatalogSyncForProvider,
  getCatalogSyncCancelToken,
  clearCatalogSyncCoordinatorForTests,
} from './catalogSyncCoordinator.ts';

export type {
  CatalogSyncCoordinatorStatus,
  CatalogSyncJobStatus,
  CatalogSyncCancelToken,
} from './catalogSyncCoordinator.ts';

export {
  createCatalogProgressThrottle,
} from './catalogProgressThrottle.ts';

export {
  startCatalogSqliteMediaSync,
  writeCatalogItemsBudgeted,
  writeCatalogItemsFromSourceBudgeted,
  writeCategoriesBudgeted,
  writeCategoriesFromSourceBudgeted,
  finishCatalogSqliteMediaSync,
  mapMovieSummaryToCatalogItem,
  mapSeriesSummaryToCatalogItem,
} from './catalogSqliteSyncWriter.ts';

export type { CatalogSqliteMediaSyncHandle } from './catalogSqliteSyncWriter.ts';

export { clearCatalogSqliteWriterGatesForTests } from './catalogSqliteSyncWriter.ts';

export type {
  CatalogProgressSnapshot,
  CatalogProgressThrottle,
} from './catalogProgressThrottle.ts';
