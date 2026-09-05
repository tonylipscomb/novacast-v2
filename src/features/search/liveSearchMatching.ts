import { normalizeSearchQuery, tokenizeSearchQuery } from './searchQuery.ts';

/**
 * Live-only search ranking. Channel-name hits always outrank number, cached
 * program, and category matches. Normalization is search-only.
 */
export type LiveSearchMatchTier =
  | 'exact'
  | 'prefix'
  | 'token'
  | 'contains'
  | 'number'
  | 'program'
  | 'category'
  | 'none';

export type LiveSearchCandidate = {
  id: string;
  name: string;
  number?: number | string | null;
  currentProgram?: string | null;
  categoryName?: string | null;
};

const TIER_ORDER: Record<LiveSearchMatchTier, number> = {
  program: 0,
  exact: 1,
  prefix: 2,
  token: 3,
  contains: 4,
  number: 5,
  category: 6,
  none: 7,
};

export function tokenizeLiveSearchText(value: string) {
  return tokenizeSearchQuery(value);
}

function tokensMatchQuery(queryTokens: string[], textTokens: string[]) {
  return (
    queryTokens.length > 0 &&
    queryTokens.every((queryToken) => textTokens.some((textToken) => textToken.startsWith(queryToken)))
  );
}

export function computeLiveSearchMatchTier(
  query: string,
  candidate: LiveSearchCandidate,
  options: { allowProgram?: boolean; allowCategory?: boolean } = {},
): LiveSearchMatchTier {
  const allowProgram = options.allowProgram !== false;
  const allowCategory = options.allowCategory !== false;
  const normalizedQuery = normalizeSearchQuery(query);
  if (!normalizedQuery) {
    return 'none';
  }

  const normalizedName = normalizeSearchQuery(candidate.name);
  const queryTokens = tokenizeLiveSearchText(normalizedQuery);
  const nameTokens = tokenizeLiveSearchText(normalizedName);

  if (allowProgram) {
    const normalizedProgram = normalizeSearchQuery(candidate.currentProgram ?? '');
    const programTokens = tokenizeLiveSearchText(normalizedProgram);
    if (normalizedProgram === normalizedQuery || (normalizedProgram && normalizedProgram.includes(normalizedQuery))) {
      return 'program';
    }
    if (normalizedProgram && tokensMatchQuery(queryTokens, programTokens)) {
      return 'program';
    }
  }

  if (normalizedName && normalizedName === normalizedQuery) {
    return 'exact';
  }

  if (normalizedName && normalizedName.startsWith(normalizedQuery)) {
    return 'prefix';
  }

  if (normalizedName && tokensMatchQuery(queryTokens, nameTokens)) {
    return 'token';
  }

  if (normalizedName && normalizedName.includes(normalizedQuery)) {
    return 'contains';
  }

  const numberText = candidate.number == null ? '' : String(candidate.number).trim();
  if (numberText && numberText === normalizedQuery) {
    return 'number';
  }

  if (allowCategory) {
    const normalizedCategory = normalizeSearchQuery(candidate.categoryName ?? '');
    if (normalizedCategory && normalizedCategory.includes(normalizedQuery)) {
      return 'category';
    }
  }

  return 'none';
}

export function compareLiveSearchCandidates(
  query: string,
  left: LiveSearchCandidate,
  right: LiveSearchCandidate,
  options?: { allowProgram?: boolean; allowCategory?: boolean },
) {
  const leftTier = computeLiveSearchMatchTier(query, left, options);
  const rightTier = computeLiveSearchMatchTier(query, right, options);
  const tierDiff = TIER_ORDER[leftTier] - TIER_ORDER[rightTier];
  if (tierDiff !== 0) {
    return tierDiff;
  }

  const nameDiff = left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
  if (nameDiff !== 0) {
    return nameDiff;
  }

  return left.id.localeCompare(right.id);
}

export function liveSearchCandidateMatches(
  query: string,
  candidate: LiveSearchCandidate,
  options?: { allowProgram?: boolean; allowCategory?: boolean },
) {
  return computeLiveSearchMatchTier(query, candidate, options) !== 'none';
}

export function liveSearchSqlRankCase() {
    return `CASE
          WHEN normalized_current = ? THEN 0
          WHEN normalized_title = ? THEN 1
          WHEN normalized_title LIKE ? ESCAPE '\\' THEN 2
          WHEN normalized_title LIKE ? ESCAPE '\\' THEN 4
          WHEN CAST(channel_number AS TEXT) = ? THEN 5
          WHEN normalized_current LIKE ? ESCAPE '\\' THEN 6
          ELSE 7
        END`;
}
