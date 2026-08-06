/**
 * Stage 4.2N.1 — Series Detail Popup V2 helpers.
 *
 * Pure, framework-free logic for the Series adaptation of the physically-
 * accepted Movies Detail Popup V2 shell (see
 * `src/features/movies/moviesDetailPopupV2.ts` and
 * `src/features/movies/components/MovieDetailPopupV2.tsx`, the ground truth
 * this file and its companion component mirror). There is no multi-phase
 * close transaction here either — Back and X share exactly one close call
 * (`closeSeriesDetailPopupV2` in `SeriesScreen`), same as Movies.
 *
 * Additive only: nothing here is imported by Movies, and nothing in Movies
 * is imported here.
 */

export const SERIES_DETAIL_POPUP_V2_MARKER = 'series-detail-popup-v2-adapter';

export type SeriesDetailPopupV2Action = {
  id: string;
  disabled?: boolean;
};

export type SeriesDetailPopupV2Layout = {
  popupWidth: number;
  popupHeight: number;
  posterWidth: number;
};

/**
 * Identical clamps to the accepted Movies V2 popup — same physically-
 * accepted shell, same sizing: ~58-64% of screen width, ~52-62% of screen
 * height, poster ~26-30% of popup width.
 */
export function computeSeriesDetailPopupV2Layout(input: {
  screenWidth: number;
  screenHeight: number;
}): SeriesDetailPopupV2Layout {
  const screenWidth = Math.max(0, input.screenWidth);
  const screenHeight = Math.max(0, input.screenHeight);

  const minWidth = Math.min(screenWidth * 0.58, Math.max(0, screenWidth - 48));
  const maxWidthCap = Math.min(screenWidth * 0.64, 1180);
  const maxWidth = Math.max(maxWidthCap, minWidth);
  const popupWidth = Math.round(Math.min(Math.max(screenWidth * 0.61, minWidth), maxWidth));

  const popupHeight = Math.round(
    Math.min(Math.max(screenHeight * 0.57, 420), Math.max(420, screenHeight * 0.62)),
  );

  const posterWidth = Math.round(popupWidth * 0.28);

  return { popupWidth, popupHeight, posterWidth };
}

/** Play/Resume is the preferred initial focus target; otherwise the first enabled action. */
export function resolveSeriesDetailPopupV2InitialFocusId(
  actions: SeriesDetailPopupV2Action[],
): string | null {
  const play = actions.find((action) => action.id === 'play' && !action.disabled);
  if (play) {
    return play.id;
  }
  const firstEnabled = actions.find((action) => !action.disabled);
  return firstEnabled?.id ?? null;
}

/** Back is consumed only while the popup is actually open/visible — nothing else. */
export function shouldConsumeSeriesDetailPopupV2Back(popupOpen: boolean): boolean {
  return popupOpen === true;
}

export type SeriesDetailPopupV2Season = {
  seasonNumber: number;
};

export type SeriesDetailPopupV2Episode = {
  seasonNumber: number;
};

/**
 * Prefers the requested season number when it exists among the series'
 * seasons; otherwise falls back to the first available season. Returns
 * `null` only when there are no seasons at all.
 */
export function resolveSeriesDetailPopupV2SeasonNumber(
  seasons: SeriesDetailPopupV2Season[],
  preferredSeasonNumber?: number | null,
): number | null {
  if (seasons.length === 0) {
    return null;
  }
  if (
    preferredSeasonNumber != null &&
    seasons.some((season) => season.seasonNumber === preferredSeasonNumber)
  ) {
    return preferredSeasonNumber;
  }
  return seasons[0].seasonNumber;
}

/** Episodes belonging to the selected season only. */
export function filterSeriesDetailPopupV2Episodes<T extends SeriesDetailPopupV2Episode>(
  episodes: T[],
  seasonNumber: number | null,
): T[] {
  if (seasonNumber == null) {
    return [];
  }
  return episodes.filter((episode) => episode.seasonNumber === seasonNumber);
}

export function logSeriesDetailPopupV2Event(
  event: string,
  payload: Record<string, unknown> = {},
): void {
  console.info(
    '[NovaCast Series Detail Popup V2] ' +
      JSON.stringify({
        event,
        marker: SERIES_DETAIL_POPUP_V2_MARKER,
        ...payload,
      }),
  );
}

/**
 * Defensive forbidden-event log. Series' old Stage 4.2M
 * `closeDetailOverlay`/`SeriesDetailOverlay` machinery is intentionally left
 * in source (disconnected, not deleted, per this stage's plan) rather than
 * deleted. If that dead path is ever reached while the V2 popup owns Series
 * Detail, this makes it loud and greppable in ONN traces instead of failing
 * silently — mirrors Movies' `logMovieDetailLegacyClosePathViolation`.
 */
export function logSeriesDetailLegacyOverlayPathViolation(
  payload: Record<string, unknown> = {},
): void {
  console.info(
    '[NovaCast Series Detail Popup V2] ' +
      JSON.stringify({
        event: 'series_detail_legacy_overlay_path_violation',
        marker: SERIES_DETAIL_POPUP_V2_MARKER,
        ...payload,
      }),
  );
}

/**
 * Stage 4.2O.1 — Episodes is a first-class action (alongside Play/Resume,
 * Favorite, Watchlist), not just an always-visible strip. It's enabled only
 * once local season/episode data exists — the same "local data" the Episode
 * view itself renders from, independent of background metadata enrichment.
 */
export function isSeriesDetailPopupV2EpisodesActionEnabled(seasonCount: number): boolean {
  return seasonCount > 0;
}
