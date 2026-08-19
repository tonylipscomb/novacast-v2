import {
  getLiveTvWorkload,
  shouldPauseLiveSearchIndexing,
} from '../live/liveTvWorkload.ts';

/** Low-end Fire TV: never crawl Live categories concurrently. */
export const LIVE_SEARCH_BUILD_CONCURRENCY = 1;
export const LIVE_SEARCH_WRITE_BATCH_SIZE = 16;
export const LIVE_SEARCH_INDEX_YIELD_MS = 16;
export const LIVE_SEARCH_INDEX_PAUSE_POLL_MS = 150;

export function shouldStartInteractiveLiveSearchCrawl() {
  // Interactive Search / Live TV must never start an unbounded provider-wide crawl.
  return false;
}

export async function waitWhileLiveSearchIndexPaused(input: {
  isCancelled?: () => boolean;
  isPaused?: () => boolean;
  sleep?: (ms: number) => Promise<void>;
  onPaused?: () => void;
  onResumed?: () => void;
}): Promise<'cancelled' | 'ready'> {
  const sleep = input.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const isPaused = input.isPaused ?? (() => shouldPauseLiveSearchIndexing(getLiveTvWorkload()));
  if (input.isCancelled?.()) {
    return 'cancelled';
  }
  if (!isPaused()) {
    return 'ready';
  }

  input.onPaused?.();
  while (isPaused()) {
    if (input.isCancelled?.()) {
      return 'cancelled';
    }
    await sleep(LIVE_SEARCH_INDEX_PAUSE_POLL_MS);
  }
  if (input.isCancelled?.()) {
    return 'cancelled';
  }
  input.onResumed?.();
  return 'ready';
}

export function liveSearchIndexPendingCategories(completed: number, total: number) {
  return Math.max(0, total - Math.max(0, completed));
}
