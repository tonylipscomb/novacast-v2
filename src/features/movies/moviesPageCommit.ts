/**
 * Movies first-page commit / ErrorBoundary recovery helpers.
 * Pure decision + diagnostics. Does not start catalog sync.
 */

export type MoviesPageCommitPhase =
  | 'query-start'
  | 'query-resolved'
  | 'commit-attempt'
  | 'commit-accepted'
  | 'commit-rejected';

export type MoviesRecoveryPhase =
  | 'boundaryRetry'
  | 'component-mounted'
  | 'sessionAlreadyInteractive'
  | 'localPresentationHydrated'
  | 'readyGenerationPresent';

export type MoviesPageCommitDecisionInput = {
  browseUiFrozenForDetail: boolean;
  detailOpenForDiagnostics: boolean;
  currentRequestTokenMatches: boolean;
  selectedCategoryMatches: boolean;
  mounted: boolean;
  cancelled: boolean;
  rowCount: number;
  visibleCountBefore: number;
  reason: string;
};

export type MoviesPageCommitDecision = {
  apply: boolean;
  rejectReason: string | null;
};

let nextPresentationInstance = 1;

export function nextMoviesPresentationInstance(): number {
  const instance = nextPresentationInstance;
  nextPresentationInstance += 1;
  return instance;
}

export function resetMoviesPageCommitForTests() {
  nextPresentationInstance = 1;
}

export function resolveMoviesPageCommitDecision(
  input: MoviesPageCommitDecisionInput,
): MoviesPageCommitDecision {
  if (!input.mounted || input.cancelled) {
    return { apply: false, rejectReason: 'cancelled-or-unmounted' };
  }
  if (!input.currentRequestTokenMatches) {
    return { apply: false, rejectReason: 'request-token-mismatch' };
  }
  if (!input.selectedCategoryMatches) {
    return { apply: false, rejectReason: 'selected-category-mismatch' };
  }

  const frozen = input.browseUiFrozenForDetail || input.detailOpenForDiagnostics;
  if (frozen) {
    // Retry remount starts with [] while the module freeze latch is still true.
    // An empty local presentation must hydrate from a successful page.
    if (input.visibleCountBefore === 0 && input.rowCount > 0) {
      return { apply: true, rejectReason: null };
    }
    return { apply: false, rejectReason: 'browse-ui-frozen-for-detail' };
  }

  return { apply: true, rejectReason: null };
}

export function isMoviesFirstPageReadyInvariantHeld(input: {
  firstPageReady: boolean;
  resultRowCount: number;
  visibleCount: number;
  commitAccepted: boolean;
}): boolean {
  if (input.firstPageReady && input.resultRowCount > 0) {
    return input.commitAccepted && input.visibleCount > 0;
  }
  return true;
}

export function shouldRehydrateMoviesAfterInteractiveRemount(input: {
  sessionAlreadyInteractive: boolean;
  localVisibleCount: number;
  readyGenerationPresent: boolean;
}): boolean {
  return input.sessionAlreadyInteractive && input.readyGenerationPresent && input.localVisibleCount === 0;
}

export function logMoviesPageCommit(payload: {
  phase: MoviesPageCommitPhase;
  categoryId?: string | null;
  requestToken?: string | null;
  currentRequestTokenMatches?: boolean;
  componentInstance?: number | null;
  subscriptionInstance?: number | null;
  rowCount?: number;
  selectedCategoryMatches?: boolean;
  mounted?: boolean;
  cancelled?: boolean;
  visibleCountBefore?: number;
  visibleCountAfter?: number;
  rejectReason?: string | null;
}) {
  console.info(
    '[NovaCast Movies Page Commit] ' +
      JSON.stringify({
        phase: payload.phase,
        categoryId: payload.categoryId ?? null,
        requestToken: payload.requestToken ?? null,
        currentRequestTokenMatches: payload.currentRequestTokenMatches ?? null,
        componentInstance: payload.componentInstance ?? null,
        subscriptionInstance: payload.subscriptionInstance ?? null,
        rowCount: payload.rowCount ?? null,
        selectedCategoryMatches: payload.selectedCategoryMatches ?? null,
        mounted: payload.mounted ?? null,
        cancelled: payload.cancelled ?? null,
        visibleCountBefore: payload.visibleCountBefore ?? null,
        visibleCountAfter: payload.visibleCountAfter ?? null,
        rejectReason: payload.rejectReason ?? null,
      }),
  );
}

export function logMoviesRecovery(payload: {
  phase: MoviesRecoveryPhase;
  componentInstance?: number | null;
  sessionAlreadyInteractive?: boolean;
  localPresentationHydrated?: boolean;
  readyGenerationPresent?: boolean;
  region?: string | null;
}) {
  console.info(
    '[NovaCast Movies Recovery] ' +
      JSON.stringify({
        phase: payload.phase,
        componentInstance: payload.componentInstance ?? null,
        sessionAlreadyInteractive: payload.sessionAlreadyInteractive ?? null,
        localPresentationHydrated: payload.localPresentationHydrated ?? null,
        readyGenerationPresent: payload.readyGenerationPresent ?? null,
        region: payload.region ?? null,
      }),
  );
}
