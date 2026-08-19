import { getMovieLibraryState, recordWatch, resetMovieProgress } from '../../movies/smart/movieLibraryStore.ts';
import { getContinueWatchingEntries, getMediaLibraryState, recordEpisodeProgress, resetEpisodeProgress } from '../../media-browser/mediaLibraryStore.ts';
import {
  COMPLETED_PROGRESS_PERCENT,
  getPlaybackPercentage,
  isPlaybackComplete,
  PROGRESS_SAVE_INTERVAL_MS,
  shouldSaveProgress,
} from '../continuity/playbackContinuity.ts';

import type { PlaybackItem, PlaybackMediaType } from './types.ts';

export { PROGRESS_SAVE_INTERVAL_MS, shouldSaveProgress };
export const WATCHED_THRESHOLD_PERCENT = COMPLETED_PROGRESS_PERCENT;

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
  return getPlaybackPercentage(positionMs, durationMs);
}

export function shouldMarkComplete(positionMs: number, durationMs: number): boolean {
  return isPlaybackComplete(positionMs, durationMs);
}

export function computeResumePositionMs(
  progressPercent: number | undefined,
  durationMs: number | undefined,
  positionMs?: number,
): number {
  if (typeof positionMs === 'number' && Number.isFinite(positionMs) && positionMs > 0) {
    if (durationMs && isPlaybackComplete(positionMs, durationMs)) {
      return 0;
    }
    return Math.round(positionMs);
  }

  if (
    progressPercent === undefined ||
    durationMs === undefined ||
    durationMs <= 0 ||
    isPlaybackComplete((durationMs * progressPercent) / 100, durationMs)
  ) {
    return 0;
  }
  return Math.round((durationMs * progressPercent) / 100);
}

export async function getSavedProgress(key: PlaybackProgressKey): Promise<PlaybackProgressSnapshot | null> {
  if (!key.providerId || key.mediaType === 'live') {
    return null;
  }

  if (key.mediaType === 'movie') {
    const { watchHistory } = await getMovieLibraryState(key.providerId);
    const entry = watchHistory.find((item) => item.movieId === key.itemId);
    if (!entry) {
      return null;
    }
    const durationMs = entry.durationMs ?? 0;
    const positionMs = computeResumePositionMs(entry.progressPercent, durationMs, entry.positionMs);
    return snapshotProgress(positionMs, durationMs);
  }

  if (key.mediaType === 'episode') {
    const entries = await getContinueWatchingEntries(key.providerId, 'episode');
    const entry = entries.find((item) => item.episodeId === key.itemId || item.mediaId === key.itemId);
    if (entry) {
      return snapshotProgress(entry.positionMs, entry.durationMs);
    }

    const { watchHistory } = await getMediaLibraryState(key.providerId);
    const history = watchHistory.find((item) => item.episodeId === key.itemId || item.mediaId === key.itemId);
    if (!history) {
      return null;
    }
    const durationMs = history.durationMs ?? 0;
    const positionMs = history.positionMs ?? computeResumePositionMs(history.progressPercent, durationMs);
    return snapshotProgress(positionMs, durationMs);
  }

  return null;
}

export async function getResumePositionMs(key: PlaybackProgressKey): Promise<number> {
  const saved = await getSavedProgress(key);
  return saved && !saved.isComplete ? saved.positionMs : 0;
}

export async function resetPlaybackProgress(key: PlaybackProgressKey): Promise<void> {
  if (!key.providerId || key.mediaType === 'live') {
    return;
  }
  if (key.mediaType === 'movie') {
    await resetMovieProgress(key.providerId, key.itemId);
    return;
  }
  if (key.mediaType === 'episode') {
    await resetEpisodeProgress(key.providerId, key.itemId);
  }
}

export async function savePlaybackProgress(
  key: PlaybackProgressKey,
  input: {
    title: string;
    positionMs: number;
    durationMs: number;
  },
  item?: Pick<PlaybackItem, 'seriesId' | 'seasonNumber' | 'episodeNumber' | 'episodeId' | 'subtitle' | 'artworkUrl' | 'containerExtension'>,
): Promise<void> {
  if (!key.providerId || key.mediaType === 'live') {
    return;
  }

  const progressPercent = computeProgressPercent(input.positionMs, input.durationMs);
  const completed = shouldMarkComplete(input.positionMs, input.durationMs);

  if (key.mediaType === 'movie') {
    await recordWatch(key.providerId, {
      movieId: key.itemId,
      title: input.title,
      artworkUrl: item?.artworkUrl,
      progressPercent: completed ? 100 : progressPercent,
      durationMs: input.durationMs,
      positionMs: input.positionMs,
      completed,
      containerExtension: item?.containerExtension,
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
    isComplete: shouldMarkComplete(positionMs, durationMs),
  };
}
