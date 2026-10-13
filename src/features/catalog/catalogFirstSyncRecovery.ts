export type CatalogRecoveryMediaType = 'movie' | 'series';

export const CATALOG_FIRST_SYNC_MAX_RETRIES = 2;
export const CATALOG_FIRST_SYNC_RETRY_DELAYS_MS = [2_000, 8_000] as const;

type RecoveryState = {
  attempts: number;
  timer: ReturnType<typeof setTimeout> | null;
  lifecycleToken: number;
};

export type CatalogRecoveryState = {
  attempts: number;
  status: 'idle' | 'scheduled' | 'exhausted';
  nextRetryDelayMs: number | null;
};

const recoveryByProvider = new Map<string, RecoveryState>();
const lifecycleTokenByProvider = new Map<string, number>();

function getLifecycleToken(providerId: string): number {
  return lifecycleTokenByProvider.get(providerId) ?? 0;
}

function invalidateLifecycle(providerId: string): number {
  const nextToken = getLifecycleToken(providerId) + 1;
  lifecycleTokenByProvider.set(providerId, nextToken);
  return nextToken;
}

function getOrCreateState(providerId: string): RecoveryState {
  const existing = recoveryByProvider.get(providerId);
  if (existing) {
    return existing;
  }

  const created: RecoveryState = {
    attempts: 0,
    timer: null,
    lifecycleToken: getLifecycleToken(providerId),
  };
  recoveryByProvider.set(providerId, created);
  return created;
}

export function getCatalogFirstSyncRecoveryState(providerId: string): CatalogRecoveryState {
  const state = recoveryByProvider.get(providerId);
  if (!state) {
    return { attempts: 0, status: 'idle', nextRetryDelayMs: null };
  }

  if (state.timer) {
    return {
      attempts: state.attempts,
      status: 'scheduled',
      nextRetryDelayMs: CATALOG_FIRST_SYNC_RETRY_DELAYS_MS[state.attempts - 1] ?? null,
    };
  }

  return {
    attempts: state.attempts,
    status: state.attempts >= CATALOG_FIRST_SYNC_MAX_RETRIES ? 'exhausted' : 'idle',
    nextRetryDelayMs: null,
  };
}

export function scheduleCatalogFirstSyncRecovery(input: {
  providerId: string;
  mediaType: CatalogRecoveryMediaType;
  readableGeneration: number;
  retry: () => Promise<void> | void;
  lifecycleToken?: number;
}): CatalogRecoveryState {
  if (!input.providerId || input.readableGeneration > 0) {
    return { attempts: 0, status: 'idle', nextRetryDelayMs: null };
  }

  if (
    input.lifecycleToken !== undefined &&
    input.lifecycleToken !== getLifecycleToken(input.providerId)
  ) {
    return getCatalogFirstSyncRecoveryState(input.providerId);
  }

  const state = getOrCreateState(input.providerId);
  if (state.timer || state.attempts >= CATALOG_FIRST_SYNC_MAX_RETRIES) {
    return getCatalogFirstSyncRecoveryState(input.providerId);
  }

  const attempt = state.attempts + 1;
  const delayMs = CATALOG_FIRST_SYNC_RETRY_DELAYS_MS[attempt - 1];
  const lifecycleToken = getLifecycleToken(input.providerId);
  state.attempts = attempt;
  state.lifecycleToken = lifecycleToken;
  state.timer = setTimeout(() => {
    if (
      recoveryByProvider.get(input.providerId) !== state ||
      getLifecycleToken(input.providerId) !== lifecycleToken ||
      state.lifecycleToken !== lifecycleToken
    ) {
      console.info(
        '[NOVACAST_CATALOG_RECOVERY]',
        JSON.stringify({
          event: 'retry-cancelled',
          providerId: input.providerId,
          mediaType: input.mediaType,
          attempt,
        }),
      );
      return;
    }

    state.timer = null;
    console.info(
      '[NOVACAST_CATALOG_RECOVERY]',
      JSON.stringify({
        event: 'retry-started',
        providerId: input.providerId,
        mediaType: input.mediaType,
        attempt,
      }),
    );
    void Promise.resolve(input.retry()).catch((error) => {
      console.info(
        '[NOVACAST_CATALOG_RECOVERY]',
        JSON.stringify({
          event: 'retry-request-failed',
          providerId: input.providerId,
          mediaType: input.mediaType,
          attempt,
          errorCategory: error instanceof Error ? error.name : 'unknown',
        }),
      );
    });
  }, delayMs);

  console.info(
    '[NOVACAST_CATALOG_RECOVERY]',
    JSON.stringify({
      event: 'retry-scheduled',
      providerId: input.providerId,
      mediaType: input.mediaType,
      attempt,
      delayMs,
    }),
  );

  return getCatalogFirstSyncRecoveryState(input.providerId);
}

export function resetCatalogFirstSyncRecovery(providerId: string): void {
  invalidateLifecycle(providerId);
  const state = recoveryByProvider.get(providerId);
  if (!state) {
    return;
  }

  if (state.timer) {
    clearTimeout(state.timer);
  }
  recoveryByProvider.delete(providerId);
}

export function getCatalogFirstSyncRecoveryLifecycleToken(providerId: string): number {
  return getLifecycleToken(providerId);
}

export function cancelCatalogFirstSyncRecovery(providerId: string): void {
  resetCatalogFirstSyncRecovery(providerId);
}

export function cancelAllCatalogFirstSyncRecovery(): void {
  const providerIds = new Set([
    ...recoveryByProvider.keys(),
    ...lifecycleTokenByProvider.keys(),
  ]);
  for (const providerId of providerIds) {
    resetCatalogFirstSyncRecovery(providerId);
  }
}

export function resetCatalogFirstSyncRecoveryForTests(): void {
  for (const state of recoveryByProvider.values()) {
    if (state.timer) {
      clearTimeout(state.timer);
    }
  }
  recoveryByProvider.clear();
  lifecycleTokenByProvider.clear();
}
