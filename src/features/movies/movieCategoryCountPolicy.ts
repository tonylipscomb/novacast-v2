import { isSmartCategoryId } from '../media-browser/mediaCategoryUtils.ts';

import type { MovieCategory } from './movieTypes.ts';

/** Rail shows a light placeholder until the count resolves. */
export function formatMovieCategoryCount(count: number, countKnown?: boolean) {
  if (countKnown === false) {
    return '...';
  }
  return count.toLocaleString();
}

export function resolveSmartCategoryCountKnown(input: {
  cacheEntryExists: boolean;
  syncCount: number;
}): boolean {
  return input.cacheEntryExists || input.syncCount > 0;
}

/**
 * Discover (smart) and provider rows both need counts. Sections never do.
 * Prefetch previously blocked smart:* and that left Discover stuck on "-".
 */
export function shouldPrefetchMovieCategoryCount(input: {
  categoryId: string;
  kind?: MovieCategory['kind'];
}): boolean {
  if (!input.categoryId || input.categoryId.startsWith('section:') || input.kind === 'section') {
    return false;
  }
  return input.kind === 'smart' || input.kind === 'provider' || isSmartCategoryId(input.categoryId) || input.kind == null;
}

export function categoriesNeedingCountWarm(categories: MovieCategory[]) {
  return categories.filter((category) => {
    if (category.kind === 'section') {
      return false;
    }
    return category.countKnown === false;
  });
}

/** Startup warm may apply cached/index counts only — never network. */
export function shouldNetworkFetchCategoryCountOnWarm() {
  return false;
}

export type SerialCategoryCountQueueStats = {
  enqueued: number;
  started: number;
  finished: number;
  ignoredStale: number;
  pending: number;
  active: number;
};

/**
 * Cap count network work so Movies startup / D-pad stay responsive.
 * Concurrency defaults to 1; stale generations are ignored after provider change.
 */
export function createSerialCategoryCountQueue(options: {
  concurrency?: number;
  fetchCount: (categoryId: string) => Promise<number>;
  onCount: (categoryId: string, count: number) => void;
  getGeneration: () => number;
  isAccepted: (categoryId: string) => boolean;
}) {
  const concurrency = Math.max(1, options.concurrency ?? 1);
  const pending: string[] = [];
  const queuedOrDone = new Set<string>();
  let active = 0;
  let enqueued = 0;
  let started = 0;
  let finished = 0;
  let ignoredStale = 0;

  const pump = () => {
    while (active < concurrency && pending.length > 0) {
      const categoryId = pending.shift()!;
      if (!options.isAccepted(categoryId)) {
        queuedOrDone.delete(categoryId);
        continue;
      }

      const generation = options.getGeneration();
      active += 1;
      started += 1;

      void options
        .fetchCount(categoryId)
        .then((count) => {
          finished += 1;
          active -= 1;
          if (generation !== options.getGeneration()) {
            ignoredStale += 1;
            queuedOrDone.delete(categoryId);
            pump();
            return;
          }
          options.onCount(categoryId, count);
          pump();
        })
        .catch(() => {
          finished += 1;
          active -= 1;
          queuedOrDone.delete(categoryId);
          pump();
        });
    }
  };

  return {
    enqueue(categoryId: string) {
      if (!categoryId || queuedOrDone.has(categoryId) || !options.isAccepted(categoryId)) {
        return false;
      }
      queuedOrDone.add(categoryId);
      pending.push(categoryId);
      enqueued += 1;
      pump();
      return true;
    },
    reset() {
      pending.length = 0;
      queuedOrDone.clear();
      active = 0;
    },
    has(categoryId: string) {
      return queuedOrDone.has(categoryId);
    },
    getStats(): SerialCategoryCountQueueStats {
      return {
        enqueued,
        started,
        finished,
        ignoredStale,
        pending: pending.length,
        active,
      };
    },
  };
}
