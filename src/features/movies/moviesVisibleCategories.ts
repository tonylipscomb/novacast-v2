import type { MovieCategory } from './movieTypes';

/** Synthetic All Movies — keep available internally; hide from the normal rail. */
export const ALL_MOVIES_CATEGORY_ID = 'all';

export type MoviesInitialCategoryReason =
  | 'first-populated-provider-category'
  | 'preserved-existing-selection'
  | 'selected-category-missing'
  | 'no-visible-categories'
  | 'no-nonzero-provider-category';

const MARKER = 'stage4e-atomic-generation-pinning-v1';

export function getVisibleMovieCategories(categories: readonly MovieCategory[]): MovieCategory[] {
  return categories.filter((category) => category.id !== ALL_MOVIES_CATEGORY_ID);
}

/** Rail data: hide All Movies unless that would leave no selectable rows. */
export function getMovieCategoryRailCategories(categories: readonly MovieCategory[]): MovieCategory[] {
  const visible = getVisibleMovieCategories(categories);
  const hasSelectableVisible = visible.some(
    (category) => category.kind !== 'section' && category.id !== ALL_MOVIES_CATEGORY_ID,
  );
  if (hasSelectableVisible) {
    return visible;
  }
  return [...categories];
}

function isSelectableCategory(category: MovieCategory) {
  return category.kind !== 'section';
}

function isVisibleProviderCategory(category: MovieCategory) {
  return (
    isSelectableCategory(category) &&
    category.id !== ALL_MOVIES_CATEGORY_ID &&
    category.kind !== 'smart' &&
    !category.id.startsWith('smart:')
  );
}

function isPopulatedProviderCategory(category: MovieCategory) {
  if (!isVisibleProviderCategory(category)) {
    return false;
  }
  // Never auto-select a known-empty provider category.
  if (category.countKnown === true && category.count <= 0) {
    return false;
  }
  return true;
}

function isValidPersistedSelection(categories: readonly MovieCategory[], categoryId?: string | null) {
  if (!categoryId || categoryId === ALL_MOVIES_CATEGORY_ID) {
    return false;
  }
  if (categoryId.startsWith('smart:') || categoryId.startsWith('section:')) {
    return false;
  }
  return categories.some(
    (category) => category.id === categoryId && isPopulatedProviderCategory(category),
  );
}

function pickFirstPopulatedProviderCategory(visibleProviderCategories: MovieCategory[]) {
  return (
    visibleProviderCategories.find((category) => isPopulatedProviderCategory(category)) ?? null
  );
}

export function resolveMoviesInitialCategory(input: {
  categories: readonly MovieCategory[];
  previousCategoryId?: string | null;
  rememberedCategoryId?: string | null;
}): {
  selectedCategoryId: string;
  visibleCategoryCount: number;
  usedAllMoviesFallback: boolean;
  reason: MoviesInitialCategoryReason;
  /** True only for init / fallback decisions — not ordinary preserve-on-refresh. */
  shouldLog: boolean;
} {
  const visible = getVisibleMovieCategories(input.categories);
  const visibleProviderCategories = visible.filter(isVisibleProviderCategory);
  const populatedProviderCategories = visibleProviderCategories.filter(isPopulatedProviderCategory);
  const visibleCategoryCount = populatedProviderCategories.length;
  const allMovies = input.categories.find((category) => category.id === ALL_MOVIES_CATEGORY_ID);
  const previous = input.previousCategoryId ?? '';

  if (isValidPersistedSelection(input.categories, previous)) {
    return {
      selectedCategoryId: previous,
      visibleCategoryCount,
      usedAllMoviesFallback: false,
      reason: 'preserved-existing-selection',
      shouldLog: false,
    };
  }

  if (isValidPersistedSelection(input.categories, input.rememberedCategoryId)) {
    return {
      selectedCategoryId: input.rememberedCategoryId as string,
      visibleCategoryCount,
      usedAllMoviesFallback: false,
      reason: 'preserved-existing-selection',
      shouldLog: true,
    };
  }

  if (visibleProviderCategories.length === 0) {
    return {
      selectedCategoryId: allMovies?.id ?? ALL_MOVIES_CATEGORY_ID,
      visibleCategoryCount: 0,
      usedAllMoviesFallback: true,
      reason: 'no-visible-categories',
      shouldLog: true,
    };
  }

  const picked = pickFirstPopulatedProviderCategory(visibleProviderCategories);
  if (!picked) {
    return {
      selectedCategoryId: allMovies?.id ?? ALL_MOVIES_CATEGORY_ID,
      visibleCategoryCount,
      usedAllMoviesFallback: true,
      reason: 'no-nonzero-provider-category',
      shouldLog: true,
    };
  }

  const reason: MoviesInitialCategoryReason =
    previous && previous !== ALL_MOVIES_CATEGORY_ID
      ? 'selected-category-missing'
      : 'first-populated-provider-category';

  return {
    selectedCategoryId: picked.id,
    visibleCategoryCount,
    usedAllMoviesFallback: false,
    reason,
    shouldLog: true,
  };
}

export function logMoviesInitialCategory(payload: {
  providerId: string;
  readableGeneration: number | null;
  previousCategoryId: string | null;
  selectedCategoryId: string;
  visibleCategoryCount: number;
  usedAllMoviesFallback: boolean;
  reason: MoviesInitialCategoryReason;
}) {
  console.info(
    '[NovaCast Movies Initial Category] ' +
      JSON.stringify({
        ...payload,
        marker: MARKER,
      }),
  );
}
