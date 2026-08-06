export { MediaDetailOverlayShell } from './MediaDetailOverlayShell.tsx';
export type { MediaDetailOverlayShellProps } from './MediaDetailOverlayShell.tsx';
export { adaptMediaDetailToOverlayModel } from './adaptMediaDetailModel.ts';
export {
  MEDIA_DETAIL_OVERLAY_STAGE4M_MARKER,
  createClosedDetailOverlayState,
  openDetailOverlayState,
  closeDetailOverlayState,
} from './mediaDetailOverlayTypes.ts';
export type {
  MediaDetailOverlayModel,
  MediaDetailAction,
  DetailOverlayState,
  DetailOverlayCloseSource,
  MediaDetailOverlayMediaType,
} from './mediaDetailOverlayTypes.ts';
export {
  MEDIA_DETAIL_OVERLAY_EXIT_MS,
  DEPRECATED_DETAIL_CLOSE_PHASES,
  shouldConsumeDetailOverlayBack,
  canBeginDetailOverlayClose,
  assertBrowseInstancesStable,
  detailOverlayBrowsePointerEvents,
  planCloseDetailOverlay,
  logDetailOverlayEvent,
  buildMediaDetailMetaParts,
  formatMediaDetailRating,
} from './mediaDetailOverlayLogic.ts';
