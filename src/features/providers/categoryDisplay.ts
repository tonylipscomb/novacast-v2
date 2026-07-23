import type { ProviderCategoryContentType } from './categoryNormalization.ts';
import { resolveCategoryDisplayName } from './categoryRegionalPipeline.ts';
import { displayCategoryName } from '../series/metadata/titleNormalization.ts';

export type ProviderCategoryDisplayInput = {
  name: string;
  rawName?: string;
  countryCode?: string;
  contentType?: ProviderCategoryContentType;
  kind?: 'provider' | 'smart' | 'section';
};

export function displayProviderCategoryName(input: ProviderCategoryDisplayInput) {
  if (input.kind && input.kind !== 'provider') {
    return displayCategoryName(input.name);
  }

  return resolveCategoryDisplayName({
    name: input.name,
    rawName: input.rawName,
    countryCode: input.countryCode,
    contentType: input.contentType ?? 'live',
  });
}
