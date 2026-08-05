import {
  getCachedMoviesReadableGeneration,
  setCachedMoviesReadableGeneration,
} from '../../catalog/moviesReadableGenerationCache.ts';
import {
  getCatalogCategoryCounts,
  getCatalogCategoryMetadataOnly,
  getCatalogDiagnosticSnapshot,
  getCatalogGenerationRowCount,
  getCatalogItemsPage,
  getCatalogMovieItem,
  getCatalogProvider,
  getCatalogTotalCount,
  resolveReadableCatalogGeneration,
} from '../../catalog/catalogRepository.ts';
import { recoverFragmentedMovieCatalogOnce } from '../../catalog/catalogFragmentRecovery.ts';
import type { CatalogItemRecord, CatalogItemSort } from '../../catalog/catalogTypes.ts';
import type { ContentSortOption } from '../../media-browser/contentSorting.ts';
import type { MediaDetail } from '../../media-browser/mediaTypes.ts';
import { getActiveRepositoryBundle } from '../../providers/providerBundle.ts';
import {
  publishMovieCatalogReady,
  publishMovieCategoriesUpdated,
} from '../../providers/providerCatalogSync.ts';
import {
  isOnnMoviesTraceEnabled,
  traceOnnMoviesEvent,
} from '@/features/diagnostics/onnMoviesTrace';
import { getMoviesDetailOpenForDiagnostics } from '../moviesDiagnosticsState.ts';

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
  isMoviesStartupDurableSnapshotValidForProvider,
  MOVIES_FOCUS_STAGE4L_MARKER,
  MOVIES_STARTUP_VIEWPORT_LIMIT,
  type MoviesStartupGenerationSource,
  type MoviesStartupQueryMode,
} from '../moviesStartupFastPath.ts';
import {
  loadMoviesStartupDurableSnapshot,
  saveMoviesStartupDurableSnapshot,
} from '../moviesStartupSnapshotStore.ts';
import {
  getMoviesStartupSession,
  MOVIES_FOCUS_STAGE4L1_MARKER,
  setMoviesStartupPinnedGeneration,
  shouldBlockMoviesStartupReentry,
} from '../moviesStartupRuntimeIsolation.ts';
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
/** Stage 4.2L: one deferred full-count refresh per provider after a fast-path return. */
const deferredFullCategoryRefreshByProvider = new Set<string>();
const deferredFullCategoryRefreshInFlight = new Set<string>();

/** Stage 4.2L: next getCategories() runs the full-count path (e.g. catalog_ready). */
const forceNextCategoriesFullLoad = new Set<string>();

export function requestSqliteMovieCategoriesFullRefresh(providerId: string): void {
  forceNextCategoriesFullLoad.add(providerId);
}

export function resetLastValidSqliteMovieCategoriesForTests() {
  lastValidSqliteCategoriesByProvider.clear();
  deferredFullCategoryRefreshByProvider.clear();
  deferredFullCategoryRefreshInFlight.clear();
  forceNextCategoriesFullLoad.clear();
}

// Re-export for tests that clear the L.1 session alongside SQLite pins.
export { resetMoviesStartupSessionsForTests } from '../moviesStartupRuntimeIsolation.ts';

export function getLastValidMoviesCatalogReadSnapshotForTests(providerId: string) {
  return lastValidSqliteCategoriesByProvider.get(providerId)?.snapshot ?? null;
}

function emitMoviesStartupTrace(
  event: string,
  payload: Record<string, unknown>,
): void {
  const body = {
    event,
    marker: MOVIES_FOCUS_STAGE4L_MARKER,
    ...payload,
  };
  console.info('[NovaCast Movies Startup] ' + JSON.stringify(body));
  if (isOnnMoviesTraceEnabled()) {
    traceOnnMoviesEvent('Startup', event, body);
  }
}

function buildStartupCategoriesFromMetadata(
  metadata: Array<{ categoryId: string; categoryName: string }>,
  totalMovieCount: number,
): MovieCategory[] {
  const seenIds = new Map<string, number>();
  const providerCategories: MovieCategory[] = metadata.map((category) => {
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

  return filterInteractiveMovieCategories([
    {
      id: SQLITE_MOVIES_DISCOVER_ID,
      renderKey: SQLITE_MOVIES_DISCOVER_ID,
      name: 'All Movies',
      count: totalMovieCount,
      countKnown: totalMovieCount > 0,
      kind: 'provider',
      section: 'provider',
    },
    ...providerCategories,
  ]);
}

function pinStartupCategories(
  providerId: string,
  generation: number,
  categories: MovieCategory[],
  totalCount: number,
  metadataCategoryCount: number,
  groupedCountRows: number,
): MoviesCatalogReadSnapshot {
  const snapshot = buildMoviesCatalogReadSnapshot({
    providerId,
    readableGeneration: generation,
    categories,
    metadataCategoryCount,
    groupedCountRows,
    totalMovieCount: totalCount,
  });
  lastValidSqliteCategoriesByProvider.set(providerId, {
    generation,
    categories,
    totalCount,
    snapshot,
  });
  return snapshot;
}

function scheduleDeferredFullCategoryRefresh(
  providerId: string,
  loadFull: () => Promise<MovieCategory[]>,
  reason: string,
): void {
  if (
    deferredFullCategoryRefreshByProvider.has(providerId) ||
    deferredFullCategoryRefreshInFlight.has(providerId)
  ) {
    return;
  }
  if (getMoviesDetailOpenForDiagnostics()) {
    return;
  }
  deferredFullCategoryRefreshByProvider.add(providerId);
  emitMoviesStartupTrace('movies_startup_background_refresh_started', {
    providerId,
    reason,
  });
  queueMicrotask(() => {
    void (async () => {
      if (deferredFullCategoryRefreshInFlight.has(providerId)) {
        return;
      }
      if (getMoviesDetailOpenForDiagnostics()) {
        deferredFullCategoryRefreshByProvider.delete(providerId);
        return;
      }
      deferredFullCategoryRefreshInFlight.add(providerId);
      const startedAt = Date.now();
      try {
        const categories = await loadFull();
        const pinned = lastValidSqliteCategoriesByProvider.get(providerId);
        if (pinned && categories.length > 0) {
          publishMovieCategoriesUpdated(providerId, pinned.generation, categories.length);
        }
        emitMoviesStartupTrace('movies_startup_background_refresh_finished', {
          providerId,
          reason,
          categoryCount: categories.length,
          generation: pinned?.generation ?? 0,
          elapsedMs: Date.now() - startedAt,
        });
      } catch (error) {
        emitMoviesStartupTrace('movies_startup_background_refresh_finished', {
          providerId,
          reason,
          error: error instanceof Error ? error.message : String(error),
          elapsedMs: Date.now() - startedAt,
        });
      } finally {
        deferredFullCategoryRefreshInFlight.delete(providerId);
        deferredFullCategoryRefreshByProvider.delete(providerId);
      }
    })();
  });
}

async function persistStartupDurableSnapshot(
  providerId: string,
  generation: number,
  categories: MovieCategory[],
  totalCount: number,
): Promise<void> {
  if (generation <= 0 || categories.length === 0) {
    return;
  }
  try {
    const itemRows = await getCatalogGenerationRowCount(providerId, 'movie', generation);
    await saveMoviesStartupDurableSnapshot({
      providerId,
      generation,
      categories,
      totalMovieCount: totalCount,
      itemRows,
      categoryRows: categories.length,
    });
  } catch {
    // Best-effort — session pin still accelerates startup.
  }
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

  async function getCategoriesImpl(options?: {
    forceFull?: boolean;
  }): Promise<MovieCategory[]> {
      const queryStartedAt = Date.now();
      const forceFull =
        options?.forceFull === true || forceNextCategoriesFullLoad.delete(providerId);
      const startupBlocked = !forceFull && shouldBlockMoviesStartupReentry(providerId);

      // ── Stage 4.2L fast path: durable / session / metadata before heavy work ──
      if (!forceFull) {
        if (startupBlocked) {
          emitMoviesStartupTrace('movies_startup_reentry_blocked', {
            providerId,
            marker: MOVIES_FOCUS_STAGE4L1_MARKER,
            reason: 'session-already-interactive',
          });
          const memory = lastValidSqliteCategoriesByProvider.get(providerId);
          if (memory && memory.categories.length > 0) {
            return filterInteractiveMovieCategories(memory.categories);
          }
          const durableSilent = await loadMoviesStartupDurableSnapshot(providerId);
          if (durableSilent) {
            const rowCount = await getCatalogGenerationRowCount(
              providerId,
              'movie',
              durableSilent.generation,
            );
            if (
              isMoviesStartupDurableSnapshotValidForProvider({
                snapshot: durableSilent,
                providerId,
                readableItemCount: rowCount,
              })
            ) {
              const preserved = filterInteractiveMovieCategories(durableSilent.categories);
              pinStartupCategories(
                providerId,
                durableSilent.generation,
                preserved,
                durableSilent.totalMovieCount,
                durableSilent.categoryRows || preserved.length,
                durableSilent.distinctItemCategoryIds || 0,
              );
              return preserved;
            }
          }
          // Runtime full path below — not labeled as startup.
        } else {
        emitMoviesStartupTrace('movies_startup_categories_query_started', {
          providerId,
          queryMode: 'startup-fast',
          forceFull: false,
        });

        const memory = lastValidSqliteCategoriesByProvider.get(providerId);
        if (memory && memory.generation > 0 && memory.categories.length > 0) {
          const preserved = filterInteractiveMovieCategories(memory.categories);
          if (preserved.length > 0) {
            setMoviesStartupPinnedGeneration(providerId, memory.generation);
            const needsCounts = preserved.some(
              (category) =>
                category.id !== SQLITE_MOVIES_DISCOVER_ID && category.countKnown === false,
            );
            emitMoviesStartupTrace('movies_startup_categories_query_finished', {
              providerId,
              generation: memory.generation,
              rowCount: preserved.length,
              queryElapsedMs: Date.now() - queryStartedAt,
              totalElapsedMs: Date.now() - queryStartedAt,
              usedCachedResult: true,
              queryMode: 'memory-cache' satisfies MoviesStartupQueryMode,
            });
            emitMoviesStartupTrace('movies_startup_readable_generation_selected', {
              providerId,
              generation: memory.generation,
              source: 'memory-cache' satisfies MoviesStartupGenerationSource,
              categoryCount: preserved.length,
              selectedCategoryId: null,
              savedCategoryFound: true,
              readableMovieCount: memory.totalCount,
              fallbackReason: null,
              elapsedMs: Date.now() - queryStartedAt,
            });
            if (needsCounts) {
              scheduleDeferredFullCategoryRefresh(
                providerId,
                () => getCategoriesImpl({ forceFull: true }),
                'memory-unknown-counts',
              );
            }
            return preserved;
          }
        }

        const durable = await loadMoviesStartupDurableSnapshot(providerId);
        if (durable) {
          const rowCount = await getCatalogGenerationRowCount(
            providerId,
            'movie',
            durable.generation,
          );
          if (
            isMoviesStartupDurableSnapshotValidForProvider({
              snapshot: durable,
              providerId,
              readableItemCount: rowCount,
            })
          ) {
            const preserved = filterInteractiveMovieCategories(durable.categories);
            pinStartupCategories(
              providerId,
              durable.generation,
              preserved,
              durable.totalMovieCount,
              durable.categoryRows || preserved.length,
              durable.distinctItemCategoryIds || 0,
            );
            setMoviesStartupPinnedGeneration(providerId, durable.generation);
            setCachedMoviesReadableGeneration({
              providerId,
              generation: durable.generation,
              resolvedAt: Date.now(),
              itemRows: rowCount,
              categoryRows: durable.categoryRows || preserved.length,
              distinctItemCategoryIds: durable.distinctItemCategoryIds || 0,
            });
            emitMoviesStartupTrace('movies_startup_categories_query_finished', {
              providerId,
              generation: durable.generation,
              rowCount: preserved.length,
              queryElapsedMs: Date.now() - queryStartedAt,
              totalElapsedMs: Date.now() - queryStartedAt,
              usedCachedResult: true,
              queryMode: 'durable-snapshot' satisfies MoviesStartupQueryMode,
            });
            emitMoviesStartupTrace('movies_startup_readable_generation_selected', {
              providerId,
              generation: durable.generation,
              source: 'durable-snapshot' satisfies MoviesStartupGenerationSource,
              categoryCount: preserved.length,
              selectedCategoryId: durable.selectedCategoryId,
              savedCategoryFound: true,
              readableMovieCount: rowCount,
              fallbackReason: null,
              elapsedMs: Date.now() - queryStartedAt,
            });
            const needsCounts = preserved.some(
              (category) =>
                category.id !== SQLITE_MOVIES_DISCOVER_ID && category.countKnown === false,
            );
            if (needsCounts) {
              scheduleDeferredFullCategoryRefresh(
                providerId,
                () => getCategoriesImpl({ forceFull: true }),
                'durable-unknown-counts',
              );
            }
            return preserved;
          }
          emitMoviesStartupTrace('movies_startup_snapshot_unavailable', {
            providerId,
            generation: durable.generation,
            reason:
              durable.providerId !== providerId
                ? 'provider-mismatch'
                : rowCount <= 0
                  ? 'unreadable-generation'
                  : 'invalid-snapshot',
            readableItemCount: rowCount,
            elapsedMs: Date.now() - queryStartedAt,
          });
        }

        let peekGeneration = 0;
        let peekSource: MoviesStartupGenerationSource = 'none';
        const cachedReadable = getCachedMoviesReadableGeneration(providerId);
        if (cachedReadable && cachedReadable.generation > 0) {
          const rows = await getCatalogGenerationRowCount(
            providerId,
            'movie',
            cachedReadable.generation,
          );
          if (rows > 0) {
            peekGeneration = cachedReadable.generation;
            peekSource = 'session-cache';
          }
        }
        if (peekGeneration <= 0) {
          const provider = await getCatalogProvider(providerId);
          const activeGeneration = provider?.catalogGeneration ?? 0;
          if (activeGeneration > 0) {
            const rows = await getCatalogGenerationRowCount(
              providerId,
              'movie',
              activeGeneration,
            );
            if (rows > 0) {
              peekGeneration = activeGeneration;
              peekSource = 'active-pointer-fast';
              setCachedMoviesReadableGeneration({
                providerId,
                generation: activeGeneration,
                resolvedAt: Date.now(),
                itemRows: rows,
                categoryRows: 0,
                distinctItemCategoryIds: 0,
              });
            }
          }
        }

        if (peekGeneration > 0) {
          const metadata = await getCatalogCategoryMetadataOnly(providerId, 'movie', {
            generation: peekGeneration,
          });
          if (metadata.length > 0) {
            const totalEstimate = await getCatalogGenerationRowCount(
              providerId,
              'movie',
              peekGeneration,
            );
            const nextCategories = buildStartupCategoriesFromMetadata(
              metadata,
              totalEstimate,
            );
            if (nextCategories.some((category) => category.id !== SQLITE_MOVIES_DISCOVER_ID)) {
              pinStartupCategories(
                providerId,
                peekGeneration,
                nextCategories,
                totalEstimate,
                metadata.length,
                0,
              );
              setMoviesStartupPinnedGeneration(providerId, peekGeneration);
              emitMoviesStartupTrace('movies_startup_categories_query_finished', {
                providerId,
                generation: peekGeneration,
                rowCount: nextCategories.length,
                queryElapsedMs: Date.now() - queryStartedAt,
                totalElapsedMs: Date.now() - queryStartedAt,
                usedCachedResult: false,
                queryMode: 'startup-metadata' satisfies MoviesStartupQueryMode,
              });
              emitMoviesStartupTrace('movies_startup_readable_generation_selected', {
                providerId,
                generation: peekGeneration,
                source: peekSource,
                categoryCount: nextCategories.length,
                selectedCategoryId: null,
                savedCategoryFound: false,
                readableMovieCount: totalEstimate,
                fallbackReason: null,
                elapsedMs: Date.now() - queryStartedAt,
              });
              scheduleDeferredFullCategoryRefresh(
                providerId,
                () => getCategoriesImpl({ forceFull: true }),
                'startup-metadata-full-counts',
              );
              return nextCategories;
            }
          }
        }

        emitMoviesStartupTrace('movies_startup_network_fallback_started', {
          providerId,
          reason: 'no-local-snapshot',
          elapsedMs: Date.now() - queryStartedAt,
        });
        } // end !startupBlocked startup fast path
      }

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

      // Stage 4.2D/E/I: may schedule background repair, but never blank a valid snapshot.
      if (itemsGeneration > 0 && readiness.decision !== 'waiting-fresh-sync') {
        const repairStatus = await repairDegradedMoviesCatalogIfNeeded(providerId, ({ providerId: pid }) => {
          const bundle = getActiveRepositoryBundle();
          if (!bundle || bundle.providerId !== pid) {
            return;
          }
          void bundle.syncCatalog();
        });
        if (repairStatus === 'repairing') {
          const preserved =
            previous &&
            previous.generation === itemsGeneration &&
            previous.categories.length > 0
              ? filterInteractiveMovieCategories(previous.categories)
              : null;
          console.info(
            '[NovaCast Movies Readable Recovery] ' +
              JSON.stringify({
                event: 'movies_snapshot_preserved_during_repair',
                providerId,
                generation: itemsGeneration,
                itemRows: readiness.readableItemCount,
                categoryRows: preserved?.length ?? previous?.categories.length ?? 0,
                distinctItemCategoryIds: null,
                integrityDecision: 'preserve-snapshot',
                reason: 'background-sparse-repair',
                marker: 'stage4i-movies-readable-snapshot-recovery-v1',
              }),
          );
          if (preserved && preserved.length > 0) {
            console.info(
              '[NovaCast Movies Category Contract] ' +
                JSON.stringify({
                  providerId,
                  readableGeneration,
                  categoriesGeneration,
                  itemsGeneration,
                  repositoryCategoryCount: preserved.length,
                  sqliteProviderCategoryCount: preserved.filter((c) => c.kind === 'provider').length,
                  wrappedCategoryCount: 0,
                  appliedProviderCategoryCount: preserved.filter((c) => c.kind === 'provider').length,
                  totalMovieCount: readiness.readableItemCount,
                  firstProviderCategoryIds: preserved
                    .filter((c) => c.kind === 'provider')
                    .slice(0, 5)
                    .map((c) => c.id),
                  reason: 'snapshot-preserved-during-repair',
                }),
            );
            return preserved;
          }
          // Validated readable generation exists — continue loading categories from N.
          // Only blank when there is truly no snapshot (handled by waiting-fresh-sync).
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
      setMoviesStartupPinnedGeneration(providerId, categoryReadGeneration);
      void persistStartupDurableSnapshot(
        providerId,
        categoryReadGeneration,
        nextCategories,
        totalCount,
      );

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
      // Stage 4.2L.1: after interactive, full recounts are runtime — not startup queries.
      if (!shouldBlockMoviesStartupReentry(providerId)) {
        emitMoviesStartupTrace('movies_startup_categories_query_finished', {
          providerId,
          generation: categoryReadGeneration,
          rowCount: nextCategories.length,
          queryElapsedMs: Date.now() - queryStartedAt,
          totalElapsedMs: Date.now() - queryStartedAt,
          usedCachedResult: false,
          queryMode: 'full-counts' satisfies MoviesStartupQueryMode,
        });
        emitMoviesStartupTrace('movies_startup_readable_generation_selected', {
          providerId,
          generation: categoryReadGeneration,
          source: 'full-integrity' satisfies MoviesStartupGenerationSource,
          categoryCount: nextCategories.length,
          selectedCategoryId: null,
          savedCategoryFound: Boolean(previous),
          readableMovieCount: totalCount,
          fallbackReason: null,
          elapsedMs: Date.now() - queryStartedAt,
        });
      }

      return nextCategories;
  }

  async function getMoviesPageImpl(input: {
    categoryId: string;
    offset: number;
    limit: number;
    sort?: ContentSortOption;
    pinnedGeneration?: number;
    startupSessionId?: string | null;
    queryPurpose?: 'startup-viewport' | 'runtime';
  }) {
      const queryStartedAt = Date.now();
      const session = getMoviesStartupSession(providerId);
      const pinned = lastValidSqliteCategoriesByProvider.get(providerId);
      const categoryId =
        input.categoryId && input.categoryId !== SQLITE_MOVIES_DISCOVER_ID
          ? input.categoryId
          : undefined;

      // Stage 4.2L.1: true pinned-generation viewport — bounded SQL only.
      const pinnedGeneration =
        (input.pinnedGeneration && input.pinnedGeneration > 0
          ? input.pinnedGeneration
          : 0) ||
        (session && session.pinnedGeneration > 0 ? session.pinnedGeneration : 0) ||
        (pinned && pinned.generation > 0 ? pinned.generation : 0);

      const isStartupViewport =
        input.queryPurpose === 'startup-viewport' ||
        (input.queryPurpose !== 'runtime' &&
          input.offset === 0 &&
          Boolean(session) &&
          !session!.interactive &&
          !shouldBlockMoviesStartupReentry(providerId));

      if (isStartupViewport && pinnedGeneration > 0) {
        const requestedLimit = Math.min(input.limit, MOVIES_STARTUP_VIEWPORT_LIMIT);
        emitMoviesStartupTrace('movies_startup_viewport_query_started', {
          providerId,
          categoryId: categoryId ?? SQLITE_MOVIES_DISCOVER_ID,
          generation: pinnedGeneration,
          requestedLimit,
          startupSessionId: input.startupSessionId ?? session?.sessionId ?? null,
          marker: MOVIES_FOCUS_STAGE4L1_MARKER,
          queryMode: 'pinned-generation-sql',
        });
        const page = await getCatalogItemsPage({
          providerId,
          mediaType: 'movie',
          categoryId,
          offset: input.offset,
          limit: requestedLimit,
          sort: mapSort(input.sort),
          generation: pinnedGeneration,
          skipTotalCount: true,
        });
        emitMoviesStartupTrace('movies_startup_viewport_query_finished', {
          providerId,
          categoryId: categoryId ?? SQLITE_MOVIES_DISCOVER_ID,
          generation: pinnedGeneration,
          requestedLimit,
          returnedCount: page.items.length,
          savedMovieId: null,
          savedMovieFound: false,
          savedOffset: input.offset,
          queryElapsedMs: Date.now() - queryStartedAt,
          totalElapsedMs: Date.now() - queryStartedAt,
          marker: MOVIES_FOCUS_STAGE4L1_MARKER,
          queryMode: 'pinned-generation-sql',
        });
        console.info('[Movies SQLite] first-page', {
          providerId,
          categoryId: categoryId ?? SQLITE_MOVIES_DISCOVER_ID,
          offset: page.offset,
          itemCount: page.items.length,
          totalCount: page.totalCount,
          generation: pinnedGeneration,
          readableGeneration: pinnedGeneration,
          skipTotalCount: true,
          queryMode: 'pinned-generation-sql',
          marker: MOVIES_FOCUS_STAGE4L1_MARKER,
        });
        return {
          items: page.items.map(mapCatalogItemToMovie),
          totalCount: page.totalCount,
          hasMore: page.hasMore,
        };
      }

      // Runtime / post-interactive page loads — never labeled as startup.
      let itemsGeneration = pinnedGeneration;
      let readableGeneration = pinnedGeneration;
      if (itemsGeneration <= 0) {
        readableGeneration = await resolveReadableCatalogGeneration(providerId, 'movie');
        itemsGeneration = readableGeneration;
      }
      if (readableGeneration <= 0) {
        throw new MoviesCatalogNotReadyError(providerId, readableGeneration);
      }

      const page = await getCatalogItemsPage({
        providerId,
        mediaType: 'movie',
        categoryId,
        offset: input.offset,
        limit: input.limit,
        sort: mapSort(input.sort),
        generation: itemsGeneration,
        skipTotalCount: input.offset === 0,
      });

      if (input.offset === 0) {
        await logSqliteMovieDiagnostic(providerId, 'first-page-after-query');
      }
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
        skipTotalCount: input.offset === 0,
        queryMode: 'runtime',
        marker: 'stage4e-atomic-generation-pinning-v1',
      });

      return {
        items: page.items.map(mapCatalogItemToMovie),
        totalCount: page.totalCount,
        hasMore: page.hasMore,
      };
  }

  return {
    sourceKind: 'sqlite',

    getCategories(): Promise<MovieCategory[]> {
      return getCategoriesImpl();
    },

    getMoviesPage(input) {
      return getMoviesPageImpl(input);
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
