/**
 * Preview URL should only be cleared when the committed preview channel
 * actually changes. Clearing on every tune request forces the player to
 * remount/rebuffer even when the user presses OK on the same channel again.
 */
export function shouldClearPreviewStreamUrl(currentPreviewChannelId: string | null, nextChannelId: string): boolean {
  return currentPreviewChannelId !== nextChannelId;
}

/**
 * A debounced preview request is stale when focus/tune moved on before the
 * timer fired. The caller must ignore the result when this returns false.
 */
export function isPreviewRequestCurrent(
  scheduledRequestId: number,
  scheduledChannelId: string,
  currentRequestId: number,
  currentChannelId: string | null,
): boolean {
  return scheduledRequestId === currentRequestId && scheduledChannelId === currentChannelId;
}

/** Lightweight guard: skip setState when focus id is unchanged. */
export function nextFocusId(currentId: string | null, nextId: string): string | null {
  return currentId === nextId ? currentId : nextId;
}

export {
  LIVE_TV_PREVIEW_FOCUS_DEBOUNCE_MS as PREVIEW_FOCUS_DEBOUNCE_MS,
  shouldApplyDebouncedPreviewTune,
} from './liveTvFocusPreview.ts';

/**
 * Skip redundant list jumps when native focus is already on the same row.
 */
export function shouldScrollListToFocusIndex(lastScrolledIndex: number | null, nextIndex: number): boolean {
  return lastScrolledIndex !== nextIndex;
}

/**
 * Programmatic scroll is reserved for restore / category jump / failed native focus —
 * not for ordinary in-range D-pad movement.
 */
export function shouldProgrammaticScrollOnFocus(input: {
  focusedIndex: number;
  visible: { first: number; last: number } | null;
  totalCount: number;
  reason: 'focus' | 'restore' | 'category-jump' | 'focus-recovery';
}): boolean {
  if (input.reason === 'restore' || input.reason === 'category-jump' || input.reason === 'focus-recovery') {
    return true;
  }

  // Ordinary focus: only when the row is genuinely outside the visible range.
  if (input.visible === null) {
    return false;
  }

  return input.focusedIndex < input.visible.first || input.focusedIndex > input.visible.last;
}
