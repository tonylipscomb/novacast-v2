import { novacastTrace } from '../diagnostics/novacastLogPolicy.ts';
import type { ProviderLiveCategory, ProviderLiveChannel, ProviderLiveRepository } from '../providers/providerRepositories.ts';
import { getCatalogDatabase, getCatalogReadDatabase, withCatalogTransaction } from '../catalog/catalogDatabase.ts';
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
  tone: string | null;
};

export type LiveSearchCatalogBuildResult = {
  ready: boolean;
  rebuilt: boolean;
  generation: number;
  channelCount: number;
  counts: Record<string, number>;
};

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
    `);
  })().catch((error) => {
    schemaPromise = null;
    throw error;
  });

  return schemaPromise;
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

async function readGenerationSummary(
  providerId: string,
  generation: number,
): Promise<{ channelCount: number; counts: Record<string, number> }> {
  if (generation <= 0) {
    return { channelCount: 0, counts: {} };
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
    const categoryId = row.category_id?.trim();
    if (categoryId) {
      counts[categoryId] = asNumber(row.total);
    }
  }

  return {
    channelCount: asNumber(totalRow?.total),
    counts,
  };
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
}

async function activateGeneration(providerId: string, generation: number, channelCount: number) {
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
}

function rowForChannel(
  providerId: string,
  generation: number,
  fallbackCategoryId: string,
  channel: ProviderLiveChannel,
) {
  const title = channel.name?.trim() || `Channel ${channel.id}`;
  const currentProgram = channel.current?.trim() || '';
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
    tone: channel.tone ?? null,
    updatedAt: Date.now(),
  };
}

async function writeChannelRows(
  providerId: string,
  generation: number,
  fallbackCategoryId: string,
  channels: ProviderLiveChannel[],
  seenChannelIds: Set<string>,
  counts: Record<string, number>,
) {
  const uniqueRows: ReturnType<typeof rowForChannel>[] = [];

  for (const channel of channels) {
    const channelId = channel.id?.trim();
    if (!channelId || seenChannelIds.has(channelId)) {
      continue;
    }
    seenChannelIds.add(channelId);
    const row = rowForChannel(providerId, generation, fallbackCategoryId, channel);
    uniqueRows.push(row);
    counts[row.categoryId] = (counts[row.categoryId] ?? 0) + 1;
  }

  if (!uniqueRows.length) {
    return 0;
  }

  const db = await getCatalogDatabase();
  for (let offset = 0; offset < uniqueRows.length; offset += LIVE_SEARCH_WRITE_BATCH_SIZE) {
    const batch = uniqueRows.slice(offset, offset + LIVE_SEARCH_WRITE_BATCH_SIZE);
    const placeholders = batch.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
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
        row.tone,
        row.updatedAt,
      );
    }

    await withCatalogTransaction(async () => {
      await db.run(
        `INSERT OR IGNORE INTO live_search_channels (
           provider_id, generation, channel_id, category_id,
           title, normalized_title, current_program, normalized_current,
           logo_url, channel_number, stream_extension, tone, updated_at
         ) VALUES ${placeholders}`,
        params,
      );
    });
    batch.length = 0;
    await yieldToUi(0);
  }

  const written = uniqueRows.length;
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

    await activateGeneration(providerId, generation, summary.channelCount);
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
    whereParts.push(`normalized_current LIKE ? ESCAPE '\\'`);
    whereParams.push(`%${escaped}%`);
    if (currentTokens.sql) {
      whereParts.push(currentTokens.sql);
      whereParams.push(...currentTokens.params);
    }
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
    `SELECT channel_id, category_id, title, current_program, logo_url,
            channel_number, stream_extension, tone
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
    subtitle: row.current_program || undefined,
    currentProgram: row.current_program || undefined,
    channelNumber: row.channel_number == null ? undefined : asNumber(row.channel_number),
    logoUrl: row.logo_url || undefined,
    tone: row.tone || undefined,
    categoryId: row.category_id || undefined,
    containerExtension: row.stream_extension || undefined,
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
