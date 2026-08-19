/**
 * Diagnostics-only mirrors for Movies UI / catalog state.
 *
 * Read by ONN trace and FlatList lifecycle logs. Never read by focus, render,
 * or data logic that affects product behavior.
 *
 * Stage 4.2J also exposes a browse UI freeze latch consulted by the screen model
 * so pagination / catalog commits can defer without widening product focus paths.
 */

let detailOpenForDiagnostics = false;
/** Stage 4.2J: freeze browse UI commits while Detail is open or closing. */
let browseUiFrozenForDetail = false;
/** Stage 4.2J: increments when visibleMovies identity is replaced (not pagination append). */
let browseListRevision = 0;

export type MoviesOnnTraceSnapshot = {
  providerId: string | null;
  route: string;
  selectedCategoryId: string;
  selectedMovieId: string | null;
  focusedMovieId: string | null;
  detailOpen: boolean;
  detailFocusPhase: string;
  searchPhase: string | null;
  playbackActive: boolean;
  playbackClosing: boolean;
  restoringBrowseFocus: boolean;
  categoriesLength: number;
  visibleMoviesLength: number;
  loadStatus: string;
  readableGeneration: number | null;
  syncingGeneration: number | null;
  activeProviderGeneration: number | null;
  catalogRepairing: boolean;
};

const EMPTY_SNAPSHOT: MoviesOnnTraceSnapshot = {
  providerId: null,
  route: 'movies',
  selectedCategoryId: '',
  selectedMovieId: null,
  focusedMovieId: null,
  detailOpen: false,
  detailFocusPhase: 'browse',
  searchPhase: null,
  playbackActive: false,
  playbackClosing: false,
  restoringBrowseFocus: false,
  categoriesLength: 0,
  visibleMoviesLength: 0,
  loadStatus: 'idle',
  readableGeneration: null,
  syncingGeneration: null,
  activeProviderGeneration: null,
  catalogRepairing: false,
};

let screenSnapshot: MoviesOnnTraceSnapshot = EMPTY_SNAPSHOT;

export function setMoviesDetailOpenForDiagnostics(open: boolean) {
  detailOpenForDiagnostics = open;
}

export function getMoviesDetailOpenForDiagnostics() {
  return detailOpenForDiagnostics;
}

export function setMoviesBrowseUiFrozenForDetail(frozen: boolean) {
  browseUiFrozenForDetail = frozen;
}

export function isMoviesBrowseUiFrozenForDetail() {
  return browseUiFrozenForDetail;
}

/** Clears module latches left behind when ErrorBoundary unmounts Movies mid-Detail. */
export function resetMoviesBrowsePresentationLatches() {
  browseUiFrozenForDetail = false;
  detailOpenForDiagnostics = false;
}

export function bumpMoviesBrowseListRevision() {
  browseListRevision += 1;
  return browseListRevision;
}

export function getMoviesBrowseListRevision() {
  return browseListRevision;
}

export function setMoviesBrowseListRevisionForTests(revision: number) {
  browseListRevision = revision;
}

export function setMoviesOnnTraceSnapshot(next: MoviesOnnTraceSnapshot) {
  screenSnapshot = next;
  detailOpenForDiagnostics = next.detailOpen;
}

export function getMoviesOnnTraceSnapshot(): MoviesOnnTraceSnapshot {
  return screenSnapshot;
}

export function inferMovieGridUnmountReason(): string {
  const snap = screenSnapshot;
  if (snap.categoriesLength === 0) {
    return snap.catalogRepairing
      ? 'categories-empty-repairing'
      : snap.loadStatus === 'loading'
        ? 'categories-empty-loading'
        : 'categories-empty';
  }
  if (snap.playbackActive || snap.playbackClosing) {
    return 'playback-active';
  }
  if (snap.detailOpen) {
    return 'detail-open-remount';
  }
  return 'grid-unmount-unknown';
}
