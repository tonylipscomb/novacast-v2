/**
 * Stage 4.2J / 4.2I.1 — fast readable Movies generation cache.
 * Shares one in-flight validation Promise; syncing/errored newer gens do not
 * invalidate a healthy active generation.
 */

export const MOVIES_READABLE_GENERATION_CACHE_MARKER =
  'stage4j-movies-readable-generation-cache-v1';

export type MoviesReadableGenerationCacheEntry = {
  providerId: string;
  generation: number;
  resolvedAt: number;
  itemRows: number;
  categoryRows: number;
  distinctItemCategoryIds: number;
};

type CacheState = {
  entry: MoviesReadableGenerationCacheEntry | null;
  inflight: Promise<number> | null;
  inflightProviderId: string | null;
};

const cacheByProvider = new Map<string, CacheState>();

function stateFor(providerId: string): CacheState {
  let state = cacheByProvider.get(providerId);
  if (!state) {
    state = { entry: null, inflight: null, inflightProviderId: null };
    cacheByProvider.set(providerId, state);
  }
  return state;
}

export function getCachedMoviesReadableGeneration(
  providerId: string,
): MoviesReadableGenerationCacheEntry | null {
  return stateFor(providerId).entry;
}

export function setCachedMoviesReadableGeneration(
  entry: MoviesReadableGenerationCacheEntry,
): void {
  const state = stateFor(entry.providerId);
  state.entry = entry;
}

/**
 * Syncing/errored generation N+1 must not drop a healthy cached generation.
 * Only clear when the active provider pointer itself changes to a different
 * validated generation, or the cache is explicitly invalidated.
 */
export function shouldInvalidateMoviesReadableGenerationCache(input: {
  cachedGeneration: number;
  activeProviderGeneration: number;
  syncingGeneration: number;
  syncStatus: string | null;
}): boolean {
  if (input.cachedGeneration <= 0) {
    return true;
  }
  // Healthy active pointer still matches cache — keep it during sync/error of newer gens.
  if (
    input.activeProviderGeneration > 0 &&
    input.activeProviderGeneration === input.cachedGeneration
  ) {
    return false;
  }
  // Active pointer moved to a different generation — re-resolve.
  if (
    input.activeProviderGeneration > 0 &&
    input.activeProviderGeneration !== input.cachedGeneration
  ) {
    return true;
  }
  return false;
}

export async function resolveMoviesReadableGenerationCached(input: {
  providerId: string;
  resolve: () => Promise<number>;
  getMeta?: () => Promise<{
    itemRows: number;
    categoryRows: number;
    distinctItemCategoryIds: number;
    activeProviderGeneration: number;
    syncingGeneration: number;
    syncStatus: string | null;
  } | null>;
}): Promise<number> {
  const state = stateFor(input.providerId);
  const meta = input.getMeta ? await input.getMeta() : null;

  if (
    state.entry &&
    state.entry.generation > 0 &&
    meta &&
    !shouldInvalidateMoviesReadableGenerationCache({
      cachedGeneration: state.entry.generation,
      activeProviderGeneration: meta.activeProviderGeneration,
      syncingGeneration: meta.syncingGeneration,
      syncStatus: meta.syncStatus,
    })
  ) {
    return state.entry.generation;
  }

  if (state.inflight && state.inflightProviderId === input.providerId) {
    return state.inflight;
  }

  const promise = (async () => {
    const generation = await input.resolve();
    if (generation > 0) {
      const resolvedMeta = input.getMeta ? await input.getMeta() : null;
      setCachedMoviesReadableGeneration({
        providerId: input.providerId,
        generation,
        resolvedAt: Date.now(),
        itemRows: resolvedMeta?.itemRows ?? 0,
        categoryRows: resolvedMeta?.categoryRows ?? 0,
        distinctItemCategoryIds: resolvedMeta?.distinctItemCategoryIds ?? 0,
      });
    }
    return generation;
  })();

  state.inflight = promise;
  state.inflightProviderId = input.providerId;
  try {
    return await promise;
  } finally {
    if (state.inflight === promise) {
      state.inflight = null;
      state.inflightProviderId = null;
    }
  }
}

export function clearMoviesReadableGenerationCache(providerId?: string): void {
  if (providerId) {
    cacheByProvider.delete(providerId);
    return;
  }
  cacheByProvider.clear();
}

export function clearMoviesReadableGenerationCacheForTests(): void {
  cacheByProvider.clear();
}
