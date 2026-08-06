/**
 * Stage 4.2M — Shared Media Detail Overlay types.
 * Browse screens own only open/item/originItemId; the shell owns presentation.
 */

export const MEDIA_DETAIL_OVERLAY_STAGE4M_MARKER = 'stage4m-shared-media-detail-overlay-v1';

export type MediaDetailOverlayMediaType = 'movie' | 'series';

export type MediaDetailOverlayModel = {
  id: string;
  mediaType: MediaDetailOverlayMediaType;
  title: string;
  description?: string | null;
  posterUrl?: string | null;
  backdropUrl?: string | null;
  year?: string | number | null;
  rating?: string | number | null;
  durationLabel?: string | null;
  genres?: string[];
  badges?: string[];
};

export type MediaDetailAction = {
  id: string;
  label: string;
  icon?: string;
  primary?: boolean;
  disabled?: boolean;
  onPress: () => void;
};

export type DetailOverlayState<T> = {
  open: boolean;
  item: T | null;
  originItemId: string | null;
};

export type DetailOverlayCloseSource = 'back' | 'x';

export function createClosedDetailOverlayState<T>(): DetailOverlayState<T> {
  return {
    open: false,
    item: null,
    originItemId: null,
  };
}

export function openDetailOverlayState<T extends { id: string }>(item: T): DetailOverlayState<T> {
  return {
    open: true,
    item,
    originItemId: item.id,
  };
}

export function closeDetailOverlayState<T>(): DetailOverlayState<T> {
  return createClosedDetailOverlayState<T>();
}
