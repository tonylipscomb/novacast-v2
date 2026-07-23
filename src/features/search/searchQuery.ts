import { SEARCH_MIN_QUERY_LENGTH } from './searchConstants.ts';

const PUNCTUATION_PATTERN = /[''`´]/g;
const HYPHEN_UNDERSCORE_PATTERN = /[-_]+/g;
const WHITESPACE_PATTERN = /\s+/g;
const NON_ALNUM_PATTERN = /[^\p{L}\p{N}\s-]/gu;

/**
 * Normalize a user search query for case-insensitive comparison.
 * Preserves short tokens like "6", "HD", "BET", and "IT".
 */
export function normalizeSearchQuery(query: string): string {
  return query
    .trim()
    .replace(WHITESPACE_PATTERN, ' ')
    .toLocaleLowerCase()
    .replace(PUNCTUATION_PATTERN, '')
    .replace(HYPHEN_UNDERSCORE_PATTERN, ' ')
    .replace(NON_ALNUM_PATTERN, ' ')
    .replace(WHITESPACE_PATTERN, ' ')
    .trim();
}

/** @deprecated Use normalizeSearchQuery instead. */
export function normalizeQuery(query: string) {
  return normalizeSearchQuery(query);
}

export function isWhitespaceOnlyQuery(query: string) {
  return query.trim().length === 0;
}

/**
 * Returns true when the query is long enough to search, or is a valid short
 * token such as a channel number or short channel name.
 */
export function isSearchableQuery(query: string): boolean {
  const trimmed = query.trim();
  if (!trimmed) {
    return false;
  }

  const normalized = normalizeSearchQuery(trimmed);
  if (!normalized) {
    return false;
  }

  if (normalized.length >= SEARCH_MIN_QUERY_LENGTH) {
    return true;
  }

  // Allow exact numeric channel searches (e.g. "6").
  if (/^\d+$/.test(normalized)) {
    return true;
  }

  // Allow short uppercase-style channel tokens (e.g. "HD", "BET", "IT").
  if (/^[a-z0-9]{2,3}$/i.test(trimmed)) {
    return true;
  }

  return false;
}

/** Escape SQL LIKE wildcard characters for safe parameterized queries. */
export function escapeLikeWildcards(value: string) {
  return value.replace(/[%_\\]/g, '\\$&');
}

export function tokenizeSearchQuery(query: string) {
  const normalized = normalizeSearchQuery(query);
  if (!normalized) {
    return [] as string[];
  }

  return normalized.split(' ').filter(Boolean);
}
