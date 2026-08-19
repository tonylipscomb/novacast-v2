import type { CatalogMediaType } from './catalogTypes.ts';

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

export function buildCatalogSyncKey(providerId: string, mediaType: CatalogMediaType): string {
  return `${providerId}::${mediaType}`;
}

function parseCatalogSyncKey(key: string): { providerId: string; mediaType: CatalogMediaType } {
  const separatorIndex = key.indexOf('::');
  const providerId = key.slice(0, separatorIndex);
  const mediaType = key.slice(separatorIndex + 2) as CatalogMediaType;
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
  mediaType?: CatalogMediaType,
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
  mediaType: CatalogMediaType,
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
  mediaType?: CatalogMediaType,
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

export function cancelCatalogSync(
  providerId?: string,
  mediaType?: CatalogMediaType,
): void {
  const keysToCancel = new Set<string>([...jobs.keys(), ...keyGenerations.keys()]);
  if (providerId && mediaType) {
    keysToCancel.add(buildCatalogSyncKey(providerId, mediaType));
  }

  for (const key of keysToCancel) {
    if (!matchesKeyFilter(key, providerId, mediaType)) {
      continue;
    }
    bumpGeneration(key);
    const job = jobs.get(key);
    if (!job) {
      continue;
    }
    job.status = 'cancelled';
    delete job.promise;
  }
}

export function invalidateCatalogSyncForProvider(providerId: string): void {
  cancelCatalogSync(providerId);
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

export function scheduleCatalogSync(
  key: string,
  runner: () => Promise<void>,
  options?: { delayMs?: number },
): Promise<void> {
  const existing = jobs.get(key);
  if (isInFlight(existing)) {
    logCatalogBootstrapDispatch('coordinator-deduped', {
      providerId: parseCatalogSyncKey(key).providerId,
      coordinatorKey: key,
      coordinatorEpoch: existing.generation,
      activeCoordinatorEpoch: getGeneration(key),
      cancelled: false,
      reason: 'existing-in-flight-job',
    });
    return existing.promise;
  }

  const runGeneration = getGeneration(key);
  let resolvePromise!: () => void;
  let rejectPromise!: (error: unknown) => void;
  const promise = new Promise<void>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  const job: CatalogSyncJob = {
    promise,
    status: 'queued',
    generation: runGeneration,
  };
  jobs.set(key, job);
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
        resolvePromise();
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
        resolvePromise();
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

      if (getGeneration(key) !== runGeneration) {
        logCatalogBootstrapDispatch('coordinator-stale-return', {
          providerId: parseCatalogSyncKey(key).providerId,
          coordinatorKey: key,
          coordinatorEpoch: runGeneration,
          activeCoordinatorEpoch: getGeneration(key),
          cancelled: true,
          skipReason: 'coordinator-epoch-changed-after-provider-sync',
        });
        job.status = 'cancelled';
        resolvePromise();
        return;
      }

      job.status = 'completed';
      job.error = undefined;
      resolvePromise();
    } catch (error) {
      job.status = 'failed';
      job.error = error;
      rejectPromise(error);
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
