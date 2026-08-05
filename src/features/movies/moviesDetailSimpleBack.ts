/**
 * Stage 4.2L.2 — Simple Movies Detail Back helpers.
 * No Search focus fighting; safe focus targets; no BlurTargetView dependency.
 */

export const MOVIES_FOCUS_STAGE4L2_MARKER = 'stage4l2-movies-simple-detail-back-v1';

export type MoviesDetailReturnFocusResult = {
  requested: boolean;
  reason:
    | 'ok'
    | 'target-missing'
    | 'target-focus-method-unavailable'
    | 'focus-threw'
    | 'inactive'
    | 'timeout'
    | 'cancelled'
    | 'superseded';
};

/** True only when the target exposes a callable focus() used by requestTvFocus. */
export function isValidTvFocusableTarget(target: unknown): target is { focus: () => void } {
  if (target == null || (typeof target !== 'object' && typeof target !== 'function')) {
    return false;
  }
  const focus = (target as { focus?: unknown }).focus;
  return typeof focus === 'function';
}

export function shouldUseMoviesDetailCloseIsolationCover(input: {
  targetVisible: boolean;
  targetRefMounted: boolean;
}): boolean {
  // Normal mounted, visible posters: Detail itself covers the transition — no gray cover.
  if (input.targetVisible && input.targetRefMounted) {
    return false;
  }
  return true;
}

export function moviesDetailBrowseMustBeClear(input: {
  detailOpen: boolean;
  detailClosing: boolean;
}): boolean {
  return !input.detailOpen && !input.detailClosing;
}

export function assertMoviesDetailClosedVisualInvariant(input: {
  detailOpen: boolean;
  detailClosing: boolean;
  overlayVisible: boolean;
  visualIsolationActive: boolean;
  holdCoverActive: boolean;
  browsePointerEventsEnabled: boolean;
}): { ok: boolean; violations: string[] } {
  if (input.detailOpen || input.detailClosing) {
    return { ok: true, violations: [] };
  }
  const violations: string[] = [];
  if (input.overlayVisible) {
    violations.push('overlay-still-visible');
  }
  if (input.visualIsolationActive) {
    violations.push('isolation-cover-mounted');
  }
  if (input.holdCoverActive) {
    violations.push('hold-cover-active');
  }
  if (!input.browsePointerEventsEnabled) {
    violations.push('browse-pointer-events-disabled');
  }
  return { ok: violations.length === 0, violations };
}
