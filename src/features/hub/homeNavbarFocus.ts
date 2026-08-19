export const HOME_FOCUS_LOG = '[NovaCast Home Focus]';

export type HomeNavbarRightMode = 'content' | 'retain-navbar' | 'unmanaged';

export type HomeNavbarRightDecision = {
  targetAvailable: boolean;
  targetId: string | null;
  nextFocusMode: HomeNavbarRightMode;
};

/**
 * A Home row may only receive DPAD RIGHT from the navbar when it is currently
 * visible, mounted, and has a live native focus handle. Empty / hidden /
 * unmounted / still-loading rows are not destinations.
 */
export function resolveHomeNavbarRightTarget(input: {
  firstVisibleHomeTargetId: string | null | undefined;
  contentHandle: number | null | undefined;
  walkthroughVisible?: boolean;
}): HomeNavbarRightDecision {
  if (input.walkthroughVisible) {
    return { targetAvailable: false, targetId: null, nextFocusMode: 'unmanaged' };
  }

  const targetId = input.firstVisibleHomeTargetId?.trim() || null;
  const contentHandle = input.contentHandle ?? null;
  if (!targetId || !contentHandle) {
    return { targetAvailable: false, targetId: null, nextFocusMode: 'retain-navbar' };
  }

  return { targetAvailable: true, targetId, nextFocusMode: 'content' };
}

export function shouldRetainNavbarFocus(decision: HomeNavbarRightDecision) {
  return decision.nextFocusMode === 'retain-navbar';
}

export function logHomeNavbarRightAttempt(fields: {
  navbarItem: string;
  targetAvailable: boolean;
  targetId: string | null;
}) {
  console.info(HOME_FOCUS_LOG, {
    event: 'right-from-navbar',
    navbarItem: fields.navbarItem,
    targetAvailable: fields.targetAvailable,
    targetId: fields.targetId,
  });
}

export function logHomeNavbarFocusRetained(reason = 'no-visible-home-target') {
  console.info(HOME_FOCUS_LOG, {
    event: 'retained-navbar-focus',
    reason,
  });
}
