import { failCatalogSync } from './catalogRepository.ts';
import { getCatalogDatabase, type CatalogDatabaseHandle } from './catalogDatabase.ts';
import { hasActiveCatalogSqliteWriter } from './catalogSyncWriterRegistry.ts';
import type { CatalogMediaType } from './catalogTypes.ts';

const LOG_TAG = '[NovaCast Catalog Orphan Recovery]';

type SyncingStateRow = {
  provider_id: string;
  media_type: string;
  generation: number | string | null;
  started_at: number | string | null;
};

export function shouldAbandonOrphanedCatalogSync(input: {
  providerId: string;
  mediaType: CatalogMediaType;
  generation: number;
  hasActiveWriter: boolean;
}): boolean {
  return Boolean(input.providerId) && !input.hasActiveWriter;
}

export async function reconcileOrphanedCatalogSyncs(database?: CatalogDatabaseHandle): Promise<number> {
  const db = database ?? (await getCatalogDatabase());
  const rows = await db.getAll<SyncingStateRow>(
    `SELECT provider_id, media_type, generation, started_at
     FROM catalog_sync_state
     WHERE status = 'syncing'`,
  );

  let abandoned = 0;
  for (const row of rows) {
    const providerId = row.provider_id;
    const mediaType = row.media_type as CatalogMediaType;
    const generation = Number(row.generation ?? 0);
    if (!providerId || (mediaType !== 'movie' && mediaType !== 'series')) {
      continue;
    }
    const hasActiveWriter =
      generation > 0 && hasActiveCatalogSqliteWriter(providerId, mediaType, generation);
    if (!shouldAbandonOrphanedCatalogSync({
      providerId,
      mediaType,
      generation,
      hasActiveWriter,
    })) {
      console.info(
        LOG_TAG,
        JSON.stringify({
          event: 'keep-live-writer',
          providerId,
          mediaType,
          generation,
          startedAt: row.started_at ?? null,
        }),
      );
      continue;
    }

    console.info(
      LOG_TAG,
      JSON.stringify({
        event: 'abandon-orphaned-syncing-generation',
        providerId,
        mediaType,
        generation,
        startedAt: row.started_at ?? null,
        published: false,
        reason: 'durable-syncing-without-active-writer',
      }),
    );
    try {
      await failCatalogSync(providerId, mediaType, 'orphaned_stale_sync');
      abandoned += 1;
      if (mediaType === 'movie') {
        try {
          const { persistInvalidatedMovieCheckpointProgress } = await import(
            '../providers/catalogSyncCheckpointResume.ts'
          );
          await persistInvalidatedMovieCheckpointProgress(providerId);
        } catch {
          // Checkpoint I/O must not block SQLite orphan recovery.
        }
      }
    } catch (error) {
      console.warn(
        LOG_TAG,
        JSON.stringify({
          event: 'abandon-orphaned-sync-failed',
          providerId,
          mediaType,
          generation,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }
  return abandoned;
}
