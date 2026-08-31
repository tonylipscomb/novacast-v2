/**
 * Deterministic first-paint navbar focus. Native hasTVPreferredFocus is
 * mount-only and stays armed unless consumed, which steals D-pad from content.
 */

export const NAVBAR_SURFACE_ALPHA = 0.74;
export const NAVBAR_SURFACE_FILL = `rgba(7, 9, 22, ${NAVBAR_SURFACE_ALPHA})`;
export const NAVBAR_FOCUS_RETRY_LIMIT = 4;

export function shouldArmNavbarPreferredFocus(input: {
  preferActiveNavigationFocus: boolean;
  suppressNavbarPreferredFocus: boolean;
  navigationFocusable: boolean;
  isActiveItem: boolean;
  preferredFocusConsumed: boolean;
}): boolean {
  return (
    input.preferActiveNavigationFocus &&
    !input.suppressNavbarPreferredFocus &&
    input.navigationFocusable &&
    input.isActiveItem &&
    !input.preferredFocusConsumed
  );
}

/** First layout only — never after the user has left the navbar or after overlays later re-enable it. */
export function shouldStartNavbarInitialHandoff(input: {
  eligibleAtMount: boolean;
  handoffFinished: boolean;
  userLeftNavbar: boolean;
  focusConfirmed: boolean;
}): boolean {
  return (
    input.eligibleAtMount &&
    !input.handoffFinished &&
    !input.userLeftNavbar &&
    !input.focusConfirmed
  );
}

export function shouldRetryNavbarInitialFocus(input: {
  focusConfirmed: boolean;
  userLeftNavbar: boolean;
  handoffFinished: boolean;
  attemptsRemaining: number;
}): boolean {
  return (
    !input.focusConfirmed &&
    !input.userLeftNavbar &&
    !input.handoffFinished &&
    input.attemptsRemaining > 0
  );
}

export function markNavbarFocusConfirmed(): {
  preferredFocusConsumed: true;
  focusConfirmed: true;
  handoffFinished: true;
} {
  return {
    preferredFocusConsumed: true,
    focusConfirmed: true,
    handoffFinished: true,
  };
}

export function markUserLeftNavbar(input: { focusWasConfirmed: boolean }): { userLeftNavbar: boolean } {
  return { userLeftNavbar: input.focusWasConfirmed };
}
