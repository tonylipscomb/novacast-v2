/**
 * Stage 4.2O.2 ΓÇö Series SQLite Parity.
 *
 * Local-catalog read path for Series, mirroring the Movies SQLite data
 * source (`../../movies/data/SqliteMovieDataSource.ts`) but scoped to the
 * simpler set of guarantees this stage requires: card-level browse metadata
 * only (no seasons/episodes), generation-safe reads via the shared
 * `catalogRepository`/`catalogTableRouting` pipeline, and a network-fallback
 * composite so `useSeriesScreenModel.ts`'s existing UI contract and startup
 * fast-path branching need no changes ΓÇö only the resolved `SeriesDataSource`
 * value changes.
 */

import { getCatalogReadDatabase } from '../../catalog/catalogDatabase.ts';
import {
  getCatalogCategoryCounts,
  getCatalogCategoryMetadataOnly,
  getCatalogItemsPage,
  getCatalogSeriesItem,
  getCatalogTotalCount,
  resolveReadableCatalogGeneration,
} from '../../catalog/catalogRepository.ts';
import { catalogItemsTable } from '../../catalog/catalogTableRouting.ts';
import {
  assignSeriesStreamCategoryId,
  derivedSeriesCategoryName,
  mergeSeriesMetadataWithDumpCategories,
  SERIES_UNKNOWN_CATEGORY_ID,
} from '../../providers/seriesCatalogCompletion.ts';
import { enrichAndPersistSeriesCategoryNames } from '../seriesCategoryNameEnrichment.ts';
import { isTrustworthySeriesCategoryName } from '../seriesCategoryNameResolution.ts';
import { logSeriesScreenSource } from '../seriesScreenSource.ts';
import { logSeriesDataSourceAudit } from '../seriesDataSourceAudit.ts';
import type { CatalogItemRecord } from '../../catalog/catalogTypes.ts';
import type { ContentSortOption } from '../../media-browser/contentSorting.ts';
import { mapContentSortToCatalogSort } from '../../media-browser/contentSortMapping.ts';
import type { MediaCategory, SeriesDetail, SeriesSummary } from '../../media-browser/mediaTypes.ts';
import { getOfflineSnapshot } from '../../resilience/offlineStatus.ts';
import { emitSeriesSqliteEvent } from '../seriesDiagnostics.ts';
import { repairDegradedSeriesCatalogIfNeeded } from '../seriesSparseCatalogRepair.ts';
import type { SeriesDataSource } from './SeriesDataSource.ts';

const SQLITE_SERIES_DISCOVER_ID = 'all';

async function getPublishedSeriesItemCategoryIds(
  providerId: string,
  generation: number,
): Promise<Array<{ categoryId: string; itemCount: number }>> {
  if (generation <= 0) {
    return [];
  }
  const db = await getCatalogReadDatabase();
  const rows = await db.getAll<{ category_id: string | null; item_count: number | string }>(
    `SELECT category_id, COUNT(*) AS item_count
       FROM ${catalogItemsTable('series')}
      WHERE provider_id = ? AND media_type = ? AND sync_generation = ?
      GROUP BY category_id`,
    [providerId, 'series', generation],
  );
  return rows.map((row) => ({
    categoryId: String(row.category_id ?? '').trim(),
    itemCount: Number(row.item_count) || 0,
  }));
}

/** Thrown internally to signal "no readable local generation" ΓÇö callers fall back to network. */
export class SeriesCatalogNotReadyError extends Error {
  constructor(providerId: string, generation: number) {
    super(`Series SQLite catalog not ready for provider ${providerId} (generation ${generation})`);
    this.name = 'SeriesCatalogNotReadyError';
  }
}

function mapSort(sort: ContentSortOption | undefined) {
  return mapContentSortToCatalogSort(sort);
}

function mapCatalogItemToSeries(item: CatalogItemRecord): SeriesSummary {
  const seriesId = item.seriesId ?? item.contentId;
  return {
    id: item.contentId,
    seriesId,
    categoryId: item.categoryId ?? '',
    title: item.title,
    year: item.releaseYear != null ? String(item.releaseYear) : undefined,
    rating: item.rating != null ? String(item.rating) : undefined,
    addedAt: item.addedAt ?? undefined,
    popularity: item.popularity ?? undefined,
    releaseDate: item.releaseDate ?? undefined,
    providerSortOrder: item.providerSortOrder ?? undefined,
    description: item.description ?? undefined,
    genres: [],
    posterStyleKey: 'ember',
    posterUrl: item.artworkUrl ?? undefined,
    backdropUrl: item.backdropUrl ?? undefined,
  };
}

function buildSeriesCategoriesFromMetadata(
  metadata: Array<{ categoryId: string; categoryName: string }>,
): MediaCategory[] {
  // series-no-all-category-v1
  // Provider categories only. No synthetic All Series row.
  const seenIds = new Map<string, number>();
  return metadata.map((category) => {
    const id = category.categoryId;
    const occurrence = (seenIds.get(id) ?? 0) + 1;
    seenIds.set(id, occurrence);
    const renderKey = occurrence === 1 ? id : `${id}::${occurrence}`;
    return {
      id,
      renderKey,
      name: category.categoryName,
      rawName: category.categoryName,
      count: 0,
      countKnown: false,
      kind: 'provider' as const,
      section: 'provider' as const,
    };
  });
}

export type SqliteSeriesDataSourceOptions = {
  getDetailOrigin?: () => 'browse' | 'search';
  /** search-s7-pinned-readable-generation - Navbar Search already resolved this generation. */
  searchReadableGeneration?: number;
};

/**
 * Pure-SQLite Series reads. Throws `SeriesCatalogNotReadyError` when no
 * readable local generation exists for the provider ΓÇö callers (the
 * network-fallback composite below) treat that as "use provider network".
 */
export function createSqliteSeriesDataSource(
  providerId: string,
  options?: SqliteSeriesDataSourceOptions,
): SeriesDataSource {
  logSeriesDataSourceAudit({
    event: 'sqlite-source-created',
    providerId,
    selectedSource: 'sqlite',
    sourceClass: 'SqliteSeriesDataSource',
    sqliteEnabled: true,
  });

  async function requireReadableGeneration(requestPurpose: string): Promise<number> {
    // search-s7-pinned-readable-generation
    const pinnedSearchGeneration =
      requestPurpose === 'search' ? (options?.searchReadableGeneration ?? 0) : 0;
    const generation =
      pinnedSearchGeneration > 0
        ? pinnedSearchGeneration
        : await resolveReadableCatalogGeneration(providerId, 'series');
    if (generation <= 0) {
      logSeriesDataSourceAudit({
        event: 'source-error',
        providerId,
        selectedSource: 'sqlite',
        sourceClass: 'SqliteSeriesDataSource',
        sqliteEnabled: true,
        readableGeneration: generation,
        generationStatus: 'not-readable',
        fallbackReason: `no-readable-generation:${requestPurpose}`,
        errorName: 'SeriesCatalogNotReadyError',
        errorMessage: `Series SQLite catalog not ready for provider ${providerId} (generation ${generation})`,
      });
      throw new SeriesCatalogNotReadyError(providerId, generation);
    }
    emitSeriesSqliteEvent('series_sqlite_generation_pinned', {
      providerId,
      generation,
      requestPurpose,
    });
    return generation;
  }

  async function getCategoriesImpl(): Promise<MediaCategory[]> {
    const startedAt = Date.now();
    logSeriesDataSourceAudit({
      event: 'source-getCategories-enter',
      providerId,
      selectedSource: 'sqlite',
      sourceClass: 'SqliteSeriesDataSource',
      sqliteEnabled: true,
    });
    try {
    const generation = await requireReadableGeneration('categories');

    // Backport of Stage 4.2Q's bounded sparse-Series repair.
    // Non-blocking: current metadata keeps rendering while a degraded active
    // generation schedules one fresh provider sync in the background.
    void repairDegradedSeriesCatalogIfNeeded(providerId, ({ providerId: pid }) => {
      // Dynamic import avoids a providerBundle <-> SqliteSeriesDataSource cycle.
      void import('../../providers/providerBundle.ts').then(({ getActiveRepositoryBundle }) => {
        const bundle = getActiveRepositoryBundle();
        if (!bundle || bundle.providerId !== pid) {
          return;
        }
        void bundle.syncCatalog('series-sparse-repair');
      });
    });

    // Metadata-only fast path (Stage 4.2O.2 spec #3): no per-category counts,
    // no provider calls. Counts are backfilled lazily via getCategoryCount /
    // prefetchAllCategoryCounts (mirrors Movies' getCatalogCategoryCounts
    // deferred pattern) ΓÇö called on demand by useSeriesScreenModel.
    const [metadata, itemCategories, publishedTotal] = await Promise.all([
      getCatalogCategoryMetadataOnly(providerId, 'series', { generation }),
      getPublishedSeriesItemCategoryIds(providerId, generation),
      getCatalogTotalCount(providerId, 'series', { generation }),
    ]);
    const itemCategoryIds = itemCategories.map((row) => assignSeriesStreamCategoryId(row.categoryId));
    const missingCategoryIdCount = itemCategories.filter(
      (row) => !String(row.categoryId ?? '').trim() || row.categoryId === SERIES_UNKNOWN_CATEGORY_ID,
    ).length;

    if (publishedTotal <= 0 && metadata.length === 0 && itemCategoryIds.length === 0) {
      logSeriesDataSourceAudit({
        event: 'source-error',
        providerId,
        selectedSource: 'sqlite',
        sourceClass: 'SqliteSeriesDataSource',
        sqliteEnabled: true,
        readableGeneration: generation,
        generationStatus: 'readable-but-empty',
        categoryCount: 0,
        itemCount: 0,
        fallbackReason: 'published-generation-empty',
        errorName: 'SeriesCatalogNotReadyError',
        errorMessage: 'published generation has no categories or items',
      });
      logSeriesScreenSource({
        providerId,
        source: 'published-sqlite',
        readableGeneration: generation,
        publishedTotal: 0,
        metadataCategoryCount: 0,
        publishedCategoryCount: 0,
        selectedCategoryId: null,
        loadedSeriesCount: 0,
        fallbackReason: null,
        errorReason: 'published-generation-empty',
      });
      throw new SeriesCatalogNotReadyError(providerId, generation);
    }

    const merged = mergeSeriesMetadataWithDumpCategories({
      metadata: metadata.map((category) => ({ id: category.categoryId, name: category.categoryName })),
      streamCategoryIds: itemCategoryIds,
      missingCategoryIdCount,
    });
    const metadataNames = new Map(
      merged.categories
        .filter((category) => !category.derived && isTrustworthySeriesCategoryName(category.name, category.id))
        .map((category) => [category.id, category.name]),
    );
    const enriched = await enrichAndPersistSeriesCategoryNames({
      providerId,
      generation,
      categories: merged.categories,
      metadataNames,
      persistToGeneration: generation,
    });
    const countById = new Map(
      itemCategories.map((row) => [assignSeriesStreamCategoryId(row.categoryId), row.itemCount]),
    );
    const categories = buildSeriesCategoriesFromMetadata(
      enriched.categories.map((category) => ({
        categoryId: category.id,
        categoryName: category.name || derivedSeriesCategoryName(category.id),
      })),
    ).map((category) => ({
      ...category,
      count: countById.get(category.id) ?? 0,
      countKnown: countById.has(category.id),
    }));
    logSeriesDataSourceAudit({
      event: 'source-getCategories-result',
      providerId,
      selectedSource: 'sqlite',
      sourceClass: 'SqliteSeriesDataSource',
      sqliteEnabled: true,
      readableGeneration: generation,
      generationStatus: 'readable',
      categoryCount: categories.length,
      itemCount: publishedTotal,
    });
    logSeriesScreenSource({
      providerId,
      source: 'published-sqlite',
      readableGeneration: generation,
      publishedTotal,
      metadataCategoryCount: metadata.length,
      publishedCategoryCount: categories.length,
      selectedCategoryId: null,
      loadedSeriesCount: null,
      fallbackReason: null,
      errorReason: null,
    });
    emitSeriesSqliteEvent('series_sqlite_categories_ready', {
      providerId,
      generation,
      rowCount: categories.length,
      elapsedMs: Date.now() - startedAt,
    });
    if (getOfflineSnapshot().status === 'offline') {
      emitSeriesSqliteEvent('series_sqlite_offline_startup', {
        providerId,
        generation,
        categoryCount: categories.length,
      });
    }
    return categories;
    } catch (error) {
      if (!(error instanceof SeriesCatalogNotReadyError)) {
        logSeriesDataSourceAudit({
          event: 'source-error',
          providerId,
          selectedSource: 'sqlite',
          sourceClass: 'SqliteSeriesDataSource',
          sqliteEnabled: true,
          fallbackReason: 'getCategoriesImpl',
          errorName: error instanceof Error ? error.name : typeof error,
          errorMessage: error instanceof Error ? error.message : String(error),
        });
      }
      throw error;
    }
  }

  async function getSeriesPageImpl(input: {
    categoryId: string;
    offset: number;
    limit: number;
    sort?: ContentSortOption;
  }) {
    const startedAt = Date.now();
    logSeriesDataSourceAudit({
      event: 'source-getItems-enter',
      providerId,
      selectedSource: 'sqlite',
      sourceClass: 'SqliteSeriesDataSource',
      sqliteEnabled: true,
      selectedCategoryId: input.categoryId,
    });
    const requestId = `series-sqlite-${providerId}-${startedAt}-${Math.round(Math.random() * 1e6)}`;
    const isFirstPage = input.offset === 0;
    const queryPurpose = isFirstPage ? 'startup-viewport' : 'runtime';
    const generation = await requireReadableGeneration(queryPurpose);
    const categoryId =
      input.categoryId && input.categoryId !== SQLITE_SERIES_DISCOVER_ID ? input.categoryId : undefined;

    const runQuery = (queryGeneration: number) =>
      getCatalogItemsPage({
        providerId,
        mediaType: 'series',
        categoryId,
        offset: input.offset,
        limit: input.limit,
        sort: mapSort(input.sort),
        generation: queryGeneration,
        skipTotalCount: true,
      });

    let effectiveGeneration = generation;
    let page = await runQuery(generation);
    logSeriesDataSourceAudit({
      event: 'source-getItems-result',
      providerId,
      selectedSource: 'sqlite',
      sourceClass: 'SqliteSeriesDataSource',
      sqliteEnabled: true,
      readableGeneration: effectiveGeneration,
      generationStatus: 'readable',
      itemCount: page.items.length,
      selectedCategoryId: categoryId ?? null,
    });
    logSeriesScreenSource({
      providerId,
      source: 'published-sqlite',
      readableGeneration: effectiveGeneration,
      publishedTotal: null,
      metadataCategoryCount: null,
      publishedCategoryCount: null,
      selectedCategoryId: categoryId ?? null,
      loadedSeriesCount: page.items.length,
      fallbackReason: null,
      errorReason: null,
    });

    // Stage 4.2O.2 spec #14/#15: detect a mid-flight generation promotion
    // and drop the stale-generation page rather than mixing generations ΓÇö
    // a single bounded retry re-reads at the newly-promoted generation.
    const postGeneration = await resolveReadableCatalogGeneration(providerId, 'series');
    if (postGeneration > 0 && postGeneration !== generation) {
      emitSeriesSqliteEvent('series_sqlite_stale_result_dropped', {
        providerId,
        requestedGeneration: generation,
        currentGeneration: postGeneration,
        requestId,
      });
      emitSeriesSqliteEvent('series_sqlite_generation_mismatch_blocked', {
        providerId,
        requestedGeneration: generation,
        currentGeneration: postGeneration,
        requestId,
      });
      effectiveGeneration = postGeneration;
      page = await runQuery(postGeneration);
    }

    const items = page.items.map(mapCatalogItemToSeries);
    const hasMore = page.items.length >= input.limit;
    const eventName = isFirstPage ? 'series_sqlite_first_viewport_ready' : 'series_sqlite_page_appended';
    emitSeriesSqliteEvent(eventName, {
      providerId,
      generation: effectiveGeneration,
      categoryId: categoryId ?? SQLITE_SERIES_DISCOVER_ID,
      rowCount: items.length,
      elapsedMs: Date.now() - startedAt,
      requestId,
      queryPurpose,
    });

    return {
      items,
      totalCount: page.offset + items.length + (hasMore ? 1 : 0),
      // series-total-count-exactness-v1:
      // skipTotalCount:true makes this a lower-bound pagination estimate.
      // Keep it for the page contract, but never let it replace category counts.
      totalCountIsExact: false,
      hasMore,
    };
  }

  async function searchSeriesImpl(input: { query: string; offset: number; limit: number; signal?: AbortSignal }) {
  // search-s3-cancellable-series
  if (input.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const startedAt = Date.now();
    const requestId = `series-sqlite-search-${providerId}-${startedAt}-${Math.round(Math.random() * 1e6)}`;
    const generation = await requireReadableGeneration('search');
  if (input.signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    const page = await getCatalogItemsPage({
      providerId,
      mediaType: 'series',
      query: input.query,
      offset: input.offset,
      limit: input.limit,
      sort: 'title',
      generation,
      skipTotalCount: true,
    });

    const items = page.items.map(mapCatalogItemToSeries);
    const hasMore = page.items.length >= input.limit;
    emitSeriesSqliteEvent('series_sqlite_search_completed', {
      providerId,
      generation,
      rowCount: items.length,
      elapsedMs: Date.now() - startedAt,
      requestId,
      queryLength: input.query.trim().length,
    });

    return {
      items,
      totalCount: input.offset + items.length + (hasMore ? 1 : 0),
      hasMore,
    };
  }

  return {
    async getCategories() {
      return getCategoriesImpl();
    },

    async getSeriesPage(input) {
      return getSeriesPageImpl(input);
    },

    async searchSeries(input) {
      return searchSeriesImpl(input);
    },

    async getSeriesInfo(seriesId) {
      // Stage 4.2O.2 spec #2/#11: browse SQLite is card-level only. Basic
      // metadata (title/poster/backdrop) already renders instantly from the
      // grid card; seasons/episodes remain an on-demand provider concern.
      // The network-fallback composite is responsible for real enrichment ΓÇö
      // this SQLite-only implementation returns a metadata-only shell so
      // Detail never renders fully blank while the network call is pending.
      const generation = await resolveReadableCatalogGeneration(providerId, 'series');
      if (generation <= 0) {
        return null;
      }
      const item = await getCatalogSeriesItem(providerId, seriesId, { generation });
      if (!item) {
        return null;
      }
      const detail: SeriesDetail = {
        seriesId,
        title: item.title,
        description: item.description ?? undefined,
        year: item.releaseYear != null ? String(item.releaseYear) : undefined,
        releaseDate: item.releaseDate ?? undefined,
        rating: item.rating != null ? String(item.rating) : undefined,
        genres: [],
        posterUrl: item.artworkUrl ?? undefined,
        backdropUrl: item.backdropUrl ?? undefined,
        seasons: [],
        episodesBySeason: {},
      };
      return detail;
    },

    async getCategoryCount(categoryId) {
      const generation = await requireReadableGeneration('category-count');
      if (!categoryId || categoryId === SQLITE_SERIES_DISCOVER_ID) {
        return getCatalogTotalCount(providerId, 'series', { generation });
      }
      const categories = await getCatalogCategoryCounts(providerId, 'series', { generation });
      return categories.find((category) => category.categoryId === categoryId)?.itemCount ?? 0;
    },

    async prefetchAllCategoryCounts(categoryIds, onCategoryCount) {
      const generation = await requireReadableGeneration('prefetch-counts');
      const [categories, totalCount] = await Promise.all([
        getCatalogCategoryCounts(providerId, 'series', { generation }),
        getCatalogTotalCount(providerId, 'series', { generation }),
      ]);
      const byId = new Map(categories.map((category) => [category.categoryId, category.itemCount]));
      for (const categoryId of categoryIds) {
        onCategoryCount(
          categoryId,
          categoryId === SQLITE_SERIES_DISCOVER_ID ? totalCount : byId.get(categoryId) ?? 0,
        );
      }
    },
  };
}

/**
 * Stage 4.2O.2 spec #5: SQLite-first with provider-network fallback ONLY
 * when no readable local Series generation exists. Wrapping at the
 * `SeriesDataSource` boundary means `useSeriesScreenModel.ts`'s existing
 * memory-pin -> durable-snapshot -> "network" fast-path branching is
 * unchanged ΓÇö the "network" step now transparently prefers SQLite whenever
 * a readable generation is available, and only reaches the real network
 * data source when it is not.
 */
export function createSqliteFirstSeriesDataSource(
  providerId: string,
  network: SeriesDataSource,
  options?: SqliteSeriesDataSourceOptions,
): SeriesDataSource {
  const sqlite = createSqliteSeriesDataSource(providerId, options);

  async function withSqliteOrNetwork<T>(
    sqliteCall: () => Promise<T>,
    networkCall: () => Promise<T>,
    requestName: string,
  ): Promise<T> {
    try {
      return await sqliteCall();
    } catch (error) {
      if (!(error instanceof SeriesCatalogNotReadyError)) {
        logSeriesDataSourceAudit({
          event: 'source-error',
          providerId,
          selectedSource: 'sqlite',
          sourceClass: 'SqliteFirstSeriesDataSource',
          sqliteEnabled: true,
          fallbackReason: `${requestName}:non-not-ready-error`,
          errorName: error instanceof Error ? error.name : typeof error,
          errorMessage: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
      const readableGeneration = await resolveReadableCatalogGeneration(providerId, 'series').catch(() => 0);
      if (readableGeneration > 0) {
        logSeriesDataSourceAudit({
          event: 'fallback-triggered',
          providerId,
          selectedSource: 'sqlite',
          sourceClass: 'SqliteSeriesDataSource',
          sqliteEnabled: true,
          readableGeneration,
          generationStatus: 'readable',
          fallbackReason: `${requestName}:blocked-repository-fallback-readable-generation-exists`,
          errorName: error.name,
          errorMessage: error.message,
        });
        throw error;
      }
      logSeriesDataSourceAudit({
        event: 'fallback-triggered',
        providerId,
        selectedSource: 'repository',
        sourceClass: 'ProviderSeriesDataSource',
        sqliteEnabled: true,
        readableGeneration,
        generationStatus: 'not-readable',
        fallbackReason: `${requestName}:no-readable-series-generation`,
      });
      return networkCall();
    }
  }

  return {
    getCategories() {
      return withSqliteOrNetwork(
        () => sqlite.getCategories(),
        () => {
          logSeriesScreenSource({
            providerId,
            source: 'provider-fallback',
            readableGeneration: null,
            publishedTotal: null,
            metadataCategoryCount: null,
            publishedCategoryCount: null,
            selectedCategoryId: null,
            loadedSeriesCount: null,
            fallbackReason: 'no-readable-series-generation',
            errorReason: null,
          });
          return network.getCategories();
        },
        'getCategories',
      );
    },

    getSeriesPage(input) {
      return withSqliteOrNetwork(
        () => sqlite.getSeriesPage(input),
        () => {
          logSeriesScreenSource({
            providerId,
            source: 'provider-fallback',
            readableGeneration: null,
            publishedTotal: null,
            metadataCategoryCount: null,
            publishedCategoryCount: null,
            selectedCategoryId: input.categoryId,
            loadedSeriesCount: null,
            fallbackReason: 'no-readable-series-generation',
            errorReason: null,
          });
          return network.getSeriesPage(input);
        },
        'getSeriesPage',
      );
    },

    searchSeries(input) {
      return withSqliteOrNetwork(
        () => sqlite.searchSeries!(input),
        () => (network.searchSeries ? network.searchSeries(input) : Promise.resolve({ items: [], totalCount: 0, hasMore: false })),
        'searchSeries',
      );
    },

    getSeriesInfo(seriesId) {
      // Stage 4.2O.2 spec #2/#11/#21: seasons/episodes are never stored in
      // the browse-level catalog, so full Detail enrichment always goes
      // through the existing provider path unchanged. Basic card metadata
      // (title/poster/backdrop) is already SQLite-sourced via getSeriesPage
      // and renders instantly in the popup before this resolves ΓÇö so
      // Detail already "opens from local card metadata" without this call
      // needing a local fallback. Preserving the exact existing
      // success/null/throw contract here keeps SeriesDetailPopupV2's
      // accepted scoped-error handling (Stage 4.2O.1) completely unchanged.
      return network.getSeriesInfo(seriesId);
    },

    getCategoryCount(categoryId) {
      return withSqliteOrNetwork(
        () => sqlite.getCategoryCount!(categoryId),
        () => (network.getCategoryCount ? network.getCategoryCount(categoryId) : Promise.resolve(0)),
        'getCategoryCount',
      );
    },

    prefetchAllCategoryCounts(categoryIds, onCategoryCount) {
      return withSqliteOrNetwork(
        () => sqlite.prefetchAllCategoryCounts!(categoryIds, onCategoryCount),
        () =>
          network.prefetchAllCategoryCounts
            ? network.prefetchAllCategoryCounts(categoryIds, onCategoryCount)
            : Promise.resolve(),
        'prefetchAllCategoryCounts',
      );
    },

    listCategorySeries: network.listCategorySeries?.bind(network),
    getCatalogListRequestUrl: network.getCatalogListRequestUrl?.bind(network),
  };
}
