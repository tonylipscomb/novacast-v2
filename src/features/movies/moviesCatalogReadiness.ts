import {
  getCatalogGenerationItemCount,
  getCatalogGenerationPhysicalStats,
  getCatalogProvider,
  getCatalogSyncState,
  resolveReadableCatalogGeneration,
  resolveReadableCategoryGeneration,
} from '../catalog/catalogRepository.ts';

export type MoviesCatalogReadinessDecision =
  | 'waiting-fresh-sync'
  | 'preserving-completed-generation'
  | 'activating-completed-generation'
  | 'ready'
  | 'completed-empty';

export type MoviesCatalogReadiness = {
  providerId: string;
  categoriesGeneration: number;
  readableItemGeneration: number;
  activeProviderGeneration: number;
  syncingGeneration: number;
  syncStatus: string | null;
  categoryCount: number;
  readableItemCount: number;
  inProgressItemCount: number;
  previousReadableGeneration: number;
  decision: MoviesCatalogReadinessDecision;
};

const lastLoggedReadinessByProvider = new Map<string, string>();
const previousReadableGenerationByProvider = new Map<string, number>();

export function resetMoviesCatalogReadinessLogForTests() {
  lastLoggedReadinessByProvider.clear();
  previousReadableGenerationByProvider.clear();
}

export function decideMoviesCatalogReadiness(input: {
  categoriesGeneration: number;
  readableItemGeneration: number;
  syncingGeneration: number;
  syncStatus: string | null;
  previousReadableGeneration: number;
  readableItemCount?: number;
}): MoviesCatalogReadinessDecision {
  const {
    categoriesGeneration,
    readableItemGeneration,
    syncingGeneration,
    syncStatus,
    previousReadableGeneration,
    readableItemCount = -1,
  } = input;

  // Never treat category metadata alone as item readiness.
  if (readableItemGeneration <= 0) {
    return 'waiting-fresh-sync';
  }

  const syncingNewer =
    syncingGeneration > readableItemGeneration &&
    (syncStatus === 'syncing' || syncStatus === 'error');

  if (syncingNewer) {
    return 'preserving-completed-generation';
  }

  if (readableItemCount === 0) {
    return 'completed-empty';
  }

  if (
    previousReadableGeneration > 0 &&
    previousReadableGeneration < readableItemGeneration
  ) {
    return 'activating-completed-generation';
  }

  // First activation after a fresh wait (previous was 0).
  if (previousReadableGeneration <= 0 && categoriesGeneration > 0) {
    return 'activating-completed-generation';
  }

  return 'ready';
}

export async function resolveMoviesCatalogReadiness(
  providerId: string,
): Promise<MoviesCatalogReadiness> {
  const [categoriesGeneration, readableItemGeneration, state, provider] = await Promise.all([
    resolveReadableCategoryGeneration(providerId, 'movie'),
    resolveReadableCatalogGeneration(providerId, 'movie'),
    getCatalogSyncState(providerId, 'movie'),
    getCatalogProvider(providerId),
  ]);

  const syncingGeneration = state?.generation ?? 0;
  const syncStatus = state?.status ?? null;
  const activeProviderGeneration = provider?.catalogGeneration ?? 0;
  const previousReadableGeneration = previousReadableGenerationByProvider.get(providerId) ?? 0;

  const [categoryStats, readableItemCount, inProgressItemCount] = await Promise.all([
    categoriesGeneration > 0
      ? getCatalogGenerationPhysicalStats(providerId, 'movie', categoriesGeneration)
      : Promise.resolve({
          itemRows: 0,
          distinctContentIds: 0,
          categoryRows: 0,
          distinctItemCategoryIds: 0,
        }),
    readableItemGeneration > 0
      ? getCatalogGenerationItemCount(providerId, 'movie', readableItemGeneration)
      : Promise.resolve(0),
    syncingGeneration > 0 && syncStatus === 'syncing'
      ? getCatalogGenerationItemCount(providerId, 'movie', syncingGeneration)
      : Promise.resolve(0),
  ]);

  const decision = decideMoviesCatalogReadiness({
    categoriesGeneration,
    readableItemGeneration,
    syncingGeneration,
    syncStatus,
    previousReadableGeneration,
    readableItemCount,
  });

  const readiness: MoviesCatalogReadiness = {
    providerId,
    categoriesGeneration,
    readableItemGeneration,
    activeProviderGeneration,
    syncingGeneration,
    syncStatus,
    categoryCount: categoryStats.categoryRows,
    readableItemCount,
    inProgressItemCount,
    previousReadableGeneration,
    decision,
  };

  if (readableItemGeneration > 0) {
    previousReadableGenerationByProvider.set(providerId, readableItemGeneration);
  }

  return readiness;
}

/** Bounded: one log per distinct readiness signature per provider. */
export function logMoviesCatalogReadiness(readiness: MoviesCatalogReadiness): void {
  const signature = [
    readiness.decision,
    readiness.categoriesGeneration,
    readiness.readableItemGeneration,
    readiness.activeProviderGeneration,
    readiness.syncingGeneration,
    readiness.syncStatus ?? 'null',
    readiness.categoryCount,
    readiness.readableItemCount,
  ].join(':');

  if (lastLoggedReadinessByProvider.get(readiness.providerId) === signature) {
    return;
  }
  lastLoggedReadinessByProvider.set(readiness.providerId, signature);

  console.info(
    '[NovaCast Movies Catalog Readiness] ' +
      JSON.stringify({
        providerId: readiness.providerId,
        categoriesGeneration: readiness.categoriesGeneration,
        readableItemGeneration: readiness.readableItemGeneration,
        activeProviderGeneration: readiness.activeProviderGeneration,
        syncingGeneration: readiness.syncingGeneration,
        syncStatus: readiness.syncStatus,
        categoryCount: readiness.categoryCount,
        inProgressItemCount: readiness.inProgressItemCount,
        previousReadableGeneration: readiness.previousReadableGeneration,
        decision: readiness.decision,
      }),
  );
}

export class MoviesCatalogNotReadyError extends Error {
  readonly code = 'catalog-not-ready' as const;

  constructor(providerId: string, readableItemGeneration = 0) {
    super(
      `Movies catalog not ready for provider ${providerId} (readableItemGeneration=${readableItemGeneration})`,
    );
    this.name = 'MoviesCatalogNotReadyError';
  }
}

export function isMoviesCatalogNotReadyError(error: unknown): error is MoviesCatalogNotReadyError {
  return (
    error instanceof MoviesCatalogNotReadyError ||
    (error instanceof Error &&
      (error.name === 'MoviesCatalogNotReadyError' ||
        (error as { code?: string }).code === 'catalog-not-ready'))
  );
}
