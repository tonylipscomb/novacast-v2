export const CATALOG_NETWORK_GATE_LOG = '[NovaCast Catalog Network Gate]';
export const FOREGROUND_MOVIE_STARVATION_THRESHOLD_MS = 1500;

export type CatalogNetworkGateOwner = {
  mediaType: string;
  operation: string;
  runId: string | null;
  requestSource: string | null;
  background: boolean;
  cancellable: boolean;
  foreground: boolean;
  activeSurface: string | null;
  readableGenerationPresent: boolean;
  preemptionRequested?: boolean;
  onPreemptionRequested?: () => boolean;
  onPreemptionReleased?: (input: { ownerHeldMs: number }) => void;
};

export type CatalogNetworkGateOptions = {
  isCancelled?: () => boolean;
  runId?: string | null;
  requestSource?: string | null;
  background?: boolean;
  cancellable?: boolean;
  foreground?: boolean;
  activeSurface?: string | null;
  readableGenerationPresent?: boolean;
  onPreemptionRequested?: () => boolean;
  onPreemptionReleased?: (input: { ownerHeldMs: number }) => void;
};

type CatalogNetworkGateLease = CatalogNetworkGateOwner & {
  leaseId: number;
};

type CatalogNetworkGateWaiter = CatalogNetworkGateOwner & {
  id: number;
  queuedAt: number;
  isCancelled?: () => boolean;
  settled: boolean;
  pollTimer: ReturnType<typeof setInterval> | null;
  foregroundStarvationTimer: ReturnType<typeof setTimeout> | null;
  resolve: (lease: { leaseId: number; acquiredAt: number }) => void;
  reject: (error: Error) => void;
  onPreemptionRequested?: () => boolean;
};

type ProviderCatalogNetworkGate = {
  owner: CatalogNetworkGateLease | null;
  acquiredAt: number;
  waiters: CatalogNetworkGateWaiter[];
};

const gates = new Map<string, ProviderCatalogNetworkGate>();
let leaseSequence = 0;
let waiterSequence = 0;

export function createCatalogNetworkGateCancelledError(): Error & { errorReason: 'cancelled' } {
  const error = new Error('cancelled') as Error & { errorReason: 'cancelled' };
  error.name = 'CatalogNetworkGateCancelledError';
  error.errorReason = 'cancelled';
  return error;
}

export function isCatalogNetworkGateCancelled(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && (error as { name?: string }).name === 'CatalogNetworkGateCancelledError');
}

export function resolveCatalogNetworkGateMediaType(input: {
  mediaType: string;
  catalogNetworkMediaType?: string;
}): string {
  return input.catalogNetworkMediaType ?? input.mediaType;
}

export function resolveCatalogNetworkGateOperation(input: {
  mediaType: string;
  filterCategoryId?: string;
  catalogNetworkMediaType?: string;
  catalogNetworkOperation?: string;
}): string {
  if (input.catalogNetworkOperation) {
    return input.catalogNetworkOperation;
  }
  const mediaType = resolveCatalogNetworkGateMediaType(input);
  const filterCategoryId = String(input.filterCategoryId ?? '').trim();
  const unfiltered = !filterCategoryId || filterCategoryId === 'all';
  if (unfiltered) {
    if (mediaType === 'live') {
      return 'get_live_streams';
    }
    if (mediaType === 'series') {
      return 'get_series';
    }
    return 'get_vod_streams';
  }
  if (mediaType === 'series') {
    return 'get_series:category';
  }
  if (mediaType === 'live') {
    return 'get_live_streams:category';
  }
  return 'get_vod_streams:category';
}

export function resetProviderCatalogNetworkGateForTests() {
  for (const gate of gates.values()) {
    for (const waiter of gate.waiters) {
      abandonWaiter(waiter, createCatalogNetworkGateCancelledError());
    }
    gate.waiters = [];
    gate.owner = null;
  }
  gates.clear();
  leaseSequence = 0;
  waiterSequence = 0;
}

export function getProviderCatalogNetworkGateSnapshotForTests(providerId: string) {
  const gate = gates.get(providerId);
  return {
    owner: gate?.owner
      ? {
          mediaType: gate.owner.mediaType,
          operation: gate.owner.operation,
          runId: gate.owner.runId,
          requestSource: gate.owner.requestSource,
          background: gate.owner.background,
          cancellable: gate.owner.cancellable,
          foreground: gate.owner.foreground,
          activeSurface: gate.owner.activeSurface,
          readableGenerationPresent: gate.owner.readableGenerationPresent,
        }
      : null,
    queueDepth: gate?.waiters.filter((waiter) => !waiter.settled).length ?? 0,
    queue: (gate?.waiters ?? [])
      .filter((waiter) => !waiter.settled)
      .map((waiter) => ({
        mediaType: waiter.mediaType,
        operation: waiter.operation,
        runId: waiter.runId,
        requestSource: waiter.requestSource,
        background: waiter.background,
        cancellable: waiter.cancellable,
        foreground: waiter.foreground,
        activeSurface: waiter.activeSurface,
        readableGenerationPresent: waiter.readableGenerationPresent,
      })),
  };
}

export async function runXtreamCategoryDecodeWithCatalogNetworkGate<T>(
  input: {
    providerId: string;
    mediaType: string;
    filterCategoryId?: string;
    catalogNetworkMediaType?: string;
    catalogNetworkOperation?: string;
    runId?: string | null;
    skipCatalogNetworkGate?: boolean;
    isCancelled?: () => boolean;
    catalogNetworkRequestSource?: string | null;
    catalogNetworkBackground?: boolean;
    catalogNetworkCancellable?: boolean;
    catalogNetworkForeground?: boolean;
    catalogNetworkActiveSurface?: string | null;
    catalogNetworkReadableGenerationPresent?: boolean;
    catalogNetworkOnPreemptionRequested?: () => boolean;
    catalogNetworkOnPreemptionReleased?: (input: { ownerHeldMs: number }) => void;
  },
  decode: () => Promise<T>,
): Promise<T> {
  if (input.skipCatalogNetworkGate) {
    return decode();
  }
  return withProviderCatalogNetworkGate(
    input.providerId,
    resolveCatalogNetworkGateMediaType(input),
    resolveCatalogNetworkGateOperation(input),
    decode,
    {
      isCancelled: input.isCancelled,
      runId: input.runId ?? null,
      requestSource: input.catalogNetworkRequestSource ?? null,
      background: input.catalogNetworkBackground ?? false,
      cancellable: input.catalogNetworkCancellable ?? false,
      foreground: input.catalogNetworkForeground ?? false,
      activeSurface: input.catalogNetworkActiveSurface ?? null,
      readableGenerationPresent: input.catalogNetworkReadableGenerationPresent ?? false,
      onPreemptionRequested: input.catalogNetworkOnPreemptionRequested,
      onPreemptionReleased: input.catalogNetworkOnPreemptionReleased,
    },
  );
}

export async function withProviderCatalogNetworkGate<T>(
  providerId: string,
  mediaType: string,
  operation: string,
  callback: () => Promise<T>,
  options?: CatalogNetworkGateOptions,
): Promise<T> {
  const owner: CatalogNetworkGateOwner = {
    mediaType,
    operation,
    runId: options?.runId ?? null,
    requestSource: options?.requestSource ?? null,
    background: options?.background ?? false,
    cancellable: options?.cancellable ?? false,
    foreground: options?.foreground ?? false,
    activeSurface: options?.activeSurface ?? null,
    readableGenerationPresent: options?.readableGenerationPresent ?? false,
    onPreemptionRequested: options?.onPreemptionRequested,
    onPreemptionReleased: options?.onPreemptionReleased,
  };
  const lease = await acquireProviderCatalogNetworkGate(providerId, owner, options?.isCancelled);
  try {
    if (options?.isCancelled?.()) {
      throw createCatalogNetworkGateCancelledError();
    }
    return await callback();
  } finally {
    releaseProviderCatalogNetworkGate(providerId, lease.leaseId);
  }
}

function ownerSnapshot(owner: CatalogNetworkGateOwner | null): CatalogNetworkGateOwner | null {
  if (!owner) {
    return null;
  }
  return {
    mediaType: owner.mediaType,
    operation: owner.operation,
    runId: owner.runId,
    requestSource: owner.requestSource,
    background: owner.background,
    cancellable: owner.cancellable,
    foreground: owner.foreground,
    activeSurface: owner.activeSurface,
    readableGenerationPresent: owner.readableGenerationPresent,
    preemptionRequested: owner.preemptionRequested,
    onPreemptionRequested: owner.onPreemptionRequested,
    onPreemptionReleased: owner.onPreemptionReleased,
  };
}

export function reevaluateProviderCatalogNetworkGateSurface(surface: string) {
  for (const [providerId, gate] of gates) {
    for (const waiter of gate.waiters) {
      if (waiter.settled || waiter.mediaType !== 'movie') {
        continue;
      }
      waiter.activeSurface = surface;
      waiter.foreground = surface === 'movies';
      if (waiter.foreground && isForegroundMoviesFirstRun(waiter)) {
        armForegroundMoviesStarvationTimer(providerId, gate, waiter);
        maybeRequestForegroundMoviesPreemption(providerId, gate, waiter);
      } else if (!waiter.foreground && waiter.foregroundStarvationTimer) {
        clearTimeout(waiter.foregroundStarvationTimer);
        waiter.foregroundStarvationTimer = null;
      }
    }
  }
}

function logCatalogNetworkGate(event: string, fields: Record<string, unknown>) {
  console.info(
    CATALOG_NETWORK_GATE_LOG,
    JSON.stringify({
      event,
      providerId: fields.providerId ?? null,
      mediaType: fields.mediaType ?? null,
      operation: fields.operation ?? null,
      runId: fields.runId ?? null,
      waitMs: fields.waitMs ?? null,
      heldMs: fields.heldMs ?? null,
      queueDepth: fields.queueDepth ?? null,
      previousOwner: fields.previousOwner ?? null,
      nextOwner: fields.nextOwner ?? null,
      requestSource: fields.requestSource ?? null,
      activeSurface: fields.activeSurface ?? null,
      readableGenerationPresent: fields.readableGenerationPresent ?? null,
      thresholdMs: fields.thresholdMs ?? null,
      preemptionReason: fields.preemptionReason ?? null,
      retryDelayMs: fields.retryDelayMs ?? null,
      ownerHeldMs: fields.ownerHeldMs ?? null,
    }),
  );
}

function ensureGate(providerId: string): ProviderCatalogNetworkGate {
  let gate = gates.get(providerId);
  if (!gate) {
    gate = { owner: null, acquiredAt: 0, waiters: [] };
    gates.set(providerId, gate);
  }
  return gate;
}

function isForegroundMoviesFirstRun(waiter: CatalogNetworkGateWaiter) {
  return waiter.mediaType === 'movie' &&
    waiter.foreground &&
    waiter.activeSurface === 'movies' &&
    !waiter.readableGenerationPresent;
}

function isEligibleForegroundMoviesOwner(owner: CatalogNetworkGateOwner | null) {
  return Boolean(
    owner &&
      owner.mediaType === 'series' &&
      owner.operation === 'get_series' &&
      owner.background &&
      owner.cancellable,
  );
}

function armForegroundMoviesStarvationTimer(
  providerId: string,
  gate: ProviderCatalogNetworkGate,
  waiter: CatalogNetworkGateWaiter,
) {
  if (waiter.foregroundStarvationTimer) {
    clearTimeout(waiter.foregroundStarvationTimer);
  }
  waiter.foregroundStarvationTimer = null;
  if (!isForegroundMoviesFirstRun(waiter) || !isEligibleForegroundMoviesOwner(gate.owner)) {
    return;
  }
  const remainingMs = Math.max(
    0,
    FOREGROUND_MOVIE_STARVATION_THRESHOLD_MS - (Date.now() - waiter.queuedAt),
  );
  waiter.foregroundStarvationTimer = setTimeout(() => {
    waiter.foregroundStarvationTimer = null;
    maybeRequestForegroundMoviesPreemption(providerId, gate, waiter);
  }, remainingMs);
}

function maybeRequestForegroundMoviesPreemption(
  providerId: string,
  gate: ProviderCatalogNetworkGate,
  waiter: CatalogNetworkGateWaiter,
) {
  if (
    waiter.settled ||
    waiter.isCancelled?.() ||
    !isForegroundMoviesFirstRun(waiter) ||
    !isEligibleForegroundMoviesOwner(gate.owner)
  ) {
    return false;
  }
  const owner = gate.owner;
  if (!owner || owner.preemptionRequested) {
    return false;
  }
  const waitMs = Date.now() - waiter.queuedAt;
  if (waitMs < FOREGROUND_MOVIE_STARVATION_THRESHOLD_MS) {
    armForegroundMoviesStarvationTimer(providerId, gate, waiter);
    return false;
  }
  logCatalogNetworkGate('foreground-starvation-threshold', {
    providerId,
    mediaType: waiter.mediaType,
    operation: waiter.operation,
    runId: waiter.runId,
    requestSource: waiter.requestSource,
    activeSurface: waiter.activeSurface,
    readableGenerationPresent: false,
    waitMs,
    ownerHeldMs: Date.now() - gate.acquiredAt,
    thresholdMs: FOREGROUND_MOVIE_STARVATION_THRESHOLD_MS,
    preemptionReason: 'foreground-movies-first-run',
  });
  const requested = waiter.onPreemptionRequested?.() ?? false;
  if (requested && gate.owner === owner) {
    owner.preemptionRequested = true;
    logCatalogNetworkGate('preemption-requested', {
      providerId,
      mediaType: owner.mediaType,
      operation: owner.operation,
      runId: owner.runId,
      requestSource: owner.requestSource,
      activeSurface: waiter.activeSurface,
      readableGenerationPresent: false,
      waitMs,
      ownerHeldMs: Date.now() - gate.acquiredAt,
      thresholdMs: FOREGROUND_MOVIE_STARVATION_THRESHOLD_MS,
      preemptionReason: 'foreground-movies-first-run',
    });
  }
  return requested;
}

function pendingWaiters(gate: ProviderCatalogNetworkGate): CatalogNetworkGateWaiter[] {
  return gate.waiters.filter((waiter) => !waiter.settled);
}

function peekNextOwner(gate: ProviderCatalogNetworkGate): CatalogNetworkGateOwner | null {
  const next = pendingWaiters(gate)[0];
  return next ? ownerSnapshot(next) : null;
}

function abandonWaiter(waiter: CatalogNetworkGateWaiter, error: Error) {
  if (waiter.settled) {
    return;
  }
  waiter.settled = true;
  if (waiter.pollTimer) {
    clearInterval(waiter.pollTimer);
    waiter.pollTimer = null;
  }
  if (waiter.foregroundStarvationTimer) {
    clearTimeout(waiter.foregroundStarvationTimer);
    waiter.foregroundStarvationTimer = null;
  }
  waiter.reject(error);
}

function takeOwnership(
  gate: ProviderCatalogNetworkGate,
  owner: CatalogNetworkGateOwner,
): CatalogNetworkGateLease {
  const lease: CatalogNetworkGateLease = {
    ...owner,
    leaseId: ++leaseSequence,
  };
  gate.owner = lease;
  gate.acquiredAt = Date.now();
  return lease;
}

async function acquireProviderCatalogNetworkGate(
  providerId: string,
  owner: CatalogNetworkGateOwner,
  isCancelled?: () => boolean,
): Promise<{ leaseId: number; acquiredAt: number }> {
  if (isCancelled?.()) {
    throw createCatalogNetworkGateCancelledError();
  }
  const gate = ensureGate(providerId);
  if (!gate.owner) {
    const lease = takeOwnership(gate, owner);
    logCatalogNetworkGate('acquired', {
      providerId,
      mediaType: owner.mediaType,
      operation: owner.operation,
      runId: owner.runId,
      waitMs: 0,
      heldMs: null,
      queueDepth: pendingWaiters(gate).length,
      previousOwner: null,
      nextOwner: peekNextOwner(gate),
      requestSource: owner.requestSource,
      activeSurface: owner.activeSurface,
      readableGenerationPresent: owner.readableGenerationPresent,
    });
    return { leaseId: lease.leaseId, acquiredAt: gate.acquiredAt };
  }

  logCatalogNetworkGate('queued', {
    providerId,
    mediaType: owner.mediaType,
    operation: owner.operation,
    runId: owner.runId,
    waitMs: null,
    heldMs: null,
    queueDepth: pendingWaiters(gate).length + 1,
    previousOwner: ownerSnapshot(gate.owner),
    nextOwner: peekNextOwner(gate) ?? owner,
    requestSource: owner.requestSource,
    activeSurface: owner.activeSurface,
    readableGenerationPresent: owner.readableGenerationPresent,
  });

  return await new Promise((resolve, reject) => {
    const waiter: CatalogNetworkGateWaiter = {
      ...owner,
      id: ++waiterSequence,
      queuedAt: Date.now(),
      isCancelled,
      settled: false,
      pollTimer: null,
      foregroundStarvationTimer: null,
      resolve,
      reject,
      onPreemptionRequested: owner.onPreemptionRequested,
    };
    gate.waiters.push(waiter);
    if (isForegroundMoviesFirstRun(waiter)) {
      logCatalogNetworkGate('foreground-wait-start', {
        providerId,
        mediaType: waiter.mediaType,
        operation: waiter.operation,
        runId: waiter.runId,
        requestSource: waiter.requestSource,
        activeSurface: waiter.activeSurface,
        readableGenerationPresent: false,
        waitMs: 0,
        ownerHeldMs: Date.now() - gate.acquiredAt,
      });
      armForegroundMoviesStarvationTimer(providerId, gate, waiter);
    }
    waiter.pollTimer = setInterval(() => {
      if (waiter.settled) {
        return;
      }
      if (!isCancelled?.()) {
        const owner = gate.owner;
        const waitMs = Date.now() - waiter.queuedAt;
        if (isForegroundMoviesFirstRun(waiter) && isEligibleForegroundMoviesOwner(owner)) {
          maybeRequestForegroundMoviesPreemption(providerId, gate, waiter);
        }
        return;
      }
      gate.waiters = gate.waiters.filter((entry) => entry.id !== waiter.id);
      logCatalogNetworkGate('cancelled-while-waiting', {
        providerId,
        mediaType: owner.mediaType,
        operation: owner.operation,
        runId: owner.runId,
        waitMs: Date.now() - waiter.queuedAt,
        heldMs: null,
        queueDepth: pendingWaiters(gate).length,
        previousOwner: ownerSnapshot(gate.owner),
        nextOwner: peekNextOwner(gate),
      });
      abandonWaiter(waiter, createCatalogNetworkGateCancelledError());
    }, 50);
  });
}

function dequeueNextWaiter(
  providerId: string,
  gate: ProviderCatalogNetworkGate,
): CatalogNetworkGateWaiter | null {
  while (gate.waiters.length) {
    const waiter = gate.waiters.shift()!;
    if (waiter.settled) {
      continue;
    }
    if (waiter.isCancelled?.()) {
      logCatalogNetworkGate('cancelled-while-waiting', {
        providerId,
        mediaType: waiter.mediaType,
        operation: waiter.operation,
        runId: waiter.runId,
        waitMs: Date.now() - waiter.queuedAt,
        heldMs: null,
        queueDepth: pendingWaiters(gate).length,
        previousOwner: ownerSnapshot(gate.owner),
        nextOwner: peekNextOwner(gate),
      });
      abandonWaiter(waiter, createCatalogNetworkGateCancelledError());
      continue;
    }
    return waiter;
  }
  return null;
}

function releaseProviderCatalogNetworkGate(providerId: string, leaseId: number) {
  const gate = gates.get(providerId);
  if (!gate || gate.owner?.leaseId !== leaseId) {
    return;
  }
  const releasing = ownerSnapshot(gate.owner);
  const heldMs = Date.now() - gate.acquiredAt;
  const nextWaiter = dequeueNextWaiter(providerId, gate);
  const nextOwner = nextWaiter ? ownerSnapshot(nextWaiter) : peekNextOwner(gate);
  logCatalogNetworkGate('released', {
    providerId,
    mediaType: releasing?.mediaType,
    operation: releasing?.operation,
    runId: releasing?.runId,
    waitMs: null,
    heldMs,
    queueDepth: pendingWaiters(gate).length,
    previousOwner: releasing,
    nextOwner,
  });
  if (releasing?.preemptionRequested) {
    logCatalogNetworkGate('gate-owner-released-after-preemption', {
      providerId,
      mediaType: releasing.mediaType,
      operation: releasing.operation,
      runId: releasing.runId,
      requestSource: releasing.requestSource,
      ownerHeldMs: heldMs,
      preemptionReason: 'foreground-movies-first-run',
    });
    logCatalogNetworkGate('preemption-acknowledged', {
      providerId,
      mediaType: releasing.mediaType,
      operation: releasing.operation,
      runId: releasing.runId,
      requestSource: releasing.requestSource,
      waitMs: null,
      ownerHeldMs: heldMs,
      preemptionReason: 'foreground-movies-first-run',
    });
    releasing.onPreemptionReleased?.({ ownerHeldMs: heldMs });
  }
  if (!nextWaiter) {
    gate.owner = null;
    if (!pendingWaiters(gate).length) {
      gates.delete(providerId);
    }
    return;
  }
  const lease = takeOwnership(gate, nextWaiter);
  nextWaiter.settled = true;
  if (nextWaiter.pollTimer) {
    clearInterval(nextWaiter.pollTimer);
    nextWaiter.pollTimer = null;
  }
  logCatalogNetworkGate('acquired', {
    providerId,
    mediaType: nextWaiter.mediaType,
    operation: nextWaiter.operation,
    runId: nextWaiter.runId,
    waitMs: Date.now() - nextWaiter.queuedAt,
    heldMs: null,
    queueDepth: pendingWaiters(gate).length,
    previousOwner: releasing,
    nextOwner: peekNextOwner(gate),
  });
  if (releasing?.preemptionRequested && nextWaiter.foreground && nextWaiter.mediaType === 'movie') {
    logCatalogNetworkGate('foreground-acquired-after-preemption', {
      providerId,
      mediaType: nextWaiter.mediaType,
      operation: nextWaiter.operation,
      runId: nextWaiter.runId,
      requestSource: nextWaiter.requestSource,
      activeSurface: nextWaiter.activeSurface,
      readableGenerationPresent: nextWaiter.readableGenerationPresent,
      waitMs: Date.now() - nextWaiter.queuedAt,
      ownerHeldMs: heldMs,
      preemptionReason: 'foreground-movies-first-run',
    });
  }
  nextWaiter.resolve({ leaseId: lease.leaseId, acquiredAt: gate.acquiredAt });
}
