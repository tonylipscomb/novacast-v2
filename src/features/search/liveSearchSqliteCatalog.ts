import { novacastTrace } from '../diagnostics/novacastLogPolicy.ts';
import { LIVE_UNKNOWN_CATEGORY_ID, logLivePublicationTrace } from '../providers/liveCatalogCompletion.ts';
import { getSampledLiveStreamId, logSampledLiveStreamRow, persistableLiveDirectSource } from '../providers/liveStreamRowDiagnostics.ts';
import type { ProviderLiveCategory, ProviderLiveChannel, ProviderLiveRepository } from '../providers/providerRepositories.ts';
import {
  buildPublishedLiveCategories,
  countPersistedLiveDirectSources,
  publishedLiveRowToChannel,
  resolvePersistedLiveCategoryName,
} from './livePublishedCatalogRead.ts';
import type { CategoryRegionalSortMetrics } from '../providers/categoryRegionalPipeline.ts';
import {
  beginCatalogForegroundRead,
  getCachedCatalogJournalMode,
  getCatalogDatabase,
  getCatalogReadDatabase,
  isCatalogWalActive,
  isCatalogWriteTransactionActive,
  logCatalogForegroundReadIfSlow,
  withCatalogTransaction,
} from '../catalog/catalogDatabase.ts';
import { patchLiveTvWorkload } from '../live/liveTvWorkload.ts';
import { escapeLikeWildcards, normalizeSearchQuery, tokenizeSearchQuery } from './searchQuery.ts';
import { ingestLiveSearchCategories, type LiveSearchMatchMode } from './liveChannelIndex.ts';
import {
  LIVE_SEARCH_BUILD_CONCURRENCY,
  LIVE_SEARCH_INDEX_YIELD_MS,
  LIVE_SEARCH_WRITE_BATCH_SIZE,
  liveSearchIndexPendingCategories,
  waitWhileLiveSearchIndexPaused,
} from './liveSearchCatalogPolicy.ts';
import { liveSearchSqlRankCase } from './liveSearchMatching.ts';
import type { LiveSearchResult, SearchPageResult } from './searchTypes.ts';
import { processTimeBudgeted, type TimeBudgetResult } from '../catalog/jsChunkBudget.ts';
import { isCurrentProgramFresh } from '../live/liveProgramFreshness.ts';

export const LIVE_SEARCH_SQLITE_CATALOG_MARKER = 'live-search-sqlite-v1_1';
export { LIVE_SEARCH_BUILD_CONCURRENCY, LIVE_SEARCH_WRITE_BATCH_SIZE } from './liveSearchCatalogPolicy.ts';
// live-search-progressive-bootstrap-v1_1

const LIVE_SEARCH_CATALOG_TTL_MS = 6 * 60 * 60 * 1000;

const inFlightBuilds = new Map<string, Promise<LiveSearchCatalogBuildResult>>();
const cancelRequested = new Map<string, boolean>();
let schemaPromise: Promise<void> | null = null;

type LiveSearchCatalogStateRow = {
  status: string;
  active_generation: number | string;
  building_generation: number | string;
  channel_count: number | string;
  started_at: number | string | null;
  completed_at: number | string | null;
  error_code: string | null;
};

type LiveSearchCatalogRow = {
  channel_id: string;
  category_id: string | null;
  title: string;
  current_program: string | null;
  logo_url: string | null;
  channel_number: number | string | null;
  stream_extension: string | null;
  direct_source?: string | null;
  epg_channel_id?: string | null;
  tone: string | null;
  current_program_fetched_at?: number | string | null;
  current_start_at?: number | string | null;
  current_end_at?: number | string | null;
};

export type LiveSearchCatalogBuildResult = {
  ready: boolean;
  rebuilt: boolean;
  generation: number;
  channelCount: number;
  counts: Record<string, number>;
};

export type PublishedLiveCatalogState = {
  ready: boolean;
  generation: number;
  channelCount: number;
  counts: Record<string, number>;
  status: string | null;
  stateRowPresent: boolean;
  buildingGeneration: number;
  stateChannelCount: number;
  unreadinessReason: string | null;
  categoryNames: Record<string, string>;
};

export async function updateLiveSearchCurrentProgram(input: {
  providerId: string;
  channelId: string;
  current: string;
  fetchedAt: number;
  startAt?: number;
  endAt?: number;
  source?: string;
  epgChannelId?: string;
}) {
  await ensureLiveSearchSchema();
  const db = await getCatalogDatabase();
  const state = await readState(input.providerId);
  if (!state || Number(state.active_generation) <= 0) return false;
  const current = isCurrentProgramFresh({ fetchedAt: input.fetchedAt, startAt: input.startAt, endAt: input.endAt }) ? input.current.trim() : '';
  await db.run(
    `UPDATE live_search_channels
        SET current_program = ?, normalized_current = ?, current_program_fetched_at = ?,
            current_start_at = ?, current_end_at = ?, updated_at = ?, epg_channel_id = COALESCE(?, epg_channel_id)
      WHERE provider_id = ? AND generation = ? AND channel_id = ?`,
    [current || null, normalizeSearchQuery(current), input.fetchedAt, input.startAt ?? null, input.endAt ?? null, Date.now(), input.epgChannelId ?? null, input.providerId, Number(state.active_generation), input.channelId],
  );
  console.info('[NovaCast Live EPG]', {
    event: 'searchProgramUpdated', providerId: input.providerId, channelId: input.channelId,
    epgChannelId: input.epgChannelId ?? null, epgSource: input.source ?? null,
    fetchedAt: input.fetchedAt, startAt: input.startAt ?? null, endAt: input.endAt ?? null,
    ageMs: Date.now() - input.fetchedAt, staleProgramRejected: !current,
  });
  return true;
}

type PublishedLivePointer = {
  ready: boolean;
  generation: number;
  channelCount: number;
  status: string | null;
  stateRowPresent: boolean;
  buildingGeneration: number;
  unreadinessReason: string | null;
};

const publishedStateCache = new Map<string, PublishedLiveCatalogState>();
const publishedStateInflight = new Map<string, Promise<PublishedLiveCatalogState>>();
const publishedPointerCache = new Map<string, PublishedLivePointer>();
const publishedLiveCategoryCache = new Map<string, ProviderLiveCategory[]>();
const publishedLiveCategoryInflight = new Map<string, Promise<ProviderLiveCategory[]>>();

function invalidatePublishedLiveCategoryCache(providerId?: string) {
  const prefix = providerId ? `${providerId}:` : null;
  for (const key of [...publishedLiveCategoryCache.keys()]) {
    if (!prefix || key.startsWith(prefix)) {
      publishedLiveCategoryCache.delete(key);
    }
  }
  for (const key of [...publishedLiveCategoryInflight.keys()]) {
    if (!prefix || key.startsWith(prefix)) {
      publishedLiveCategoryInflight.delete(key);
    }
  }
}

export function resetLiveSearchCatalogForTests() {
  inFlightBuilds.clear();
  cancelRequested.clear();
  publishedStateCache.clear();
  publishedStateInflight.clear();
  publishedPointerCache.clear();
  invalidatePublishedLiveCategoryCache();
  schemaPromise = null;
}

function asNumber(value: unknown, fallback = 0) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function logLiveSearchCatalog(event: string, payload: Record<string, unknown> = {}) {
  novacastTrace(
    '[NovaCast Live Search Catalog] ' +
      JSON.stringify({
        event,
        marker: LIVE_SEARCH_SQLITE_CATALOG_MARKER,
        ...payload,
      }),
  );
}

async function yieldToUi(ms = LIVE_SEARCH_INDEX_YIELD_MS) {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function logLivePublicationStage(
  event: string,
  rowCount: number,
  startedAt: number,
  extra: Record<string, unknown> = {},
) {
  logLivePublicationTrace(event, {
    timestamp: Date.now(),
    rowCount,
    durationMs: Math.max(0, Date.now() - startedAt),
    ...extra,
  });
}

function isBuildCancelled(providerId: string, isCancelled?: () => boolean) {
  return Boolean(cancelRequested.get(providerId) || isCancelled?.());
}

export function cancelLiveSearchCatalogBuild(providerId: string) {
  const id = providerId.trim();
  if (!id) {
    return;
  }
  cancelRequested.set(id, true);
}

async function ensureLiveSearchSchema() {
  if (schemaPromise) {
    return schemaPromise;
  }

  schemaPromise = (async () => {
    const db = await getCatalogDatabase();
    await db.exec(`
      CREATE TABLE IF NOT EXISTS live_search_state (
        provider_id TEXT PRIMARY KEY NOT NULL,
        status TEXT NOT NULL DEFAULT 'idle',
        active_generation INTEGER NOT NULL DEFAULT 0,
        building_generation INTEGER NOT NULL DEFAULT 0,
        channel_count INTEGER NOT NULL DEFAULT 0,
        started_at INTEGER,
        completed_at INTEGER,
        error_code TEXT
      );

      CREATE TABLE IF NOT EXISTS live_search_channels (
        provider_id TEXT NOT NULL,
        generation INTEGER NOT NULL,
        channel_id TEXT NOT NULL,
        category_id TEXT,
        title TEXT NOT NULL,
        normalized_title TEXT NOT NULL,
        current_program TEXT,
        normalized_current TEXT NOT NULL DEFAULT '',
        logo_url TEXT,
        channel_number INTEGER,
        stream_extension TEXT,
        direct_source TEXT,
        epg_channel_id TEXT,
        tone TEXT,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (provider_id, generation, channel_id)
      );

      CREATE INDEX IF NOT EXISTS idx_live_search_channels_provider_generation_title
        ON live_search_channels (provider_id, generation, normalized_title);

      CREATE INDEX IF NOT EXISTS idx_live_search_channels_provider_generation_category
        ON live_search_channels (provider_id, generation, category_id);

      CREATE INDEX IF NOT EXISTS idx_live_search_channels_provider_generation_number
        ON live_search_channels (provider_id, generation, channel_number);

      CREATE TABLE IF NOT EXISTS live_search_category_counts (
        provider_id TEXT NOT NULL,
        generation INTEGER NOT NULL,
        category_id TEXT NOT NULL,
        category_name TEXT,
        item_count INTEGER NOT NULL,
        PRIMARY KEY (provider_id, generation, category_id)
      );
    `);
    await ensureLiveSearchDirectSourceColumn(db);
    await ensureLiveSearchColumn(db, 'live_search_channels', 'current_program_fetched_at', 'INTEGER');
    await ensureLiveSearchColumn(db, 'live_search_channels', 'current_start_at', 'INTEGER');
    await ensureLiveSearchColumn(db, 'live_search_channels', 'current_end_at', 'INTEGER');
    const epgColumnAdded = await ensureLiveSearchColumn(db, 'live_search_channels', 'epg_channel_id', 'TEXT');
    const categoryNameColumnAdded = await ensureLiveSearchColumn(db, 'live_search_category_counts', 'category_name', 'TEXT');
    if (epgColumnAdded || categoryNameColumnAdded) {
      await db.run(`UPDATE live_search_state SET status = 'stale', error_code = 'live_metadata_schema_upgrade'`);
    }
  })().catch((error) => {
    schemaPromise = null;
    throw error;
  });

  return schemaPromise;
}

async function ensureLiveSearchDirectSourceColumn(db: Awaited<ReturnType<typeof getCatalogDatabase>>) {
  const columns = await db.getAll<{ name: string }>('PRAGMA table_info(live_search_channels)');
  if (columns.some((column) => column.name === 'direct_source')) {
    return;
  }
  await db.exec('ALTER TABLE live_search_channels ADD COLUMN direct_source TEXT');
}

async function ensureLiveSearchColumn(
  db: Awaited<ReturnType<typeof getCatalogDatabase>>,
  table: 'live_search_channels' | 'live_search_category_counts',
  column: 'epg_channel_id' | 'category_name' | 'current_program_fetched_at' | 'current_start_at' | 'current_end_at',
  type: 'TEXT' | 'INTEGER',
) {
  const columns = await db.getAll<{ name: string }>(`PRAGMA table_info(${table})`);
  if (columns.some((item) => item.name === column)) return false;
  await db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  return true;
}

async function readState(providerId: string): Promise<LiveSearchCatalogStateRow | null> {
  await ensureLiveSearchSchema();
  const db = await getCatalogReadDatabase();
  return db.getFirst<LiveSearchCatalogStateRow>(
    `SELECT status, active_generation, building_generation, channel_count,
            started_at, completed_at, error_code
       FROM live_search_state
      WHERE provider_id = ?`,
    [providerId],
  );
}

async function readPersistedCategoryCounts(
  providerId: string,
  generation: number,
): Promise<{ counts: Record<string, number>; names: Record<string, string> } | null> {
  if (generation <= 0) {
    return null;
  }
  await ensureLiveSearchSchema();
  const db = await getCatalogReadDatabase();
  const rows = await db.getAll<{ category_id: string; category_name: string | null; item_count: number | string }>(
    `SELECT category_id, category_name, item_count
       FROM live_search_category_counts
      WHERE provider_id = ? AND generation = ?`,
    [providerId, generation],
  );
  if (!rows.length) {
    return null;
  }
  const counts: Record<string, number> = {};
  const names: Record<string, string> = {};
  for (const row of rows) {
    const categoryId = String(row.category_id ?? '').trim() || LIVE_UNKNOWN_CATEGORY_ID;
    counts[categoryId] = (counts[categoryId] ?? 0) + asNumber(row.item_count);
    if (row.category_name?.trim()) names[categoryId] = row.category_name.trim();
  }
  return { counts, names };
}

async function persistCategoryCounts(
  providerId: string,
  generation: number,
  counts: Record<string, number>,
  categories?: readonly ProviderLiveCategory[],
): Promise<void> {
  if (generation <= 0) {
    return;
  }
  await ensureLiveSearchSchema();
  const db = await getCatalogDatabase();
  const names = new Map((categories ?? []).map((category) => [category.id.trim(), category.name.trim()]));
  await withCatalogTransaction(async () => {
    await db.run(
      `DELETE FROM live_search_category_counts
        WHERE provider_id = ? AND generation != ?`,
      [providerId, generation],
    );
    for (const [categoryId, itemCount] of Object.entries(counts)) {
      const id = String(categoryId ?? '').trim() || LIVE_UNKNOWN_CATEGORY_ID;
      await db.run(
        `INSERT OR REPLACE INTO live_search_category_counts (
           provider_id, generation, category_id, category_name, item_count
         ) VALUES (?, ?, ?, ?, ?)`,
        [providerId, generation, id, names.get(id) || null, asNumber(itemCount)],
      );
    }
  });
}

async function readGenerationSummary(
  providerId: string,
  generation: number,
  options?: { allowScan?: boolean },
): Promise<{ channelCount: number; counts: Record<string, number>; categoryNames: Record<string, string>; scannedAllChannels: boolean }> {
  if (generation <= 0) {
    return { channelCount: 0, counts: {}, categoryNames: {}, scannedAllChannels: false };
  }

  const persisted = await readPersistedCategoryCounts(providerId, generation);
  if (persisted) {
    let channelCount = 0;
    for (const total of Object.values(persisted.counts)) {
      channelCount += total;
    }
    return { channelCount, counts: persisted.counts, categoryNames: persisted.names, scannedAllChannels: false };
  }

  if (options?.allowScan === false) {
    return { channelCount: 0, counts: {}, categoryNames: {}, scannedAllChannels: false };
  }

  await ensureLiveSearchSchema();
  const db = await getCatalogReadDatabase();
  const [totalRow, categoryRows] = await Promise.all([
    db.getFirst<{ total: number | string }>(
      `SELECT COUNT(*) AS total
         FROM live_search_channels
        WHERE provider_id = ? AND generation = ?`,
      [providerId, generation],
    ),
    db.getAll<{ category_id: string | null; total: number | string }>(
      `SELECT category_id, COUNT(*) AS total
         FROM live_search_channels
        WHERE provider_id = ? AND generation = ?
        GROUP BY category_id`,
      [providerId, generation],
    ),
  ]);

  const counts: Record<string, number> = {};
  for (const row of categoryRows) {
    const categoryId = row.category_id?.trim() || LIVE_UNKNOWN_CATEGORY_ID;
    counts[categoryId] = (counts[categoryId] ?? 0) + asNumber(row.total);
  }

  const summary = {
    channelCount: asNumber(totalRow?.total),
    counts,
      categoryNames: {},
    scannedAllChannels: true,
  };
  if (summary.channelCount > 0) {
    await persistCategoryCounts(providerId, generation, counts).catch(() => undefined);
  }
  return summary;
}

async function markBuildStarted(providerId: string, generation: number) {
  const startedAt = Date.now();
  const db = await getCatalogDatabase();
  await withCatalogTransaction(async () => {
    await db.run(
      `INSERT INTO live_search_state (
         provider_id, status, active_generation, building_generation,
         channel_count, started_at, completed_at, error_code
       ) VALUES (?, 'building', 0, ?, 0, ?, NULL, NULL)
       ON CONFLICT(provider_id) DO UPDATE SET
         status = 'building',
         building_generation = excluded.building_generation,
         started_at = excluded.started_at,
         error_code = NULL`,
      [providerId, generation, startedAt],
    );
    await db.run(
      `DELETE FROM live_search_channels
        WHERE provider_id = ? AND generation = ?`,
      [providerId, generation],
    );
  });
}

async function markBuildFailed(providerId: string, generation: number, errorCode: string) {
  const db = await getCatalogDatabase();
  await withCatalogTransaction(async () => {
    await db.run(
      `DELETE FROM live_search_channels
        WHERE provider_id = ? AND generation = ?`,
      [providerId, generation],
    );
    await db.run(
      `UPDATE live_search_state
          SET status = CASE WHEN active_generation > 0 THEN 'ready' ELSE 'error' END,
              building_generation = 0,
              error_code = ?
        WHERE provider_id = ?`,
      [errorCode, providerId],
    );
  });
  publishedStateCache.delete(providerId);
  publishedPointerCache.delete(providerId);
  invalidatePublishedLiveCategoryCache(providerId);
}

async function activateGeneration(
  providerId: string,
  generation: number,
  channelCount: number,
  counts?: Record<string, number>,
  categories?: readonly ProviderLiveCategory[],
) {
  const completedAt = Date.now();
  const db = await getCatalogDatabase();
  await withCatalogTransaction(async () => {
    await db.run(
      `UPDATE live_search_state
          SET status = 'ready',
              active_generation = ?,
              building_generation = 0,
              channel_count = ?,
              completed_at = ?,
              error_code = NULL
        WHERE provider_id = ?`,
      [generation, channelCount, completedAt, providerId],
    );
    await db.run(
      `DELETE FROM live_search_channels
        WHERE provider_id = ? AND generation != ?`,
      [providerId, generation],
    );
  });
  if (counts && Object.keys(counts).length) {
    await persistCategoryCounts(providerId, generation, counts, categories).catch(() => undefined);
  }
  publishedStateCache.delete(providerId);
  publishedPointerCache.delete(providerId);
  invalidatePublishedLiveCategoryCache(providerId);
}

function rowForChannel(
  providerId: string,
  generation: number,
  fallbackCategoryId: string,
  channel: ProviderLiveChannel,
) {
  const title = channel.name?.trim() || `Channel ${channel.id}`;
  const currentProgram = isCurrentProgramFresh({
    fetchedAt: channel.currentProgramFetchedAt,
    startAt: channel.currentStartAt,
    endAt: channel.currentEndAt,
  }) ? channel.current?.trim() || '' : '';
  return {
    providerId,
    generation,
    channelId: channel.id,
    categoryId: channel.categoryId?.trim() || fallbackCategoryId,
    title,
    normalizedTitle: normalizeSearchQuery(title),
    currentProgram,
    normalizedCurrent: normalizeSearchQuery(currentProgram),
    logoUrl: channel.logoUrl ?? null,
    channelNumber: Number.isFinite(channel.number) ? channel.number : null,
    streamExtension: channel.containerExtension ?? null,
    directSource: persistableLiveDirectSource(channel.streamUrl),
    epgChannelId: channel.epgChannelId ?? null,
    tone: channel.tone ?? null,
    updatedAt: Date.now(),
    currentProgramFetchedAt: channel.currentProgramFetchedAt ?? null,
    currentStartAt: channel.currentStartAt ?? null,
    currentEndAt: channel.currentEndAt ?? null,
  };
}

function logPersistedLiveRowSample(
  providerId: string,
  generation: number,
  row: ReturnType<typeof rowForChannel>,
) {
  const sampledId = getSampledLiveStreamId();
  if (sampledId && row.channelId !== sampledId) {
    return;
  }
  logSampledLiveStreamRow('sqlite-persisted', {
    stream_id: row.channelId,
    category_id: row.categoryId,
    ...(row.streamExtension ? { container_extension: row.streamExtension, stream_extension: row.streamExtension } : {}),
    ...(row.directSource ? { direct_source: row.directSource } : {}),
  }, {
    providerIdPresent: Boolean(providerId),
    generationPresent: Number.isFinite(generation),
    directSourcePersisted: Boolean(row.directSource),
  });
}

async function writeChannelRows(
  providerId: string,
  generation: number,
  fallbackCategoryId: string,
  channels: ProviderLiveChannel[],
  seenChannelIds: Set<string>,
  counts: Record<string, number>,
  isCancelled?: () => boolean,
) {
  const rowCount = channels.length;
  const memoryStartedAt = Date.now();
  logLivePublicationStage('live-memory-publish-start', rowCount, memoryStartedAt);
  const uniqueRows: ReturnType<typeof rowForChannel>[] = [];
  let memoryTiming: TimeBudgetResult | null = null;
  memoryTiming = await processTimeBudgeted(
    channels,
    (channel) => {
      const channelId = channel.id?.trim();
      if (!channelId || seenChannelIds.has(channelId)) {
        return;
      }
      seenChannelIds.add(channelId);
      const row = rowForChannel(providerId, generation, fallbackCategoryId, channel);
      logPersistedLiveRowSample(providerId, generation, row);
      uniqueRows.push(row);
    },
    {
      kind: 'liveNormalization',
      targetMs: 8,
      softMs: 50,
      hardMs: 100,
      minItems: 16,
      maxItems: 300,
      isCancelled,
    },
  );
  logLivePublicationStage('live-memory-publish-complete', rowCount, memoryStartedAt, {
    outputRows: uniqueRows.length,
    maxSegmentMs: Math.round(memoryTiming.maxChunkMs),
    yieldCount: Math.max(0, memoryTiming.chunks - 1),
  });

  const indexStartedAt = Date.now();
  logLivePublicationStage('live-index-build-start', uniqueRows.length, indexStartedAt);
  const indexTiming = await processTimeBudgeted(
    uniqueRows,
    (row) => {
      counts[row.categoryId] = (counts[row.categoryId] ?? 0) + 1;
    },
    {
      kind: 'liveNormalization',
      targetMs: 8,
      softMs: 50,
      hardMs: 100,
      minItems: 16,
      maxItems: 300,
      isCancelled,
    },
  );
  logLivePublicationStage('live-index-build-complete', uniqueRows.length, indexStartedAt, {
    categoryCount: Object.keys(counts).length,
    maxSegmentMs: Math.round(indexTiming.maxChunkMs),
    yieldCount: Math.max(0, indexTiming.chunks - 1),
  });

  if (!uniqueRows.length) {
    return 0;
  }

  const db = await getCatalogDatabase();
  const sqliteStartedAt = Date.now();
  logLivePublicationStage('live-sqlite-write-start', rowCount, sqliteStartedAt, {
    batchSize: LIVE_SEARCH_WRITE_BATCH_SIZE,
    transactionType: 'live-search-generation-staging',
  });
  let persistedRows = 0;
  for (let offset = 0; offset < uniqueRows.length; offset += LIVE_SEARCH_WRITE_BATCH_SIZE) {
    if (isCancelled?.()) {
      break;
    }
    const batch = uniqueRows.slice(offset, offset + LIVE_SEARCH_WRITE_BATCH_SIZE);
    const placeholders = batch.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
    const params: Array<string | number | null> = [];

    for (const row of batch) {
      params.push(
        row.providerId,
        row.generation,
        row.channelId,
        row.categoryId,
        row.title,
        row.normalizedTitle,
        row.currentProgram || null,
        row.normalizedCurrent,
        row.logoUrl,
        row.channelNumber,
        row.streamExtension,
        row.directSource,
        row.epgChannelId,
        row.tone,
        row.updatedAt,
        row.currentProgramFetchedAt,
        row.currentStartAt,
        row.currentEndAt,
      );
    }

    await withCatalogTransaction(async () => {
      await db.run(
        `INSERT OR IGNORE INTO live_search_channels (
           provider_id, generation, channel_id, category_id,
           title, normalized_title, current_program, normalized_current,
           logo_url, channel_number, stream_extension, direct_source, epg_channel_id, tone, updated_at,
           current_program_fetched_at, current_start_at, current_end_at
         ) VALUES ${placeholders}`,
        params,
      );
    });
    persistedRows += batch.length;
    batch.length = 0;
    await yieldToUi(0);
  }

  const written = persistedRows;
  logLivePublicationStage('live-sqlite-write-complete', rowCount, sqliteStartedAt, {
    writtenRows: persistedRows,
    batchSize: LIVE_SEARCH_WRITE_BATCH_SIZE,
    yieldCount: Math.ceil(uniqueRows.length / LIVE_SEARCH_WRITE_BATCH_SIZE),
  });
  uniqueRows.length = 0;
  return written;
}

function normalizeCategories(categories: readonly ProviderLiveCategory[]) {
  const seen = new Set<string>();
  const unique: ProviderLiveCategory[] = [];

  for (const category of categories) {
    const id = category.id?.trim();
    if (!id || id === 'all' || id === 'favorites' || id === 'recent' || seen.has(id)) {
      continue;
    }
    seen.add(id);
    unique.push(category);
  }

  return unique;
}

async function buildLiveSearchCatalog(input: {
  providerId: string;
  live: ProviderLiveRepository;
  categories?: readonly ProviderLiveCategory[];
  isCancelled?: () => boolean;
}): Promise<LiveSearchCatalogBuildResult> {
  const { providerId, live, isCancelled } = input;
  await ensureLiveSearchSchema();

  const previousState = await readState(providerId);
  const previousGeneration = asNumber(previousState?.active_generation);
  const previousSummary = await readGenerationSummary(providerId, previousGeneration);
  const generation = Math.max(
    Date.now(),
    previousGeneration + 1,
    asNumber(previousState?.building_generation) + 1,
  );

  await markBuildStarted(providerId, generation);

  const startedAt = Date.now();
  const seenChannelIds = new Set<string>();
  const counts: Record<string, number> = {};
  const failedCategories = new Set<string>();

  try {
    const rawCategories = input.categories?.length
      ? [...input.categories]
      : await live.getCategories();
    const categories = normalizeCategories(rawCategories);
    ingestLiveSearchCategories(providerId, categories);

    patchLiveTvWorkload(
      {
        searchIndexBuildActive: true,
        searchIndexPendingCategories: categories.length,
      },
      { log: true, reason: 'search-index-started' },
    );
    logLiveSearchCatalog('build-started', {
      providerId,
      generation,
      categoryCount: categories.length,
      concurrency: LIVE_SEARCH_BUILD_CONCURRENCY,
      retainedJsItemCount: 0,
    });

    let dumpChannels: ProviderLiveChannel[] = [];
    try {
      dumpChannels = await live.getChannels('all');
    } catch {
      dumpChannels = [];
    }
    if (dumpChannels.length) {
      await writeChannelRows(
        providerId,
        generation,
        LIVE_UNKNOWN_CATEGORY_ID,
        dumpChannels,
        seenChannelIds,
        counts,
        isCancelled,
      );
      const dumpSummary = await readGenerationSummary(providerId, generation);
      if (dumpSummary.channelCount <= 0) {
        throw new Error('live_search_catalog_empty_generation');
      }
      await activateGeneration(providerId, generation, dumpSummary.channelCount, dumpSummary.counts, categories);
      patchLiveTvWorkload(
        { searchIndexBuildActive: false, searchIndexPendingCategories: 0 },
        { log: true, reason: 'search-index-completed-full-dump' },
      );
      logLiveSearchCatalog('completed', {
        providerId,
        generation,
        channelCount: dumpSummary.channelCount,
        categoryCount: Object.keys(dumpSummary.counts).length,
        duration: Date.now() - startedAt,
        durationMs: Date.now() - startedAt,
        retainedJsItemCount: seenChannelIds.size,
        strategy: 'full-dump-stream-category',
      });
      return {
        ready: true,
        rebuilt: true,
        generation,
        channelCount: dumpSummary.channelCount,
        counts: dumpSummary.counts,
      };
    }

    let paused = false;
    for (let index = 0; index < categories.length; index += 1) {
      const pauseState = await waitWhileLiveSearchIndexPaused({
        isCancelled: () => isBuildCancelled(providerId, isCancelled),
        onPaused: () => {
          if (!paused) {
            paused = true;
            logLiveSearchCatalog('build-paused', {
              providerId,
              generation,
              completedCategories: index,
              categoryCount: categories.length,
              pendingCategories: liveSearchIndexPendingCategories(index, categories.length),
              retainedJsItemCount: seenChannelIds.size,
            });
          }
        },
        onResumed: () => {
          if (paused) {
            paused = false;
            logLiveSearchCatalog('build-resumed', {
              providerId,
              generation,
              completedCategories: index,
              categoryCount: categories.length,
              pendingCategories: liveSearchIndexPendingCategories(index, categories.length),
              retainedJsItemCount: seenChannelIds.size,
            });
          }
        },
      });
      if (pauseState === 'cancelled' || isBuildCancelled(providerId, isCancelled)) {
        throw new Error('live_search_catalog_cancelled');
      }

      const category = categories[index];
      let channels: ProviderLiveChannel[] = [];
      try {
        channels = await live.getChannels(category.id);
      } catch {
        failedCategories.add(category.id);
        channels = [];
      }

      if (channels.length) {
        await writeChannelRows(
          providerId,
          generation,
          category.id,
          channels,
          seenChannelIds,
          counts,
          isCancelled,
        );
      }
      channels = [];

      const completedCategories = index + 1;
      patchLiveTvWorkload(
        {
          searchIndexBuildActive: true,
          searchIndexPendingCategories: liveSearchIndexPendingCategories(completedCategories, categories.length),
        },
        { log: false },
      );
      logLiveSearchCatalog('batch', {
        providerId,
        generation,
        completedCategories,
        categoryCount: categories.length,
        pendingCategories: liveSearchIndexPendingCategories(completedCategories, categories.length),
        channelCount: seenChannelIds.size,
        retainedJsItemCount: seenChannelIds.size,
        durationMs: Date.now() - startedAt,
      });
      await yieldToUi();
    }

    // One bounded serial retry keeps a temporary provider/rate-limit hiccup from
    // poisoning an otherwise complete persistent index.
    for (const categoryId of [...failedCategories]) {
      if (isBuildCancelled(providerId, isCancelled)) {
        throw new Error('live_search_catalog_cancelled');
      }
      try {
        const channels = await live.getChannels(categoryId);
        await writeChannelRows(
          providerId,
          generation,
          categoryId,
          channels,
          seenChannelIds,
          counts,
          isCancelled,
        );
        failedCategories.delete(categoryId);
      } catch {
        // Leave it in failedCategories; incomplete builds never become authoritative.
      }
      await yieldToUi();
    }

    if (failedCategories.size > 0) {
      throw new Error(`live_search_catalog_incomplete:${[...failedCategories].join(',')}`);
    }

    const summary = await readGenerationSummary(providerId, generation);
    if (summary.channelCount <= 0 && categories.length > 0) {
      throw new Error('live_search_catalog_empty_generation');
    }

    const subscriberStartedAt = Date.now();
    logLivePublicationStage('live-subscriber-notify-start', seenChannelIds.size, subscriberStartedAt, {
      listenerStrategy: 'generation-pointer-publication',
    });
    await activateGeneration(providerId, generation, summary.channelCount, summary.counts, categories);
    logLivePublicationStage('live-subscriber-notify-complete', seenChannelIds.size, subscriberStartedAt, {
      listenerStrategy: 'generation-pointer-publication',
    });
    patchLiveTvWorkload(
      { searchIndexBuildActive: false, searchIndexPendingCategories: 0 },
      { log: true, reason: 'search-index-completed' },
    );
    logLiveSearchCatalog('completed', {
      providerId,
      generation,
      channelCount: summary.channelCount,
      categoryCount: Object.keys(summary.counts).length,
      duration: Date.now() - startedAt,
      durationMs: Date.now() - startedAt,
      retainedJsItemCount: seenChannelIds.size,
    });

    return {
      ready: true,
      rebuilt: true,
      generation,
      channelCount: summary.channelCount,
      counts: summary.counts,
    };
  } catch (error) {
    const errorCode = error instanceof Error ? error.message.slice(0, 180) : 'live_search_catalog_failed';
    const cancelled = errorCode.includes('live_search_catalog_cancelled');
    await markBuildFailed(providerId, generation, errorCode).catch(() => undefined);
    patchLiveTvWorkload(
      { searchIndexBuildActive: false },
      { log: true, reason: cancelled ? 'search-index-cancelled' : 'search-index-failed' },
    );
    logLiveSearchCatalog(cancelled ? 'build-cancelled' : 'build-failed', {
      providerId,
      generation,
      errorCode,
      duration: Date.now() - startedAt,
      durationMs: Date.now() - startedAt,
      retainedJsItemCount: seenChannelIds.size,
    });

    return {
      ready: previousGeneration > 0 && previousSummary.channelCount > 0,
      rebuilt: false,
      generation: previousGeneration,
      channelCount: previousSummary.channelCount,
      counts: previousSummary.counts,
    };
  }
}

export async function ensureLiveSearchSqliteCatalog(input: {
  providerId: string;
  live: ProviderLiveRepository;
  categories?: readonly ProviderLiveCategory[];
  isCancelled?: () => boolean;
  force?: boolean;
}): Promise<LiveSearchCatalogBuildResult> {
  const providerId = input.providerId.trim();
  if (!providerId) {
    return { ready: false, rebuilt: false, generation: 0, channelCount: 0, counts: {} };
  }

  await ensureLiveSearchSchema();
  const state = await readState(providerId);
  const activeGeneration = asNumber(state?.active_generation);
  const completedAt = asNumber(state?.completed_at);

  if (
    !input.force &&
    state?.status === 'ready' &&
    activeGeneration > 0 &&
    Date.now() - completedAt < LIVE_SEARCH_CATALOG_TTL_MS
  ) {
    const summary = await readGenerationSummary(providerId, activeGeneration);
    if (summary.channelCount > 0 || asNumber(state?.channel_count) === 0) {
      logLiveSearchCatalog('build-cache-hit', {
        providerId,
        generation: activeGeneration,
        channelCount: summary.channelCount,
      });
      return {
        ready: true,
        rebuilt: false,
        generation: activeGeneration,
        channelCount: summary.channelCount,
        counts: summary.counts,
      };
    }
  }

  const existing = inFlightBuilds.get(providerId);
  if (existing) {
    return existing;
  }

  cancelRequested.set(providerId, false);
  const build = buildLiveSearchCatalog(input).finally(() => {
    if (inFlightBuilds.get(providerId) === build) {
      inFlightBuilds.delete(providerId);
    }
    if (!cancelRequested.get(providerId)) {
      cancelRequested.delete(providerId);
    }
    patchLiveTvWorkload(
      { searchIndexBuildActive: false },
      { log: false },
    );
  });
  inFlightBuilds.set(providerId, build);
  return build;
}

export async function publishLiveSearchCatalogFromDump(input: {
  providerId: string;
  channels: ProviderLiveChannel[];
  categories?: readonly ProviderLiveCategory[];
  isCancelled?: () => boolean;
  requestSource?: string;
}): Promise<LiveSearchCatalogBuildResult> {
  const providerId = input.providerId.trim();
  const previousState = await readState(providerId);
  const previousGeneration = asNumber(previousState?.active_generation);
  const previousSummary = await readGenerationSummary(providerId, previousGeneration);
  if (!providerId || input.isCancelled?.()) {
    logLivePublicationTrace('live-publication-skipped', {
      providerId,
      requestSource: input.requestSource ?? null,
      publishedCount: previousSummary.channelCount,
      generation: previousGeneration || null,
      skipReason: !providerId ? 'empty-provider-id' : 'cancelled-before-write',
    });
    return {
      ready: previousGeneration > 0 && previousSummary.channelCount > 0,
      rebuilt: false,
      generation: previousGeneration,
      channelCount: previousSummary.channelCount,
      counts: previousSummary.counts,
    };
  }

  await ensureLiveSearchSchema();
  const generation = Math.max(
    Date.now(),
    previousGeneration + 1,
    asNumber(previousState?.building_generation) + 1,
  );
  await markBuildStarted(providerId, generation);
  const startedAt = Date.now();
  const seenChannelIds = new Set<string>();
  const counts: Record<string, number> = {};

  try {
    if (input.categories?.length) {
      ingestLiveSearchCategories(providerId, [...input.categories]);
    }
    await writeChannelRows(
      providerId,
      generation,
      LIVE_UNKNOWN_CATEGORY_ID,
      input.channels,
      seenChannelIds,
      counts,
      input.isCancelled,
    );
    if (input.isCancelled?.()) {
      throw new Error('live_search_catalog_cancelled');
    }
    logLivePublicationTrace('live-publication-write-complete', {
      providerId,
      requestSource: input.requestSource ?? null,
      publishedCount: seenChannelIds.size,
      generation,
    });
    const summary = await readGenerationSummary(providerId, generation);
    if (summary.channelCount <= 0) {
      throw new Error('live_search_catalog_empty_generation');
    }
    await activateGeneration(providerId, generation, summary.channelCount, summary.counts, input.categories);
    logLivePublicationTrace('live-publication-activated', {
      providerId,
      requestSource: input.requestSource ?? null,
      publishedCount: summary.channelCount,
      generation,
    });
    logLiveSearchCatalog('completed', {
      providerId,
      generation,
      channelCount: summary.channelCount,
      categoryCount: Object.keys(summary.counts).length,
      durationMs: Date.now() - startedAt,
      strategy: 'full-dump-stream-category',
    });
    return {
      ready: true,
      rebuilt: true,
      generation,
      channelCount: summary.channelCount,
      counts: summary.counts,
    };
  } catch (error) {
    const errorCode = error instanceof Error ? error.message.slice(0, 180) : 'live_search_catalog_failed';
    await markBuildFailed(providerId, generation, errorCode).catch(() => undefined);
    logLiveSearchCatalog('build-failed', {
      providerId,
      generation,
      errorCode,
      durationMs: Date.now() - startedAt,
      retainedPreviousGeneration: previousGeneration,
      retainedPreviousChannelCount: previousSummary.channelCount,
    });
    logLivePublicationTrace('live-publication-skipped', {
      providerId,
      requestSource: input.requestSource ?? null,
      publishedCount: previousSummary.channelCount,
      generation: previousGeneration || null,
      skipReason: `publish-failed:${errorCode}`,
    });
    return {
      ready: previousGeneration > 0 && previousSummary.channelCount > 0,
      rebuilt: false,
      generation: previousGeneration,
      channelCount: previousSummary.channelCount,
      counts: previousSummary.counts,
    };
  }
}

export function scheduleLiveSearchCatalogIdleBuild(input: {
  providerId: string;
  live: ProviderLiveRepository;
  categories?: readonly ProviderLiveCategory[];
  isCancelled?: () => boolean;
}): void {
  const providerId = input.providerId.trim();
  if (!providerId) {
    return;
  }

  void ensureLiveSearchSqliteCatalog(input).catch((error) => {
    novacastTrace('[NovaCast Live Search Catalog] ' + JSON.stringify({
      event: 'idle-build-fallback',
      marker: LIVE_SEARCH_SQLITE_CATALOG_MARKER,
      providerId,
      message: error instanceof Error ? error.message : String(error),
    }));
  });
}

function buildTokenClause(column: 'normalized_title' | 'normalized_current', tokens: string[]) {
  if (!tokens.length) {
    return { sql: '', params: [] as string[] };
  }
  const clauses = tokens.map(() => `${column} LIKE ? ESCAPE '\\'`);
  return {
    sql: `(${clauses.join(' AND ')})`,
    params: tokens.map((token) => `%${escapeLikeWildcards(token)}%`),
  };
}

export async function searchLiveSqliteCatalog(input: {
  providerId: string;
  query: string;
  offset: number;
  limit: number;
  matchMode?: LiveSearchMatchMode;
  matchingCategoryIds?: readonly string[];
  signal?: AbortSignal;
}): Promise<SearchPageResult<LiveSearchResult> | null> {
  if (input.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  await ensureLiveSearchSchema();
  const state = await readState(input.providerId);
  const activeGeneration = asNumber(state?.active_generation);
  const buildingGeneration = asNumber(state?.building_generation);
  // live-search-progressive-bootstrap-v1_1
  // Normal operation always reads the completed generation. Only a provider with no
  // completed Live catalog yet may read the in-progress bootstrap generation.
  const generation = activeGeneration > 0 ? activeGeneration : buildingGeneration;
  if (generation <= 0) {
    return null;
  }
  if (activeGeneration <= 0 && buildingGeneration > 0) {
    logLiveSearchCatalog('search-progressive-bootstrap', {
      providerId: input.providerId,
      generation: buildingGeneration,
    });
  }

  const normalized = normalizeSearchQuery(input.query);
  if (!normalized) {
    return { items: [], totalCount: 0, hasMore: false };
  }

  const tokens = tokenizeSearchQuery(input.query);
  const escaped = escapeLikeWildcards(normalized);
  const titleTokens = buildTokenClause('normalized_title', tokens);
  const currentTokens = buildTokenClause('normalized_current', tokens);
  const matchMode = input.matchMode ?? 'live';
  const matchingCategoryIds = (input.matchingCategoryIds ?? []).filter(Boolean).slice(0, 40);
  const whereParts = [
    `normalized_title LIKE ? ESCAPE '\\'`,
    titleTokens.sql,
    `CAST(channel_number AS TEXT) = ?`,
  ].filter(Boolean);
  const whereParams: Array<string | number> = [
    `%${escaped}%`,
    ...titleTokens.params,
    normalized,
  ];

  if (matchMode === 'live') {
    const now = Date.now();
    const currentMatchParts = [`normalized_current LIKE ? ESCAPE '\\'`];
    const currentMatchParams: Array<string | number> = [`%${escaped}%`];
    if (currentTokens.sql) {
      currentMatchParts.push(currentTokens.sql);
      currentMatchParams.push(...currentTokens.params);
    }
    whereParts.push(`(current_program_fetched_at IS NOT NULL AND current_program_fetched_at >= ? AND
      (current_start_at IS NULL OR current_start_at <= ?) AND (current_end_at IS NULL OR current_end_at > ?) AND
      (${currentMatchParts.join(' OR ')}))`);
    whereParams.push(now - 5 * 60 * 1000, now, now);
    whereParams.push(...currentMatchParams);
    if (matchingCategoryIds.length) {
      whereParts.push(`category_id IN (${matchingCategoryIds.map(() => '?').join(', ')})`);
      whereParams.push(...matchingCategoryIds);
    }
  }

  const limit = Math.min(Math.max(input.limit, 1), 100);
  const offset = Math.max(input.offset, 0);
  const db = await getCatalogReadDatabase();
  const baseParams: Array<string | number> = [input.providerId, generation, ...whereParams];
  const where = `provider_id = ? AND generation = ? AND (${whereParts.join(' OR ')})`;

  const startedAt = Date.now();
  const rows = await db.getAll<LiveSearchCatalogRow>(
    `SELECT channel_id, category_id, title, current_program, current_program_fetched_at,
            current_start_at, current_end_at, logo_url,
            channel_number, stream_extension, direct_source, epg_channel_id, tone
       FROM live_search_channels
      WHERE ${where}
      ORDER BY
        ${liveSearchSqlRankCase()},
        normalized_title ASC,
        channel_number ASC,
        channel_id ASC
      LIMIT ? OFFSET ?`,
    [
      ...baseParams,
      normalized,
      normalized,
      `${escaped}%`,
      `%${escaped}%`,
      normalized,
      `%${escaped}%`,
      limit + 1,
      offset,
    ],
  );

  if (input.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  const hasMore = rows.length > limit;
  const visible = hasMore ? rows.slice(0, limit) : rows;
  const totalRow = await db.getFirst<{ total: number | string }>(
    `SELECT COUNT(*) AS total
       FROM live_search_channels
      WHERE ${where}`,
    baseParams,
  );

  const items: LiveSearchResult[] = visible.map((row) => ({
    type: 'live',
    id: row.channel_id,
    providerId: input.providerId,
    title: row.title,
    subtitle: isCurrentProgramFresh({ fetchedAt: Number(row.current_program_fetched_at), startAt: Number(row.current_start_at), endAt: Number(row.current_end_at) }) ? row.current_program || undefined : undefined,
    currentProgram: isCurrentProgramFresh({ fetchedAt: Number(row.current_program_fetched_at), startAt: Number(row.current_start_at), endAt: Number(row.current_end_at) }) ? row.current_program || undefined : undefined,
    channelNumber: row.channel_number == null ? undefined : asNumber(row.channel_number),
    logoUrl: row.logo_url || undefined,
    tone: row.tone || undefined,
    categoryId: row.category_id || undefined,
    containerExtension: row.stream_extension || undefined,
    streamUrl: row.direct_source || undefined,
  }));

  logLiveSearchCatalog('search', {
    providerId: input.providerId,
    generation,
    queryLength: normalized.length,
    matchMode,
    returnedCount: items.length,
    totalCount: asNumber(totalRow?.total),
    durationMs: Date.now() - startedAt,
  });

  return {
    items,
    totalCount: asNumber(totalRow?.total),
    hasMore,
  };
}

export {
  buildPublishedLiveCategories,
  normalizePublishedCategoryCounts,
  publishedLiveRowToChannel,
  resolvePublishedLiveCategoryName,
} from './livePublishedCatalogRead.ts';

async function describeLiveSearchInventory(providerId: string): Promise<string> {
  try {
    await ensureLiveSearchSchema();
    const db = await getCatalogReadDatabase();
    const states = await db.getAll<{
      provider_id: string;
      status: string;
      active_generation: number | string;
      channel_count: number | string;
    }>(`SELECT provider_id, status, active_generation, channel_count FROM live_search_state`);
    const gens = await db.getAll<{
      provider_id: string;
      generation: number | string;
      total: number | string;
    }>(
      `SELECT provider_id, generation, COUNT(*) AS total
         FROM live_search_channels
        GROUP BY provider_id, generation`,
    );
    const stateParts = states.map(
      (row) =>
        `${row.provider_id === providerId ? 'self' : 'other'}:${row.status}:${asNumber(row.active_generation)}:${asNumber(row.channel_count)}`,
    );
    const genParts = gens.map(
      (row) =>
        `${row.provider_id === providerId ? 'self' : 'other'}:${asNumber(row.generation)}:${asNumber(row.total)}`,
    );
    return `states=${states.length}[${stateParts.join(';')}] channelGens=${gens.length}[${genParts.join(';')}]`;
  } catch (error) {
    return `inventory-failed:${error instanceof Error ? error.message : String(error)}`;
  }
}

function emptyPublishedLiveCatalogState(unreadinessReason: string): PublishedLiveCatalogState {
  return {
    ready: false,
    generation: 0,
    channelCount: 0,
    counts: {},
    categoryNames: {},
    status: null,
    stateRowPresent: false,
    buildingGeneration: 0,
    stateChannelCount: 0,
    unreadinessReason,
  };
}

function logLiveReadTiming(fields: Record<string, unknown>): void {
  console.info('[NovaCast Live Screen Read Trace]', JSON.stringify(fields));
}

async function resolvePublishedLivePointer(providerId: string): Promise<PublishedLivePointer> {
  const startedAt = Date.now();
  const id = providerId.trim();
  if (!id) {
    return {
      ready: false,
      generation: 0,
      channelCount: 0,
      status: null,
      stateRowPresent: false,
      buildingGeneration: 0,
      unreadinessReason: 'empty-provider-id',
    };
  }
  const cached = publishedPointerCache.get(id);
  const state = await readState(id);
  const generation = asNumber(state?.active_generation);
  const buildingGeneration = asNumber(state?.building_generation);
  const channelCount = asNumber(state?.channel_count);
  if (cached && cached.generation === generation && cached.channelCount === channelCount) {
    logLiveReadTiming({
      event: 'published-pointer-timing',
      providerId: id,
      generation,
      sqliteMs: Date.now() - startedAt,
      rowCount: 1,
      usedCache: true,
      pointerCacheHit: true,
      stateReadRequired: true,
      elapsedMs: Date.now() - startedAt,
    });
    return cached;
  }
  const ready = Boolean(state && generation > 0 && channelCount > 0);
  const pointer: PublishedLivePointer = {
    ready,
    generation,
    channelCount,
    status: state?.status ?? null,
    stateRowPresent: Boolean(state),
    buildingGeneration,
    unreadinessReason: !state
      ? 'live-search-state-row-missing'
      : generation <= 0
        ? 'active-generation-not-positive'
        : ready
          ? null
          : 'active-generation-has-zero-rows',
  };
  publishedPointerCache.set(id, pointer);
  logLiveReadTiming({
    event: 'published-pointer-timing',
    providerId: id,
    generation,
    sqliteMs: Date.now() - startedAt,
    rowCount: 1,
    usedCache: false,
    pointerCacheHit: false,
    stateReadRequired: true,
    elapsedMs: Date.now() - startedAt,
  });
  return pointer;
}

async function loadPublishedLiveCatalogState(
  providerId: string,
  pointer: PublishedLivePointer,
): Promise<PublishedLiveCatalogState> {
  if (!pointer.ready) {
    const result = {
      ...emptyPublishedLiveCatalogState(pointer.unreadinessReason ?? 'published-state-not-ready'),
      generation: pointer.generation,
      status: pointer.status,
      stateRowPresent: pointer.stateRowPresent,
      buildingGeneration: pointer.buildingGeneration,
      stateChannelCount: pointer.channelCount,
    };
    if (!pointer.stateRowPresent || pointer.generation <= 0) {
      result.unreadinessReason = pointer.unreadinessReason;
    }
    return result;
  }

  const summaryStartedAt = Date.now();
  const summary = await readGenerationSummary(providerId, pointer.generation);
  const ready = summary.channelCount > 0 || pointer.channelCount > 0;
  return {
    ready,
    generation: pointer.generation,
    channelCount: summary.channelCount || pointer.channelCount,
    counts: summary.counts,
    categoryNames: summary.categoryNames,
    status: pointer.status,
    stateRowPresent: true,
    buildingGeneration: pointer.buildingGeneration,
    stateChannelCount: pointer.channelCount,
    unreadinessReason: ready ? null : 'active-generation-has-zero-rows',
    scannedAllChannels: summary.scannedAllChannels,
    summaryMs: Date.now() - summaryStartedAt,
  } as PublishedLiveCatalogState & { scannedAllChannels?: boolean; summaryMs?: number };
}

export function clearPublishedLiveCatalogStateCacheForTests(): void {
  publishedStateCache.clear();
  publishedStateInflight.clear();
  publishedPointerCache.clear();
  invalidatePublishedLiveCategoryCache();
}

export async function getPublishedLiveCatalogState(providerId: string): Promise<PublishedLiveCatalogState> {
  const id = providerId.trim();
  const stateStartedAt = Date.now();
  logLiveReadTiming({
    event: 'published-state-read-start',
    providerId: id || null,
  });
  if (!id) {
    const empty = emptyPublishedLiveCatalogState('empty-provider-id');
    logLiveReadTiming({
      event: 'published-state-read-result',
      providerId: null,
      returnReason: empty.unreadinessReason,
      source: 'none',
      elapsedMs: Date.now() - stateStartedAt,
    });
    return empty;
  }

  const pointer = await resolvePublishedLivePointer(id);
  const cached = publishedStateCache.get(id);
  if (cached && cached.generation === pointer.generation && cached.ready === pointer.ready) {
    logLiveReadTiming({
      event: 'published-state-read-result',
      providerId: id,
      readableGeneration: cached.ready ? cached.generation : null,
      publishedGeneration: cached.generation,
      publishedTotal: cached.channelCount,
      categoryCount: Object.keys(cached.counts).length,
      channelCount: cached.channelCount,
      source: cached.ready ? 'published-sqlite' : 'none',
      returnReason: cached.unreadinessReason,
      usedCache: true,
      scannedAllChannels: false,
      elapsedMs: Date.now() - stateStartedAt,
    });
    return cached;
  }

  const inflight = publishedStateInflight.get(id);
  if (inflight) {
    return inflight;
  }

  const pending = loadPublishedLiveCatalogState(id, pointer).then((result) => {
    publishedStateCache.set(id, result);
    return result;
  }).finally(() => {
    publishedStateInflight.delete(id);
  });
  publishedStateInflight.set(id, pending);
  const result = await pending;
  logLiveReadTiming({
    event: 'published-state-read-result',
    providerId: id,
    readableGeneration: result.ready ? result.generation : null,
    publishedGeneration: result.generation,
    publishedTotal: result.channelCount,
    categoryCount: Object.keys(result.counts).length,
    channelCount: result.channelCount,
    source: result.ready ? 'published-sqlite' : 'none',
    returnReason: result.unreadinessReason,
    usedCache: false,
    scannedAllChannels: Boolean((result as { scannedAllChannels?: boolean }).scannedAllChannels),
    elapsedMs: Date.now() - stateStartedAt,
  });
  return result;
}

export async function getPublishedLiveChannelCount(providerId: string): Promise<number> {
  const pointer = await resolvePublishedLivePointer(providerId);
  return pointer.ready ? pointer.channelCount : 0;
}

/** Resolve one channel from the active published generation without loading the catalog into JS. */
export async function getPublishedLiveChannelById(
  providerId: string,
  channelId: string,
): Promise<ProviderLiveChannel | null> {
  const id = String(channelId ?? '').trim();
  if (!providerId.trim() || !id) return null;
  const pointer = await resolvePublishedLivePointer(providerId);
  if (!pointer.ready) return null;
  await ensureLiveSearchSchema();
  const db = await getCatalogReadDatabase();
  const row = await db.getFirst<LiveSearchCatalogRow>(
    `SELECT channel_id, category_id, title, current_program, logo_url,
            channel_number, stream_extension, direct_source, epg_channel_id, tone
       FROM live_search_channels
      WHERE provider_id = ? AND generation = ? AND channel_id = ?
      LIMIT 1`,
    [providerId, pointer.generation, id],
  );
  return row ? publishedLiveRowToChannel(row, 0, { publishedGeneration: pointer.generation }) : null;
}

/** Legacy migration lookup: exact normalized title, bounded to detect ambiguity. */
export async function findPublishedLiveChannelsByTitle(
  providerId: string,
  title: string,
): Promise<ProviderLiveChannel[]> {
  const normalizedTitle = normalizeSearchQuery(title);
  if (!providerId.trim() || !normalizedTitle) return [];
  const pointer = await resolvePublishedLivePointer(providerId);
  if (!pointer.ready) return [];
  await ensureLiveSearchSchema();
  const db = await getCatalogReadDatabase();
  const rows = await db.getAll<LiveSearchCatalogRow>(
    `SELECT channel_id, category_id, title, current_program, logo_url,
            channel_number, stream_extension, direct_source, tone
       FROM live_search_channels
      WHERE provider_id = ? AND generation = ? AND normalized_title = ?
      ORDER BY channel_id ASC
      LIMIT 2`,
    [providerId, pointer.generation, normalizedTitle],
  );
  return rows.map((row, index) => publishedLiveRowToChannel(row, index, {
    publishedGeneration: pointer.generation,
  }));
}

export async function getPublishedLiveCategories(
  providerId: string,
  options?: { state?: PublishedLiveCatalogState },
): Promise<ProviderLiveCategory[]> {
  const startedAt = Date.now();
  logLiveReadTiming({
    event: 'published-category-read-start',
    providerId,
  });
  const stateStartedAt = Date.now();
  const state = options?.state?.ready ? options.state : await getPublishedLiveCatalogState(providerId);
  const stateMs = Date.now() - stateStartedAt;
  if (!state.ready) {
    logLiveReadTiming({
      event: 'getPublishedLiveCategories-timing',
      providerId,
      publishedGeneration: state.generation || null,
      rowCount: 0,
      stateMs,
      sqliteMs: 0,
      normalizeMs: 0,
      sortMs: 0,
      scannedAllChannels: false,
      elapsedMs: Date.now() - startedAt,
      returnReason: state.unreadinessReason ?? 'published-state-not-ready',
    });
    return [];
  }

  const cacheKey = `${providerId.trim()}:${state.generation}`;
  const cached = publishedLiveCategoryCache.get(cacheKey);
  if (cached) {
    logLiveReadTiming({
      event: 'getPublishedLiveCategories-timing',
      providerId,
      readableGeneration: state.generation,
      publishedGeneration: state.generation,
      publishedTotal: state.channelCount,
      categoryCount: cached.length,
      rowCount: cached.length,
      stateMs,
      sqliteMs: 0,
      normalizeMs: 0,
      sortMs: 0,
      scannedAllChannels: false,
      source: 'memory-cache',
      usedCache: true,
      elapsedMs: Date.now() - startedAt,
    });
    return cached;
  }
  const inflight = publishedLiveCategoryInflight.get(cacheKey);
  if (inflight) {
    return inflight;
  }

  const pending = Promise.resolve().then(() => {
    const normalizeStartedAt = Date.now();
    const metrics: CategoryRegionalSortMetrics = { profileBuildMs: 0, actualSortMs: 0, profileBuildCount: 0, comparatorCalls: 0 };
    const categories = buildPublishedLiveCategories(state.counts, (categoryId) =>
      resolvePersistedLiveCategoryName(providerId, categoryId, state.categoryNames),
      metrics,
    );
    const normalizeMs = Date.now() - normalizeStartedAt;
    publishedLiveCategoryCache.set(cacheKey, categories);
    logLiveReadTiming({
      event: 'getPublishedLiveCategories-timing',
      providerId,
      readableGeneration: state.generation,
      publishedGeneration: state.generation,
      publishedTotal: state.channelCount,
      categoryCount: categories.length,
      rowCount: categories.length,
      stateMs,
      sqliteMs: 0,
      normalizeMs,
      sortMs: metrics.actualSortMs,
      profileBuildMs: metrics.profileBuildMs,
      actualSortMs: metrics.actualSortMs,
      totalCategoryTransformMs: normalizeMs,
      profileBuildCount: metrics.profileBuildCount,
      comparatorCalls: metrics.comparatorCalls,
      scannedAllChannels: Boolean((state as { scannedAllChannels?: boolean }).scannedAllChannels),
      source: 'published-sqlite',
      usedCache: false,
      elapsedMs: Date.now() - startedAt,
    });
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      console.info('[NovaCast Live Category CPU Audit]', {
        providerId,
        generation: state.generation,
        categoryCount: categories.length,
        // Independently measured. profileBuild + actualSort are subsets of the
        // total; the remainder is category-record construction/name resolution.
        totalCategoryTransformMs: normalizeMs,
        profileBuildMs: metrics.profileBuildMs,
        actualSortMs: metrics.actualSortMs,
        profileBuildCount: metrics.profileBuildCount,
        comparatorCalls: metrics.comparatorCalls,
        // Per-stage breakdown inside profile building.
        titleParseMs: metrics.titleParseMs ?? 0,
        scriptDetectMs: metrics.scriptDetectMs ?? 0,
        regionClassifyMs: metrics.regionClassifyMs ?? 0,
        displayNameMs: metrics.displayNameMs ?? 0,
        sortKeyMs: metrics.sortKeyMs ?? 0,
        titleParseCount: metrics.titleParseCount ?? 0,
        scriptDetectCount: metrics.scriptDetectCount ?? 0,
        regionClassifyCount: metrics.regionClassifyCount ?? 0,
      });
    }
    return categories;
  }).finally(() => {
    publishedLiveCategoryInflight.delete(cacheKey);
  });
  publishedLiveCategoryInflight.set(cacheKey, pending);
  return pending;
}

export async function getPublishedLiveChannels(
  providerId: string,
  categoryId?: string,
  options?: { offset?: number; limit?: number; publishedGeneration?: number; publishedChannelCount?: number },
): Promise<ProviderLiveChannel[]> {
  const startedAt = Date.now();
  const pointerStartedAt = Date.now();
  const verifiedGeneration = options?.publishedGeneration;
  const pointer = verifiedGeneration != null
    ? {
        ready: verifiedGeneration > 0,
        generation: verifiedGeneration,
        channelCount: options?.publishedChannelCount ?? 0,
        status: 'ready',
        stateRowPresent: true,
        buildingGeneration: 0,
        unreadinessReason: verifiedGeneration > 0 ? null : 'active-generation-not-positive',
      }
    : await resolvePublishedLivePointer(providerId);
  const stateMs = Date.now() - pointerStartedAt;
  if (!pointer.ready) {
    logLiveReadTiming({
      event: 'getPublishedLiveChannels-timing',
      providerId,
      selectedCategoryId: categoryId ?? null,
      rowCount: 0,
      stateMs,
      sqliteMs: 0,
      normalizeMs: 0,
      scannedAllChannels: false,
      elapsedMs: Date.now() - startedAt,
      returnReason: pointer.unreadinessReason,
      usedVerifiedGeneration: verifiedGeneration != null,
    });
    return [];
  }

  const scopedCategoryId = String(categoryId ?? '').trim();
  const offset = Math.max(options?.offset ?? 0, 0);
  const limit = options?.limit == null ? null : Math.max(options.limit, 0);
  if (!scopedCategoryId && limit == null) {
    logLiveReadTiming({
      event: 'getPublishedLiveChannels-timing',
      providerId,
      publishedGeneration: pointer.generation,
      selectedCategoryId: null,
      rowCount: 0,
      stateMs,
      sqliteMs: 0,
      normalizeMs: 0,
      scannedAllChannels: false,
      elapsedMs: Date.now() - startedAt,
      returnReason: 'unscoped-full-dump-refused',
    });
    return [];
  }

  const releaseForegroundRead = beginCatalogForegroundRead();
  const writerTransactionActiveAtStart = isCatalogWriteTransactionActive();
  const foregroundStartedAt = Date.now();
  try {
  await ensureLiveSearchSchema();
  const db = await getCatalogReadDatabase();
  const queueWaitMs = Date.now() - foregroundStartedAt;
  const params: Array<string | number> = [providerId, pointer.generation];
  const where = ['provider_id = ?', 'generation = ?'];
  if (scopedCategoryId) {
    if (scopedCategoryId === LIVE_UNKNOWN_CATEGORY_ID) {
      where.push(`(category_id = ? OR category_id IS NULL OR TRIM(category_id) = '')`);
      params.push(scopedCategoryId);
    } else {
      where.push('category_id = ?');
      params.push(scopedCategoryId);
    }
  }

  let sql = `SELECT channel_id, category_id, title, current_program, logo_url,
                    channel_number, stream_extension, direct_source, epg_channel_id, tone
               FROM live_search_channels
              WHERE ${where.join(' AND ')}
              ORDER BY channel_number ASC, normalized_title ASC, channel_id ASC`;
  if (limit != null) {
    sql += ' LIMIT ? OFFSET ?';
    params.push(limit, offset);
  }

  const sqliteStartedAt = Date.now();
  const rows = await db.getAll<LiveSearchCatalogRow>(sql, params);
  const sqliteMs = Date.now() - sqliteStartedAt;
  logCatalogForegroundReadIfSlow({
    purpose: 'live-published-channels',
    queueWaitMs,
    sqliteExecutionMs: sqliteMs,
    waitedOnJsQueue: writerTransactionActiveAtStart || queueWaitMs >= 50,
    writerTransactionActiveAtStart,
  });
  const pageStats = countPersistedLiveDirectSources(rows);
  const normalizeStartedAt = Date.now();
  const channels = rows.map((row, index) => publishedLiveRowToChannel(row, offset + index, {
    ...pageStats,
    publishedGeneration: pointer.generation,
  }));
  const normalizeMs = Date.now() - normalizeStartedAt;
  logLiveReadTiming({
    event: 'getPublishedLiveChannels-timing',
    providerId,
    readableGeneration: pointer.generation,
    publishedGeneration: pointer.generation,
    publishedTotal: pointer.channelCount,
    selectedCategoryId: scopedCategoryId || null,
    channelCount: channels.length,
    rowCount: channels.length,
    ...pageStats,
    stateMs,
    usedVerifiedGeneration: verifiedGeneration != null,
    sqliteMs,
    sqliteExecutionMs: sqliteMs,
    queueWaitMs,
    journalMode: getCachedCatalogJournalMode(),
    walActive: isCatalogWalActive(),
    waitedOnJsQueue: writerTransactionActiveAtStart || queueWaitMs >= 50,
    writerTransactionActiveAtStart,
    normalizeMs,
    scannedAllChannels: false,
    source: 'published-sqlite',
    elapsedMs: Date.now() - startedAt,
  });
  return channels;
  } finally {
    releaseForegroundRead();
  }
}
