import {
  CATALOG_MIGRATION_SQL_V1,
  CATALOG_MIGRATION_SQL_V2,
  CATALOG_SCHEMA_VERSION,
} from './catalogSchema.ts';
import {
  getCatalogDatabaseOpener,
  openCatalogReadDatabase,
  type CatalogDatabaseHandle,
} from './catalogDatabaseDriver.ts';
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
      await db.exec('PRAGMA foreign_keys = ON;');
      const migrateStart = nowMs();
      await migrateCatalogDatabase(db);
      recordCatalogWritePhase('sqlite.migration', {
        wallMs: nowMs() - migrateStart,
        itemCount: 1,
      });
      activeHandle = db;
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
export async function withCatalogTransaction<T>(fn: () => Promise<T>): Promise<T> {
  const waitStart = nowMs();

  const run = catalogTransactionChain.then(async () => {
    await waitForForegroundCatalogReadsToDrain();
    const waitMs = nowMs() - waitStart;
    mutexWaitTotalMs += waitMs;
    mutexWaitSamples += 1;
    mutexMaxWaitMs = Math.max(mutexMaxWaitMs, waitMs);
    if (waitMs >= 50) {
      recordCatalogWritePhase('mutex.wait', {
        wallMs: waitMs,
        itemCount: 1,
        meta: {
          avgWaitMs:
            mutexWaitSamples > 0 ? Math.round((mutexWaitTotalMs / mutexWaitSamples) * 10) / 10 : 0,
          maxWaitMs: Math.round(mutexMaxWaitMs * 10) / 10,
        },
      });
    }
    const db = await getCatalogDatabase();
    activeCatalogTransactions += 1;
    try {
      return await db.withTransaction(fn);
    } finally {
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

export async function migrateCatalogDatabase(db: CatalogDatabaseHandle): Promise<number> {
  const versionRow = await db.getFirst<{ user_version: number }>('PRAGMA user_version');
  const currentVersion = Number(versionRow?.user_version ?? 0);

  if (currentVersion < 1) {
    await db.exec(CATALOG_MIGRATION_SQL_V1);
    await db.exec('PRAGMA user_version = 1');
  }

  if (currentVersion < 2) {
    // Stage 3C: add generation-safe v2 tables. Legacy tables remain intact.
    await db.exec(CATALOG_MIGRATION_SQL_V1);
    await db.exec(CATALOG_MIGRATION_SQL_V2);
    await db.exec('PRAGMA user_version = 2');
  }

  // Idempotent repair for the current schema version.
  if (currentVersion >= CATALOG_SCHEMA_VERSION) {
    await db.exec(CATALOG_MIGRATION_SQL_V1);
    await db.exec(CATALOG_MIGRATION_SQL_V2);
  }

  const next = await db.getFirst<{ user_version: number }>('PRAGMA user_version');
  return Number(next?.user_version ?? CATALOG_SCHEMA_VERSION);
}

export async function resetCatalogDatabaseForTests(): Promise<void> {
  if (activeHandle) {
    try {
      await activeHandle.close();
    } catch {
      // ignore
    }
  }
  activeHandle = null;
  initPromise = null;
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
