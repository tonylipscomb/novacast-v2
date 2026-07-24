/**
 * Pure Search overlay focus policy (TV / Fire TV).
 * After the search shell has held focus once, Close and results must never reclaim Search.
 */
export function shouldReclaimSearchFromClose(focusConfirmed: boolean): boolean {
  void focusConfirmed;
  return false;
}

export function shouldRefocusSearchShellOnTextInputBlur(): boolean {
  return false;
}

/**
 * Close must not wire every nextFocus* edge back to Search — that bounces focus off Close.
 * When false, Close keeps native edges (or self) so Right/Up stay on Close.
 */
export function shouldWireCloseNextFocusToSearch(): boolean {
  return false;
}

/** IME submit may return to the search shell only when Close is not focused. */
export function shouldReturnFocusToSearchShellAfterIme(input: { closeFocused: boolean }): boolean {
  return !input.closeFocused;
}

/**
 * Close sits above the search field. Up from Close must NOT go to Search (bounce).
 * Down is the only intentional path back to the search shell.
 */
export function resolveCloseNextFocusHandles(input: {
  closeHandle?: number;
  searchFieldHandle?: number;
}): {
  nextFocusUp?: number;
  nextFocusLeft?: number;
  nextFocusRight?: number;
  nextFocusDown?: number;
} | null {
  if (shouldWireCloseNextFocusToSearch()) {
    if (!input.searchFieldHandle) {
      return null;
    }
    return {
      nextFocusUp: input.searchFieldHandle,
      nextFocusLeft: input.searchFieldHandle,
      nextFocusRight: input.searchFieldHandle,
      nextFocusDown: input.searchFieldHandle,
    };
  }

  if (!input.closeHandle) {
    return null;
  }

  return {
    nextFocusUp: input.closeHandle,
    nextFocusLeft: input.closeHandle,
    nextFocusRight: input.closeHandle,
    nextFocusDown: input.searchFieldHandle ?? input.closeHandle,
  };
}

/**
 * Search must not hard-wire Up → Close. A mutual Close↔Search nextFocus pair
 * bounces Down off Close on Fire TV / ONN. Spatial Up still reaches Close after
 * the header sits above the field in normal layout order.
 */
export function shouldWireSearchNextFocusUpToClose(): boolean {
  return false;
}

/** TVFocusGuideView autoFocus fights Close — open focus is requestTvFocus once only. */
export function shouldAutoFocusSearchFocusGuide(): boolean {
  return false;
}
