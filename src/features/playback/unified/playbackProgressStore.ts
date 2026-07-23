import { getMovieLibraryState, recordWatch } from '../../movies/smart/movieLibraryStore.ts';
import { getContinueWatchingEntries, recordEpisodeProgress } from '../../media-browser/mediaLibraryStore.ts';

import type { PlaybackItem, PlaybackMediaType } from './types.ts';

export const PROGRESS_SAVE_INTERVAL_MS = 5000;
export const WATCHED_THRESHOLD_PERCENT = 90;

export type PlaybackProgressKey = {
  providerId: string;
  mediaType: PlaybackMediaType;
  itemId: string;
};

export type PlaybackProgressSnapshot = {
  positionMs: number;
  durationMs: number;
  progressPercent: number;
  isComplete: boolean;
};

export function buildProgressKey(
  providerId: string,
  mediaType: PlaybackMediaType,
  itemId: string,
): PlaybackProgressKey {
  return { providerId, mediaType, itemId };
}

export function computeProgressPercent(positionMs: number, durationMs: number): number {
  if (durationMs <= 0) {
    return 0;
  }
  return Math.min(100, Math.round((positionMs / durationMs) * 100));
}

export function shouldMarkComplete(positionMs: number, durationMs: number): boolean {
  return computeProgressPercent(positionMs, durationMs) >= WATCHED_THRESHOLD_PERCENT;
}

export function shouldSaveProgress(lastSavedAt: number, now = Date.now()): boolean {
  return now - lastSavedAt >= PROGRESS_SAVE_INTERVAL_MS;
}

export function computeResumePositionMs(
  progressPercent: number | undefined,
  durationMs: number | undefined,
): number {
  if (
    progressPercent === undefined ||
    durationMs === undefined ||
    durationMs <= 0 ||
    progressPercent >= WATCHED_THRESHOLD_PERCENT
  ) {
    return 0;
  }
  return Math.round((durationMs * progressPercent) / 100);
}

export async function getResumePositionMs(key: PlaybackProgressKey): Promise<number> {
  if (!key.providerId || key.mediaType === 'live') {
    return 0;
  }

  if (key.mediaType === 'movie') {
    const { watchHistory } = await getMovieLibraryState(key.providerId);
    const entry = watchHistory.find((item) => item.movieId === key.itemId);
    if (!entry) {
      return 0;
    }
    return computeResumePositionMs(entry.progressPercent, entry.durationMs);
  }

  if (key.mediaType === 'episode') {
    const entries = await getContinueWatchingEntries(key.providerId, 'episode');
    const entry = entries.find((item) => item.episodeId === key.itemId || item.mediaId === key.itemId);
    if (!entry) {
      return 0;
    }
    return entry.positionMs;
  }

  return 0;
}

export async function savePlaybackProgress(
  key: PlaybackProgressKey,
  input: {
    title: string;
    positionMs: number;
    durationMs: number;
  },
  item?: Pick<PlaybackItem, 'seriesId' | 'seasonNumber' | 'episodeNumber' | 'episodeId' | 'subtitle' | 'artworkUrl'>,
): Promise<void> {
  if (!key.providerId || key.mediaType === 'live') {
    return;
  }

  const progressPercent = computeProgressPercent(input.positionMs, input.durationMs);

  if (key.mediaType === 'movie') {
    await recordWatch(key.providerId, {
      movieId: key.itemId,
      title: input.title,
      artworkUrl: item?.artworkUrl,
      progressPercent: shouldMarkComplete(input.positionMs, input.durationMs) ? 100 : progressPercent,
      durationMs: input.durationMs,
    });
    return;
  }

  if (key.mediaType === 'episode' && item?.seriesId && item.seasonNumber && item.episodeNumber) {
    await recordEpisodeProgress({
      providerId: key.providerId,
      seriesId: item.seriesId,
      seasonNumber: item.seasonNumber,
      episodeNumber: item.episodeNumber,
      episodeId: item.episodeId ?? key.itemId,
      title: input.title,
      seriesTitle: item.subtitle,
      artworkUrl: item.artworkUrl,
      positionMs: input.positionMs,
      durationMs: input.durationMs,
    });
  }
}

export function snapshotProgress(positionMs: number, durationMs: number): PlaybackProgressSnapshot {
  const progressPercent = computeProgressPercent(positionMs, durationMs);
  return {
    positionMs,
    durationMs,
    progressPercent,
    isComplete: progressPercent >= WATCHED_THRESHOLD_PERCENT,
  };
}
