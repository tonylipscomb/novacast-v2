import { useCallback, useEffect, useRef, useState } from 'react';

import { recordEpisodeProgress } from '@/features/media-browser/mediaLibraryStore';
import type { PlaybackProgressState } from './mediaPlayerTypes';

const WATCHED_THRESHOLD_PERCENT = 90;
const PROGRESS_SAVE_INTERVAL_MS = 5000;

function computeProgress(positionMs: number, durationMs: number): PlaybackProgressState {
  const progressPercent = durationMs > 0 ? Math.min(100, Math.round((positionMs / durationMs) * 100)) : 0;
  return {
    positionMs,
    durationMs,
    progressPercent,
    isWatched: progressPercent >= WATCHED_THRESHOLD_PERCENT,
  };
}

export type UsePlaybackProgressOptions = {
  providerId: string;
  enabled?: boolean;
  initialPositionMs?: number;
  movie?: {
    movieId: string;
    title: string;
  };
  episode?: {
    seriesId: string;
    seasonNumber: string;
    episodeNumber: string;
    episodeId: string;
    title: string;
  };
  onWatched?: () => void;
};

export function usePlaybackProgress(options: UsePlaybackProgressOptions) {
  const { providerId, enabled = true, initialPositionMs = 0, movie, episode, onWatched } = options;
  const [progress, setProgress] = useState<PlaybackProgressState>(() =>
    computeProgress(initialPositionMs, 0),
  );
  const lastSavedRef = useRef(0);
  const watchedNotifiedRef = useRef(false);

  const updatePosition = useCallback((positionMs: number, durationMs: number) => {
    const next = computeProgress(positionMs, durationMs);
    setProgress(next);

    if (next.isWatched && !watchedNotifiedRef.current) {
      watchedNotifiedRef.current = true;
      onWatched?.();
    }
  }, [onWatched]);

  const persistProgress = useCallback(
    async (positionMs: number, durationMs: number) => {
      if (!enabled || !providerId) {
        return;
      }

      const now = Date.now();
      if (now - lastSavedRef.current < PROGRESS_SAVE_INTERVAL_MS) {
        return;
      }
      lastSavedRef.current = now;

      if (episode) {
        await recordEpisodeProgress({
          providerId,
          seriesId: episode.seriesId,
          seasonNumber: episode.seasonNumber,
          episodeNumber: episode.episodeNumber,
          episodeId: episode.episodeId,
          title: episode.title,
          positionMs,
          durationMs,
        });
      } else if (movie) {
        const { recordWatch } = await import('@/features/movies/smart/movieLibraryStore');
        await recordWatch(providerId, {
          movieId: movie.movieId,
          title: movie.title,
          progressPercent: computeProgress(positionMs, durationMs).progressPercent,
          durationMs,
        });
      }
    },
    [enabled, episode, movie, providerId],
  );

  useEffect(() => {
    if (!enabled) {
      return;
    }
    void persistProgress(progress.positionMs, progress.durationMs);
  }, [enabled, persistProgress, progress.durationMs, progress.positionMs]);

  return {
    progress,
    updatePosition,
    persistProgress,
    resumePositionMs: initialPositionMs,
  };
}
