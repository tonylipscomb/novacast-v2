import type { CatalogItemSort } from './catalogTypes.ts';

export const VALID_RELEASE_DATE_SQL =
  `(release_date IS NOT NULL AND TRIM(release_date) != '' AND release_date NOT LIKE '0000%' AND release_date != '0')`;

export const VALID_RELEASE_YEAR_SQL =
  `(release_year IS NOT NULL AND release_year >= 1900 AND release_year <= 2100)`;

export const VALID_ADDED_AT_SQL = `(added_at IS NOT NULL AND added_at > 0)`;

export const VALID_RATING_SQL = `(rating IS NOT NULL)`;

export const VALID_POPULARITY_SQL = `(popularity IS NOT NULL)`;

const PROVIDER_THEN_ID =
  '(provider_sort_order IS NULL) ASC, provider_sort_order ASC, content_id ASC';

export function isUsableReleaseDate(value: unknown): value is string {
  if (typeof value !== 'string' || !value.trim()) {
    return false;
  }
  const trimmed = value.trim();
  if (/^0+$/.test(trimmed) || trimmed.startsWith('0000')) {
    return false;
  }
  return true;
}

export function parseCatalogReleaseYear(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const year = Math.trunc(value);
    return year >= 1900 && year <= 2100 ? year : null;
  }
  if (typeof value === 'string' && value.trim()) {
    const exact = Number(value.trim());
    if (Number.isInteger(exact) && exact >= 1900 && exact <= 2100) {
      return exact;
    }
    const match = value.match(/\b(19|20)\d{2}\b/);
    if (match) {
      return Number.parseInt(match[0], 10);
    }
  }
  return null;
}

/** SQLite before 3.30 may not support NULLS LAST; use IS NULL / CASE. */
export function orderByClauseCompatible(sort: CatalogItemSort | undefined) {
  switch (sort) {
    case 'newest':
      return `CASE WHEN ${VALID_RELEASE_DATE_SQL} THEN 0 WHEN ${VALID_RELEASE_YEAR_SQL} THEN 1 WHEN ${VALID_ADDED_AT_SQL} THEN 2 ELSE 3 END ASC, release_date DESC, release_year DESC, added_at DESC, ${PROVIDER_THEN_ID}`;
    case 'oldest':
      return `CASE WHEN ${VALID_RELEASE_DATE_SQL} THEN 0 WHEN ${VALID_RELEASE_YEAR_SQL} THEN 1 ELSE 2 END ASC, release_date ASC, release_year ASC, ${PROVIDER_THEN_ID}`;
    case 'title-desc':
      return 'normalized_title DESC, content_id ASC';
    case 'rating':
      return `(rating IS NULL) ASC, rating DESC, normalized_title ASC, content_id ASC`;
    case 'recently-added':
      return `CASE WHEN ${VALID_ADDED_AT_SQL} THEN 0 ELSE 1 END ASC, added_at DESC, ${PROVIDER_THEN_ID}`;
    case 'popularity':
      return '(popularity IS NULL) ASC, popularity DESC, normalized_title ASC, content_id ASC';
    case 'provider':
      return `${PROVIDER_THEN_ID}`;
    case 'title':
    default:
      return 'normalized_title ASC, content_id ASC';
  }
}

export type CatalogSortMetadataCoverage = {
  rowCount: number;
  releaseDatePresentCount: number;
  releaseYearPresentCount: number;
  addedAtPresentCount: number;
  popularityPresentCount: number;
};

export type ContentSortEffectivePrimary =
  | 'release-date'
  | 'release-year'
  | 'added-at'
  | 'provider-order'
  | 'title'
  | 'rating'
  | 'popularity';

export function evaluateSortMetadataUpgradeNeed(coverage: CatalogSortMetadataCoverage) {
  return coverage.rowCount > 0 && coverage.addedAtPresentCount <= 0;
}

export function resolveContentSortEffectivePrimary(
  sort: CatalogItemSort | undefined,
  coverage: CatalogSortMetadataCoverage,
): { effectivePrimary: ContentSortEffectivePrimary; fallbackUsed: boolean } {
  switch (sort) {
    case 'newest':
      if (coverage.releaseDatePresentCount > 0) {
        return { effectivePrimary: 'release-date', fallbackUsed: false };
      }
      if (coverage.releaseYearPresentCount > 0) {
        return { effectivePrimary: 'release-year', fallbackUsed: false };
      }
      if (coverage.addedAtPresentCount > 0) {
        return { effectivePrimary: 'added-at', fallbackUsed: true };
      }
      return { effectivePrimary: 'provider-order', fallbackUsed: true };
    case 'oldest':
      if (coverage.releaseDatePresentCount > 0) {
        return { effectivePrimary: 'release-date', fallbackUsed: false };
      }
      if (coverage.releaseYearPresentCount > 0) {
        return { effectivePrimary: 'release-year', fallbackUsed: false };
      }
      return { effectivePrimary: 'provider-order', fallbackUsed: true };
    case 'recently-added':
      if (coverage.addedAtPresentCount > 0) {
        return { effectivePrimary: 'added-at', fallbackUsed: false };
      }
      return { effectivePrimary: 'provider-order', fallbackUsed: true };
    case 'rating':
      return { effectivePrimary: 'rating', fallbackUsed: false };
    case 'popularity':
      return {
        effectivePrimary: 'popularity',
        fallbackUsed: coverage.popularityPresentCount <= 0,
      };
    case 'title-desc':
    case 'title':
      return { effectivePrimary: 'title', fallbackUsed: false };
    default:
      return { effectivePrimary: 'title', fallbackUsed: false };
  }
}

export const CATALOG_SORT_COVERAGE_SELECT = `
  COUNT(*) AS row_count,
  SUM(CASE WHEN ${VALID_RELEASE_DATE_SQL} THEN 1 ELSE 0 END) AS release_date_present,
  SUM(CASE WHEN ${VALID_RELEASE_YEAR_SQL} THEN 1 ELSE 0 END) AS release_year_present,
  SUM(CASE WHEN ${VALID_ADDED_AT_SQL} THEN 1 ELSE 0 END) AS added_at_present,
  SUM(CASE WHEN ${VALID_POPULARITY_SQL} THEN 1 ELSE 0 END) AS popularity_present
`;
