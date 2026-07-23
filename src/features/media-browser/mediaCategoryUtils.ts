import type { MediaCategory } from './mediaTypes';

import { LEGACY_SMART_CATEGORY_KEY_DISCOVER, SMART_CATEGORY_KEY_FEATURES } from './newReleasesCuration.ts';

export function normalizeSelectedSmartCategoryId(categoryId?: string | null) {
  if (!categoryId) {
    return categoryId ?? '';
  }

  if (categoryId === `smart:${LEGACY_SMART_CATEGORY_KEY_DISCOVER}`) {
    return `smart:${SMART_CATEGORY_KEY_FEATURES}`;
  }

  return categoryId;
}

export function isFeaturesSmartCategoryId(categoryId?: string | null) {
  return categoryId === `smart:${SMART_CATEGORY_KEY_FEATURES}` || categoryId === `smart:${LEGACY_SMART_CATEGORY_KEY_DISCOVER}`;
}

export function isSectionCategoryId(categoryId: string) {
  return categoryId.startsWith('section:');
}

export function isSmartCategoryId(categoryId: string) {
  return categoryId.startsWith('smart:');
}

export function isProviderCategory(category: MediaCategory) {
  return category.kind === 'provider' || (!isSmartCategoryId(category.id) && !isSectionCategoryId(category.id));
}

export const DEFAULT_BROWSE_CATEGORY_ID = `smart:${SMART_CATEGORY_KEY_FEATURES}`;

export function findDefaultBrowseCategoryId(categories: MediaCategory[]) {
  const features = categories.find(
    (category) => category.id === DEFAULT_BROWSE_CATEGORY_ID && category.kind !== 'section',
  );
  if (features) {
    return DEFAULT_BROWSE_CATEGORY_ID;
  }

  return findDefaultProviderCategoryId(categories);
}

export function findDefaultProviderCategoryId(categories: MediaCategory[]) {
  const provider = categories.find((category) => category.kind === 'provider');
  if (provider) {
    return provider.id;
  }

  const legacyProvider = categories.find((category) => isProviderCategory(category) && category.kind !== 'section');
  if (legacyProvider) {
    return legacyProvider.id;
  }

  const smart = categories.find((category) => category.kind === 'smart');
  if (smart) {
    return smart.id;
  }

  return categories.find((category) => category.kind !== 'section')?.id ?? '';
}

export function prioritizeCategoryIds(categoryIds: string[], selectedCategoryId?: string, limit = 5) {
  const unique = [...new Set(categoryIds.filter(Boolean))];
  if (!selectedCategoryId) {
    return unique.slice(0, limit);
  }

  return [...new Set([selectedCategoryId, ...unique.filter((id) => id !== selectedCategoryId)])].slice(0, limit);
}
