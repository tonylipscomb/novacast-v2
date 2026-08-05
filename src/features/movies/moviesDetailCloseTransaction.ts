/**
 * Stage 4.2J — Deterministic Movie Detail close transaction.
 * Pure helpers. MoviesScreen remains the sole coordinator.
 */

export const MOVIES_FOCUS_STAGE4J_MARKER = 'stage4j-movies-deterministic-detail-close-v1';

export type MoviesDetailCloseSource = 'back' | 'x' | 'other';
export type MoviesDetailCloseOrigin = 'browse' | 'search';

export type MoviesDetailCloseTransaction = {
  token: string;
  source: MoviesDetailCloseSource;
  origin: MoviesDetailCloseOrigin;
  targetMovieId: string;
  targetIndex: number;
  categoryId: string;
  gridInstanceId: string | null;
  listOffset: number;
  focusedDetailControl: string | null;
  targetNativeHandle: number | null;
  startedAt: number;
  focusConfirmed: boolean;
  offsetConfirmed: boolean;
  revealCommitted: boolean;
  cancelled: boolean;
  listRevision: number;
  refRevision: number;
  snapshotTargetWasVisible: boolean;
};

export function createMoviesDetailCloseTransaction(input: {
  token: string;
  source: MoviesDetailCloseSource;
  origin: MoviesDetailCloseOrigin;
  targetMovieId: string;
  targetIndex: number;
  categoryId: string;
  gridInstanceId: string | null;
  listOffset: number;
  focusedDetailControl?: string | null;
  targetNativeHandle?: number | null;
  startedAt?: number;
  listRevision?: number;
  refRevision?: number;
  snapshotTargetWasVisible?: boolean;
}): MoviesDetailCloseTransaction {
  return {
    token: input.token,
    source: input.source,
    origin: input.origin,
    targetMovieId: input.targetMovieId,
    targetIndex: input.targetIndex,
    categoryId: input.categoryId,
    gridInstanceId: input.gridInstanceId,
    listOffset: input.listOffset,
    focusedDetailControl: input.focusedDetailControl ?? null,
    targetNativeHandle: input.targetNativeHandle ?? null,
    startedAt: input.startedAt ?? Date.now(),
    focusConfirmed: false,
    offsetConfirmed: false,
    revealCommitted: false,
    cancelled: false,
    listRevision: input.listRevision ?? 0,
    refRevision: input.refRevision ?? 0,
    snapshotTargetWasVisible: input.snapshotTargetWasVisible ?? false,
  };
}

/** Strict ownership: null or mismatched token must drop the callback. */
export function shouldDropMoviesDetailCloseCallback(input: {
  activeToken: string | null | undefined;
  callbackToken: string;
  revealCommitted?: boolean;
  commitToken?: string | null;
}): boolean {
  if (input.revealCommitted || input.commitToken === input.callbackToken) {
    return true;
  }
  return input.activeToken !== input.callbackToken;
}

export function tryCommitMoviesDetailCloseReveal(input: {
  transaction: MoviesDetailCloseTransaction | null | undefined;
  token: string;
}): { ok: true; transaction: MoviesDetailCloseTransaction } | { ok: false; reason: string } {
  if (!input.transaction) {
    return { ok: false, reason: 'missing-transaction' };
  }
  if (input.transaction.token !== input.token) {
    return { ok: false, reason: 'token-mismatch' };
  }
  if (input.transaction.cancelled) {
    return { ok: false, reason: 'cancelled' };
  }
  if (input.transaction.revealCommitted) {
    return { ok: false, reason: 'already-committed' };
  }
  return {
    ok: true,
    transaction: {
      ...input.transaction,
      revealCommitted: true,
    },
  };
}

/**
 * Fast-mounted path requires a still-registered, identity-stable poster target
 * that was visible in the immutable open snapshot. Live viewport indexes may be
 * temporarily null.
 */
export function isMoviesDetailCloseTargetRefValid(input: {
  hasSnapshot: boolean;
  targetMovieId: string | null;
  targetIndex: number;
  targetNativeHandleExists: boolean;
  registeredContentIdMatches: boolean;
  registeredIndexMatches: boolean;
  gridInstanceMatches: boolean;
  visibleMoviesEntryMatches: boolean;
  snapshotTargetWasVisible: boolean;
  listRevisionUnchanged: boolean;
}): boolean {
  return (
    input.hasSnapshot &&
    Boolean(input.targetMovieId) &&
    input.targetIndex >= 0 &&
    input.targetNativeHandleExists &&
    input.registeredContentIdMatches &&
    input.registeredIndexMatches &&
    input.gridInstanceMatches &&
    input.visibleMoviesEntryMatches &&
    input.snapshotTargetWasVisible &&
    input.listRevisionUnchanged
  );
}

/** Natural mounted return: preserve current Detail focus owner for Back and X. */
export function shouldPreserveMoviesDetailFocusOwner(input: {
  handoffActive: boolean;
  naturalReturn: boolean;
  closeSource?: MoviesDetailCloseSource | null;
}): boolean {
  return input.handoffActive && input.naturalReturn;
}

/** Hidden sentinel must not receive focus on natural mounted return. */
export function shouldFocusMoviesDetailHiddenHandoffForClose(input: {
  naturalReturn: boolean;
  closeSource?: MoviesDetailCloseSource | null;
}): boolean {
  return !input.naturalReturn;
}

export function shouldDeferMoviesBrowseMutationDuringDetail(input: {
  detailOpen: boolean;
  detailClosing: boolean;
}): boolean {
  return input.detailOpen || input.detailClosing;
}

export type MoviesDeferredBrowseCommitKind =
  | 'pagination'
  | 'catalog-commit'
  | 'list-replacement';

export function describeMoviesDeferredBrowseCommit(
  kind: MoviesDeferredBrowseCommitKind,
): string {
  switch (kind) {
    case 'pagination':
      return 'detail_close_deferred_pagination';
    case 'catalog-commit':
      return 'detail_close_deferred_catalog_commit';
    case 'list-replacement':
      return 'detail_close_deferred_list_replacement';
  }
}
