/**
 * Stage 4.2M — Simple guest overlay open/close + focus-return helpers.
 * No multi-phase close transactions, isolation covers, or Search bridges.
 */

import type { DetailOverlayCloseSource, DetailOverlayState } from './mediaDetailOverlayTypes.ts';
import { MEDIA_DETAIL_OVERLAY_STAGE4M_MARKER } from './mediaDetailOverlayTypes.ts';

export { MEDIA_DETAIL_OVERLAY_STAGE4M_MARKER };

/** Exit animation budget — no close watchdog beyond this. */
export const MEDIA_DETAIL_OVERLAY_EXIT_MS = 180;

export type BrowseInstanceSnapshot = {
  screenInstanceId: string;
  gridInstanceId: string;
  railInstanceId: string;
  categoryId: string;
  listOffset: number;
  visibleItemCount: number;
};

export function shouldConsumeDetailOverlayBack(input: {
  overlayOpen: boolean;
  overlayVisible: boolean;
}): boolean {
  return input.overlayOpen && input.overlayVisible;
}

export function canBeginDetailOverlayClose(input: {
  open: boolean;
  closeInFlight: boolean;
}): boolean {
  return input.open && !input.closeInFlight;
}

export function assertBrowseInstancesStable(input: {
  before: BrowseInstanceSnapshot;
  after: BrowseInstanceSnapshot;
}): { ok: boolean; violations: string[] } {
  const violations: string[] = [];
  if (input.before.screenInstanceId !== input.after.screenInstanceId) {
    violations.push('screen-instance-changed');
  }
  if (input.before.gridInstanceId !== input.after.gridInstanceId) {
    violations.push('grid-instance-changed');
  }
  if (input.before.railInstanceId !== input.after.railInstanceId) {
    violations.push('rail-instance-changed');
  }
  if (input.before.categoryId !== input.after.categoryId) {
    violations.push('category-changed');
  }
  if (input.before.listOffset !== input.after.listOffset) {
    violations.push('list-offset-changed');
  }
  if (input.before.visibleItemCount !== input.after.visibleItemCount) {
    violations.push('visible-items-replaced');
  }
  return { ok: violations.length === 0, violations };
}

export function detailOverlayBrowsePointerEvents(input: {
  overlayOpen: boolean;
  searchBlocksBrowse?: boolean;
  playbackUiActive?: boolean;
}): 'auto' | 'none' {
  if (input.overlayOpen || input.searchBlocksBrowse || input.playbackUiActive) {
    return 'none';
  }
  return 'auto';
}

export function formatMediaDetailRating(value?: string | number | null): string | undefined {
  if (value == null || value === '') {
    return undefined;
  }
  if (typeof value === 'number') {
    return value > 0 ? value.toFixed(1) : undefined;
  }
  const trimmed = String(value).trim();
  return trimmed || undefined;
}

export function buildMediaDetailMetaParts(model: {
  year?: string | number | null;
  rating?: string | number | null;
  durationLabel?: string | null;
  genres?: string[];
}): string[] {
  const parts: string[] = [];
  if (model.year != null && String(model.year).trim()) {
    parts.push(String(model.year));
  }
  const rating = formatMediaDetailRating(model.rating);
  if (rating) {
    parts.push(rating);
  }
  if (model.durationLabel) {
    parts.push(model.durationLabel);
  }
  const genres = (model.genres ?? []).filter(Boolean).slice(0, 3);
  if (genres.length) {
    parts.push(genres.join(' · '));
  }
  return parts;
}

export function logDetailOverlayEvent(
  event: string,
  payload: Record<string, unknown> = {},
): void {
  console.info(
    '[NovaCast Media Detail] ' +
      JSON.stringify({
        event,
        marker: MEDIA_DETAIL_OVERLAY_STAGE4M_MARKER,
        ...payload,
      }),
  );
}

export type CloseDetailOverlayPlan = {
  nextState: DetailOverlayState<null>;
  originItemId: string | null;
  source: DetailOverlayCloseSource;
  requestOriginFocus: boolean;
};

export function planCloseDetailOverlay<T>(input: {
  state: DetailOverlayState<T>;
  source: DetailOverlayCloseSource;
}): CloseDetailOverlayPlan {
  return {
    nextState: { open: false, item: null, originItemId: null },
    originItemId: input.state.originItemId,
    source: input.source,
    requestOriginFocus: Boolean(input.state.originItemId),
  };
}

/** Multi-phase close names that must not appear in the Stage 4.2M active path. */
export const DEPRECATED_DETAIL_CLOSE_PHASES = [
  'closing-prepare',
  'closing-viewport',
  'closing-focus',
  'closing-confirm',
  'return-focus-arming',
  'return-focus-requested',
  'return-focus-confirmed',
  'browse-restored',
] as const;
