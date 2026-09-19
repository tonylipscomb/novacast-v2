import type { ProviderCategoryContentType } from './categoryNormalization.ts';
import { CATEGORY_REGION_PREFIX_CODES } from './categoryRegionalConfig.ts';
import { resolveCategoryDisplayName } from './categoryRegionalPipeline.ts';
import { displayCategoryName } from '../series/metadata/titleNormalization.ts';

export type ProviderCategoryDisplayInput = {
  name: string;
  rawName?: string;
  countryCode?: string;
  contentType?: ProviderCategoryContentType;
  kind?: 'provider' | 'smart' | 'section';
  /** Strip a leading regional presentation code (e.g. `US Sports` -> `Sports`) for display-only surfaces. */
  stripRegionPrefix?: boolean;
};

/** Remove only explicit two-letter regional presentation markers from Movies UI.
 * The source label remains unchanged for sorting/classification and `USA` is
 * intentionally excluded because it can be part of a legitimate name.
 */
function stripMovieRegionDisplayPrefix(name: string) {
  const match = name.trim().match(/^([A-Z]{2})\s+(.+)$/);
  if (!match || !CATEGORY_REGION_PREFIX_CODES.has(match[1])) {
    return name;
  }
  return match[2].trim();
}

export function displayProviderCategoryName(input: ProviderCategoryDisplayInput) {
  if (input.kind && input.kind !== 'provider') {
    return displayCategoryName(input.name);
  }

  // `USA Network` is a real network/category name, not a region marker.
  // Preserve it before the shared US-category formatter treats `USA` as a
  // label prefix. Other display cleanup remains limited to recognized codes.
  if ((input.contentType === 'movie' || input.contentType === 'series') && /^USA Network(?:\s|$)/i.test(input.name.trim())) {
    return input.name.trim();
  }

  const displayName = resolveCategoryDisplayName({
    name: input.name,
    rawName: input.rawName,
    countryCode: input.countryCode,
    contentType: input.contentType ?? 'live',
  });

  return input.contentType === 'movie' || input.contentType === 'series' || input.stripRegionPrefix
    ? stripMovieRegionDisplayPrefix(displayName)
    : displayName;
}
