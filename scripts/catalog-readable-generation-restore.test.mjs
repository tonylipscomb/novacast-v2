import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  incompleteGenerationToExclude,
  resolveMoviePointerCandidate,
  shouldExcludeSyncingGenerationFromRecovery,
  shouldResumeInterruptedCatalogSync,
  shouldSkipBootstrapBecauseSyncing,
} from '../src/features/catalog/catalogReadableGenerationRestore.ts';

const repository = readFileSync('src/features/catalog/catalogRepository.ts', 'utf8');
const bundle = readFileSync('src/features/providers/providerBundle.ts', 'utf8');

test('leftover SQLite syncing is not treated as a live writer', () => {
  assert.equal(
    shouldSkipBootstrapBecauseSyncing({ currentStatus: 'syncing', coordinatorInFlight: true }),
    true,
  );
  assert.equal(
    shouldSkipBootstrapBecauseSyncing({ currentStatus: 'syncing', coordinatorInFlight: false }),
    false,
  );
  assert.equal(
    shouldResumeInterruptedCatalogSync({ currentStatus: 'syncing', coordinatorInFlight: false }),
    true,
  );
  assert.equal(
    shouldResumeInterruptedCatalogSync({ currentStatus: 'syncing', coordinatorInFlight: true }),
    false,
  );
  assert.match(bundle, /bootstrap-resume-interrupted-sync/);
  assert.match(bundle, /sqlite-syncing-without-live-writer/);
});

test('movie pointer restores last ready generation when shared provider pointer is 0', () => {
  assert.deepEqual(
    resolveMoviePointerCandidate({
      providerCatalogGeneration: 0,
      providerPointerLifecycleStatus: null,
      lastReadyMovieGeneration: 4,
    }),
    { pointerGeneration: 4, source: 'durable-ready', restoredPriorReady: true },
  );
  assert.deepEqual(
    resolveMoviePointerCandidate({
      providerCatalogGeneration: 4,
      providerPointerLifecycleStatus: 'ready',
      lastReadyMovieGeneration: 4,
    }),
    { pointerGeneration: 4, source: 'provider-pointer', restoredPriorReady: false },
  );
  assert.match(repository, /CATALOG_READABLE_RESTORE_LOG/);
  assert.match(repository, /restored-prior-ready-generation/);
});

test('a fresh syncing generation is excluded only when a ready catalog already exists', () => {
  assert.equal(
    shouldExcludeSyncingGenerationFromRecovery({
      generationLifecycleStatus: 'syncing',
      hasReadyGeneration: true,
    }),
    true,
  );
  assert.equal(
    shouldExcludeSyncingGenerationFromRecovery({
      generationLifecycleStatus: 'syncing',
      hasReadyGeneration: false,
    }),
    false,
  );
  assert.equal(
    shouldExcludeSyncingGenerationFromRecovery({
      generationLifecycleStatus: 'error',
      hasReadyGeneration: false,
    }),
    true,
  );
});

test('in-progress generation is not hidden when no prior completed catalog exists', () => {
  assert.equal(
    incompleteGenerationToExclude({
      currentAttemptGeneration: 1,
      currentStatus: 'syncing',
      lastCompletedGeneration: 0,
    }),
    0,
  );
  assert.equal(
    incompleteGenerationToExclude({
      currentAttemptGeneration: 6,
      currentStatus: 'syncing',
      lastCompletedGeneration: 5,
    }),
    6,
  );
  assert.match(repository, /FROM catalog_generation_state WHERE provider_id = \? AND media_type = \?/);
});
