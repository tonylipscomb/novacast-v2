import { normalizeSearchQuery, tokenizeSearchQuery } from './searchQuery.ts';

export type SearchMatchTier =
  | 'exact'
  | 'prefix'
  | 'word-prefix'
  | 'contains'
  | 'metadata'
  | 'none';

export type RankedSearchCandidate = {
  title: string;
  metadata?: string;
  popularity?: number;
  recency?: number;
};

export function computeSearchMatchTier(query: string, candidate: RankedSearchCandidate): SearchMatchTier {
  const normalizedQuery = normalizeSearchQuery(query);
  if (!normalizedQuery) {
    return 'none';
  }

  const normalizedTitle = normalizeSearchQuery(candidate.title);
  const normalizedMetadata = candidate.metadata ? normalizeSearchQuery(candidate.metadata) : '';

  if (normalizedTitle === normalizedQuery) {
    return 'exact';
  }

  if (normalizedTitle.startsWith(normalizedQuery)) {
    return 'prefix';
  }

  const tokens = tokenizeSearchQuery(normalizedQuery);
  if (tokens.length > 0) {
    const titleWords = normalizedTitle.split(' ').filter(Boolean);
    if (tokens.every((token) => titleWords.some((word) => word.startsWith(token)))) {
      return 'word-prefix';
    }
  }

  if (normalizedTitle.includes(normalizedQuery)) {
    return 'contains';
  }

  if (normalizedMetadata.includes(normalizedQuery)) {
    return 'metadata';
  }

  return 'none';
}

const TIER_ORDER: Record<SearchMatchTier, number> = {
  exact: 0,
  prefix: 1,
  'word-prefix': 2,
  contains: 3,
  metadata: 4,
  none: 5,
};

export function compareSearchCandidates(
  query: string,
  left: RankedSearchCandidate,
  right: RankedSearchCandidate,
) {
  const leftTier = computeSearchMatchTier(query, left);
  const rightTier = computeSearchMatchTier(query, right);
  const tierDiff = TIER_ORDER[leftTier] - TIER_ORDER[rightTier];
  if (tierDiff !== 0) {
    return tierDiff;
  }

  const leftPopularity = left.popularity ?? 0;
  const rightPopularity = right.popularity ?? 0;
  if (leftPopularity !== rightPopularity) {
    return rightPopularity - leftPopularity;
  }

  const leftRecency = left.recency ?? 0;
  const rightRecency = right.recency ?? 0;
  if (leftRecency !== rightRecency) {
    return rightRecency - leftRecency;
  }

  return left.title.localeCompare(right.title, undefined, { sensitivity: 'base' });
}

export function matchesSearchQuery(query: string, candidate: RankedSearchCandidate) {
  return computeSearchMatchTier(query, candidate) !== 'none';
}

export function buildSearchHaystack(parts: (string | number | undefined | null)[]) {
  return parts
    .filter((part) => part !== undefined && part !== null && String(part).trim().length > 0)
    .map((part) => normalizeSearchQuery(String(part)))
    .join(' ');
}
