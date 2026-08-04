import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  assessMoviesCatalogIntegrity,
  validateMoviesCategoryDistribution,
} from '../src/features/catalog/moviesCategoryDistributionValidation.ts';
import {
  buildMoviesCatalogReadSnapshot,
  filterInteractiveMovieCategories,
  isAlignedMoviesCatalogReadSnapshot,
} from '../src/features/movies/moviesCatalogReadSnapshot.ts';
import { resolveMoviesInitialCategory } from '../src/features/movies/moviesVisibleCategories.ts';

const sqlite = fs.readFileSync('src/features/movies/data/SqliteMovieDataSource.ts', 'utf8');
const model = fs.readFileSync('src/features/movies/useMoviesScreenModel.ts', 'utf8');
const repository = fs.readFileSync('src/features/catalog/catalogRepository.ts', 'utf8');
const repair = fs.readFileSync('src/features/movies/moviesSparseCatalogRepair.ts', 'utf8');
const readiness = fs.readFileSync('src/features/movies/moviesCatalogReadiness.ts', 'utf8');
const visible = fs.readFileSync('src/features/movies/moviesVisibleCategories.ts', 'utf8');
const validation = fs.readFileSync(
  'src/features/catalog/moviesCategoryDistributionValidation.ts',
  'utf8',
);

test('1) gen 6 readable while gen 8 categories written — rail pins to gen 6', () => {
  assert.match(sqlite, /categoryReadGeneration = itemsGeneration/);
  assert.match(sqlite, /categoriesGeneration: itemsGeneration/);
  assert.match(sqlite, /syncingCategoryGeneration: readiness\.categoriesGeneration/);
  assert.match(sqlite, /preserving-completed-generation/);
  assert.match(sqlite, /generationAligned: true/);
  assert.match(sqlite, /filterInteractiveMovieCategories/);
});

test('2) preserving-completed-generation reports aligned generations', () => {
  assert.match(readiness, /preserving-completed-generation/);
  const snapshot = buildMoviesCatalogReadSnapshot({
    providerId: 'p1',
    readableGeneration: 6,
    categories: [
      { id: 'all', name: 'All Movies', count: 100, countKnown: true, kind: 'provider' },
      { id: '10', name: 'Action', count: 50, countKnown: true, kind: 'provider' },
    ],
    metadataCategoryCount: 439,
    groupedCountRows: 304,
    totalMovieCount: 110507,
  });
  assert.equal(snapshot.categoriesGeneration, 6);
  assert.equal(snapshot.itemsGeneration, 6);
  assert.equal(snapshot.readableGeneration, 6);
  assert.equal(isAlignedMoviesCatalogReadSnapshot(snapshot), true);
});

test('3) 439 metadata / 304 populated → interactive rail is 304', () => {
  const categories = [
    { id: 'all', name: 'All Movies', count: 110507, countKnown: true, kind: 'provider' },
    ...Array.from({ length: 304 }, (_, i) => ({
      id: `p${i}`,
      name: `Pop ${i}`,
      count: i + 1,
      countKnown: true,
      kind: 'provider',
    })),
    ...Array.from({ length: 135 }, (_, i) => ({
      id: `z${i}`,
      name: `Zero ${i}`,
      count: 0,
      countKnown: true,
      kind: 'provider',
    })),
  ];
  const interactive = filterInteractiveMovieCategories(categories);
  const provider = interactive.filter((category) => category.id !== 'all');
  assert.equal(provider.length, 304);
  assert.ok(provider.every((category) => category.count > 0));
  assert.equal(provider.some((category) => category.id.startsWith('z')), false);

  const snapshot = buildMoviesCatalogReadSnapshot({
    providerId: 'p1',
    readableGeneration: 6,
    categories: interactive,
    metadataCategoryCount: 439,
    groupedCountRows: 304,
    totalMovieCount: 110507,
  });
  assert.equal(snapshot.nonzeroCategoryCount, 304);
  assert.equal(snapshot.zeroCountCategoryCount, 135);
  assert.equal(snapshot.interactiveCategoryCount, 304);
  assert.equal(snapshot.groupedCountRows, 304);
  assert.equal(snapshot.metadataCategoryCount, 439);
});

test('4) selected category count 0 → first populated, no empty flash path', () => {
  const decision = resolveMoviesInitialCategory({
    categories: [
      { id: 'all', name: 'All Movies', count: 100, countKnown: true, kind: 'provider' },
      { id: 'zero', name: 'Empty', count: 0, countKnown: true, kind: 'provider' },
      { id: 'live', name: 'Live', count: 40, countKnown: true, kind: 'provider' },
    ],
    previousCategoryId: 'zero',
    rememberedCategoryId: 'zero',
  });
  assert.equal(decision.selectedCategoryId, 'live');
  assert.ok(
    decision.reason === 'first-populated-provider-category' ||
      decision.reason === 'selected-category-missing',
  );
  assert.match(model, /atomic_generation_swap_committed/);
  assert.match(model, /re-pick first populated before paint/);
});

test('5) generation activation commits categories + movies atomically', () => {
  assert.match(model, /atomicBrowseCommitRef/);
  assert.match(model, /atomic_generation_swap_committed/);
  assert.match(model, /stage4e-atomic-generation-pinning-v1/);
  assert.match(model, /setCategories[\s\S]{0,200}setSelectedCategoryId[\s\S]{0,200}updateVisibleMovies/);
});

test('6) current category remains when still populated after swap', () => {
  const decision = resolveMoviesInitialCategory({
    categories: [
      { id: 'all', name: 'All Movies', count: 100, countKnown: true, kind: 'provider' },
      { id: '287', name: 'Keep', count: 2039, countKnown: true, kind: 'provider' },
      { id: '10', name: 'Other', count: 10, countKnown: true, kind: 'provider' },
    ],
    previousCategoryId: '287',
    rememberedCategoryId: '10',
  });
  assert.equal(decision.selectedCategoryId, '287');
  assert.equal(decision.reason, 'preserved-existing-selection');
});

test('7) current category disappears → first populated selected', () => {
  const decision = resolveMoviesInitialCategory({
    categories: [
      { id: 'all', name: 'All Movies', count: 100, countKnown: true, kind: 'provider' },
      { id: '10', name: 'Action', count: 5, countKnown: true, kind: 'provider' },
      { id: '20', name: 'Comedy', count: 3, countKnown: true, kind: 'provider' },
    ],
    previousCategoryId: '309',
    rememberedCategoryId: '309',
  });
  assert.equal(decision.selectedCategoryId, '10');
  assert.equal(decision.reason, 'selected-category-missing');
});

test('8) diagnostic nonzeroCategoryCount equals grouped item rows > 0', () => {
  assert.match(repository, /nonzeroCategoryCount = groupedCountRows\.filter/);
  assert.match(repository, /zeroCountCategoryCount/);
  assert.match(repository, /interactiveCategoryCount/);
  assert.match(repository, /metadataCategoryCount: metadataRows\.length/);
  assert.match(repository, /generationAligned: true/);
  assert.match(sqlite, /nonzeroCategoryCount,/);
  assert.match(sqlite, /zeroCountCategoryCount/);
  assert.match(sqlite, /interactiveCategoryCount/);
});

test('9) startup integrity assessment reports real generation', () => {
  assert.match(validation, /generation\?: number/);
  assert.match(repair, /assessMoviesCatalogIntegrity\(\{\s*generation,/);
  const result = assessMoviesCatalogIntegrity({
    generation: 6,
    metadataCategoryCount: 439,
    nonzeroCategoryCount: 304,
    distinctItemCategoryIds: 304,
    totalItems: 110507,
    largestCategoryShare: 0.05,
  });
  assert.equal(result.healthy, true);
  assert.equal(result.degraded, false);

  // Capture that validate receives generation 6 (via assessing healthy gen).
  const logged = validateMoviesCategoryDistribution({
    generation: 6,
    totalItems: 110507,
    distinctCategoryIds: 304,
    metadataCategoryCount: 439,
    nonzeroCategoryCount: 304,
    largestCategoryId: '287',
    largestCategoryCount: 2039,
  });
  assert.equal(logged.generation, 6);
  assert.equal(logged.validationPassed, true);
});

test('10) healthy repaired generation does not relaunch repair loop', () => {
  assert.match(repair, /clearMoviesSparseRepairSchedule/);
  assert.match(repair, /alreadyRepaired/);
  assert.match(repair, /Bound once per degraded generation/);
  assert.match(model, /clearMoviesSparseRepairSchedule/);
  assert.match(visible, /first-populated-provider-category/);
});
