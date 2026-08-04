/**
 * Diagnostics-only mirrors for Movies UI / catalog state.
 *
 * Read by ONN trace and FlatList lifecycle logs. Never read by focus, render,
 * or data logic that affects product behavior.
 */

let detailOpenForDiagnostics = false;

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
