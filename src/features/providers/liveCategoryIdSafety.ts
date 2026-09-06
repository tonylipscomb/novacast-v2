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

// UI-only synthetic Live categories rendered at the top of the rail. These IDs
// must never reach Xtream category_id, provider fetches, or published SQLite.
export const LIVE_MY_CHANNELS_CATEGORY_ID = '__my_channels__';
export const LIVE_RECENTS_CATEGORY_ID = '__recents__';

const SYNTHETIC_LIVE_PERSONALIZATION_IDS = new Set([
  LIVE_MY_CHANNELS_CATEGORY_ID,
  LIVE_RECENTS_CATEGORY_ID,
]);

export function normalizeLiveCategoryId(categoryId: string | null | undefined): string {
  return String(categoryId ?? '').trim();
}

export function isSyntheticLiveFavoritesCategoryId(categoryId: string | null | undefined): boolean {
  const normalized = normalizeLiveCategoryId(categoryId).toLowerCase();
  return Boolean(normalized) && SYNTHETIC_LIVE_FAVORITES_IDS.has(normalized);
}

export function isSyntheticLiveMyChannelsCategoryId(categoryId: string | null | undefined): boolean {
  return normalizeLiveCategoryId(categoryId).toLowerCase() === LIVE_MY_CHANNELS_CATEGORY_ID;
}

export function isSyntheticLiveRecentsCategoryId(categoryId: string | null | undefined): boolean {
  return normalizeLiveCategoryId(categoryId).toLowerCase() === LIVE_RECENTS_CATEGORY_ID;
}

export function isSyntheticLivePersonalizationCategoryId(categoryId: string | null | undefined): boolean {
  return SYNTHETIC_LIVE_PERSONALIZATION_IDS.has(normalizeLiveCategoryId(categoryId).toLowerCase());
}

export function isSyntheticLiveCategoryId(categoryId: string | null | undefined): boolean {
  return isSyntheticLiveFavoritesCategoryId(categoryId) || isSyntheticLivePersonalizationCategoryId(categoryId);
}

export function isRealProviderLiveCategoryId(categoryId: string | null | undefined): boolean {
  const normalized = normalizeLiveCategoryId(categoryId);
  return Boolean(normalized) && normalized !== 'all' && !isSyntheticLiveCategoryId(normalized);
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
