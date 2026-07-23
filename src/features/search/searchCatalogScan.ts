import { compareSearchCandidates, matchesSearchQuery, type RankedSearchCandidate } from './searchRanking.ts';
import { normalizeSearchQuery } from './searchQuery.ts';

/** Cap sort work for broad queries against large catalogs. Pagination beyond this uses a full rescan. */
const MAX_RANK_BUFFER = 600;

export type CatalogScanOptions<TEntry, TResult> = {
  query: string;
  offset: number;
  limit: number;
  forEachEntry: (visit: (entry: TEntry) => void) => void;
  toCandidate: (entry: TEntry) => RankedSearchCandidate;
  toResult: (entry: TEntry) => TResult;
  acceptEntry?: (entry: TEntry, query: string, normalizedQuery: string, candidate: RankedSearchCandidate) => boolean;
  /** Skip expensive ranking when the normalized query cannot appear in this entry. */
  fastReject?: (entry: TEntry, normalizedQuery: string) => boolean;
  dedupeKey?: (entry: TEntry) => string | null | undefined;
  batchSize?: number;
  signal?: AbortSignal;
};

function runCatalogScan<TEntry, TResult>(options: CatalogScanOptions<TEntry, TResult>) {
  const { query, offset, limit, forEachEntry, toCandidate, toResult } = options;
  const normalizedQuery = normalizeSearchQuery(query);
  const seen = new Set<string>();
  let totalCount = 0;
  const ranked: Array<{ entry: TEntry; candidate: RankedSearchCandidate }> = [];
  const rankLimit = Math.min(MAX_RANK_BUFFER, Math.max(offset + limit, limit));

  const accept = (entry: TEntry, candidate: RankedSearchCandidate) => {
    if (options.acceptEntry) {
      return options.acceptEntry(entry, query, normalizedQuery, candidate);
    }

    return (
      matchesSearchQuery(query, candidate) ||
      Boolean(candidate.metadata?.includes(normalizedQuery))
    );
  };

  const consider = (entry: TEntry) => {
    if (options.signal?.aborted) {
      return;
    }

    if (options.fastReject?.(entry, normalizedQuery)) {
      return;
    }

    const dedupe = options.dedupeKey?.(entry);
    if (dedupe) {
      if (seen.has(dedupe)) {
        return;
      }
      seen.add(dedupe);
    }

    const candidate = toCandidate(entry);
    if (!accept(entry, candidate)) {
      return;
    }

    totalCount += 1;

    if (ranked.length < rankLimit) {
      ranked.push({ entry, candidate });
      return;
    }

    let worstIndex = 0;
    for (let index = 1; index < ranked.length; index += 1) {
      if (compareSearchCandidates(query, ranked[worstIndex].candidate, ranked[index].candidate) < 0) {
        worstIndex = index;
      }
    }

    if (compareSearchCandidates(query, candidate, ranked[worstIndex].candidate) < 0) {
      ranked[worstIndex] = { entry, candidate };
    }
  };

  forEachEntry(consider);

  ranked.sort((left, right) => compareSearchCandidates(query, left.candidate, right.candidate));

  const items = ranked.slice(offset, offset + limit).map(({ entry }) => toResult(entry));
  return {
    items,
    totalCount,
    hasMore: offset + limit < totalCount,
  };
}

export function scanCatalogForSearch<TEntry, TResult>(
  options: CatalogScanOptions<TEntry, TResult>,
): { items: TResult[]; totalCount: number; hasMore: boolean } {
  return runCatalogScan(options);
}

const DEFAULT_SCAN_BATCH_SIZE = 4_000;

function yieldToEventLoop() {
  return new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}

/** Chunked scan so large catalogs stay responsive on TV hardware. */
export async function scanCatalogForSearchAsync<TEntry, TResult>(
  options: CatalogScanOptions<TEntry, TResult>,
): Promise<{ items: TResult[]; totalCount: number; hasMore: boolean }> {
  const batchSize = options.batchSize ?? DEFAULT_SCAN_BATCH_SIZE;
  if (!batchSize || batchSize <= 0) {
    return runCatalogScan(options);
  }

  const queue: TEntry[] = [];
  options.forEachEntry((entry) => {
    queue.push(entry);
  });

  const normalizedQuery = normalizeSearchQuery(options.query);
  const seen = new Set<string>();
  let totalCount = 0;
  const ranked: Array<{ entry: TEntry; candidate: RankedSearchCandidate }> = [];
  const rankLimit = Math.min(MAX_RANK_BUFFER, Math.max(options.offset + options.limit, options.limit));

  const accept = (entry: TEntry, candidate: RankedSearchCandidate) => {
    if (options.acceptEntry) {
      return options.acceptEntry(entry, options.query, normalizedQuery, candidate);
    }

    return (
      matchesSearchQuery(options.query, candidate) ||
      Boolean(candidate.metadata?.includes(normalizedQuery))
    );
  };

  const consider = (entry: TEntry) => {
    if (options.signal?.aborted) {
      return;
    }

    if (options.fastReject?.(entry, normalizedQuery)) {
      return;
    }

    const dedupe = options.dedupeKey?.(entry);
    if (dedupe) {
      if (seen.has(dedupe)) {
        return;
      }
      seen.add(dedupe);
    }

    const candidate = options.toCandidate(entry);
    if (!accept(entry, candidate)) {
      return;
    }

    totalCount += 1;

    if (ranked.length < rankLimit) {
      ranked.push({ entry, candidate });
      return;
    }

    let worstIndex = 0;
    for (let index = 1; index < ranked.length; index += 1) {
      if (compareSearchCandidates(options.query, ranked[worstIndex].candidate, ranked[index].candidate) < 0) {
        worstIndex = index;
      }
    }

    if (compareSearchCandidates(options.query, candidate, ranked[worstIndex].candidate) < 0) {
      ranked[worstIndex] = { entry, candidate };
    }
  };

  for (let index = 0; index < queue.length; index += 1) {
    if (options.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    consider(queue[index]!);

    if ((index + 1) % batchSize === 0) {
      await yieldToEventLoop();
    }
  }

  ranked.sort((left, right) => compareSearchCandidates(options.query, left.candidate, right.candidate));

  const items = ranked.slice(options.offset, options.offset + options.limit).map(({ entry }) => options.toResult(entry));
  return {
    items,
    totalCount,
    hasMore: options.offset + options.limit < totalCount,
  };
}
