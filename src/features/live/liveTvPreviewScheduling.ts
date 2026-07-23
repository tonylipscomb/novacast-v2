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

export const PREVIEW_FOCUS_DEBOUNCE_MS = 320;

/**
 * Focus moved again before the debounce fired — ignore the scheduled preview tune.
 */
export function shouldApplyDebouncedPreviewTune(
  scheduledChannelId: string,
  focusedChannelId: string | null,
): boolean {
  return focusedChannelId === scheduledChannelId;
}

/**
 * Skip redundant list jumps when native focus is already on the same row.
 */
export function shouldScrollListToFocusIndex(lastScrolledIndex: number | null, nextIndex: number): boolean {
  return lastScrolledIndex !== nextIndex;
}
