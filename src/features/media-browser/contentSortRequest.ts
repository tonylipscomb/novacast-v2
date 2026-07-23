import type { ContentSortOption } from './contentSorting.ts';

export type ContentSortRequestIdentity = {
  providerId: string;
  contentType: 'movie' | 'series';
  categoryId: string;
  sort: ContentSortOption;
  offset: number;
  generation: number;
};

export function buildContentSortRequestKey(input: ContentSortRequestIdentity) {
  return `${input.providerId}:${input.contentType}:${input.categoryId}:${input.sort}:${input.offset}:${input.generation}`;
}

export function createContentSortRequestIdentity(
  input: Omit<ContentSortRequestIdentity, 'generation'> & { generation: number },
): ContentSortRequestIdentity {
  return input;
}
