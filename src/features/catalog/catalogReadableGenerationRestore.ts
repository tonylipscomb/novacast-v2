/**
 * Catalog readable-generation restore helpers.
 * A previous completed generation must stay readable across app restart
 * while a newer sync is in progress or leftover from a dead process.
 */

export const CATALOG_READABLE_RESTORE_LOG = '[NovaCast Catalog Readable Recovery]';

export function isLiveCatalogWriter(coordinatorStatus: string | null | undefined) {
  return coordinatorStatus === 'queued' || coordinatorStatus === 'running';
}

export function shouldSkipBootstrapBecauseSyncing(input: {
  currentStatus: string | null | undefined;
  coordinatorInFlight: boolean;
}) {
  return input.currentStatus === 'syncing' && input.coordinatorInFlight;
}

export function shouldResumeInterruptedCatalogSync(input: {
  currentStatus: string | null | undefined;
  coordinatorInFlight: boolean;
}) {
  return input.currentStatus === 'syncing' && !input.coordinatorInFlight;
}

export function shouldExcludeSyncingGenerationFromRecovery(input: {
  generationLifecycleStatus: string | null | undefined;
  hasReadyGeneration: boolean;
}) {
  if (input.generationLifecycleStatus === 'error') {
    return true;
  }
  return input.generationLifecycleStatus === 'syncing' && input.hasReadyGeneration;
}

export function resolveMoviePointerCandidate(input: {
  providerCatalogGeneration: number;
  providerPointerLifecycleStatus: string | null | undefined;
  lastReadyMovieGeneration: number;
}): {
  pointerGeneration: number;
  source: 'provider-pointer' | 'durable-ready' | 'none';
  restoredPriorReady: boolean;
} {
  if (input.providerPointerLifecycleStatus === 'ready' && input.providerCatalogGeneration > 0) {
    return {
      pointerGeneration: input.providerCatalogGeneration,
      source: 'provider-pointer',
      restoredPriorReady: false,
    };
  }
  if (input.lastReadyMovieGeneration > 0) {
    return {
      pointerGeneration: input.lastReadyMovieGeneration,
      source: 'durable-ready',
      restoredPriorReady: input.providerCatalogGeneration !== input.lastReadyMovieGeneration,
    };
  }
  return { pointerGeneration: 0, source: 'none', restoredPriorReady: false };
}

/** Series (and movie fallback) may read the in-progress generation only when no prior completed catalog exists. */
export function incompleteGenerationToExclude(input: {
  currentAttemptGeneration: number;
  currentStatus: string | null | undefined;
  lastCompletedGeneration: number;
}) {
  if (input.lastCompletedGeneration > 0 && (input.currentStatus === 'syncing' || input.currentStatus === 'error')) {
    return input.currentAttemptGeneration;
  }
  return 0;
}
