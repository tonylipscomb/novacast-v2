/**
 * Stage 4.2N — Movies Detail Popup V2 helpers.
 *
 * Pure, framework-free logic for the rebuilt centered Movies detail popup.
 * There is no multi-phase close transaction, visual isolation, hold cover,
 * or Search focus bridge in this module — the popup is a simple guest with
 * one open state and one close function shared by Back and X.
 */

export const MOVIES_FOCUS_STAGE4N_MARKER = 'stage4n-movies-detail-popup-v2';

export type MovieDetailPopupV2Action = {
  id: string;
  disabled?: boolean;
};

export type MovieDetailPopupV2Layout = {
  popupWidth: number;
  popupHeight: number;
  posterWidth: number;
};

/**
 * Centered popup + poster sizing, clamped to the physical acceptance targets:
 * ~58-64% of screen width, ~52-62% of screen height, poster ~26-30% of popup width.
 */
export function computeMovieDetailPopupV2Layout(input: {
  screenWidth: number;
  screenHeight: number;
}): MovieDetailPopupV2Layout {
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

export function shouldMoviesBrowseListHostBeEnabled(input: {
  detailPopupOpen: boolean;
  playbackUiActive?: boolean;
}): boolean {
  return !input.detailPopupOpen && !input.playbackUiActive;
}

export function shouldRequestMovieDetailPopupV2InitialFocus(input: {
  detailOpen: boolean;
  hasPrimaryAction: boolean;
  alreadyIssued: boolean;
}): boolean {
  return input.detailOpen && input.hasPrimaryAction && !input.alreadyIssued;
}

export function shouldPublishMovieDetailDestinations(input: {
  alreadyPublished: boolean;
  actionId: string;
  initialFocusActionId: string | null;
  instancePresent: boolean;
  sameHandle: boolean;
}): boolean {
  return (
    !input.alreadyPublished &&
    input.instancePresent &&
    !input.sameHandle &&
    input.initialFocusActionId != null &&
    input.actionId === input.initialFocusActionId
  );
}

export function shouldUpdateMovieDetailFocusedActionId(
  current: string | null,
  next: string | null,
): boolean {
  return current !== next;
}

export function shouldConfirmMovieDetailInitialFocus(input: {
  actionId: string;
  initialFocusActionId: string | null;
  alreadyConfirmed: boolean;
  visible: boolean;
}): boolean {
  return (
    input.visible &&
    !input.alreadyConfirmed &&
    input.initialFocusActionId != null &&
    input.actionId === input.initialFocusActionId
  );
}

export function shouldReArmMovieDetailPreferredFocus(input: {
  openSession: string | null;
  previousSession: string | null;
}): boolean {
  return input.openSession != null && input.openSession !== input.previousSession;
}

export function logMovieDetailRenderLoopAudit(payload: {
  event:
    | 'render'
    | 'ref-attach'
    | 'ref-detach'
    | 'focus'
    | 'preferred-focus-change'
    | 'destinations-change'
    | 'initial-request';
  movieId?: string | null;
  actionId?: string | null;
  renderCount?: number;
  nativeHandlePresent?: boolean;
  sameHandle?: boolean;
  focusedActionId?: string | null;
  preferredFocus?: boolean;
  initialRequestLatched?: boolean;
}) {
  console.info(
    '[NovaCast Movie Detail Render Loop Audit] ' +
      JSON.stringify({
        event: payload.event,
        movieId: payload.movieId ?? null,
        actionId: payload.actionId ?? null,
        renderCount: payload.renderCount ?? null,
        nativeHandlePresent: payload.nativeHandlePresent ?? null,
        sameHandle: payload.sameHandle ?? null,
        focusedActionId: payload.focusedActionId ?? null,
        preferredFocus: payload.preferredFocus ?? null,
        initialRequestLatched: payload.initialRequestLatched ?? null,
      }),
  );
}

export function logMoviesDetailV2FocusOwnership(payload: {
  phase:
    | 'detail-open'
    | 'cta-ref-ready'
    | 'initial-focus-requested'
    | 'initial-focus-confirmed'
    | 'background-focus-disabled'
    | 'unexpected-background-focus'
    | 'detail-close'
    | 'origin-focus-restored';
  movieId?: string | null;
  detailOpen: boolean;
  focusIssued: boolean;
  detailCtaHandlePresent?: boolean;
  focusedRegion?: string;
  categoryHostFocusable?: boolean;
  posterHostFocusable?: boolean;
}) {
  console.info(
    '[NovaCast Movies Detail Focus Lifecycle] ' +
      JSON.stringify({
        phase: payload.phase,
        movieId: payload.movieId ?? null,
        detailOpen: payload.detailOpen,
        focusIssued: payload.focusIssued,
        detailCtaHandlePresent: payload.detailCtaHandlePresent ?? null,
        focusedRegion: payload.focusedRegion ?? null,
        categoryHostFocusable: payload.categoryHostFocusable ?? null,
        posterHostFocusable: payload.posterHostFocusable ?? null,
      }),
  );
}

export function resolveMovieDetailPopupV2InitialFocusId(
  actions: MovieDetailPopupV2Action[],
): string | null {
  const play = actions.find((action) => action.id === 'play' && !action.disabled);
  if (play) {
    return play.id;
  }
  const firstEnabled = actions.find((action) => !action.disabled);
  return firstEnabled?.id ?? null;
}

/** Back is consumed only while the popup is actually open/visible — nothing else. */
export function shouldConsumeMovieDetailPopupV2Back(popupOpen: boolean): boolean {
  return popupOpen === true;
}

export function logMovieDetailPopupV2Event(
  event: string,
  payload: Record<string, unknown> = {},
): void {
  console.info(
    '[NovaCast Movies Detail Popup V2] ' +
      JSON.stringify({
        event,
        marker: MOVIES_FOCUS_STAGE4N_MARKER,
        ...payload,
      }),
  );
}

/**
 * Defensive forbidden-event log. The Stage 4.2N popup never calls legacy
 * close-transaction / visual-isolation / hold-cover code. If any of that
 * code path is ever reached while V2 is active, this makes it loud and
 * greppable in ONN traces instead of failing silently.
 */
export function logMovieDetailLegacyClosePathViolation(
  payload: Record<string, unknown> = {},
): void {
  console.info(
    '[NovaCast Movies Detail Popup V2] ' +
      JSON.stringify({
        event: 'movie_detail_legacy_close_path_violation',
        marker: MOVIES_FOCUS_STAGE4N_MARKER,
        ...payload,
      }),
  );
}
