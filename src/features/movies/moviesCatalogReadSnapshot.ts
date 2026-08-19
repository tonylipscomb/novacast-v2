/**
 * Stage 4.2E — immutable Movies read snapshot.
 * Interactive browsing must pin categories + items to one readable generation.
 */

import type { MovieCategory } from './movieTypes.ts';
import { ALL_MOVIES_CATEGORY_ID } from './moviesVisibleCategories.ts';

export type MoviesCatalogReadSnapshot = {
  providerId: string;
  readableGeneration: number;
  categoriesGeneration: number;
  itemsGeneration: number;
  categories: MovieCategory[];
  groupedCounts: Array<{ categoryId: string; itemCount: number }>;
  totalMovieCount: number;
  selectedCategoryId: string | null;
  metadataCategoryCount: number;
  groupedCountRows: number;
  nonzeroCategoryCount: number;
  zeroCountCategoryCount: number;
  interactiveCategoryCount: number;
  generationAligned: boolean;
};

export function isAlignedMoviesCatalogReadSnapshot(
  snapshot: Pick<
    MoviesCatalogReadSnapshot,
    'readableGeneration' | 'categoriesGeneration' | 'itemsGeneration'
  >,
): boolean {
  const { readableGeneration, categoriesGeneration, itemsGeneration } = snapshot;
  return (
    readableGeneration > 0 &&
    categoriesGeneration === readableGeneration &&
    itemsGeneration === readableGeneration
  );
}

/** Interactive provider rail: hide known-zero provider categories; keep All/smart/sections. */
export function filterInteractiveMovieCategories(
  categories: readonly MovieCategory[],
): MovieCategory[] {
  return categories.filter((category) => {
    if (category.id === ALL_MOVIES_CATEGORY_ID) {
      return true;
    }
    if (category.kind === 'section') {
      return true;
    }
    if (category.kind === 'smart' || category.id.startsWith('smart:')) {
      return true;
    }
    // Never infer nonzero from metadata presence alone.
    if (category.countKnown === true && category.count <= 0) {
      return false;
    }
    return true;
  });
}

export function buildMoviesCatalogReadSnapshot(input: {
  providerId: string;
  readableGeneration: number;
  categories: MovieCategory[];
  metadataCategoryCount: number;
  groupedCountRows: number;
  totalMovieCount: number;
  selectedCategoryId?: string | null;
}): MoviesCatalogReadSnapshot {
  const interactive = filterInteractiveMovieCategories(input.categories);
  const providerInteractive = interactive.filter(
    (category) =>
      category.id !== ALL_MOVIES_CATEGORY_ID &&
      category.kind !== 'section' &&
      category.kind !== 'smart' &&
      !category.id.startsWith('smart:'),
  );
  const groupedCounts = providerInteractive.map((category) => ({
    categoryId: category.id,
    itemCount: category.count,
  }));
  // GROUP BY rows are only categories with items — that is the nonzero count.
  const nonzeroCategoryCount =
    input.groupedCountRows > 0
      ? input.groupedCountRows
      : providerInteractive.filter((category) => category.count > 0).length;
  const zeroCountCategoryCount = Math.max(0, input.metadataCategoryCount - nonzeroCategoryCount);

  const snapshot: MoviesCatalogReadSnapshot = {
    providerId: input.providerId,
    readableGeneration: input.readableGeneration,
    categoriesGeneration: input.readableGeneration,
    itemsGeneration: input.readableGeneration,
    categories: interactive,
    groupedCounts,
    totalMovieCount: input.totalMovieCount,
    selectedCategoryId: input.selectedCategoryId ?? null,
    metadataCategoryCount: input.metadataCategoryCount,
    groupedCountRows: input.groupedCountRows,
    nonzeroCategoryCount,
    zeroCountCategoryCount,
    interactiveCategoryCount: providerInteractive.length,
    generationAligned: false,
  };
  snapshot.generationAligned = isAlignedMoviesCatalogReadSnapshot(snapshot);
  return snapshot;
}

export function logMoviesCatalogReadSnapshot(snapshot: MoviesCatalogReadSnapshot, reason: string) {
  console.info(
    '[NovaCast Movies Read Snapshot] ' +
      JSON.stringify({
        providerId: snapshot.providerId,
        readableGeneration: snapshot.readableGeneration,
        categoriesGeneration: snapshot.categoriesGeneration,
        itemsGeneration: snapshot.itemsGeneration,
        generationAligned: snapshot.generationAligned,
        metadataCategoryCount: snapshot.metadataCategoryCount,
        groupedCountRows: snapshot.groupedCountRows,
        nonzeroCategoryCount: snapshot.nonzeroCategoryCount,
        zeroCountCategoryCount: snapshot.zeroCountCategoryCount,
        interactiveCategoryCount: snapshot.interactiveCategoryCount,
        totalMovieCount: snapshot.totalMovieCount,
        selectedCategoryId: snapshot.selectedCategoryId,
        reason,
        marker: 'stage4e-atomic-generation-pinning-v1',
      }),
  );
}
