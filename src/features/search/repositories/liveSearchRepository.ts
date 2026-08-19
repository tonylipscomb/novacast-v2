import { novacastTrace } from '../../diagnostics/novacastLogPolicy.ts';
import type { ProviderRepositories } from '../../providers/providerRepositories.ts';
import { scheduleLiveSearchCatalogIdleBuild, searchLiveSqliteCatalog } from '../liveSearchSqliteCatalog.ts';

import { ingestLiveChannels, ingestLiveSearchCategories, liveChannelIndexSize, searchLiveChannelIndex, findMatchingLiveCategoryIds, type LiveSearchMatchMode } from '../liveChannelIndex.ts';
import { matchesSearchQuery } from '../searchRanking.ts';
import type { LiveSearchResult, SearchPageRequest, SearchPageResult } from '../searchTypes.ts';

export async function searchLiveChannels(
  providerId: string,
  repositories: ProviderRepositories | null | undefined,
  request: SearchPageRequest,
  options: { matchMode?: LiveSearchMatchMode } = {},
): Promise<SearchPageResult<LiveSearchResult>> {
  // search-live-s1-global-mode
  const matchMode = options.matchMode ?? 'live';
  if (request.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  // live-search-sqlite-v1
  try {
    const sqliteResult = await searchLiveSqliteCatalog({
      providerId,
      query: request.query,
      offset: request.offset,
      limit: request.limit,
      matchMode,
      matchingCategoryIds: matchMode === 'live' ? findMatchingLiveCategoryIds(providerId, request.query) : [],
      signal: request.signal,
    });
    if (sqliteResult) {
      // A readable persistent generation is authoritative, including zero results.
      return sqliteResult;
    }
  } catch (error) {
    if (request.signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
      throw error;
    }
    novacastTrace('[NovaCast Live Search Catalog] search-read-fallback', {
      providerId,
      message: error instanceof Error ? error.message : String(error),
    });
  }

  if (repositories?.live) {
    // Interactive Search never starts an unbounded crawl. Request the idle
    // indexer only; it pauses during overlay/IME/surf/fullscreen/rapid DPAD.
    scheduleLiveSearchCatalogIdleBuild({ providerId, live: repositories.live });
  }

  if (liveChannelIndexSize(providerId) > 0) {
    // search-live-provider-fallback-v1_1
    // The index can be only partially warm (for example, categories already browsed in Live TV).
    // Trust it when it has a match; otherwise ask the provider instead of treating a partial cache as complete.
    const indexedResult = searchLiveChannelIndex(providerId, request.query, request.offset, request.limit, matchMode);
    if (indexedResult.totalCount > 0) {
      return indexedResult;
    }
  }

  // live-search-progressive-bootstrap-v1_1
  // Interactive Search must never block on the provider-wide Live category sweep.
  // If SQLite has no completed generation yet, the background builder continues and
  // Search returns immediately. Already-indexed bootstrap rows and in-memory hits above
  // remain available while the first persistent generation fills.
  if (repositories?.live) {
    return { items: [], totalCount: 0, hasMore: false };
  }

  if (!repositories?.search) {
    return { items: [], totalCount: 0, hasMore: false };
  }

  const hits = await repositories.search.search(request.query, request.signal);
  if (request.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  const liveHits = hits
    .filter((hit) => hit.kind === 'live')
    .map((hit) => ({
      type: 'live' as const,
      id: hit.id,
      providerId,
      title: hit.title,
      subtitle: hit.subtitle,
      tone: hit.tone,
      categoryId: hit.categoryId,
    }));

  // Warm the live channel index from provider search results for future scoped searches.
  if (liveHits.length) {
    ingestLiveChannels(
      providerId,
      liveHits.map((hit) => ({
        id: hit.id,
        categoryId: hit.categoryId ?? 'search',
        number: 0,
        name: hit.title,
        shortName: hit.title.slice(0, 2),
        current: hit.subtitle ?? hit.title,
        next: '',
        following: '',
        description: '',
        resolution: '',
        audio: '',
        remaining: '',
        progress: 0,
        tone: hit.tone ?? '#173B67',
        currentStart: '',
        currentEnd: '',
      })),
    );
  }

  const visibleLiveHits =
    matchMode === 'global'
      ? liveHits.filter((hit) => matchesSearchQuery(request.query, { title: hit.title }))
      : liveHits;

  const items = visibleLiveHits.slice(request.offset, request.offset + request.limit);
  return {
    items,
    totalCount: visibleLiveHits.length,
    hasMore: request.offset + request.limit < visibleLiveHits.length,
  };
}

export { ingestLiveChannels, ingestLiveSearchCategories };
