import {
  getCatalogCategoryCounts,
  getCatalogDiagnosticSnapshot,
  getCatalogItemsPage,
  getCatalogMovieItem,
  getCatalogTotalCount,
  resolveReadableCatalogGeneration,
} from '../../catalog/catalogRepository.ts';
import { recoverFragmentedMovieCatalogOnce } from '../../catalog/catalogFragmentRecovery.ts';
import type { CatalogItemRecord, CatalogItemSort } from '../../catalog/catalogTypes.ts';
import type { ContentSortOption } from '../../media-browser/contentSorting.ts';
import type { MediaDetail } from '../../media-browser/mediaTypes.ts';
import { getActiveRepositoryBundle } from '../../providers/providerBundle.ts';
import { publishMovieCatalogReady } from '../../providers/providerCatalogSync.ts';

import type { MovieDataSource } from './MovieDataSource.ts';
import type { MovieCategory, MovieSummary } from '../movieTypes.ts';
import {
  logMoviesCatalogReadiness,
  MoviesCatalogNotReadyError,
  resolveMoviesCatalogReadiness,
} from '../moviesCatalogReadiness.ts';
import {
  buildMoviesCatalogReadSnapshot,
  filterInteractiveMovieCategories,
  isAlignedMoviesCatalogReadSnapshot,
  logMoviesCatalogReadSnapshot,
  type MoviesCatalogReadSnapshot,
} from '../moviesCatalogReadSnapshot.ts';
import {
  clearMoviesSparseRepairSchedule,
  repairDegradedMoviesCatalogIfNeeded,
} from '../moviesSparseCatalogRepair.ts';
import {
  buildLocalMovieDetailFromCatalogItem,
  getCachedProviderMovieInfo,
  isLocalMovieDetailComplete,
  logMovieDetailEnrichment,
  mergeLocalAndProviderMovieDetail,
  normalizeDetailContainerExtension,
  setCachedProviderMovieInfo,
  type MovieDetailEnrichmentOrigin,
} from '../movieDetailEnrichment.ts';

const SQLITE_MOVIES_DISCOVER_ID = 'all';
const SQLITE_MOVIES_DIAGNOSTICS_ENABLED =
  process.env.EXPO_PUBLIC_MOVIES_SQLITE_DIAGNOSTICS === 'true';

async function logSqliteMovieDiagnostic(providerId: string, phase: string) {
  if (!SQLITE_MOVIES_DIAGNOSTICS_ENABLED) {
    return;
  }

  try {
    const snapshot = await getCatalogDiagnosticSnapshot(providerId, 'movie');
    console.info(
      '[Movies SQLite Diagnostic]',
      JSON.stringify({ phase, ...snapshot }),
    );
  } catch (error) {
    console.info(
      '[Movies SQLite Diagnostic]',
      JSON.stringify({
        phase,
        diagnosticError: error instanceof Error ? error.message : String(error),
      }),
    );
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
      // SQLite schema does not yet retain popularity or provider-added timestamps.
      // Preserve deterministic provider ordering until those fields are added.
      return 'provider';
    case 'title-asc':
      return 'title';
    case 'newest':
    default:
      return 'newest';
  }
}

function mapCatalogItemToMovie(item: CatalogItemRecord): MovieSummary {
  return {
    id: item.contentId,
    categoryId: item.categoryId ?? '',
    title: item.title,
    year: item.releaseYear ?? undefined,
    releaseDate: item.releaseDate ?? undefined,
    rating: item.rating == null ? undefined : String(item.rating),
    genres: ['Movies'],
    description: item.description ?? undefined,
    score: item.rating ?? undefined,
    posterStyleKey: 'ember',
    posterUrl: item.artworkUrl ?? undefined,
    containerExtension: item.streamExtension ?? undefined,
    providerSortOrder: item.providerSortOrder ?? undefined,
  };
}

export async function isSqliteMovieCatalogReady(providerId: string): Promise<boolean> {
  await logSqliteMovieDiagnostic(providerId, 'readiness-check');
  const generation = await resolveReadableCatalogGeneration(providerId, 'movie');
  if (generation <= 0) {
    return false;
  }

  const totalCount = await getCatalogTotalCount(providerId, 'movie', {
    generation,
  });
  return totalCount > 0;
}

type CachedSqliteCategories = {
  generation: number;
  categories: MovieCategory[];
  totalCount: number;
  snapshot: MoviesCatalogReadSnapshot;
};

const lastValidSqliteCategoriesByProvider = new Map<string, CachedSqliteCategories>();

export function resetLastValidSqliteMovieCategoriesForTests() {
  lastValidSqliteCategoriesByProvider.clear();
}

export function getLastValidMoviesCatalogReadSnapshotForTests(providerId: string) {
  return lastValidSqliteCategoriesByProvider.get(providerId)?.snapshot ?? null;
}

export type SqliteMovieDataSourceOptions = {
  /** Controlled VOD-info fallback. Must not be provider search. */
  fetchProviderMovieInfo?: (movieId: string) => Promise<MediaDetail | null>;
  /** Browse vs Search origin for enrichment diagnostics. */
  getDetailOrigin?: () => MovieDetailEnrichmentOrigin;
};

export function createSqliteMovieDataSource(
  providerId: string,
  options?: SqliteMovieDataSourceOptions,
): MovieDataSource {
  const localDetailByMovieId = new Map<string, MediaDetail>();

  async function loadLocalMovieDetail(movieId: string): Promise<MediaDetail | null> {
    const readableGeneration = await resolveReadableCatalogGeneration(providerId, 'movie');
    const item = await getCatalogMovieItem(providerId, movieId, {
      generation: readableGeneration,
    });
    if (!item) {
      return null;
    }
    const detail = buildLocalMovieDetailFromCatalogItem(item, movieId);
    localDetailByMovieId.set(movieId, detail);
    return detail;
  }

  return {
    sourceKind: 'sqlite',

    async getCategories(): Promise<MovieCategory[]> {
      await logSqliteMovieDiagnostic(providerId, 'get-categories-before-query');
      // Stage 3C: one-time merge of verified legacy fragments into generation-safe v2.
      const recovery = await recoverFragmentedMovieCatalogOnce(providerId);
      if (recovery.activated && recovery.recoveredGeneration != null) {
        publishMovieCatalogReady(providerId, recovery.recoveredGeneration);
      }

      const readiness = await resolveMoviesCatalogReadiness(providerId);
      logMoviesCatalogReadiness(readiness);

      // Stage 4.2E: interactive rail is always pinned to the readable item generation.
      // Never surface syncing category metadata (readiness.categoriesGeneration may be ahead).
      const readableGeneration = readiness.readableItemGeneration;
      const itemsGeneration = readableGeneration;
      const categoriesGeneration = readableGeneration;
      const previous = lastValidSqliteCategoriesByProvider.get(providerId);

      // Stage 4.2D/E: active sparse generation must not stay interactive while repairing.
      if (itemsGeneration > 0 && readiness.decision !== 'waiting-fresh-sync') {
        const repairStatus = await repairDegradedMoviesCatalogIfNeeded(providerId, ({ providerId: pid }) => {
          const bundle = getActiveRepositoryBundle();
          if (!bundle || bundle.providerId !== pid) {
            return;
          }
          void bundle.syncCatalog();
        });
        if (repairStatus === 'repairing') {
          lastValidSqliteCategoriesByProvider.delete(providerId);
          console.info(
            '[NovaCast Movies Category Contract] ' +
              JSON.stringify({
                providerId,
                readableGeneration,
                categoriesGeneration,
                itemsGeneration,
                repositoryCategoryCount: readiness.categoryCount,
                sqliteProviderCategoryCount: 0,
                wrappedCategoryCount: 0,
                appliedProviderCategoryCount: 0,
                totalMovieCount: readiness.readableItemCount,
                firstProviderCategoryIds: [],
                reason: 'repairing-sparse-generation',
              }),
          );
          return [];
        }
        if (repairStatus === 'healthy') {
          clearMoviesSparseRepairSchedule(providerId);
        }
      }

      // Fresh install / no readable item generation: do not expose in-progress
      // category metadata as a usable rail (Stage 4.2A readiness barrier).
      if (readiness.decision === 'waiting-fresh-sync') {
        console.info(
          '[NovaCast Movies Category Contract] ' +
            JSON.stringify({
              providerId,
              readableGeneration,
              categoriesGeneration,
              itemsGeneration,
              repositoryCategoryCount: readiness.categoryCount,
              sqliteProviderCategoryCount: 0,
              wrappedCategoryCount: 0,
              appliedProviderCategoryCount: 0,
              totalMovieCount: 0,
              firstProviderCategoryIds: [],
              reason: 'waiting-fresh-sync-categories-pending',
            }),
        );
        console.info(
          '[NovaCast Movies Read Contract] ' +
            JSON.stringify({
              providerId,
              readableGeneration,
              requestedCategoryId: null,
              itemsGeneration,
              categoriesGeneration,
              pageOffset: null,
              pageLimit: null,
              pageRowCount: null,
              totalCount: 0,
              providerCategoryCount: 0,
              reason: 'category-item-readiness-barrier',
              generationAligned: true,
            }),
        );
        return [];
      }

      // Refresh path: keep the last valid completed rail while a newer generation syncs.
      // Pin reported generations to the preserved readable generation (not syncing N+1).
      if (
        readiness.decision === 'preserving-completed-generation' &&
        previous &&
        previous.generation === itemsGeneration &&
        previous.categories.length > 0
      ) {
        const preserved = filterInteractiveMovieCategories(previous.categories);
        const preservedSnapshot =
          previous.snapshot && isAlignedMoviesCatalogReadSnapshot(previous.snapshot)
            ? { ...previous.snapshot, categories: preserved }
            : buildMoviesCatalogReadSnapshot({
                providerId,
                readableGeneration: itemsGeneration,
                categories: preserved,
                metadataCategoryCount: previous.snapshot?.metadataCategoryCount ?? preserved.length,
                groupedCountRows: previous.snapshot?.groupedCountRows ?? preserved.filter((c) => c.id !== SQLITE_MOVIES_DISCOVER_ID).length,
                totalMovieCount: previous.totalCount,
              });
        logMoviesCatalogReadSnapshot(preservedSnapshot, 'preserving-completed-generation');
        console.info(
          '[NovaCast Movies Category Contract] ' +
            JSON.stringify({
              providerId,
              readableGeneration: itemsGeneration,
              categoriesGeneration: itemsGeneration,
              itemsGeneration,
              syncingCategoryGeneration: readiness.categoriesGeneration,
              repositoryCategoryCount: preserved.length,
              sqliteProviderCategoryCount: preserved.filter(
                (category) => category.id !== SQLITE_MOVIES_DISCOVER_ID,
              ).length,
              wrappedCategoryCount: preserved.length,
              appliedProviderCategoryCount: preserved.filter(
                (category) => category.id !== SQLITE_MOVIES_DISCOVER_ID,
              ).length,
              totalMovieCount: previous.totalCount,
              firstProviderCategoryIds: preserved
                .filter((category) => category.id !== SQLITE_MOVIES_DISCOVER_ID)
                .slice(0, 5)
                .map((category) => category.id),
              reason: 'preserving-completed-generation',
              generationAligned: true,
            }),
        );
        return preserved;
      }

      // Always read category metadata + counts from the readable *item* generation.
      const categoryReadGeneration = itemsGeneration;

      const [categories, totalCountRaw] = await Promise.all([
        getCatalogCategoryCounts(providerId, 'movie', {
          generation: categoryReadGeneration,
          includeZeroCountCategories: true,
        }),
        getCatalogTotalCount(providerId, 'movie', { generation: itemsGeneration }),
      ]);
      const totalCount = totalCountRaw;

      const normalizedCategories = categories.filter(
        (category) => category.categoryId.trim() && category.categoryName.trim(),
      );
      const metadataCategoryCount = normalizedCategories.length;
      const groupedCountRows = normalizedCategories.filter((category) => category.itemCount > 0).length;
      const zeroCountCategoryCount = metadataCategoryCount - groupedCountRows;

      const previousProviderCount = previous
        ? previous.categories.filter((category) => category.id !== SQLITE_MOVIES_DISCOVER_ID).length
        : 0;
      const nonzeroCategoryCount = groupedCountRows;
      const refreshLooksEmpty =
        totalCount > 0 &&
        nonzeroCategoryCount === 0 &&
        Boolean(previous && previous.categories.length > 0 && previous.totalCount > 0);
      // Reject last-write-wins collapse (e.g. hundreds of categories → only UFC Arabia).
      const refreshLooksCollapsed =
        Boolean(previous && previousProviderCount >= 8) &&
        totalCount > 0 &&
        nonzeroCategoryCount > 0 &&
        nonzeroCategoryCount <= 2 &&
        nonzeroCategoryCount < previousProviderCount * 0.25;

      // Empty/collapse rejection only applies once item rows are readable.
      if (itemsGeneration > 0 && (refreshLooksEmpty || refreshLooksCollapsed) && previous) {
        console.info(
          '[NovaCast Movies Category Counts Applied] ' +
            JSON.stringify({
              readableGeneration: itemsGeneration,
              categoriesGeneration: itemsGeneration,
              itemsGeneration,
              generationAligned: true,
              metadataCategoryCount,
              groupedCountRows,
              nonzeroCategoryCount,
              zeroCountCategoryCount,
              appliedProviderCategoryCount: previousProviderCount,
              interactiveCategoryCount: previousProviderCount,
              preservedPreviousCounts: true,
              reason: refreshLooksCollapsed ? 'rejected-collapsed-refresh' : 'rejected-empty-refresh',
              previousGeneration: previous.generation,
              previousTotalCount: previous.totalCount,
            }),
        );
        console.info(
          '[NovaCast Movies Category Refresh Rejected] ' +
            JSON.stringify({
              readableGeneration: itemsGeneration,
              categoriesGeneration: itemsGeneration,
              itemsGeneration,
              previousProviderCount,
              nextProviderCount: nonzeroCategoryCount,
              previousTotal: previous.totalCount,
              nextTotal: totalCount,
              reason: refreshLooksCollapsed
                ? 'collapsed-provider-rail'
                : 'empty-grouped-counts-with-rows',
            }),
        );
        return filterInteractiveMovieCategories(previous.categories);
      }

      if (!normalizedCategories.length) {
        if (previous && previous.categories.length > 0 && previous.totalCount > 0) {
          return filterInteractiveMovieCategories(previous.categories);
        }
        console.info(
          '[NovaCast Movies Category Contract] ' +
            JSON.stringify({
              providerId,
              readableGeneration: itemsGeneration,
              categoriesGeneration: itemsGeneration,
              itemsGeneration,
              repositoryCategoryCount: 0,
              sqliteProviderCategoryCount: 0,
              wrappedCategoryCount: 0,
              appliedProviderCategoryCount: 0,
              totalMovieCount: totalCount,
              firstProviderCategoryIds: [],
              reason: 'no-readable-category-generation',
            }),
        );
        console.info(
          '[NovaCast Movies Read Contract] ' +
            JSON.stringify({
              providerId,
              readableGeneration: itemsGeneration,
              requestedCategoryId: null,
              itemsGeneration,
              categoriesGeneration: itemsGeneration,
              pageOffset: null,
              pageLimit: null,
              pageRowCount: null,
              totalCount,
              providerCategoryCount: 0,
              reason: 'category-item-readiness-barrier',
              generationAligned: true,
            }),
        );
        return [];
      }

      const seenIds = new Map<string, number>();
      const providerCategories: MovieCategory[] = normalizedCategories.map((category) => {
        const id = category.categoryId;
        const occurrence = (seenIds.get(id) ?? 0) + 1;
        seenIds.set(id, occurrence);
        const renderKey = occurrence === 1 ? id : `${id}::${occurrence}`;
        if (occurrence > 1) {
          console.info(
            '[NovaCast Movies Category Duplicate] ' +
              JSON.stringify({
                providerId,
                categoryId: id,
                renderKey,
                occurrence,
              }),
          );
        }
        return {
          id,
          renderKey,
          name: category.categoryName,
          rawName: category.categoryName,
          count: category.itemCount,
          countKnown: true,
          kind: 'provider' as const,
          section: 'provider' as const,
        };
      });

      const nextCategoriesRaw: MovieCategory[] = [
        {
          id: SQLITE_MOVIES_DISCOVER_ID,
          renderKey: SQLITE_MOVIES_DISCOVER_ID,
          name: 'All Movies',
          count: totalCount,
          countKnown: true,
          kind: 'provider',
          section: 'provider',
        },
        ...providerCategories,
      ];

      // Stage 4.2E: hide known-zero provider categories from the interactive rail.
      const nextCategories = filterInteractiveMovieCategories(nextCategoriesRaw);
      const interactiveProvider = nextCategories.filter(
        (category) => category.id !== SQLITE_MOVIES_DISCOVER_ID,
      );

      const snapshot = buildMoviesCatalogReadSnapshot({
        providerId,
        readableGeneration: categoryReadGeneration,
        categories: nextCategories,
        metadataCategoryCount,
        groupedCountRows,
        totalMovieCount: totalCount,
      });
      if (!snapshot.generationAligned) {
        console.info(
          '[NovaCast Movies Read Snapshot] ' +
            JSON.stringify({
              providerId,
              reason: 'snapshot-generation-misaligned-retry',
              readableGeneration: snapshot.readableGeneration,
              categoriesGeneration: snapshot.categoriesGeneration,
              itemsGeneration: snapshot.itemsGeneration,
              marker: 'stage4e-atomic-generation-pinning-v1',
            }),
        );
        if (previous && previous.categories.length > 0) {
          return filterInteractiveMovieCategories(previous.categories);
        }
      }

      lastValidSqliteCategoriesByProvider.set(providerId, {
        generation: categoryReadGeneration,
        categories: nextCategories,
        totalCount,
        snapshot,
      });

      logMoviesCatalogReadSnapshot(snapshot, 'provider-categories-applied');
      console.info(
        '[NovaCast Movies Category Contract] ' +
          JSON.stringify({
            providerId,
            readableGeneration: itemsGeneration,
            categoriesGeneration: itemsGeneration,
            itemsGeneration,
            syncingCategoryGeneration: readiness.categoriesGeneration,
            repositoryCategoryCount: metadataCategoryCount,
            sqliteProviderCategoryCount: interactiveProvider.length,
            wrappedCategoryCount: nextCategories.length,
            appliedProviderCategoryCount: interactiveProvider.length,
            totalMovieCount: totalCount,
            firstProviderCategoryIds: interactiveProvider.slice(0, 5).map((category) => category.id),
            reason: 'provider-categories-applied',
            generationAligned: true,
          }),
      );
      console.info(
        '[NovaCast Movies Read Contract] ' +
          JSON.stringify({
            providerId,
            readableGeneration: itemsGeneration,
            requestedCategoryId: null,
            itemsGeneration,
            categoriesGeneration: itemsGeneration,
            pageOffset: null,
            pageLimit: null,
            pageRowCount: null,
            totalCount,
            providerCategoryCount: interactiveProvider.length,
            reason: 'category-item-readiness-barrier',
            generationAligned: true,
          }),
      );
      console.info(
        '[NovaCast Movies Category Counts Applied] ' +
          JSON.stringify({
            readableGeneration: itemsGeneration,
            categoriesGeneration: itemsGeneration,
            itemsGeneration,
            generationAligned: true,
            metadataCategoryCount,
            groupedCountRows,
            nonzeroCategoryCount,
            zeroCountCategoryCount,
            interactiveCategoryCount: interactiveProvider.length,
            appliedProviderCategoryCount: interactiveProvider.length,
            preservedPreviousCounts: false,
            allMoviesTotal: totalCount,
            firstCounts: interactiveProvider.slice(0, 5).map((category) => ({
              categoryId: category.id,
              itemCount: category.count,
            })),
            reason: 'grouped-counts-applied',
          }),
      );

      return nextCategories;
    },

    async getMoviesPage(input) {
      const readableGeneration = await resolveReadableCatalogGeneration(providerId, 'movie');
      if (readableGeneration <= 0) {
        throw new MoviesCatalogNotReadyError(providerId, readableGeneration);
      }

      // Prefer the pinned interactive snapshot generation while a newer sync is writing.
      const pinned = lastValidSqliteCategoriesByProvider.get(providerId);
      const itemsGeneration =
        pinned &&
        pinned.generation > 0 &&
        pinned.generation === readableGeneration
          ? pinned.generation
          : readableGeneration;

      const categoryId =
        input.categoryId && input.categoryId !== SQLITE_MOVIES_DISCOVER_ID
          ? input.categoryId
          : undefined;

      const page = await getCatalogItemsPage({
        providerId,
        mediaType: 'movie',
        categoryId,
        offset: input.offset,
        limit: input.limit,
        sort: mapSort(input.sort),
        generation: itemsGeneration,
      });

      await logSqliteMovieDiagnostic(providerId, 'first-page-after-query');
      console.info('[Movies SQLite] first-page', {
        providerId,
        categoryId: categoryId ?? SQLITE_MOVIES_DISCOVER_ID,
        offset: page.offset,
        itemCount: page.items.length,
        totalCount: page.totalCount,
        generation: itemsGeneration,
        readableGeneration,
        categoriesGeneration: itemsGeneration,
        itemsGeneration,
        generationAligned: itemsGeneration === readableGeneration,
        marker: 'stage4e-atomic-generation-pinning-v1',
      });

      return {
        items: page.items.map(mapCatalogItemToMovie),
        totalCount: page.totalCount,
        hasMore: page.hasMore,
      };
    },

    async searchMovies(input) {
      const startedAt = Date.now();
      const page = await getCatalogItemsPage({
        providerId,
        mediaType: 'movie',
        query: input.query,
        offset: input.offset,
        limit: input.limit,
        sort: 'title',
        // Stage 3G: first page must not wait on a full-generation COUNT.
        skipTotalCount: true,
      });
      const sqliteMs = Date.now() - startedAt;
      const mappingStartedAt = Date.now();
      const items = page.items.map(mapCatalogItemToMovie);
      const mappingMs = Date.now() - mappingStartedAt;
      const hasMore = page.items.length >= input.limit;

      console.info('[Movies SQLite] search', {
        providerId,
        queryLength: input.query.trim().length,
        offset: page.offset,
        itemCount: page.items.length,
        totalCount: page.totalCount,
        hasMore,
        sqliteMs,
        mappingMs,
        skipTotalCount: true,
        marker: 'stage3g-sqlite-movies-search-v1',
      });

      try {
        const { getActiveMoviesSearchRequestId, markMoviesSearchPath } = await import(
          '@/features/search/moviesSearchPerfDiagnostics'
        );
        markMoviesSearchPath(getActiveMoviesSearchRequestId(), 'sqlite', { sqliteMs, mappingMs });
      } catch {
        // Diagnostics must never fail search.
      }

      return {
        items,
        // Approximate until a later COUNT; enough for "N+ results" / hasMore paging.
        totalCount: input.offset + items.length + (hasMore ? 1 : 0),
        hasMore,
      };
    },

    async getMovieInfo(movieId) {
      const origin = options?.getDetailOrigin?.() ?? 'browse';
      const local = await loadLocalMovieDetail(movieId);
      const localExtensionPresent = Boolean(
        normalizeDetailContainerExtension(local?.containerExtension),
      );

      if (!local) {
        logMovieDetailEnrichment({
          origin,
          movieId,
          localRowFound: false,
          localExtensionPresent: false,
          providerInfoRequested: false,
          providerInfoSucceeded: false,
          providerExtensionPresent: false,
          resolvedExtensionSource: 'none',
          detailMode: 'preview-fallback',
          failureReason: 'local-row-not-found',
        });
        return null;
      }

      const complete = isLocalMovieDetailComplete(local);
      logMovieDetailEnrichment({
        origin,
        movieId,
        localRowFound: true,
        localExtensionPresent,
        providerInfoRequested: false,
        providerInfoSucceeded: false,
        providerExtensionPresent: false,
        resolvedExtensionSource: localExtensionPresent ? 'catalog' : 'none',
        detailMode: complete ? 'local-complete' : 'local-preview-enriching',
        failureReason: null,
      });
      return local;
    },

    async enrichMovieInfo(movieId) {
      const origin = options?.getDetailOrigin?.() ?? 'browse';
      const local =
        localDetailByMovieId.get(movieId) ?? (await loadLocalMovieDetail(movieId));
      if (!local) {
        logMovieDetailEnrichment({
          origin,
          movieId,
          localRowFound: false,
          localExtensionPresent: false,
          providerInfoRequested: false,
          providerInfoSucceeded: false,
          providerExtensionPresent: false,
          resolvedExtensionSource: 'none',
          detailMode: 'preview-fallback',
          failureReason: 'local-row-not-found',
        });
        return null;
      }

      const localExtensionPresent = Boolean(
        normalizeDetailContainerExtension(local.containerExtension),
      );

      if (isLocalMovieDetailComplete(local) && !options?.fetchProviderMovieInfo) {
        return local;
      }

      // Still enrich incomplete locals, or prefer cached provider info when reopening.
      const cached = getCachedProviderMovieInfo(providerId, movieId);
      if (cached) {
        const merged = mergeLocalAndProviderMovieDetail(local, cached);
        localDetailByMovieId.set(movieId, merged.detail);
        logMovieDetailEnrichment({
          origin,
          movieId,
          localRowFound: true,
          localExtensionPresent,
          providerInfoRequested: false,
          providerInfoSucceeded: true,
          providerExtensionPresent: Boolean(
            normalizeDetailContainerExtension(cached.containerExtension),
          ),
          resolvedExtensionSource: merged.resolvedExtensionSource,
          detailMode: 'enriched',
          failureReason: null,
        });
        return merged.detail;
      }

      if (!options?.fetchProviderMovieInfo) {
        logMovieDetailEnrichment({
          origin,
          movieId,
          localRowFound: true,
          localExtensionPresent,
          providerInfoRequested: false,
          providerInfoSucceeded: false,
          providerExtensionPresent: false,
          resolvedExtensionSource: localExtensionPresent ? 'catalog' : 'none',
          detailMode: isLocalMovieDetailComplete(local)
            ? 'local-complete'
            : 'preview-fallback',
          failureReason: isLocalMovieDetailComplete(local)
            ? null
            : 'provider-info-unavailable',
        });
        return local;
      }

      if (isLocalMovieDetailComplete(local)) {
        // Local already playable + descriptive; skip network unless reopening used cache above.
        return local;
      }

      logMovieDetailEnrichment({
        origin,
        movieId,
        localRowFound: true,
        localExtensionPresent,
        providerInfoRequested: true,
        providerInfoSucceeded: false,
        providerExtensionPresent: false,
        resolvedExtensionSource: localExtensionPresent ? 'catalog' : 'none',
        detailMode: 'local-preview-enriching',
        failureReason: null,
      });

      try {
        const providerDetail = await options.fetchProviderMovieInfo(movieId);
        if (!providerDetail) {
          logMovieDetailEnrichment({
            origin,
            movieId,
            localRowFound: true,
            localExtensionPresent,
            providerInfoRequested: true,
            providerInfoSucceeded: false,
            providerExtensionPresent: false,
            resolvedExtensionSource: localExtensionPresent ? 'catalog' : 'none',
            detailMode: 'preview-fallback',
            failureReason: 'provider-info-null',
          });
          return local;
        }

        setCachedProviderMovieInfo(providerId, movieId, providerDetail);
        const merged = mergeLocalAndProviderMovieDetail(local, providerDetail);
        localDetailByMovieId.set(movieId, merged.detail);
        logMovieDetailEnrichment({
          origin,
          movieId,
          localRowFound: true,
          localExtensionPresent,
          providerInfoRequested: true,
          providerInfoSucceeded: true,
          providerExtensionPresent: Boolean(
            normalizeDetailContainerExtension(providerDetail.containerExtension),
          ),
          resolvedExtensionSource: merged.resolvedExtensionSource,
          detailMode: 'enriched',
          failureReason: null,
        });
        return merged.detail;
      } catch (error) {
        const failureReason =
          error instanceof Error
            ? error.message || error.name || 'provider-info-rejected'
            : 'provider-info-rejected';
        logMovieDetailEnrichment({
          origin,
          movieId,
          localRowFound: true,
          localExtensionPresent,
          providerInfoRequested: true,
          providerInfoSucceeded: false,
          providerExtensionPresent: false,
          resolvedExtensionSource: localExtensionPresent ? 'catalog' : 'none',
          detailMode: 'preview-fallback',
          failureReason,
        });
        return local;
      }
    },

    async getCategoryCount(categoryId) {
      if (!categoryId || categoryId === SQLITE_MOVIES_DISCOVER_ID) {
        return getCatalogTotalCount(providerId, 'movie');
      }

      const categories = await getCatalogCategoryCounts(providerId, 'movie');
      return categories.find((category) => category.categoryId === categoryId)?.itemCount ?? 0;
    },

    async prefetchAllCategoryCounts(categoryIds, onCategoryCount) {
      const [categories, totalCount] = await Promise.all([
        getCatalogCategoryCounts(providerId, 'movie'),
        getCatalogTotalCount(providerId, 'movie'),
      ]);
      const byId = new Map(categories.map((category) => [category.categoryId, category.itemCount]));

      for (const categoryId of categoryIds) {
        onCategoryCount(
          categoryId,
          categoryId === SQLITE_MOVIES_DISCOVER_ID ? totalCount : byId.get(categoryId) ?? 0,
        );
      }
    },
  };
}
