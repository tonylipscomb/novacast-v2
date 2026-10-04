import type { ElementRef } from 'react';
import type { View } from 'react-native';

export const PROVIDER_RECOVERY_FOCUS_MAX_ATTEMPTS = 5;

/** Focus a recovery action after native layout, with cancellation on unmount. */
export function focusProviderRecoveryViewWhenReady(
  getTarget: () => ElementRef<typeof View> | null | undefined,
  onFocused: (attempt: number, focusHandlePresent: boolean) => void,
  attemptsLeft = PROVIDER_RECOVERY_FOCUS_MAX_ATTEMPTS,
) {
  let cancelled = false;
  let frame: number | null = null;
  let attempt = 0;

  const run = () => {
    if (cancelled) return;
    const target = getTarget();
    if (target) {
      target.focus();
      onFocused(attempt, true);
      return;
    }
    if (attempt >= attemptsLeft) {
      onFocused(attempt, false);
      return;
    }
    attempt += 1;
    frame = requestAnimationFrame(run);
  };

  run();
  return () => {
    cancelled = true;
    if (frame !== null) cancelAnimationFrame(frame);
  };
}
