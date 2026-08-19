/**
 * Interactive Live TV workload flags for low-end Fire TV.
 * User input (DPAD, surf, Search/IME, BACK) always outranks indexing, EPG, and idle sync.
 */

export type LiveTvActiveScreen = 'live' | 'other';

export type LiveTvWorkloadSnapshot = {
  activeScreen: LiveTvActiveScreen;
  fullscreenActive: boolean;
  searchOverlayVisible: boolean;
  searchImeActive: boolean;
  searchIndexBuildActive: boolean;
  searchIndexPendingCategories: number;
  epgRequestsInFlight: number;
  epgRequestsCancelled: number;
  surfTransitionInFlight: boolean;
  rapidDpadActive: boolean;
};

const DEFAULT_WORKLOAD: LiveTvWorkloadSnapshot = {
  activeScreen: 'other',
  fullscreenActive: false,
  searchOverlayVisible: false,
  searchImeActive: false,
  searchIndexBuildActive: false,
  searchIndexPendingCategories: 0,
  epgRequestsInFlight: 0,
  epgRequestsCancelled: 0,
  surfTransitionInFlight: false,
  rapidDpadActive: false,
};

let workload: LiveTvWorkloadSnapshot = { ...DEFAULT_WORKLOAD };
let lastLoggedSignature = '';

function snapshotSignature(snapshot: LiveTvWorkloadSnapshot) {
  return [
    snapshot.activeScreen,
    snapshot.fullscreenActive ? 1 : 0,
    snapshot.searchOverlayVisible ? 1 : 0,
    snapshot.searchImeActive ? 1 : 0,
    snapshot.searchIndexBuildActive ? 1 : 0,
    snapshot.searchIndexPendingCategories,
    snapshot.epgRequestsInFlight,
    snapshot.epgRequestsCancelled,
    snapshot.surfTransitionInFlight ? 1 : 0,
    snapshot.rapidDpadActive ? 1 : 0,
  ].join(':');
}

export function getLiveTvWorkload(): LiveTvWorkloadSnapshot {
  return { ...workload };
}

export function resetLiveTvWorkloadForTests() {
  workload = { ...DEFAULT_WORKLOAD };
  lastLoggedSignature = '';
}

export function patchLiveTvWorkload(
  patch: Partial<LiveTvWorkloadSnapshot>,
  options: { log?: boolean; reason?: string } = {},
) {
  const next: LiveTvWorkloadSnapshot = {
    ...workload,
    ...patch,
    searchIndexPendingCategories: Math.max(0, patch.searchIndexPendingCategories ?? workload.searchIndexPendingCategories),
    epgRequestsInFlight: Math.max(0, patch.epgRequestsInFlight ?? workload.epgRequestsInFlight),
    epgRequestsCancelled: Math.max(0, patch.epgRequestsCancelled ?? workload.epgRequestsCancelled),
  };

  const changed = snapshotSignature(next) !== snapshotSignature(workload);
  workload = next;
  if (options.log || (changed && options.log !== false && !isNoisyRapidDpadOnlyChange(patch, changed))) {
    logLiveTvWorkload(options.reason ?? 'patch');
  }
  return getLiveTvWorkload();
}

function isNoisyRapidDpadOnlyChange(patch: Partial<LiveTvWorkloadSnapshot>, changed: boolean) {
  if (!changed) {
    return true;
  }
  const keys = Object.keys(patch);
  return keys.length === 1 && keys[0] === 'rapidDpadActive';
}

export function shouldPauseLiveSearchIndexing(snapshot: LiveTvWorkloadSnapshot = workload) {
  return (
    snapshot.activeScreen === 'live' &&
    (snapshot.fullscreenActive ||
      snapshot.surfTransitionInFlight ||
      snapshot.searchOverlayVisible ||
      snapshot.searchImeActive ||
      snapshot.rapidDpadActive)
  );
}

export function shouldSuspendLiveListEpg(snapshot: LiveTvWorkloadSnapshot = workload) {
  return (
    snapshot.searchOverlayVisible ||
    snapshot.fullscreenActive ||
    snapshot.surfTransitionInFlight
  );
}

export function shouldDeferBackgroundLiveWork(snapshot: LiveTvWorkloadSnapshot = workload) {
  return shouldPauseLiveSearchIndexing(snapshot) || snapshot.surfTransitionInFlight;
}

export function logLiveTvWorkload(reason = 'snapshot') {
  const signature = snapshotSignature(workload);
  if (signature === lastLoggedSignature && reason === 'snapshot') {
    return;
  }
  lastLoggedSignature = signature;
  console.info('[NovaCast Live Workload]', {
    reason,
    activeScreen: workload.activeScreen,
    fullscreenActive: workload.fullscreenActive,
    searchOverlayVisible: workload.searchOverlayVisible,
    searchIndexBuildActive: workload.searchIndexBuildActive,
    searchIndexPendingCategories: workload.searchIndexPendingCategories,
    epgRequestsInFlight: workload.epgRequestsInFlight,
    epgRequestsCancelled: workload.epgRequestsCancelled,
    surfTransitionInFlight: workload.surfTransitionInFlight,
  });
}

export function noteLiveEpgRequestStarted() {
  patchLiveTvWorkload({ epgRequestsInFlight: workload.epgRequestsInFlight + 1 }, { log: false });
}

export function noteLiveEpgRequestFinished() {
  patchLiveTvWorkload({ epgRequestsInFlight: Math.max(0, workload.epgRequestsInFlight - 1) }, { log: false });
}

export function noteLiveEpgRequestCancelled(count = 1) {
  patchLiveTvWorkload(
    { epgRequestsCancelled: workload.epgRequestsCancelled + Math.max(0, count) },
    { log: true, reason: 'epg-cancelled' },
  );
}
