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
};

export const MIN_CONTINUE_WATCHING_POSITION_MS = 30_000;
export const COMPLETED_PROGRESS_PERCENT = 95;
export const LONG_CONTENT_MIN_DURATION_MS = 10 * 60 * 1000;
export const LONG_CONTENT_REMAINING_MS = 5 * 60 * 1000;

export function isContinueWatchingEligible(positionMs: number, durationMs: number) {
  if (!Number.isFinite(positionMs) || !Number.isFinite(durationMs) || positionMs < MIN_CONTINUE_WATCHING_POSITION_MS || durationMs <= 0) {
    return false;
  }

  const safePosition = Math.max(0, Math.min(positionMs, durationMs));
  const progressPercent = (safePosition / durationMs) * 100;
  const remainingMs = Math.max(0, durationMs - safePosition);

  if (progressPercent >= COMPLETED_PROGRESS_PERCENT) {
    return false;
  }

  if (durationMs >= LONG_CONTENT_MIN_DURATION_MS && remainingMs <= LONG_CONTENT_REMAINING_MS) {
    return false;
  }

  return true;
}

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
  favoriteChannels: unknown[];
  favoriteMovies: unknown[];
  favoriteSeries: unknown[];
  recentlyWatched: unknown[];
}) {
  return [
    ['continueWatching', snapshot.continueWatching],
    ['favoriteChannels', snapshot.favoriteChannels],
    ['favoriteMovies', snapshot.favoriteMovies],
    ['favoriteSeries', snapshot.favoriteSeries],
    ['recentlyWatched', snapshot.recentlyWatched],
  ]
    .filter(([, items]) => items.length > 0)
    .map(([key]) => key);
}
