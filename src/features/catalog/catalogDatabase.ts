import {
  CATALOG_MIGRATION_SQL_V1,
  CATALOG_MIGRATION_SQL_V2,
  CATALOG_MIGRATION_SQL_V4,
  CATALOG_SCHEMA_VERSION,
} from './catalogSchema.ts';
import {
  getCatalogDatabaseOpener,
  openCatalogReadDatabase,
  type CatalogDatabaseHandle,
} from './catalogDatabaseDriver.ts';
import { isNovaCastCatalogTraceEnabled } from '../diagnostics/novacastLogPolicy.ts';
import { CATALOG_DATABASE_NAME } from './catalogTypes.ts';
import { recordCatalogWritePhase } from './catalogWritePhaseAudit.ts';
import { nowMs } from './jsChunkBudget.ts';

let initPromise: Promise<CatalogDatabaseHandle> | null = null;
let activeHandle: CatalogDatabaseHandle | null = null;
/** search-s6-dedicated-read-connection */
let readInitPromise: Promise<CatalogDatabaseHandle> | null = null;
let activeReadHandle: CatalogDatabaseHandle | null = null;
/** Serialize write transactions — movie + series sync can race on one expo-sqlite connection. */
let catalogTransactionChain: Promise<unknown> = Promise.resolve();
let mutexWaitTotalMs = 0;
let mutexWaitSamples = 0;
let mutexMaxWaitMs = 0;
let activeCatalogTransactions = 0;

export type CatalogTransactionDiagnostics = {
  providerId?: string;
  mediaType?: string;
  generation?: number;
  writeType?: string;
  queueWaitMs?: number;
  transactionBodyMs?: number;
  totalTransactionSpanMs?: number;
};

export type CatalogWalAuditContext = {
  reason: 'database-open' | 'slow-write';
  providerId?: string;
  mediaType?: string;
  generation?: number;
  writeMode?: string;
  rowCount?: number;
  statementExecuteMs?: number;
};

/** search-s5-foreground-read-priority */
let activeForegroundCatalogReads = 0;
const foregroundCatalogReadDrainWaiters = new Set<() => void>();

export function beginCatalogForegroundRead(): () => void {
  activeForegroundCatalogReads += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeForegroundCatalogReads = Math.max(0, activeForegroundCatalogReads - 1);
    if (activeForegroundCatalogReads === 0) {
      const waiters = [...foregroundCatalogReadDrainWaiters];
      foregroundCatalogReadDrainWaiters.clear();
      for (const resolve of waiters) resolve();
    }
  };
}

async function waitForForegroundCatalogReadsToDrain(): Promise<void> {
  if (activeForegroundCatalogReads === 0) return;
  await new Promise<void>((resolve) => {
    foregroundCatalogReadDrainWaiters.add(resolve);
  });
}

function reportCatalogDatabaseError(action: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  console.error('[NovaCast CatalogDB]', { action, message });
}

/**
 * Diagnostics-only PRAGMA snapshot. Do not add wal_checkpoint(PASSIVE) here:
 * SQLite may perform checkpoint work for that pragma, which would perturb the
 * write latency this audit is intended to measure.
 */
export async function logCatalogWalAudit(
  db: CatalogDatabaseHandle,
  context: CatalogWalAuditContext,
): Promise<void> {
  if (!isNovaCastCatalogTraceEnabled()) {
    return;
  }
  try {
    const readPragma = async (sql: string): Promise<number | string | null> => {
      const row = await db.getFirst<Record<string, unknown>>(sql);
      if (!row) return null;
      const value = Object.values(row)[0];
      return typeof value === 'number' || typeof value === 'string' ? value : null;
    };
    const [journalMode, synchronous, walAutocheckpoint, busyTimeout, pageSize, pageCount, freelistCount, cacheSize] =
      await Promise.all([
        readPragma('PRAGMA journal_mode'),
        readPragma('PRAGMA synchronous'),
        readPragma('PRAGMA wal_autocheckpoint'),
        readPragma('PRAGMA busy_timeout'),
        readPragma('PRAGMA page_size'),
        readPragma('PRAGMA page_count'),
        readPragma('PRAGMA freelist_count'),
        readPragma('PRAGMA cache_size'),
      ]);

    console.info('[NovaCast Catalog WAL Audit]', {
      ...context,
      journalMode,
      synchronous,
      walAutocheckpoint,
      busyTimeout,
      pageSize,
      pageCount,
      freelistCount,
      cacheSize,
      dbBytes: null,
      walBytes: null,
      shmBytes: null,
      fileMetadata: 'unavailable-no-installed-filesystem-dependency-or-db-path',
      checkpointObservation: 'not-run-passive-checkpoint-can-perform-work',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.info('[NovaCast Catalog WAL Audit]', {
      ...context,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function initializeCatalogDatabase(
  databaseName: string = CATALOG_DATABASE_NAME,
): Promise<CatalogDatabaseHandle> {
  if (initPromise) {
    return initPromise;
  }

  initPromise = (async () => {
    try {
      const opener = getCatalogDatabaseOpener();
      const openStart = nowMs();
      const db = await opener(databaseName);
      recordCatalogWritePhase('sqlite.initialize', {
        wallMs: nowMs() - openStart,
        itemCount: 1,
      });
      await db.exec('PRAGMA journal_mode = WAL;');
      await db.exec('PRAGMA synchronous = NORMAL;');
      await db.exec('PRAGMA foreign_keys = ON;');
      const migrateStart = nowMs();
      await migrateCatalogDatabase(db);
      recordCatalogWritePhase('sqlite.migration', {
        wallMs: nowMs() - migrateStart,
        itemCount: 1,
      });
      activeHandle = db;
      void logCatalogWalAudit(db, { reason: 'database-open' });
      return db;
    } catch (error) {
      initPromise = null;
      activeHandle = null;
      reportCatalogDatabaseError('initializeCatalogDatabase', error);
      throw error;
    }
  })();

  return initPromise;
}

export async function getCatalogDatabase(): Promise<CatalogDatabaseHandle> {
  if (activeHandle) {
    return activeHandle;
  }
  return initializeCatalogDatabase();
}
/** search-s6-dedicated-read-connection
 * Foreground Search reads use a separate query-only Expo SQLite connection.
 * The primary connection remains the only writer/migration connection.
 */
export async function getCatalogReadDatabase(): Promise<CatalogDatabaseHandle> {
  if (activeReadHandle) {
    return activeReadHandle;
  }
  if (readInitPromise) {
    return readInitPromise;
  }

  readInitPromise = (async () => {
    // Ensure the primary handle has completed WAL setup and migrations first.
    await getCatalogDatabase();

    const readDb = await openCatalogReadDatabase(CATALOG_DATABASE_NAME);
    await readDb.exec('PRAGMA query_only = ON;');
    activeReadHandle = readDb;
    return readDb;
  })().catch((error) => {
    readInitPromise = null;
    activeReadHandle = null;
    reportCatalogDatabaseError('initializeCatalogReadDatabase', error);
    throw error;
  });

  return readInitPromise;
}

/**
 * Catalog write mutex. Held only for the SQLite transaction body — never across
 * network fetch, regionRank, or macrotask sleep (callers must not await those inside fn).
 */
export async function withCatalogTransaction<T>(
  fn: () => Promise<T>,
  diagnostics?: CatalogTransactionDiagnostics,
): Promise<T> {
  const waitStart = nowMs();

  const run = catalogTransactionChain.then(async () => {
    await waitForForegroundCatalogReadsToDrain();
    const queueWaitMs = nowMs() - waitStart;
    mutexWaitTotalMs += queueWaitMs;
    mutexWaitSamples += 1;
    mutexMaxWaitMs = Math.max(mutexMaxWaitMs, queueWaitMs);
    if (queueWaitMs >= 50) {
      recordCatalogWritePhase('mutex.wait', {
        wallMs: queueWaitMs,
        itemCount: 1,
        meta: {
          ...diagnostics,
          queueWaitMs,
          avgWaitMs:
            mutexWaitSamples > 0 ? Math.round((mutexWaitTotalMs / mutexWaitSamples) * 10) / 10 : 0,
          maxWaitMs: Math.round(mutexMaxWaitMs * 10) / 10,
        },
      });
    }
    const db = await getCatalogDatabase();
    activeCatalogTransactions += 1;
    const transactionStart = nowMs();
    try {
      return await db.withTransaction(fn);
    } finally {
      const transactionBodyMs = nowMs() - transactionStart;
      const totalTransactionSpanMs = queueWaitMs + transactionBodyMs;
      if (diagnostics) {
        diagnostics.queueWaitMs = queueWaitMs;
        diagnostics.transactionBodyMs = transactionBodyMs;
        diagnostics.totalTransactionSpanMs = totalTransactionSpanMs;
      }
      if (
        isNovaCastCatalogTraceEnabled() &&
        (queueWaitMs >= 50 || transactionBodyMs >= 100 || totalTransactionSpanMs >= 250)
      ) {
        console.info('[NovaCast Catalog Transaction]', {
          ...diagnostics,
          queueWaitMs: Math.round(queueWaitMs),
          transactionBodyMs: Math.round(transactionBodyMs),
          totalTransactionSpanMs: Math.round(totalTransactionSpanMs),
        });
      }
      activeCatalogTransactions = Math.max(0, activeCatalogTransactions - 1);
    }
  }) as Promise<T>;

  catalogTransactionChain = run.then(
    () => undefined,
    () => undefined,
  );

  return run;
}

export function getCatalogMutexStatsForTests() {
  return {
    waitTotalMs: mutexWaitTotalMs,
    waitSamples: mutexWaitSamples,
    maxWaitMs: mutexMaxWaitMs,
    activeTransactions: activeCatalogTransactions,
  };
}

async function ensureCatalogItemSortColumns(db: CatalogDatabaseHandle) {
  for (const table of ['catalog_items', 'catalog_items_v2'] as const) {
    const columns = await db.getAll<{ name: string }>(`PRAGMA table_info(${table})`);
    const names = new Set(columns.map((column) => column.name));
    if (!names.has('added_at')) {
      await db.exec(`ALTER TABLE ${table} ADD COLUMN added_at INTEGER`);
    }
    if (!names.has('popularity')) {
      await db.exec(`ALTER TABLE ${table} ADD COLUMN popularity REAL`);
    }
  }
}

export async function migrateCatalogDatabase(db: CatalogDatabaseHandle): Promise<number> {
  const migrationStarted = nowMs();
  const versionRow = await db.getFirst<{ user_version: number }>('PRAGMA user_version');
  const databaseVersionBefore = Number(versionRow?.user_version ?? 0);
  const generationStateBefore = await db.getFirst<{ name: string }>(
    `SELECT name
     FROM sqlite_master
     WHERE type = 'table' AND name = 'catalog_generation_state'`,
  );
  const generationStateTableExisted = Boolean(generationStateBefore?.name);
  const columnsBefore = generationStateTableExisted
    ? await db.getAll<{ name: string }>('PRAGMA table_info(catalog_generation_state)')
    : [];
  const columnNamesBefore = new Set(columnsBefore.map((column) => column.name));

  // Always establish the canonical table set before inspecting or altering
  // generation-state columns. Some historical databases reported v2 while
  // their older V1 schema did not yet contain catalog_generation_state.
  await db.exec(CATALOG_MIGRATION_SQL_V1);
  await db.exec(CATALOG_MIGRATION_SQL_V2);
  await ensureCatalogItemSortColumns(db);
  await db.exec(CATALOG_MIGRATION_SQL_V4);

  if (databaseVersionBefore < 1) {
    await db.exec('PRAGMA user_version = 1');
  }

  if (databaseVersionBefore < 2) {
    // Stage 3C: add generation-safe v2 tables. Legacy tables remain intact.
    await db.exec('PRAGMA user_version = 2');
  }

  const columns = await db.getAll<{ name: string }>('PRAGMA table_info(catalog_generation_state)');
  const columnNames = new Set(columns.map((column) => column.name));
  let activationTotalItemsColumnAdded = false;
  let activationNonzeroCategoryCountColumnAdded = false;
  if (!columnNames.has('activation_total_items')) {
      await db.exec(
        'ALTER TABLE catalog_generation_state ADD COLUMN activation_total_items INTEGER',
      );
    activationTotalItemsColumnAdded = true;
  }
  if (!columnNames.has('activation_nonzero_category_count')) {
      await db.exec(
        'ALTER TABLE catalog_generation_state ADD COLUMN activation_nonzero_category_count INTEGER',
      );
    activationNonzeroCategoryCountColumnAdded = true;
  }

  if (databaseVersionBefore < CATALOG_SCHEMA_VERSION) {
    await db.exec(`PRAGMA user_version = ${CATALOG_SCHEMA_VERSION}`);
  }

  const next = await db.getFirst<{ user_version: number }>('PRAGMA user_version');
  const databaseVersionAfter = Number(next?.user_version ?? CATALOG_SCHEMA_VERSION);
  const generationStateAfter = await db.getFirst<{ name: string }>(
    `SELECT name
     FROM sqlite_master
     WHERE type = 'table' AND name = 'catalog_generation_state'`,
  );
  console.info('[NovaCast Catalog Schema Migration]', {
    databaseVersionBefore,
    databaseVersionAfter,
    generationStateTableExisted,
    generationStateTableCreated: !generationStateTableExisted && Boolean(generationStateAfter?.name),
    activationTotalItemsColumnExisted: columnNamesBefore.has('activation_total_items'),
    activationTotalItemsColumnAdded,
    activationNonzeroCategoryCountColumnExisted:
      columnNamesBefore.has('activation_nonzero_category_count'),
    activationNonzeroCategoryCountColumnAdded,
    migrationSucceeded: Boolean(generationStateAfter?.name),
    preservedExistingCatalog: true,
    durationMs: nowMs() - migrationStarted,
  });
  return databaseVersionAfter;
}

export async function resetCatalogDatabaseForTests(): Promise<void> {
  if (activeHandle) {
    try {
      await activeHandle.close();
    } catch {
      // ignore
    }
  }
  if (activeReadHandle) {
    try {
      await activeReadHandle.close();
    } catch {
      // ignore
    }
  }
  activeHandle = null;
  initPromise = null;
  activeReadHandle = null;
  readInitPromise = null;
  catalogTransactionChain = Promise.resolve();
  mutexWaitTotalMs = 0;
  mutexWaitSamples = 0;
  mutexMaxWaitMs = 0;
  activeCatalogTransactions = 0;
}

export async function getCatalogSchemaVersion(): Promise<number> {
  const db = await getCatalogDatabase();
  const row = await db.getFirst<{ user_version: number }>('PRAGMA user_version');
  return Number(row?.user_version ?? 0);
}
