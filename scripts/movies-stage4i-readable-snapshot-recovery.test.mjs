import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  assessMoviesCatalogIntegrity,
  validateMoviesCategoryDistribution,
} from '../src/features/catalog/moviesCategoryDistributionValidation.ts';
import {
  assessMoviesGenerationSnapshotIntegrity,
  MOVIES_FOCUS_STAGE4I_MARKER,
  selectMoviesReadableRecoveryGeneration,
  shouldBlankMoviesUiDuringSparseRepair,
  shouldShowMoviesFullScreenRepairGate,
} from '../src/features/catalog/moviesReadableSnapshotRecovery.ts';
import { decideMoviesCatalogReadiness } from '../src/features/movies/moviesCatalogReadiness.ts';

const repository = fs.readFileSync('src/features/catalog/catalogRepository.ts', 'utf8');
const validation = fs.readFileSync(
  'src/features/catalog/moviesCategoryDistributionValidation.ts',
  'utf8',
);
const recovery = fs.readFileSync(
  'src/features/catalog/moviesReadableSnapshotRecovery.ts',
  'utf8',
);
const sqlite = fs.readFileSync('src/features/movies/data/SqliteMovieDataSource.ts', 'utf8');
const model = fs.readFileSync('src/features/movies/useMoviesScreenModel.ts', 'utf8');
const readiness = fs.readFileSync('src/features/movies/moviesCatalogReadiness.ts', 'utf8');
const repair = fs.readFileSync('src/features/movies/moviesSparseCatalogRepair.ts', 'utf8');

function snapshot(input) {
  return {
    generation: input.generation,
    itemRows: input.itemRows,
    distinctContentIds: input.itemRows,
    categoryRows: input.categoryRows,
    distinctItemCategoryIds: input.distinctItemCategoryIds,
    nonzeroCategoryCount: input.nonzeroCategoryCount,
    largestCategoryId: input.largestCategoryId ?? 'c1',
    largestCategoryCount: input.largestCategoryCount ?? Math.floor(input.itemRows * 0.05),
  };
}

function assess(input) {
  return assessMoviesGenerationSnapshotIntegrity({ snapshot: snapshot(input) });
}

test('1) Gen 14 degraded + gen 13 healthy + gen 15 syncing → readable 13, no blank', () => {
  const gen15Syncing = 15;
  const gen14 = assess({
    generation: 14,
    itemRows: 53,
    categoryRows: 439,
    distinctItemCategoryIds: 1,
    nonzeroCategoryCount: 1,
    largestCategoryCount: 53,
  });
  const gen13 = assess({
    generation: 13,
    itemRows: 175713,
    categoryRows: 439,
    distinctItemCategoryIds: 439,
    nonzeroCategoryCount: 439,
    largestCategoryCount: 4000,
  });
  const gen8 = assess({
    generation: 8,
    itemRows: 152075,
    categoryRows: 439,
    distinctItemCategoryIds: 360,
    nonzeroCategoryCount: 360,
    largestCategoryCount: 3500,
  });

  assert.equal(gen14.healthy, false);
  assert.equal(gen13.healthy, true);

  const decision = selectMoviesReadableRecoveryGeneration({
    activeGeneration: 14,
    syncingGeneration: gen15Syncing,
    syncStatus: 'syncing',
    // Exclude incomplete syncing generation 15 from candidates.
    candidates: [gen14, gen13, gen8],
  });

  assert.equal(decision.readableGeneration, 13);
  assert.equal(decision.pointerRepairNeeded, true);
  assert.equal(decision.rejectedActiveGeneration, 14);
  assert.match(decision.reason, /active-degraded-recovered|recovered/);

  assert.equal(
    shouldBlankMoviesUiDuringSparseRepair({
      hasValidatedReadableGeneration: true,
      hasPreservedCategories: true,
    }),
    false,
  );

  assert.match(repository, /resolveMoviesReadableCatalogGeneration/);
  assert.match(repository, /movies_recovery_generation_selected/);
  assert.match(sqlite, /snapshot-preserved-during-repair|movies_snapshot_preserved_during_repair/);
  assert.match(model, /snapshot-preserved-during-repair/);
  assert.doesNotMatch(
    sqlite.slice(
      sqlite.indexOf('repairStatus === \'repairing\''),
      sqlite.indexOf('repairStatus === \'repairing\'') + 800,
    ),
    /lastValidSqliteCategoriesByProvider\.delete/,
  );
});

test('2) Cold process restart: empty previousReadable map still selects gen 13', () => {
  // Simulates empty previousReadableGenerationByProvider after process restart.
  const previousReadableGeneration = 0;
  const gen14 = assess({
    generation: 14,
    itemRows: 53,
    categoryRows: 1,
    distinctItemCategoryIds: 1,
    nonzeroCategoryCount: 1,
  });
  const gen13 = assess({
    generation: 13,
    itemRows: 175713,
    categoryRows: 439,
    distinctItemCategoryIds: 439,
    nonzeroCategoryCount: 439,
  });
  const decision = selectMoviesReadableRecoveryGeneration({
    activeGeneration: 14,
    syncingGeneration: 15,
    syncStatus: 'syncing',
    candidates: [gen14, gen13],
  });
  assert.equal(decision.readableGeneration, 13);
  assert.equal(previousReadableGeneration, 0);

  const readinessDecision = decideMoviesCatalogReadiness({
    categoriesGeneration: 13,
    readableItemGeneration: 13,
    syncingGeneration: 15,
    syncStatus: 'syncing',
    previousReadableGeneration: 0,
    readableItemCount: 175713,
  });
  assert.equal(readinessDecision, 'preserving-completed-generation');
  assert.match(readiness, /not JS memory|not source of truth|SQLite \+ integrity/);
  assert.match(readiness, /categoriesGeneration = readableItemGeneration/);
});

test('3) Tiny first activation (53 rows / 439 metadata / 1 populated) rejected', () => {
  const result = validateMoviesCategoryDistribution({
    generation: 1,
    totalItems: 53,
    distinctCategoryIds: 1,
    metadataCategoryCount: 439,
    nonzeroCategoryCount: 1,
    largestCategoryId: 'only',
    largestCategoryCount: 53,
    previousGeneration: null,
    previousTotalItems: null,
    previousNonzeroCategoryCount: null,
  });
  assert.equal(result.validationPassed, false);
  assert.ok(
    result.rejectionReason === 'sparse-partial-dump' ||
      result.rejectionReason === 'sparse-item-total-vs-large-metadata' ||
      result.rejectionReason === 'sparse-nonzero-categories-vs-large-metadata',
  );

  const integrity = assessMoviesCatalogIntegrity({
    generation: 1,
    metadataCategoryCount: 439,
    nonzeroCategoryCount: 1,
    distinctItemCategoryIds: 1,
    totalItems: 53,
    largestCategoryShare: 1,
  });
  assert.equal(integrity.healthy, false);

  assert.match(repository, /movies_generation_activation_rejected/);
  assert.match(repository, /Keep provider\.catalogGeneration unchanged/);
  assert.match(validation, /sparse-partial-dump/);
});

test('4) Repair while healthy snapshot exists: no full-screen gate', () => {
  assert.equal(
    shouldShowMoviesFullScreenRepairGate({
      repairing: true,
      hasValidatedReadableGeneration: true,
      hasCategories: true,
    }),
    false,
  );
  assert.equal(
    shouldShowMoviesFullScreenRepairGate({
      repairing: true,
      hasValidatedReadableGeneration: false,
      hasCategories: false,
    }),
    true,
  );
  assert.match(sqlite, /movies_snapshot_preserved_during_repair/);
  assert.match(model, /never blank a validated readable snapshot/);
  assert.match(repair, /do not clear the screen or reschedule/);
});

test('5) Successful gen 15 passes integrity and swaps atomically', () => {
  const gen15 = assess({
    generation: 15,
    itemRows: 180000,
    categoryRows: 439,
    distinctItemCategoryIds: 400,
    nonzeroCategoryCount: 400,
  });
  assert.equal(gen15.healthy, true);
  assert.match(repository, /movies_generation_activation_passed/);
  assert.match(repository, /movies_generation_swap_committed/);
  assert.match(repository, /retain newly active \+ immediately previous validated/);
});

test('6) Failed gen 15 keeps gen 13 readable; no grid unmount contract', () => {
  const gen15 = assess({
    generation: 15,
    itemRows: 40,
    categoryRows: 439,
    distinctItemCategoryIds: 1,
    nonzeroCategoryCount: 1,
  });
  const gen13 = assess({
    generation: 13,
    itemRows: 175713,
    categoryRows: 439,
    distinctItemCategoryIds: 439,
    nonzeroCategoryCount: 439,
  });
  assert.equal(gen15.healthy, false);
  const decision = selectMoviesReadableRecoveryGeneration({
    activeGeneration: 13,
    syncingGeneration: 15,
    syncStatus: 'error',
    candidates: [gen15, gen13],
  });
  // Active 13 is healthy — stay on 13 even if 15 is present as a failed attempt.
  assert.equal(decision.readableGeneration, 13);
  assert.equal(decision.pointerRepairNeeded, false);
  assert.match(repository, /complete-rejected/);
  assert.match(sqlite, /snapshot-preserved-during-repair|categoriesGeneration/);
});

test('7) No valid candidate: no infinite reschedule; bounded loading', () => {
  const gen14 = assess({
    generation: 14,
    itemRows: 53,
    categoryRows: 1,
    distinctItemCategoryIds: 1,
    nonzeroCategoryCount: 1,
  });
  const decision = selectMoviesReadableRecoveryGeneration({
    activeGeneration: 14,
    syncingGeneration: 15,
    syncStatus: 'syncing',
    candidates: [gen14],
  });
  assert.equal(decision.readableGeneration, 0);
  assert.equal(decision.reason, 'active-degraded-no-recovery');
  assert.match(repository, /movies_no_valid_snapshot/);
  assert.match(repair, /alreadyRepaired/);
  assert.match(repair, /Repair already kicked off this session/);
});

test('8) Categories, counts, items, and search use the same generation', () => {
  assert.match(readiness, /categoriesGeneration = readableItemGeneration/);
  assert.match(sqlite, /const categoriesGeneration = readableGeneration/);
  assert.match(sqlite, /const itemsGeneration = readableGeneration/);
  assert.match(sqlite, /categoryReadGeneration = itemsGeneration/);
  // Search SQLite reads resolve via resolveReadableCatalogGeneration (same integrity path).
  assert.match(repository, /resolveMoviesReadableCatalogGeneration/);
});

test('9) Generation diagnostics describe catalog_items_v2 / catalog_categories_v2', () => {
  assert.match(repository, /itemsTable: 'catalog_items_v2'/);
  assert.match(repository, /categoriesTable: 'catalog_categories_v2'/);
  assert.match(
    repository,
    /itemPrimaryKey: 'provider_id,media_type,sync_generation,content_id'/,
  );
  assert.match(repository, /syncGenerationInPrimaryKey: true/);
  assert.equal(MOVIES_FOCUS_STAGE4I_MARKER, 'stage4i-movies-readable-snapshot-recovery-v1');
  assert.match(recovery, /stage4i-movies-readable-snapshot-recovery-v1/);
});

test('Recovery prefers gen 13 over gen 8 when both healthy', () => {
  const decision = selectMoviesReadableRecoveryGeneration({
    activeGeneration: 14,
    syncingGeneration: 15,
    syncStatus: 'syncing',
    candidates: [
      assess({
        generation: 14,
        itemRows: 53,
        categoryRows: 1,
        distinctItemCategoryIds: 1,
        nonzeroCategoryCount: 1,
      }),
      assess({
        generation: 13,
        itemRows: 175713,
        categoryRows: 439,
        distinctItemCategoryIds: 439,
        nonzeroCategoryCount: 439,
      }),
      assess({
        generation: 8,
        itemRows: 152075,
        categoryRows: 439,
        distinctItemCategoryIds: 360,
        nonzeroCategoryCount: 360,
      }),
    ],
  });
  assert.equal(decision.readableGeneration, 13);
});
