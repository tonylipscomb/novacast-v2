import type { MediaDetail } from '@/features/media-browser/mediaTypes.ts';
import type { MediaDetailOverlayModel } from './mediaDetailOverlayTypes.ts';

/** Adapt existing MediaDetail (Movies/Series) into the shared overlay model. */
export function adaptMediaDetailToOverlayModel(
  detail: MediaDetail,
): MediaDetailOverlayModel {
  return {
    id: detail.id,
    mediaType: detail.mediaType,
    title: detail.title,
    description: detail.synopsis ?? null,
    posterUrl: detail.posterUrl ?? null,
    backdropUrl: detail.backdropUrl ?? null,
    year: detail.year ?? null,
    rating: detail.rating ?? null,
    durationLabel: detail.runtime ?? null,
    genres: detail.genres ?? [],
    badges: detail.contentRating ? [detail.contentRating] : [],
  };
}
