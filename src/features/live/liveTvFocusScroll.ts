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
 * Scroll when the focused row is offscreen or within one row of the visible edge.
 */
export function shouldScrollToKeepFocusVisible(
  focusedIndex: number,
  visible: VisibleIndexRange | null,
  totalCount: number,
  edgeBuffer = 1,
): boolean {
  if (totalCount <= 0 || focusedIndex < 0 || focusedIndex >= totalCount) {
    return false;
  }

  if (visible === null) {
    return true;
  }

  if (focusedIndex < visible.first || focusedIndex > visible.last) {
    return true;
  }

  const nearBottom = focusedIndex >= visible.last - edgeBuffer && focusedIndex < totalCount - 1;
  const nearTop = focusedIndex <= visible.first + edgeBuffer && focusedIndex > 0;

  return nearBottom || nearTop;
}

/** TV channel list keeps the focused row near the middle of the viewport. */
export const LIVE_TV_FOCUS_SCROLL_VIEW_POSITION = 0.45;
