export type PersonalizationMediaType = 'live' | 'movie' | 'series' | 'episode';

export type FavoriteRecord = {
  providerId: string;
  mediaType: 'live' | 'movie' | 'series';
  contentId: string;
  title: string;
  artworkUrl?: string;
  categoryId?: string;
  streamId?: string;
  extension?: string;
  createdAt: number;
};

export type RecentItemRecord = {
  providerId: string;
  mediaType: PersonalizationMediaType;
  contentId: string;
  title: string;
  artworkUrl?: string;
  categoryId?: string;
  parentSeriesId?: string;
  seasonNumber?: string;
  episodeNumber?: string;
  lastOpenedAt: number;
};

export type HomeContinueWatchingItem = {
  providerId: string;
  mediaType: 'movie' | 'episode';
  contentId: string;
  title: string;
  subtitle?: string;
  artworkUrl?: string;
  parentSeriesId?: string;
  episodeId?: string;
  seasonNumber?: string;
  episodeNumber?: string;
  positionMs: number;
  durationMs: number;
  progressPercent: number;
  updatedAt: number;
  /** Optional. Old rows omit this and self-heal from canonical catalog lookup. */
  containerExtension?: string;
};

export {
  COMPLETED_PROGRESS_PERCENT,
  LONG_CONTENT_MIN_DURATION_MS,
  LONG_CONTENT_REMAINING_MS,
  MIN_CONTINUE_WATCHING_POSITION_MS,
  isContinueWatchingEligible,
} from '../playback/continuity/playbackContinuity.ts';

export function clampProgress(positionMs: number, durationMs: number) {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return 0;
  }

  return Math.max(0, Math.min(Number.isFinite(positionMs) ? positionMs : 0, durationMs));
}

export function progressPercent(positionMs: number, durationMs: number) {
  const safeDuration = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 0;
  if (!safeDuration) {
    return 0;
  }

  return Math.round((clampProgress(positionMs, safeDuration) / safeDuration) * 100);
}

export function dedupeRecentItems(items: RecentItemRecord[], limit = 20) {
  const seen = new Set<string>();
  return [...items]
    .sort((left, right) => right.lastOpenedAt - left.lastOpenedAt)
    .filter((item) => {
      const key = `${item.providerId}:${item.mediaType}:${item.contentId}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .slice(0, limit);
}

export function getVisibleHomeRows(snapshot: {
  continueWatching: unknown[];
  watchlist: unknown[];
  favoriteChannels: unknown[];
  favorites: unknown[];
}) {
  return [
    ['continueWatching', snapshot.continueWatching],
    ['watchlist', snapshot.watchlist],
    ['favoriteChannels', snapshot.favoriteChannels],
    ['favorites', snapshot.favorites],
  ]
    .filter(([, items]) => items.length > 0)
    .map(([key]) => key);
}
