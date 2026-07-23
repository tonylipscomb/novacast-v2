import type { ProviderRepositories } from '../../providers/providerRepositories.ts';

import { ingestLiveChannels, liveChannelIndexSize, searchLiveChannelIndex } from '../liveChannelIndex.ts';
import type { LiveSearchResult, SearchPageRequest, SearchPageResult } from '../searchTypes.ts';

export async function searchLiveChannels(
  providerId: string,
  repositories: ProviderRepositories | null | undefined,
  request: SearchPageRequest,
): Promise<SearchPageResult<LiveSearchResult>> {
  if (request.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  if (liveChannelIndexSize(providerId) > 0) {
    return searchLiveChannelIndex(providerId, request.query, request.offset, request.limit);
  }

  if (!repositories?.live || !repositories.search) {
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
    }));

  // Warm the live channel index from provider search results for future scoped searches.
  if (liveHits.length) {
    ingestLiveChannels(
      providerId,
      liveHits.map((hit) => ({
        id: hit.id,
        categoryId: 'search',
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

  const items = liveHits.slice(request.offset, request.offset + request.limit);
  return {
    items,
    totalCount: liveHits.length,
    hasMore: request.offset + request.limit < liveHits.length,
  };
}

export { ingestLiveChannels };
