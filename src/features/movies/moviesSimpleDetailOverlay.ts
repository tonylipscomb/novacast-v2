/**
 * Stage 4.2M — Movies guest Detail overlay helpers.
 * Active open/close path must not use multi-phase close transactions.
 */

import {
  DEPRECATED_DETAIL_CLOSE_PHASES,
  MEDIA_DETAIL_OVERLAY_STAGE4M_MARKER,
  canBeginDetailOverlayClose,
  shouldConsumeDetailOverlayBack,
} from '@/features/media-detail';

export const MOVIES_FOCUS_STAGE4M_MARKER = MEDIA_DETAIL_OVERLAY_STAGE4M_MARKER;

export {
  DEPRECATED_DETAIL_CLOSE_PHASES,
  canBeginDetailOverlayClose,
  shouldConsumeDetailOverlayBack,
};

/** True when MoviesScreen should treat Detail as a simple guest overlay. */
export const MOVIES_SIMPLE_DETAIL_OVERLAY_ENABLED = true;

export function moviesDetailOverlayVisible(input: {
  detailOpen: boolean;
  detailSuppressedForPlayback: boolean;
  playbackUiActive: boolean;
  hasSelectedMovie: boolean;
}): boolean {
  return (
    input.detailOpen &&
    !input.detailSuppressedForPlayback &&
    !input.playbackUiActive &&
    input.hasSelectedMovie
  );
}
