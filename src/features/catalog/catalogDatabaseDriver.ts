/**
 * Minimal async SQL driver used by the catalog layer.
 * Production: expo-sqlite. Tests: node:sqlite (injected).
 */

export type CatalogSqlValue = string | number | null;
export type CatalogSqlParams = CatalogSqlValue[];

export type CatalogRunResult = {
  changes: number;
  lastInsertRowId: number;
};

export type CatalogPreparedStatement = {
  execute(params?: CatalogSqlParams): Promise<CatalogRunResult>;
  finalize(): Promise<void>;
};

export type CatalogDatabaseHandle = {
  exec(sql: string): Promise<void>;
  run(sql: string, params?: CatalogSqlParams): Promise<CatalogRunResult>;
  prepare(sql: string): Promise<CatalogPreparedStatement>;
  getFirst<T extends Record<string, unknown>>(
    sql: string,
    params?: CatalogSqlParams,
  ): Promise<T | null>;
  getAll<T extends Record<string, unknown>>(
    sql: string,
    params?: CatalogSqlParams,
  ): Promise<T[]>;
  withTransaction<T>(fn: () => Promise<T>): Promise<T>;
  close(): Promise<void>;
};

export type CatalogDatabaseOpener = (databaseName: string) => Promise<CatalogDatabaseHandle>;

let openerOverride: CatalogDatabaseOpener | null = null;

export function setCatalogDatabaseOpenerForTests(opener: CatalogDatabaseOpener | null) {
  openerOverride = opener;
}

export function getCatalogDatabaseOpener(): CatalogDatabaseOpener {
  if (openerOverride) {
    return openerOverride;
  }
  return openExpoCatalogDatabase;
}

export function isCatalogDatabaseOpenerOverridden() {
  return openerOverride != null;
}

/** search-s6-dedicated-read-connection
 * Open a separate connection to the same catalog file for foreground reads.
 * Tests keep using the injected opener; production requests a new Expo connection.
 */
export async function openCatalogReadDatabase(
  databaseName: string,
): Promise<CatalogDatabaseHandle> {
  if (openerOverride) {
    return openerOverride(databaseName);
  }
  return openExpoCatalogDatabase(databaseName, true);
}
async function openExpoCatalogDatabase(
  databaseName: string,
  useNewConnection = false,
): Promise<CatalogDatabaseHandle> {
  const SQLite = await import('expo-sqlite');
  const db = await SQLite.openDatabaseAsync(
    databaseName,
    useNewConnection ? { useNewConnection: true } : undefined,
  );

  return {
    async exec(sql) {
      await db.execAsync(sql);
    },
    async run(sql, params = []) {
      const result = await db.runAsync(sql, ...params);
      return {
        changes: result.changes,
        lastInsertRowId: result.lastInsertRowId,
      };
    },
    async prepare(sql) {
      const statement = await db.prepareAsync(sql);
      return {
        async execute(params = []) {
          const result = await statement.executeAsync(...params);
          return {
            changes: Number(result.changes ?? 0),
            lastInsertRowId: Number(result.lastInsertRowId ?? 0),
          };
        },
        async finalize() {
          await statement.finalizeAsync();
        },
      };
    },
    async getFirst<T extends Record<string, unknown>>(sql: string, params: CatalogSqlParams = []) {
      const row = await db.getFirstAsync(sql, ...params);
      return (row as T | null) ?? null;
    },
    async getAll<T extends Record<string, unknown>>(sql: string, params: CatalogSqlParams = []) {
      const rows = await db.getAllAsync(sql, ...params);
      return rows as T[];
    },
    async withTransaction<T>(fn: () => Promise<T>) {
      // expo-sqlite task is typed as Promise<void>; capture the result manually.
      let result!: T;
      await db.withTransactionAsync(async () => {
        result = await fn();
      });
      return result;
    },
    async close() {
      await db.closeAsync();
    },
  };
}
