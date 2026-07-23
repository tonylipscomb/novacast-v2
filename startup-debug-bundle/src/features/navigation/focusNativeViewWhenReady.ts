import type { ElementRef } from 'react';
import type { View } from 'react-native';

/** Bounded retry count for focusing a just-mounted/just-laid-out native view. */
export const FOCUS_RESTORE_MAX_ATTEMPTS = 3;

/**
 * Calls `.focus()` on the target once it (and its native layout) is ready,
 * retrying across a few animation frames instead of a blind timeout.
 */
export function focusNativeViewWhenReady(
  getTarget: () => ElementRef<typeof View> | null | undefined,
  onSettled: () => void,
  attemptsLeft = FOCUS_RESTORE_MAX_ATTEMPTS,
): () => void {
  const target = getTarget();
  if (target) {
    target.focus();
    onSettled();
    return () => {};
  }

  if (attemptsLeft <= 0) {
    onSettled();
    return () => {};
  }

  const frame = requestAnimationFrame(() => {
    focusNativeViewWhenReady(getTarget, onSettled, attemptsLeft - 1);
  });
  return () => cancelAnimationFrame(frame);
}
