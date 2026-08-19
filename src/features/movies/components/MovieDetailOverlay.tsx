/**
 * Stage 4.2M — Thin Movies adapter over MediaDetailOverlayShell.
 * Does not own grid/category/browse opacity/isolation/close transactions.
 */
import { useMemo } from 'react';

import type { MediaDetail } from '@/features/media-browser/mediaTypes.ts';
import {
  MediaDetailOverlayShell,
  adaptMediaDetailToOverlayModel,
  type MediaDetailAction,
} from '@/features/media-detail';

export type MovieDetailOverlayProps = {
  visible: boolean;
  detail: MediaDetail | null;
  detailLoading?: boolean;
  detailError?: string | null;
  continueWatchingLabel?: string;
  isFavorite?: boolean;
  isWatchlisted?: boolean;
  onClose: () => void;
  onRetry?: () => void;
  onPlay?: () => void;
  onTrailerPress?: () => void;
  onFavoritePress?: () => void;
  onWatchlistPress?: () => void;
  /**
   * Legacy Stage 4.x props retained for call-site compatibility.
   * Ignored by the Stage 4.2M guest overlay path.
   */
  keepFocusTrap?: boolean;
  focusHandoffActive?: boolean;
  visualHoldActive?: boolean;
  visualIsolationActive?: boolean;
  overlayInstanceId?: string;
  preserveCloseButtonFocus?: boolean;
  closeActivationLocked?: boolean;
  closeTargetRef?: unknown;
  blurTarget?: unknown;
  continueWatchingProgress?: number | null;
  relatedMovies?: unknown[];
  onSelectRelated?: unknown;
};

export function MovieDetailOverlay({
  visible,
  detail,
  detailLoading = false,
  detailError = null,
  continueWatchingLabel,
  isFavorite = false,
  isWatchlisted = false,
  onClose,
  onRetry,
  onPlay,
  onTrailerPress,
  onFavoritePress,
  onWatchlistPress,
}: MovieDetailOverlayProps) {
  const model = useMemo(
    () => (detail ? adaptMediaDetailToOverlayModel(detail) : null),
    [detail],
  );

  const actions = useMemo(() => {
    const next: MediaDetailAction[] = [];
    if (onPlay) {
      next.push({
        id: 'play',
        label: continueWatchingLabel ?? 'Play',
        icon: 'play',
        primary: true,
        onPress: onPlay,
      });
    }
    if (onTrailerPress) {
      next.push({
        id: 'trailer',
        label: 'Trailer',
        icon: 'movie-outline',
        onPress: onTrailerPress,
      });
    }
    if (onFavoritePress) {
      next.push({
        id: 'favorite',
        label: isFavorite ? 'Favorited' : 'Favorite',
        icon: isFavorite ? 'heart' : 'heart-outline',
        onPress: onFavoritePress,
      });
    }
    if (onWatchlistPress) {
      next.push({
        id: 'watchlist',
        label: isWatchlisted ? 'In Watchlist' : 'Watchlist',
        icon: isWatchlisted ? 'bookmark' : 'bookmark-outline',
        onPress: onWatchlistPress,
      });
    }
    if (detailError && onRetry) {
      next.push({
        id: 'retry',
        label: 'Retry',
        icon: 'refresh',
        onPress: onRetry,
      });
    }
    return next;
  }, [
    continueWatchingLabel,
    detailError,
    isFavorite,
    isWatchlisted,
    onFavoritePress,
    onPlay,
    onRetry,
    onTrailerPress,
    onWatchlistPress,
  ]);

  const errorMessage = detailError
    ? 'Unable to load additional details'
    : null;

  return (
    <MediaDetailOverlayShell
      visible={visible}
      model={model}
      actions={actions}
      loading={detailLoading && !detailError}
      error={errorMessage}
      onRequestClose={onClose}
      initialFocusActionId="play"
      testID="movie-detail-overlay"
      traceId={detail?.id ?? undefined}
    />
  );
}

export default MovieDetailOverlay;
