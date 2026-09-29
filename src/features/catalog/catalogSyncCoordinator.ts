import type { CatalogSyncMediaType } from './catalogTypes.ts';

export type CatalogSyncCoordinatorStatus =
  | 'idle'
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type CatalogSyncJobStatus = {
  status: CatalogSyncCoordinatorStatus;
  startedAt?: number;
  error?: unknown;
  generation: number;
};

export type CatalogSyncCancelToken = {
  generation: number;
  isStale: () => boolean;
};

type CatalogSyncJob = {
  promise?: Promise<void>;
  status: CatalogSyncCoordinatorStatus;
  startedAt?: number;
  error?: unknown;
  generation: number;
};

const jobs = new Map<string, CatalogSyncJob>();
const keyGenerations = new Map<string, number>();

function logCatalogBootstrapDispatch(phase: string, fields: Record<string, unknown> = {}) {
  console.info('[NovaCast Catalog Bootstrap Dispatch]', JSON.stringify({ phase, ...fields }));
}

function nowMs(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

export function buildCatalogSyncKey(providerId: string, mediaType: CatalogSyncMediaType): string {
  return `${providerId}::${mediaType}`;
}

function parseCatalogSyncKey(key: string): { providerId: string; mediaType: CatalogSyncMediaType } {
  const separatorIndex = key.indexOf('::');
  const providerId = key.slice(0, separatorIndex);
  const mediaType = key.slice(separatorIndex + 2) as CatalogSyncMediaType;
  return { providerId, mediaType };
}

function getGeneration(key: string): number {
  return keyGenerations.get(key) ?? 0;
}

function bumpGeneration(key: string): number {
  const next = getGeneration(key) + 1;
  keyGenerations.set(key, next);
  return next;
}

function matchesKeyFilter(
  key: string,
  providerId?: string,
  mediaType?: CatalogSyncMediaType,
): boolean {
  const parsed = parseCatalogSyncKey(key);
  if (providerId && parsed.providerId !== providerId) {
    return false;
  }
  if (mediaType && parsed.mediaType !== mediaType) {
    return false;
  }
  return true;
}

function isInFlight(job: CatalogSyncJob | undefined): job is CatalogSyncJob & { promise: Promise<void> } {
  return Boolean(job?.promise && (job.status === 'queued' || job.status === 'running'));
}

export function getCatalogSyncEpoch(key: string): number {
  return getGeneration(key);
}

export function getCatalogSyncCancelToken(key: string): CatalogSyncCancelToken {
  if (!keyGenerations.has(key)) {
    keyGenerations.set(key, 0);
  }
  const generation = getGeneration(key);
  return {
    generation,
    isStale: () => getGeneration(key) !== generation,
  };
}

export function getCatalogSyncJobStatus(
  providerId: string,
  mediaType: CatalogSyncMediaType,
): CatalogSyncJobStatus {
  const key = buildCatalogSyncKey(providerId, mediaType);
  const job = jobs.get(key);
  if (!job) {
    return { status: 'idle', generation: getGeneration(key) };
  }
  return {
    status: job.status,
    startedAt: job.startedAt,
    error: job.error,
    generation: job.generation,
  };
}

export function isCatalogSyncRunning(
  providerId?: string,
  mediaType?: CatalogSyncMediaType,
): boolean {
  for (const [key, job] of jobs) {
    if (!matchesKeyFilter(key, providerId, mediaType)) {
      continue;
    }
    if (isInFlight(job)) {
      return true;
    }
  }
  return false;
}

export type CatalogSyncCancelMeta = {
  cancelSource?: string;
  cancelCaller?: string;
};

export function cancelCatalogSync(
  providerId?: string,
  mediaType?: CatalogSyncMediaType,
  meta?: CatalogSyncCancelMeta,
): void {
  const keysToCancel = new Set<string>([...jobs.keys(), ...keyGenerations.keys()]);
  if (providerId && mediaType) {
    keysToCancel.add(buildCatalogSyncKey(providerId, mediaType));
  }

  for (const key of keysToCancel) {
    if (!matchesKeyFilter(key, providerId, mediaType)) {
      continue;
    }
    const parsed = parseCatalogSyncKey(key);
    const previousEpoch = getGeneration(key);
    bumpGeneration(key);
    if (parsed.mediaType === 'series') {
      void import('../providers/seriesCancellationAudit.ts')
        .then((audit) => {
          audit.noteSeriesCancelRequested({
            cancelSource: meta?.cancelSource ?? 'coordinator-replacement',
            cancelCaller: meta?.cancelCaller ?? 'cancelCatalogSync',
            abortReason: 'catalog-sync-coordinator-generation-bumped',
            providerId: parsed.providerId,
            coordinatorEpoch: getGeneration(key),
            workerEpoch: previousEpoch,
          });
        })
        .catch(() => undefined);
    }
    const job = jobs.get(key);
    if (!job) {
      continue;
    }
    job.status = 'cancelled';
    delete job.promise;
  }
}

export function invalidateCatalogSyncForProvider(
  providerId: string,
  meta?: CatalogSyncCancelMeta,
): void {
  cancelCatalogSync(providerId, undefined, meta);
  void import('./nativeCatalogDecode.ts')
    .then((mod) => mod.cancelNativeDecodeJobsForProvider(providerId))
    .catch(() => undefined);
}

async function delayMs(ms: number, key: string, runGeneration: number): Promise<boolean> {
  logCatalogBootstrapDispatch('coordinator-delay-start', {
    providerId: parseCatalogSyncKey(key).providerId,
    coordinatorKey: key,
    coordinatorEpoch: runGeneration,
    activeCoordinatorEpoch: getGeneration(key),
    delayMs: ms,
    cancelled: false,
  });
  if (ms <= 0) {
    const currentEpoch = getGeneration(key);
    logCatalogBootstrapDispatch('coordinator-delay-complete', {
      providerId: parseCatalogSyncKey(key).providerId,
      coordinatorKey: key,
      coordinatorEpoch: runGeneration,
      activeCoordinatorEpoch: currentEpoch,
      cancelled: currentEpoch !== runGeneration,
    });
    return currentEpoch === runGeneration;
  }
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
  const currentEpoch = getGeneration(key);
  logCatalogBootstrapDispatch('coordinator-delay-complete', {
    providerId: parseCatalogSyncKey(key).providerId,
    coordinatorKey: key,
    coordinatorEpoch: runGeneration,
    activeCoordinatorEpoch: currentEpoch,
    cancelled: currentEpoch !== runGeneration,
  });
  return currentEpoch === runGeneration;
}

function logMoviePromiseProbe(event: string, fields: Record<string, unknown>) {
  console.info(
    '[NovaCast Movie Promise Probe]',
    JSON.stringify({
      event,
      mediaType: 'movie',
      timestamp: Date.now(),
      providerId: fields.providerId ?? null,
      runId: fields.runId ?? null,
      generation: fields.generation ?? fields.coordinatorEpoch ?? null,
      sqliteEnabled: fields.sqliteEnabled ?? null,
      movieFinishCalled: fields.movieFinishCalled ?? null,
      movieFinishOutcome: fields.movieFinishOutcome ?? null,
      returnReason: fields.returnReason ?? null,
      abandonedOpenSqliteGeneration: fields.abandonedOpenSqliteGeneration ?? null,
      movieStatus: fields.movieStatus ?? null,
      seriesStatus: fields.seriesStatus ?? null,
      ...fields,
    }),
  );
}

function logLivePromiseProbe(event: string, fields: Record<string, unknown>) {
  console.info(
    '[NovaCast Live Promise Probe]',
    JSON.stringify({
      event,
      mediaType: 'live',
      timestamp: Date.now(),
      providerId: fields.providerId ?? null,
      runId: fields.runId ?? null,
      generation: fields.generation ?? fields.coordinatorEpoch ?? null,
      rawLiveCount: fields.rawLiveCount ?? null,
      distinctLiveStreamIds: fields.distinctLiveStreamIds ?? null,
      publishedLiveCount: fields.publishedLiveCount ?? null,
      returnReason: fields.returnReason ?? null,
      liveStatus: fields.liveStatus ?? null,
      ...fields,
    }),
  );
}

export function scheduleCatalogSync(
  key: string,
  runner: () => Promise<void>,
  options?: { delayMs?: number },
): Promise<void> {
  const parsed = parseCatalogSyncKey(key);
  const existing = jobs.get(key);
  if (isInFlight(existing)) {
    logCatalogBootstrapDispatch('coordinator-deduped', {
      providerId: parsed.providerId,
      coordinatorKey: key,
      coordinatorEpoch: existing.generation,
      activeCoordinatorEpoch: getGeneration(key),
      cancelled: false,
      reason: 'existing-in-flight-job',
    });
    if (parsed.mediaType === 'movie') {
      logMoviePromiseProbe('coordinator-deduped-existing-promise', {
        providerId: parsed.providerId,
        coordinatorKey: key,
        coordinatorEpoch: existing.generation,
        jobStatus: existing.status,
      });
    }
    return existing.promise;
  }

  const runGeneration = getGeneration(key);
  let resolvePromise!: () => void;
  let rejectPromise!: (error: unknown) => void;
  const promise = new Promise<void>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  const settleCoordinator = (outcome: 'resolve' | 'reject', extra: Record<string, unknown> = {}) => {
    if (parsed.mediaType === 'movie') {
      logMoviePromiseProbe('coordinator-settle', {
        providerId: parsed.providerId,
        coordinatorKey: key,
        coordinatorEpoch: runGeneration,
        generation: runGeneration,
        sqliteEnabled: null,
        movieFinishCalled: null,
        movieFinishOutcome: null,
        returnReason: extra.reason ?? null,
        abandonedOpenSqliteGeneration: null,
        movieStatus: outcome === 'resolve' ? 'fulfilled' : 'rejected',
        seriesStatus: null,
        outcome,
        ...extra,
      });
    }
    if (parsed.mediaType === 'live') {
      logLivePromiseProbe('coordinator-settle', {
        providerId: parsed.providerId,
        coordinatorKey: key,
        coordinatorEpoch: runGeneration,
        generation: runGeneration,
        returnReason: extra.reason ?? null,
        liveStatus: outcome === 'resolve' ? 'fulfilled' : 'rejected',
        outcome,
        ...extra,
      });
    }
    if (outcome === 'resolve') {
      resolvePromise();
    } else {
      rejectPromise(extra.error);
    }
  };

  const job: CatalogSyncJob = {
    promise,
    status: 'queued',
    generation: runGeneration,
  };
  jobs.set(key, job);
  if (parsed.mediaType === 'movie') {
    logMoviePromiseProbe('coordinator-promise-created', {
      providerId: parsed.providerId,
      coordinatorKey: key,
      coordinatorEpoch: runGeneration,
      delayMs: options?.delayMs ?? 0,
    });
  }
  if (parsed.mediaType === 'live') {
    logLivePromiseProbe('coordinator-promise-created', {
      providerId: parsed.providerId,
      coordinatorKey: key,
      coordinatorEpoch: runGeneration,
      delayMs: options?.delayMs ?? 0,
      liveStatus: 'queued',
    });
  }
  logCatalogBootstrapDispatch('coordinator-queued', {
    providerId: parseCatalogSyncKey(key).providerId,
    coordinatorKey: key,
    coordinatorEpoch: runGeneration,
    activeCoordinatorEpoch: getGeneration(key),
    cancelled: false,
    pendingInputPresent: false,
  });

  void (async () => {
    try {
      if (parsed.mediaType === 'movie') {
        logMoviePromiseProbe('coordinator-async-worker-started', {
          providerId: parsed.providerId,
          coordinatorKey: key,
          coordinatorEpoch: runGeneration,
          delayMs: options?.delayMs ?? 0,
        });
      }
      const shouldContinue = await delayMs(options?.delayMs ?? 0, key, runGeneration);
      logCatalogBootstrapDispatch('coordinator-recheck', {
        providerId: parseCatalogSyncKey(key).providerId,
        coordinatorKey: key,
        coordinatorEpoch: runGeneration,
        activeCoordinatorEpoch: getGeneration(key),
        cancelled: !shouldContinue,
      });
      logCatalogBootstrapDispatch('coordinator-generation-check', {
        providerId: parseCatalogSyncKey(key).providerId,
        coordinatorKey: key,
        coordinatorEpoch: runGeneration,
        activeCoordinatorEpoch: getGeneration(key),
        cancelled: getGeneration(key) !== runGeneration,
      });
      if (!shouldContinue || getGeneration(key) !== runGeneration) {
        logCatalogBootstrapDispatch('coordinator-abort-check', {
          providerId: parseCatalogSyncKey(key).providerId,
          coordinatorKey: key,
          coordinatorEpoch: runGeneration,
          activeCoordinatorEpoch: getGeneration(key),
          cancelled: true,
          skipReason: 'stale-coordinator-job',
        });
        logCatalogBootstrapDispatch('coordinator-skip', {
          providerId: parseCatalogSyncKey(key).providerId,
          coordinatorKey: key,
          coordinatorEpoch: runGeneration,
          activeCoordinatorEpoch: getGeneration(key),
          cancelled: true,
          skipReason: 'stale-coordinator-job',
        });
        logCatalogBootstrapDispatch('coordinator-stale-return', {
          providerId: parseCatalogSyncKey(key).providerId,
          coordinatorKey: key,
          coordinatorEpoch: runGeneration,
          activeCoordinatorEpoch: getGeneration(key),
          cancelled: true,
          skipReason: 'coordinator-epoch-changed-during-delay',
        });
        job.status = 'cancelled';
        settleCoordinator('resolve', { reason: 'stale-during-delay' });
        return;
      }

      logCatalogBootstrapDispatch('coordinator-provider-check', {
        providerId: parseCatalogSyncKey(key).providerId,
        coordinatorKey: key,
        coordinatorEpoch: runGeneration,
        activeCoordinatorEpoch: getGeneration(key),
        cancelled: false,
        providerCallbackPresent: typeof runner === 'function',
      });
      if (typeof runner !== 'function') {
        logCatalogBootstrapDispatch('coordinator-callback-missing', {
          providerId: parseCatalogSyncKey(key).providerId,
          coordinatorKey: key,
          coordinatorEpoch: runGeneration,
          activeCoordinatorEpoch: getGeneration(key),
          cancelled: false,
          skipReason: 'provider-sync-callback-missing',
        });
        job.status = 'failed';
        settleCoordinator('resolve', { reason: 'callback-missing' });
        return;
      }

      logCatalogBootstrapDispatch('coordinator-state-recheck', {
        providerId: parseCatalogSyncKey(key).providerId,
        coordinatorKey: key,
        coordinatorEpoch: runGeneration,
        activeCoordinatorEpoch: getGeneration(key),
        cancelled: false,
        coordinatorState: 'current',
      });

      job.status = 'running';
      job.startedAt = nowMs();
      logCatalogBootstrapDispatch('coordinator-invoke-provider-sync', {
        providerId: parseCatalogSyncKey(key).providerId,
        coordinatorKey: key,
        coordinatorEpoch: runGeneration,
        activeCoordinatorEpoch: getGeneration(key),
        cancelled: false,
      });

      await runner();
      logCatalogBootstrapDispatch('coordinator-provider-sync-return', {
        providerId: parseCatalogSyncKey(key).providerId,
        coordinatorKey: key,
        coordinatorEpoch: runGeneration,
        activeCoordinatorEpoch: getGeneration(key),
        cancelled: getGeneration(key) !== runGeneration,
      });
      if (parsed.mediaType === 'movie') {
        logMoviePromiseProbe('coordinator-runner-returned', {
          providerId: parsed.providerId,
          coordinatorKey: key,
          coordinatorEpoch: runGeneration,
          next: 'resolvePromise',
        });
      }

      if (getGeneration(key) !== runGeneration) {
        logCatalogBootstrapDispatch('coordinator-stale-return', {
          providerId: parsed.providerId,
          coordinatorKey: key,
          coordinatorEpoch: runGeneration,
          activeCoordinatorEpoch: getGeneration(key),
          cancelled: true,
          skipReason: 'coordinator-epoch-changed-after-provider-sync',
        });
        job.status = 'cancelled';
        settleCoordinator('resolve', { reason: 'stale-after-runner' });
        return;
      }

      job.status = 'completed';
      job.error = undefined;
      settleCoordinator('resolve', { reason: 'runner-fulfilled' });
    } catch (error) {
      if (parsed.mediaType === 'movie') {
        const err = error instanceof Error ? error : null;
        console.info(
          '[NovaCast Movie Sync Probe]',
          JSON.stringify({
            functionName: 'scheduleCatalogSync',
            mediaType: 'movie',
            providerId: parsed.providerId,
            coordinatorKey: key,
            coordinatorEpoch: runGeneration,
            activeCoordinatorEpoch: getGeneration(key),
            reason: 'coordinator-catch-rejecting-movie-runner',
            errorName: err?.name ?? typeof error,
            errorMessage: err?.message ?? String(error),
            errorStack: typeof err?.stack === 'string' ? err.stack : null,
            promiseAwaitedByCoordinator: true,
            note: 'rejectPromise-then-startProviderCatalogSync-Promise.all-catch-swallows',
          }),
        );
      }
      job.status = 'failed';
      job.error = error;
      settleCoordinator('reject', { reason: 'runner-rejected', error });
    } finally {
      delete job.promise;
    }
  })();

  return promise;
}

export function runCatalogSyncNow(
  key: string,
  runner: () => Promise<void>,
): Promise<void> {
  return scheduleCatalogSync(key, runner, { delayMs: 0 });
}

export function clearCatalogSyncCoordinatorForTests(): void {
  jobs.clear();
  keyGenerations.clear();
}
