/**
 * Stage 4.2O.2 — Series SQLite Parity.
 *
 * Local-catalog read path for Series, mirroring the Movies SQLite data
 * source (`../../movies/data/SqliteMovieDataSource.ts`) but scoped to the
 * simpler set of guarantees this stage requires: card-level browse metadata
 * only (no seasons/episodes), generation-safe reads via the shared
 * `catalogRepository`/`catalogTableRouting` pipeline, and a network-fallback
 * composite so `useSeriesScreenModel.ts`'s existing UI contract and startup
 * fast-path branching need no changes — only the resolved `SeriesDataSource`
 * value changes.
 */

import {
  getCatalogCategoryCounts,
  getCatalogCategoryMetadataOnly,
  getCatalogGenerationRowCount,
  getCatalogItemsPage,
  getCatalogSeriesItem,
  getCatalogTotalCount,
  resolveReadableCatalogGeneration,
} from '../../catalog/catalogRepository.ts';
import type { CatalogItemRecord, CatalogItemSort } from '../../catalog/catalogTypes.ts';
import type { ContentSortOption } from '../../media-browser/contentSorting.ts';
import type { MediaCategory, SeriesDetail, SeriesSummary } from '../../media-browser/mediaTypes.ts';
import { getOfflineSnapshot } from '../../resilience/offlineStatus.ts';
import { emitSeriesSqliteEvent } from '../seriesDiagnostics.ts';
import { SERIES_BROWSE_PAGE_LIMIT_MAX, SERIES_STARTUP_VIEWPORT_LIMIT } from '../seriesStartupFastPath.ts';
import { repairDegradedSeriesCatalogIfNeeded } from '../seriesSparseCatalogRepair.ts';
import type { SeriesDataSource, SeriesQueryPurpose } from './SeriesDataSource.ts';

const SQLITE_SERIES_DISCOVER_ID = 'all';

/** Thrown internally to signal "no readable local generation" — callers fall back to network. */
export class SeriesCatalogNotReadyError extends Error {
  constructor(providerId: string, generation: number) {
    super(`Series SQLite catalog not ready for provider ${providerId} (generation ${generation})`);
    this.name = 'SeriesCatalogNotReadyError';
  }
}

function mapSort(sort: ContentSortOption | undefined): CatalogItemSort {
  switch (sort) {
    case 'oldest':
      return 'oldest';
    case 'title-desc':
      return 'title-desc';
    case 'rating-desc':
      return 'rating';
    case 'popularity-desc':
    case 'recently-added':
      return 'provider';
    case 'title-asc':
      return 'title';
    case 'newest':
    default:
      return 'newest';
  }
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
    releaseDate: item.releaseDate ?? undefined,
    description: item.description ?? undefined,
    genres: [],
    posterStyleKey: 'ember',
    posterUrl: item.artworkUrl ?? undefined,
    backdropUrl: item.backdropUrl ?? undefined,
  };
}

function buildSeriesCategoriesFromMetadata(
  metadata: Array<{ categoryId: string; categoryName: string }>,
  totalCount: number,
): MediaCategory[] {
  const seenIds = new Map<string, number>();
  const providerCategories: MediaCategory[] = metadata.map((category) => {
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

  return [
    {
      id: SQLITE_SERIES_DISCOVER_ID,
      renderKey: SQLITE_SERIES_DISCOVER_ID,
      name: 'All Series',
      count: totalCount,
      countKnown: totalCount > 0,
      kind: 'provider' as const,
      section: 'provider' as const,
    },
    ...providerCategories,
  ];
}

export type SqliteSeriesDataSourceOptions = {
  getDetailOrigin?: () => 'browse' | 'search';
};

/**
 * Pure-SQLite Series reads. Throws `SeriesCatalogNotReadyError` when no
 * readable local generation exists for the provider — callers (the
 * network-fallback composite below) treat that as "use provider network".
 */
export function createSqliteSeriesDataSource(
  providerId: string,
  _options?: SqliteSeriesDataSourceOptions,
): SeriesDataSource {
  async function requireReadableGeneration(requestPurpose: string): Promise<number> {
    const generation = await resolveReadableCatalogGeneration(providerId, 'series');
    if (generation <= 0) {
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
    const generation = await requireReadableGeneration('categories');

    // Stage 4.2Q: runtime degraded-catalog repair, mirroring Movies'
    // `repairDegradedMoviesCatalogIfNeeded` (`SqliteMovieDataSource.ts`).
    // Best-effort/non-blocking for the actual category read below — Series'
    // simpler getCategoriesImpl has no readiness/pinning state to preserve
    // the way Movies does, so this only detects an already-active sparse
    // generation and schedules (at most once per generation) a background
    // full resync; it never blanks or delays the metadata already being
    // served, and never awaits the result.
    void repairDegradedSeriesCatalogIfNeeded(providerId, ({ providerId: pid }) => {
      // Dynamic import: providerBundle.ts imports this module (for
      // createSqliteFirstSeriesDataSource), so a static import here would
      // create a cycle. Movies avoids this only because SqliteMovieDataSource.ts
      // isn't itself imported by providerBundle.ts.
      void import('../../providers/providerBundle.ts').then(({ getActiveRepositoryBundle }) => {
        const bundle = getActiveRepositoryBundle();
        if (!bundle || bundle.providerId !== pid) {
          return;
        }
        void bundle.syncCatalog();
      });
    });

    // Metadata-only fast path (Stage 4.2O.2 spec #3): no per-category counts,
    // no provider calls. Counts are backfilled lazily via getCategoryCount /
    // prefetchAllCategoryCounts (mirrors Movies' getCatalogCategoryCounts
    // deferred pattern) — called on demand by useSeriesScreenModel.
    const [metadata, totalCount] = await Promise.all([
      getCatalogCategoryMetadataOnly(providerId, 'series', { generation }),
      getCatalogGenerationRowCount(providerId, 'series', generation),
    ]);

    if (metadata.length === 0) {
      // No readable category rows yet at this generation — let the caller
      // fall back to network rather than showing an empty rail.
      throw new SeriesCatalogNotReadyError(providerId, generation);
    }

    const categories = buildSeriesCategoriesFromMetadata(metadata, totalCount);
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
  }

  async function getSeriesPageImpl(input: {
    categoryId: string;
    offset: number;
    limit: number;
    sort?: ContentSortOption;
    queryPurpose?: SeriesQueryPurpose;
  }) {
    const startedAt = Date.now();
    const requestId = `series-sqlite-${providerId}-${startedAt}-${Math.round(Math.random() * 1e6)}`;
    const isFirstPage = input.offset === 0;
    // Stage 4.2P #7: the caller (useSeriesScreenModel.ts) states the real
    // query purpose explicitly — never re-derived from `offset`, which
    // previously mislabeled post-interactive category switches (offset 0,
    // after startup) as 'startup-viewport'. A missing purpose falls back to
    // the offset-based guess only for callers that predate this stage.
    const queryPurpose: SeriesQueryPurpose =
      input.queryPurpose ?? (isFirstPage ? 'startup-viewport' : 'pagination');
    const generation = await requireReadableGeneration(queryPurpose);
    const categoryId =
      input.categoryId && input.categoryId !== SQLITE_SERIES_DISCOVER_ID ? input.categoryId : undefined;
    // Stage 4.2P #8: defensive clamp against an accidentally huge caller
    // limit. Never affects Search (searchSeriesImpl has its own limit path)
    // and never affects generation refresh ingestion (a separate writer
    // pipeline that never calls getSeriesPageImpl).
    // Stage 4.2Q: the startup-viewport purpose additionally uses
    // `SERIES_STARTUP_VIEWPORT_LIMIT` as its ceiling instead of the wider
    // `SERIES_BROWSE_PAGE_LIMIT_MAX`, mirroring Movies' DS-level clamp
    // (`Math.min(input.limit, MOVIES_STARTUP_VIEWPORT_LIMIT)` in
    // `SqliteMovieDataSource.ts`). The caller (useSeriesScreenModel.ts)
    // already requests <= SERIES_STARTUP_VIEWPORT_LIMIT rows for the startup
    // viewport, so this only ever engages as defense-in-depth. Runtime
    // pagination is unaffected — it keeps the wider ceiling.
    const purposeLimitCeiling =
      queryPurpose === 'startup-viewport' ? SERIES_STARTUP_VIEWPORT_LIMIT : SERIES_BROWSE_PAGE_LIMIT_MAX;
    const clampedLimit = Math.min(Math.max(input.limit, 1), purposeLimitCeiling);

    const runQuery = (queryGeneration: number) =>
      getCatalogItemsPage({
        providerId,
        mediaType: 'series',
        categoryId,
        offset: input.offset,
        limit: clampedLimit,
        sort: mapSort(input.sort),
        generation: queryGeneration,
        skipTotalCount: true,
      });

    let effectiveGeneration = generation;
    let page = await runQuery(generation);

    // Stage 4.2O.2 spec #14/#15: detect a mid-flight generation promotion
    // and drop the stale-generation page rather than mixing generations —
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
    const hasMore = page.items.length >= clampedLimit;
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
      hasMore,
    };
  }

  async function searchSeriesImpl(input: { query: string; offset: number; limit: number }) {
    const startedAt = Date.now();
    const requestId = `series-sqlite-search-${providerId}-${startedAt}-${Math.round(Math.random() * 1e6)}`;
    const generation = await requireReadableGeneration('search');

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
    sourceKind: 'sqlite',

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
      // The network-fallback composite is responsible for real enrichment —
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

    async getReadableGeneration() {
      // Stage 4.2P #1/#3: cheap probe (no category/row work) — used only to
      // validate a warm durable snapshot before deciding whether the full
      // getCategories() reconciliation pass can be skipped.
      return resolveReadableCatalogGeneration(providerId, 'series');
    },
  };
}

/**
 * Stage 4.2O.2 spec #5: SQLite-first with provider-network fallback ONLY
 * when no readable local Series generation exists. Wrapping at the
 * `SeriesDataSource` boundary means `useSeriesScreenModel.ts`'s existing
 * memory-pin -> durable-snapshot -> "network" fast-path branching is
 * unchanged — the "network" step now transparently prefers SQLite whenever
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
  ): Promise<T> {
    try {
      return await sqliteCall();
    } catch (error) {
      if (!(error instanceof SeriesCatalogNotReadyError)) {
        throw error;
      }
      return networkCall();
    }
  }

  return {
    // Stage 4.2Q: this composite is SQLite-first — it only falls back to
    // `network` when the SQLite side has no readable generation at all
    // (`SeriesCatalogNotReadyError`), never on a legitimate zero-hit SQLite
    // result. Marking it 'sqlite' lets `SmartSeriesDataSource`/
    // `seriesSearchRepository.ts` apply the same "SQLite is authoritative"
    // policy Movies already has.
    sourceKind: 'sqlite',

    getCategories() {
      return withSqliteOrNetwork(
        () => sqlite.getCategories(),
        () => network.getCategories(),
      );
    },

    getSeriesPage(input) {
      return withSqliteOrNetwork(
        () => sqlite.getSeriesPage(input),
        () => network.getSeriesPage(input),
      );
    },

    searchSeries(input) {
      return withSqliteOrNetwork(
        () => sqlite.searchSeries!(input),
        () => (network.searchSeries ? network.searchSeries(input) : Promise.resolve({ items: [], totalCount: 0, hasMore: false })),
      );
    },

    getSeriesInfo(seriesId) {
      // Stage 4.2O.2 spec #2/#11/#21: seasons/episodes are never stored in
      // the browse-level catalog, so full Detail enrichment always goes
      // through the existing provider path unchanged. Basic card metadata
      // (title/poster/backdrop) is already SQLite-sourced via getSeriesPage
      // and renders instantly in the popup before this resolves — so
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
      );
    },

    prefetchAllCategoryCounts(categoryIds, onCategoryCount) {
      return withSqliteOrNetwork(
        () => sqlite.prefetchAllCategoryCounts!(categoryIds, onCategoryCount),
        () =>
          network.prefetchAllCategoryCounts
            ? network.prefetchAllCategoryCounts(categoryIds, onCategoryCount)
            : Promise.resolve(),
      );
    },

    // Stage 4.2P #1/#3: always local-only (no network fallback) — a missing
    // readable generation (0) is itself a meaningful "cannot short-circuit"
    // signal, not an error condition that should fall through to network.
    getReadableGeneration() {
      return sqlite.getReadableGeneration!();
    },

    listCategorySeries: network.listCategorySeries?.bind(network),
    getCatalogListRequestUrl: network.getCatalogListRequestUrl?.bind(network),
  };
}
