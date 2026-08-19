const SYNTHETIC_LIVE_FAVORITES_IDS = new Set([
  'favorites',
  'favorite',
  'favourites',
  'favourite',
  '__favorites__',
  'my-favorites',
  'my_favorites',
]);

export const LIVE_FAVORITES_PSEUDO_CATEGORY_ID = 'favorites';

export function normalizeLiveCategoryId(categoryId: string | null | undefined): string {
  return String(categoryId ?? '').trim();
}

export function isSyntheticLiveFavoritesCategoryId(categoryId: string | null | undefined): boolean {
  const normalized = normalizeLiveCategoryId(categoryId).toLowerCase();
  return Boolean(normalized) && SYNTHETIC_LIVE_FAVORITES_IDS.has(normalized);
}

export function isRealProviderLiveCategoryId(categoryId: string | null | undefined): boolean {
  const normalized = normalizeLiveCategoryId(categoryId);
  return Boolean(normalized) && normalized !== 'all' && !isSyntheticLiveFavoritesCategoryId(normalized);
}

export function providerLiveCategoriesOnly<T extends { id: string }>(categories: readonly T[]): T[] {
  return categories.filter((category) => isRealProviderLiveCategoryId(category.id));
}

export function resolveInitialLiveBrowseCategoryId(
  requestedId: string | null | undefined,
  providerCategories: readonly { id: string }[],
): string {
  const realCategories = providerLiveCategoriesOnly(providerCategories);
  const requested = normalizeLiveCategoryId(requestedId);
  if (isRealProviderLiveCategoryId(requested) && realCategories.some((category) => category.id === requested)) {
    return requested;
  }
  return realCategories[0]?.id ?? '';
}

export function sanitizePersistedLiveCategoryId(categoryId: string | null | undefined): string {
  return isRealProviderLiveCategoryId(categoryId) ? normalizeLiveCategoryId(categoryId) : '';
}
