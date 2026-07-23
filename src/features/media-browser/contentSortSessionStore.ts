import { DEFAULT_CONTENT_SORT, isContentSortOption, type ContentSortOption } from './contentSorting.ts';

let movieSortOption: ContentSortOption = DEFAULT_CONTENT_SORT;
let seriesSortOption: ContentSortOption = DEFAULT_CONTENT_SORT;

const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((listener) => listener());
}

export function getMovieSortOption() {
  return movieSortOption;
}

export function getSeriesSortOption() {
  return seriesSortOption;
}

export function setMovieSortOptionSession(next: ContentSortOption) {
  if (movieSortOption === next) {
    return;
  }
  movieSortOption = next;
  notify();
}

export function setSeriesSortOptionSession(next: ContentSortOption) {
  if (seriesSortOption === next) {
    return;
  }
  seriesSortOption = next;
  notify();
}

export function subscribeContentSortSession(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function clearContentSortSessionForTests() {
  movieSortOption = DEFAULT_CONTENT_SORT;
  seriesSortOption = DEFAULT_CONTENT_SORT;
}

export function hydrateContentSortSessionFromSettings(value: Partial<{ movieSortOption?: unknown; seriesSortOption?: unknown }> | null) {
  movieSortOption = isContentSortOption(value?.movieSortOption) ? value.movieSortOption : DEFAULT_CONTENT_SORT;
  seriesSortOption = isContentSortOption(value?.seriesSortOption) ? value.seriesSortOption : DEFAULT_CONTENT_SORT;
}
