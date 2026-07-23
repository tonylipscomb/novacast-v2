import { guideProgramIndexSize, ingestGuideRows, searchGuideProgramIndex } from '../guideProgramIndex.ts';
import type { GuideSearchResult, SearchPageRequest, SearchPageResult } from '../searchTypes.ts';

export async function searchGuidePrograms(
  providerId: string,
  request: SearchPageRequest,
): Promise<SearchPageResult<GuideSearchResult>> {
  if (request.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  if (guideProgramIndexSize(providerId) === 0) {
    return { items: [], totalCount: 0, hasMore: false };
  }

  return searchGuideProgramIndex(providerId, request.query, request.offset, request.limit);
}

export { ingestGuideRows };
