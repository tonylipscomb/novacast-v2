/**
 * Guide focus policy — keep D-pad chrome local; defer details/state.
 */
export const GUIDE_DETAILS_FOCUS_DEBOUNCE_MS = 200;

export function shouldUpdateGuideDetailsImmediately(input: {
  /** Jump-to-now / restore should publish details immediately. */
  forceImmediate: boolean;
}): boolean {
  return input.forceImmediate;
}
