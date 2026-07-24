export type VisibleIndexRange = {
  first: number;
  last: number;
};

export function visibleRangeFromViewableItems(
  viewableItems: readonly { index: number | null }[],
): VisibleIndexRange | null {
  let first = Number.POSITIVE_INFINITY;
  let last = Number.NEGATIVE_INFINITY;

  for (const item of viewableItems) {
    if (item.index === null || item.index < 0) {
      continue;
    }

    first = Math.min(first, item.index);
    last = Math.max(last, item.index);
  }

  if (!Number.isFinite(first)) {
    return null;
  }

  return { first, last };
}

/**
 * Scroll only when the focused row is outside the currently visible range.
 * Near-edge "keep centered" scrolling is left to native TV focus navigation.
 */
export function shouldScrollToKeepFocusVisible(
  focusedIndex: number,
  visible: VisibleIndexRange | null,
  totalCount: number,
  _edgeBuffer = 0,
): boolean {
  if (totalCount <= 0 || focusedIndex < 0 || focusedIndex >= totalCount) {
    return false;
  }

  if (visible === null) {
    return false;
  }

  return focusedIndex < visible.first || focusedIndex > visible.last;
}

/** TV channel list keeps the focused row near the middle of the viewport. */
export const LIVE_TV_FOCUS_SCROLL_VIEW_POSITION = 0.45;
