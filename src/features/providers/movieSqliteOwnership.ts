import type { CatalogSqliteMediaSyncHandle } from '../catalog/catalogSqliteSyncWriter.ts';

export type MovieFinishOutcome = 'completed' | 'failed' | 'cancelled' | null;

export const MOVIE_SYNC_OPEN_SQLITE_ERROR = 'movie_sync_returned_with_open_sqlite_generation';
export const MOVIE_SYNC_CANCELLED_ERROR = 'movie_sync_cancelled';
export const MOVIE_SYNC_PLAYBACK_DEFERRED_ERROR = 'movie_sync_playback_deferred';

export type MovieSqliteEarlyReturnKind = 'cancelled' | 'failed' | 'playback_deferred';

export type MovieSqliteOwnershipState = {
  sqliteHandleCreated: boolean;
  sqliteGeneration: number;
  sqliteEnabled: boolean;
  movieFinishCalled: boolean;
  movieFinishOutcome: MovieFinishOutcome;
  returnReason: string;
  handle: CatalogSqliteMediaSyncHandle | null;
};

export type MovieSqliteOwnershipDeps = {
  finish: (input: {
    handle: CatalogSqliteMediaSyncHandle;
    ok: boolean;
    processedCount?: number;
    errorCode?: string;
    nativeDone?: boolean;
  }) => Promise<boolean>;
  probe: (event: string, fields: Record<string, unknown>) => void;
};

export function createMovieSqliteOwnershipState(): MovieSqliteOwnershipState {
  return {
    sqliteHandleCreated: false,
    sqliteGeneration: 0,
    sqliteEnabled: false,
    movieFinishCalled: false,
    movieFinishOutcome: null,
    returnReason: 'unknown',
    handle: null,
  };
}

export function movieSqliteOwnershipProbeFields(
  state: MovieSqliteOwnershipState,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    generation: state.sqliteGeneration,
    sqliteHandleCreated: state.sqliteHandleCreated,
    sqliteEnabled: state.sqliteEnabled,
    movieFinishCalled: state.movieFinishCalled,
    movieFinishOutcome: state.movieFinishOutcome,
    returnReason: state.returnReason,
    abandonedOpenSqliteGeneration: ownsOpenMovieSqliteGeneration(state),
    ...extra,
  };
}

export function noteMovieSqliteHandle(
  state: MovieSqliteOwnershipState,
  handle: CatalogSqliteMediaSyncHandle,
): void {
  state.handle = handle;
  state.sqliteHandleCreated = true;
  state.sqliteEnabled = Boolean(handle.enabled);
  state.sqliteGeneration = handle.generation ?? 0;
  state.movieFinishCalled = false;
  state.movieFinishOutcome = null;
}

export function ownsOpenMovieSqliteGeneration(state: MovieSqliteOwnershipState): boolean {
  return Boolean(state.sqliteHandleCreated && state.sqliteEnabled && state.movieFinishCalled !== true);
}

export async function finishOwnedMovieSqlite(
  state: MovieSqliteOwnershipState,
  deps: MovieSqliteOwnershipDeps,
  input: {
    handle?: CatalogSqliteMediaSyncHandle | null;
    ok: boolean;
    processedCount?: number;
    errorCode?: string;
    nativeDone?: boolean;
    outcome: Exclude<MovieFinishOutcome, null>;
  },
): Promise<boolean> {
  if (state.movieFinishCalled) {
    return state.movieFinishOutcome === 'completed';
  }

  const handle = input.handle ?? state.handle;
  state.movieFinishCalled = true;
  state.movieFinishOutcome = input.outcome;

  if (!handle?.enabled) {
    deps.probe(
      'finishCatalogSqliteMediaSync-enter',
      movieSqliteOwnershipProbeFields(state, {
        skippedDisabled: true,
        ok: input.ok,
        errorCode: input.errorCode ?? null,
      }),
    );
    deps.probe(
      'finishCatalogSqliteMediaSync-exit',
      movieSqliteOwnershipProbeFields(state, {
        skippedDisabled: true,
        result: true,
        ok: input.ok,
      }),
    );
    return true;
  }

  deps.probe(
    'finishCatalogSqliteMediaSync-enter',
    movieSqliteOwnershipProbeFields(state, {
      ok: input.ok,
      errorCode: input.errorCode ?? null,
      nativeDone: input.nativeDone ?? null,
    }),
  );
  try {
    const result = await deps.finish({
      handle,
      ok: input.ok,
      processedCount: input.processedCount,
      errorCode: input.errorCode,
      nativeDone: input.nativeDone,
    });
    if (input.ok && !result) {
      state.movieFinishOutcome = 'failed';
    }
    deps.probe(
      'finishCatalogSqliteMediaSync-exit',
      movieSqliteOwnershipProbeFields(state, {
        result,
        ok: input.ok,
        errorCode: input.errorCode ?? null,
      }),
    );
    return result;
  } catch (error) {
    state.movieFinishOutcome = 'failed';
    deps.probe(
      'finishCatalogSqliteMediaSync-exit',
      movieSqliteOwnershipProbeFields(state, {
        result: false,
        ok: input.ok,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    throw error;
  }
}

export async function terminateMovieSqliteEarlyReturn(
  state: MovieSqliteOwnershipState,
  deps: MovieSqliteOwnershipDeps,
  input: {
    reason: string;
    kind: MovieSqliteEarlyReturnKind;
    extra?: Record<string, unknown>;
  },
): Promise<void> {
  state.returnReason = input.reason;
  deps.probe(
    'movie-early-return',
    movieSqliteOwnershipProbeFields(state, {
      reason: input.reason,
      kind: input.kind,
      ...(input.extra ?? {}),
    }),
  );

  if (!state.sqliteEnabled) {
    return;
  }

  const outcome: Exclude<MovieFinishOutcome, null> =
    input.kind === 'cancelled' ? 'cancelled' : 'failed';
  const errorCode =
    input.kind === 'cancelled'
      ? 'cancelled'
      : input.kind === 'playback_deferred'
        ? 'playback_deferred'
        : input.reason;

  await finishOwnedMovieSqlite(state, deps, {
    ok: false,
    errorCode,
    nativeDone: false,
    outcome,
  });

  throw new Error(errorMessageForMovieEarlyReturnKind(input.kind));
}

export async function enforceMovieSqliteTerminal(
  state: MovieSqliteOwnershipState,
  deps: MovieSqliteOwnershipDeps,
): Promise<void> {
  if (!ownsOpenMovieSqliteGeneration(state)) {
    return;
  }

  deps.probe(
    'abandoned-open-sqlite-generation',
    movieSqliteOwnershipProbeFields(state, {
      event: 'abandoned-open-sqlite-generation',
    }),
  );

  try {
    await finishOwnedMovieSqlite(state, deps, {
      ok: false,
      errorCode: MOVIE_SYNC_OPEN_SQLITE_ERROR,
      nativeDone: false,
      outcome: 'failed',
    });
  } catch {
    // Generation close is best-effort; the invariant error is the contract.
  }

  state.returnReason = 'abandoned-open-sqlite-generation';
  throw new Error(MOVIE_SYNC_OPEN_SQLITE_ERROR);
}

export function errorMessageForMovieEarlyReturnKind(kind: MovieSqliteEarlyReturnKind): string {
  if (kind === 'cancelled') {
    return MOVIE_SYNC_CANCELLED_ERROR;
  }
  if (kind === 'playback_deferred') {
    return MOVIE_SYNC_PLAYBACK_DEFERRED_ERROR;
  }
  return MOVIE_SYNC_OPEN_SQLITE_ERROR;
}
