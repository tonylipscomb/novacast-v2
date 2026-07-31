/**
 * Pure focus policy for Movies/Series poster grids.
 * Sort may steal focus only when the user changes sort — never when pagination loading flips.
 */
export function shouldAutoFocusSortControl(input: {
  sortOptionChanged: boolean;
  loadingChanged?: boolean;
}): boolean {
  return input.sortOptionChanged === true;
}

/**
 * Preferred focus on mount/seed must not wait for pagination loading.
 * Loading flips remount preferred-focus competition and send focus to categories/nav.
 */
export function shouldClaimPreferredPosterFocus(input: {
  focusClaimed: boolean;
  itemId: string;
  seedId: string | null;
}): boolean {
  return !input.focusClaimed && input.seedId != null && input.itemId === input.seedId;
}

export type MoviesFocusOwner =
  | 'navbar'
  | 'category'
  | 'poster'
  | 'loading-anchor'
  | 'detail'
  | 'search'
  | 'restoring';

export function deriveMoviesFocusOwner(input: {
  detailOpen: boolean;
  searchOpen: boolean;
  restoringBrowseFocus: boolean;
  categoryLoading: boolean;
  loadStatus: string;
  hasPosters: boolean;
  hasCategories: boolean;
}): MoviesFocusOwner {
  if (input.detailOpen) return 'detail';
  if (input.searchOpen) return 'search';
  if (input.restoringBrowseFocus) return 'restoring';
  if ((input.categoryLoading || input.loadStatus === 'loading') && !input.hasPosters) return 'loading-anchor';
  if (input.hasPosters) return 'poster';
  if (input.hasCategories) return 'category';
  return 'navbar';
}

/**
 * Resolve which poster to restore after detail/search/playback close.
 * Prefer last focused ID; never fall back to navbar/Search/categories here.
 */
export function resolvePosterRestorationId(input: {
  focusedId: string | null | undefined;
  selectedId: string | null | undefined;
  availableIds: readonly string[];
  restorationActive?: boolean;
  targetMovieId?: string | null;
  targetConclusiveAbsent?: boolean;
}): string | null {
  const { focusedId, selectedId, availableIds, restorationActive, targetMovieId, targetConclusiveAbsent } = input;
  if (restorationActive && targetMovieId) {
    if (availableIds.includes(targetMovieId)) {
      return targetMovieId;
    }
    // A target missing from the rendered page may still exist in the
    // category dataset. Keep the restoration pending until that is known.
    return targetConclusiveAbsent ? availableIds[0] ?? null : null;
  }
  if (focusedId && availableIds.includes(focusedId)) {
    return focusedId;
  }
  if (selectedId && availableIds.includes(selectedId)) {
    return selectedId;
  }
  return availableIds[0] ?? null;
}

/**
 * When a focused poster disappears from data, restore within the grid first.
 * Categories are only allowed when the grid is genuinely empty.
 */
export function resolvePosterFocusFallbackRegion(input: { gridEmpty: boolean }): 'categories' | 'poster-grid' {
  return input.gridEmpty ? 'categories' : 'poster-grid';
}

/** Last-row posters should trap Down onto themselves (no jump to categories/nav). */
export function isLastPosterRow(input: { index: number; itemCount: number; columns: number }): boolean {
  const columns = Math.max(1, input.columns);
  if (input.itemCount <= 0) {
    return false;
  }
  const lastRowStart = input.itemCount - (input.itemCount % columns || columns);
  return input.index >= lastRowStart;
}

/**
 * Navbar preferred focus must never stay armed during Movies/Series browse.
 * Continuous hasTVPreferredFocus on the active nav item steals focus from posters
 * (end-of-list, Search open/close, detail close) and can jump into Search.
 *
 * Prefer nav only when the grid is genuinely empty and no overlay owns focus.
 */
export function shouldPreferNavigationFocus(input: {
  playbackUiActive: boolean;
  detailOverlayVisible: boolean;
  searchBlocksBrowse: boolean;
  restoringBrowseFocus: boolean;
  gridEmpty?: boolean;
}): boolean {
  if (
    input.playbackUiActive ||
    input.detailOverlayVisible ||
    input.searchBlocksBrowse ||
    input.restoringBrowseFocus
  ) {
    return false;
  }

  return input.gridEmpty === true;
}
