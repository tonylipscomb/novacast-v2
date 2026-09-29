/**
 * Node-only catalog opener for unit tests. Do not import from app runtime paths —
 * Metro cannot resolve `node:sqlite`.
 */

import type {
  CatalogDatabaseOpener,
  CatalogPreparedStatement,
  CatalogSqlParams,
  CatalogSqlValue,
} from './catalogDatabaseDriver.ts';

type NodeStatement = {
  run(...params: CatalogSqlValue[]): { changes?: number; lastInsertRowid?: number | bigint };
  get(...params: CatalogSqlValue[]): unknown;
  all(...params: CatalogSqlValue[]): unknown[];
  finalize?(): void;
};

type NodeDatabaseSync = {
  exec(sql: string): void;
  prepare(sql: string): NodeStatement;
  close(): void;
};

type NodeSqliteModule = {
  DatabaseSync: new (path: string) => NodeDatabaseSync;
};

/** Node test opener using the built-in experimental `node:sqlite` module. */
export function createNodeSqliteCatalogOpener(): CatalogDatabaseOpener {
  return async (databaseName: string) => {
    const nodeSqlite = (await import(
      'node:sqlite'
    )) as NodeSqliteModule;
    const db = new nodeSqlite.DatabaseSync(databaseName === ':memory:' ? ':memory:' : databaseName);

    return {
      async exec(sql) {
        db.exec(sql);
      },
      async run(sql, params = []) {
        const result = db.prepare(sql).run(...params);
        return {
          changes: Number(result.changes ?? 0),
          lastInsertRowId: Number(result.lastInsertRowid ?? 0),
        };
      },
      async prepare(sql): Promise<CatalogPreparedStatement> {
        const statement = db.prepare(sql);
        let finalized = false;
        return {
          async execute(params = []) {
            if (finalized) {
              throw new Error('prepared statement already finalized');
            }
            const result = statement.run(...params);
            return {
              changes: Number(result.changes ?? 0),
              lastInsertRowId: Number(result.lastInsertRowid ?? 0),
            };
          },
          async finalize() {
            if (finalized) {
              return;
            }
            finalized = true;
            statement.finalize?.();
          },
        };
      },
      async getFirst<T extends Record<string, unknown>>(sql: string, params: CatalogSqlParams = []) {
        const row = db.prepare(sql).get(...params);
        return ((row as T | undefined) ?? null) as T | null;
      },
      async getAll<T extends Record<string, unknown>>(sql: string, params: CatalogSqlParams = []) {
        return db.prepare(sql).all(...params) as T[];
      },
      async withTransaction<T>(fn: () => Promise<T>) {
        db.exec('BEGIN');
        try {
          const value = await fn();
          db.exec('COMMIT');
          return value;
        } catch (error) {
          try {
            db.exec('ROLLBACK');
          } catch {
            // ignore rollback errors
          }
          throw error;
        }
      },
      async close() {
        db.close();
      },
    };
  };
}
