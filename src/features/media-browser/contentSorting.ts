import { normalizeMediaTitle } from '../series/metadata/titleNormalization.ts';

import { isValidRating, normalizeRating } from './ratingNormalization.ts';

export type ContentSortOption =
  | 'newest'
  | 'oldest'
  | 'title-asc'
  | 'title-desc'
  | 'rating-desc'
  | 'popularity-desc'
  | 'recently-added';

export const CONTENT_SORT_OPTIONS: { value: ContentSortOption; label: string }[] = [
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'title-asc', label: 'A-Z' },
  { value: 'title-desc', label: 'Z-A' },
  { value: 'rating-desc', label: 'Highest Rated' },
  { value: 'popularity-desc', label: 'Most Popular' },
  { value: 'recently-added', label: 'Recently Added' },
];

export const DEFAULT_CONTENT_SORT: ContentSortOption = 'newest';

const INVALID_DATE_STRING = /^(?:0000(?:-0{1,2})?(?:-0{1,2})?|0000)$/i;
const MIN_VALID_DATE_MS = Date.UTC(1900, 0, 1);
const MAX_FUTURE_RELEASE_MS = Date.now() + 5 * 365 * 24 * 60 * 60 * 1000;

export function isContentSortOption(value: unknown): value is ContentSortOption {
  return CONTENT_SORT_OPTIONS.some((option) => option.value === value);
}

function isPlausibleTimestamp(timestamp: number, allowFuture = false) {
  if (timestamp < MIN_VALID_DATE_MS) {
    return false;
  }
  if (allowFuture) {
    return timestamp <= MAX_FUTURE_RELEASE_MS;
  }
  return timestamp <= Date.now();
}

export function normalizeReleaseDate(value: unknown, options: { allowFuture?: boolean } = {}) {
  const allowFuture = options.allowFuture === true;

  if (typeof value === 'number' && Number.isFinite(value)) {
    const normalized = value > 1_000_000_000_000 ? value : value > 1_000_000_000 ? value * 1000 : value;
    return isPlausibleTimestamp(normalized, allowFuture) ? normalized : 0;
  }

  if (typeof value !== 'string' || !value.trim()) {
    return 0;
  }

  const trimmed = value.trim();
  if (INVALID_DATE_STRING.test(trimmed)) {
    return 0;
  }

  const numeric = Number(trimmed);
  if (Number.isFinite(numeric)) {
    const normalized = numeric > 1_000_000_000_000 ? numeric : numeric > 1_000_000_000 ? numeric * 1000 : numeric;
    return isPlausibleTimestamp(normalized, allowFuture) ? normalized : 0;
  }

  const year = /^\d{4}$/.test(trimmed) ? Number(trimmed) : 0;
  if (year >= 1900 && year <= 2100) {
    return Date.UTC(year, 0, 1);
  }

  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) && isPlausibleTimestamp(parsed, allowFuture) ? parsed : 0;
}

export function normalizeAddedTimestamp(value: unknown) {
  return normalizeReleaseDate(value, { allowFuture: false });
}

export { isValidRating, normalizeRating } from './ratingNormalization.ts';

export function normalizeTitleForSort(value: unknown) {
  const displayTitle = normalizeMediaTitle(String(value ?? '')) || String(value ?? '');
  return displayTitle
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .trim();
}

export function getSeriesLatestEpisodeDate(value: {
  latestEpisodeDate?: unknown;
  releaseDate?: unknown;
  addedAt?: unknown;
  year?: unknown;
}) {
  return (
    normalizeReleaseDate(value.latestEpisodeDate) ||
    normalizeReleaseDate(value.releaseDate) ||
    normalizeAddedTimestamp(value.addedAt) ||
    normalizeReleaseDate(value.year)
  );
}

type SortableContent = {
  id: string;
  title: string;
  year?: string | number;
  rating?: string | number;
  popularity?: string | number;
  addedAt?: string | number;
  releaseDate?: string | number;
  latestEpisodeDate?: string | number;
};

function dateFor(item: SortableContent, kind: 'movie' | 'series') {
  if (kind === 'series') {
    return getSeriesLatestEpisodeDate(item);
  }

  return normalizeReleaseDate(item.releaseDate) || normalizeAddedTimestamp(item.addedAt) || normalizeReleaseDate(item.year);
}

function compareMissingLast(left: number, right: number, descending: boolean) {
  if (!left && !right) return 0;
  if (!left) return 1;
  if (!right) return -1;
  return descending ? right - left : left - right;
}

export function compareContentItems(
  left: SortableContent,
  right: SortableContent,
  option: ContentSortOption,
  kind: 'movie' | 'series',
) {
  let result = 0;
  switch (option) {
    case 'oldest':
      result = compareMissingLast(dateFor(left, kind), dateFor(right, kind), false);
      break;
    case 'title-asc':
      result = normalizeTitleForSort(left.title).localeCompare(normalizeTitleForSort(right.title));
      break;
    case 'title-desc':
      result = normalizeTitleForSort(right.title).localeCompare(normalizeTitleForSort(left.title));
      break;
    case 'rating-desc':
      result = compareMissingLast(normalizeRating(left.rating), normalizeRating(right.rating), true);
      break;
    case 'popularity-desc':
      result = compareMissingLast(normalizeRating(left.popularity), normalizeRating(right.popularity), true);
      break;
    case 'recently-added':
      result = compareMissingLast(normalizeAddedTimestamp(left.addedAt), normalizeAddedTimestamp(right.addedAt), true);
      break;
    case 'newest':
    default:
      result = compareMissingLast(dateFor(left, kind), dateFor(right, kind), true);
      break;
  }

  return result || normalizeTitleForSort(left.title).localeCompare(normalizeTitleForSort(right.title)) || left.id.localeCompare(right.id);
}

export function sortContentItems<T extends SortableContent>(
  items: T[],
  option: ContentSortOption = DEFAULT_CONTENT_SORT,
  kind: 'movie' | 'series',
) {
  return [...items].sort((left, right) => compareContentItems(left, right, option, kind));
}

export function contentSortLabel(option: ContentSortOption) {
  return CONTENT_SORT_OPTIONS.find((item) => item.value === option)?.label ?? 'Newest';
}

export function categoryHasValidRatings(items: { rating?: string | number }[]) {
  return items.some((item) => isValidRating(item.rating));
}

export function resolveEffectiveSort(
  requested: ContentSortOption,
  items: { rating?: string | number }[],
): ContentSortOption {
  if (requested === 'rating-desc' && !categoryHasValidRatings(items)) {
    return DEFAULT_CONTENT_SORT;
  }
  return requested;
}

export function getVisibleSortOptions(hasValidRatings: boolean) {
  return CONTENT_SORT_OPTIONS.filter((option) => option.value !== 'rating-desc' || hasValidRatings);
}

export function sortAuditField(item: SortableContent, option: ContentSortOption, kind: 'movie' | 'series') {
  switch (option) {
    case 'title-asc':
    case 'title-desc':
      return normalizeTitleForSort(item.title);
    case 'rating-desc':
      return normalizeRating(item.rating);
    case 'popularity-desc':
      return normalizeRating(item.popularity);
    case 'recently-added':
      return normalizeAddedTimestamp(item.addedAt);
    case 'oldest':
    case 'newest':
    default:
      return dateFor(item, kind);
  }
}

export function paginateSortedItems<T>(items: T[], offset: number, limit: number) {
  const pageItems = items.slice(offset, offset + limit);
  return {
    items: pageItems,
    totalCount: items.length,
    hasMore: offset + pageItems.length < items.length,
  };
}

export type ContentSortPageMetadata = {
  knownCategoryTotal: number;
  itemsConsideredForSort: number;
  sortComplete: boolean;
  hasValidRatings?: boolean;
};

export function buildContentSortPageMetadata(
  knownCategoryTotal: number,
  itemsConsideredForSort: number,
  hasValidRatings?: boolean,
): ContentSortPageMetadata {
  return {
    knownCategoryTotal,
    itemsConsideredForSort,
    sortComplete: knownCategoryTotal === itemsConsideredForSort,
    hasValidRatings,
  };
}
