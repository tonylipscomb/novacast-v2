import { useCallback, useMemo, useRef, useState } from 'react';

import { buildMoviePreviewDetail, buildSeriesMediaDetail, buildSeriesPreviewDetail as buildSeriesOverlayPreview } from '@/features/media-browser/mediaDetail';
import type { MediaDetail, SeriesDetail, SeriesSummary } from '@/features/media-browser/mediaTypes';
import { toggleMediaFavorite, toggleMediaWatchlist, useMediaLibraryStore } from '@/features/media-browser/mediaLibraryStore';
import type { MovieSummary } from '@/features/movies/movieTypes';
import { toggleFavorite, toggleWatchlist, useMovieLibraryStore } from '@/features/movies/smart/movieLibraryStore';
import { recordRecentItem } from '@/features/personalization/personalizationStore';
import {
  finishUnifiedPlaybackClose,
  useUnifiedPlayer,
} from '@/features/playback/unified';
import type { ProviderRepositoryBundle } from '@/features/providers/providerBundle';
import { buildLiveChannelPlaybackUrl, buildMoviePlaybackUrl } from '@/features/providers/providerPlayback';
import { buildSeriesPreviewDetail } from '@/features/series/data/ProviderSeriesDataSource';
import { launchSeriesEpisodePlayback, formatSeriesContinuePlayLabel, resolveSeriesContinuePlayTarget } from '@/features/series/seriesPlayback';
import { resolveContinueWatchingLabel } from '@/features/movies/movieDetailOverlayModel';
import {
  sortEpisodesByNumber,
} from '@/features/playback/continuity/playbackContinuity';

import { movieSearchResultToSummary, seriesSearchResultToSummary } from './searchMediaDetail';
import type { LiveSearchResult, MovieSearchResult, SearchResult, SeriesSearchResult } from './searchTypes';

type SearchMediaKind = 'movie' | 'series';

type SearchMediaSelection = {
  kind: SearchMediaKind;
  movie?: MovieSummary;
  series?: SeriesSummary;
};

export function useSearchMediaDetail(providerId: string, bundle: ProviderRepositoryBundle | null) {
  const movieLibrary = useMovieLibraryStore(providerId);
  const seriesLibrary = useMediaLibraryStore(providerId);
  const { isActive: playbackActive, isClosing: playbackClosing, didJustClose, launchPlayback, closePlayback } =
    useUnifiedPlayer();

  const [detailOpen, setDetailOpen] = useState(false);
  const [selection, setSelection] = useState<SearchMediaSelection | null>(null);
  const [movieDetail, setMovieDetail] = useState<MediaDetail | null>(null);
  const [seriesDetail, setSeriesDetail] = useState<SeriesDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [selectedSeasonId, setSelectedSeasonId] = useState('');
  const [focusedEpisodeId, setFocusedEpisodeId] = useState<string | null>(null);
  const detailRequestIdRef = useRef(0);
  const lastPlaybackLaunchAtRef = useRef(0);
  const reopenDetailAfterPlaybackRef = useRef(false);

  const closeDetail = useCallback(() => {
    setDetailOpen(false);
    setDetailError(null);
    setFocusedEpisodeId(null);
  }, []);

  const loadMovieDetail = useCallback(
    async (movie: MovieSummary) => {
      const requestId = ++detailRequestIdRef.current;
      const fallback = buildMoviePreviewDetail(movie);
      setMovieDetail(fallback);
      setSeriesDetail(null);
      setDetailError(null);
      setDetailLoading(true);

      try {
        const detail = await bundle?.movies?.getMovieInfo?.(movie.id);
        if (requestId !== detailRequestIdRef.current) {
          return;
        }

        setMovieDetail(detail ?? fallback);
        if (!detail && bundle?.movies?.getMovieInfo) {
          setDetailError('Detailed movie information is unavailable.');
        }
      } catch {
        if (requestId === detailRequestIdRef.current) {
          setMovieDetail(fallback);
          setDetailError('Detailed movie information could not be loaded.');
        }
      } finally {
        if (requestId === detailRequestIdRef.current) {
          setDetailLoading(false);
        }
      }
    },
    [bundle?.movies],
  );

  const loadSeriesDetail = useCallback(
    async (series: SeriesSummary) => {
      if (!bundle?.seriesDataSource) {
        return;
      }

      const requestId = ++detailRequestIdRef.current;
      setMovieDetail(null);
      setSeriesDetail(buildSeriesPreviewDetail(series));
      setDetailError(null);
      setDetailLoading(true);

      try {
        const detail = await bundle.seriesDataSource.getSeriesInfo(series.seriesId);
        if (requestId !== detailRequestIdRef.current) {
          return;
        }

        setSeriesDetail(detail);
        if (!detail) {
          setDetailError('Detailed series information is unavailable.');
        } else {
          const firstSeason = detail.seasons[0]?.id ?? '';
          setSelectedSeasonId((current) => (current && detail.episodesBySeason[current] ? current : firstSeason));
        }
      } catch {
        if (requestId === detailRequestIdRef.current) {
          setSeriesDetail(buildSeriesPreviewDetail(series));
          setDetailError('Detailed series information could not be loaded.');
        }
      } finally {
        if (requestId === detailRequestIdRef.current) {
          setDetailLoading(false);
        }
      }
    },
    [bundle?.seriesDataSource],
  );

  const openFromSearchResult = useCallback(
    (result: SearchResult) => {
      if (result.type === 'movie') {
        const movie = movieSearchResultToSummary(result);
        setSelection({ kind: 'movie', movie });
        setDetailOpen(true);
        void loadMovieDetail(movie);
        return true;
      }

      if (result.type === 'series') {
        const series = seriesSearchResultToSummary(result);
        setSelection({ kind: 'series', series });
        setDetailOpen(true);
        void loadSeriesDetail(series);
        return true;
      }

      return false;
    },
    [loadMovieDetail, loadSeriesDetail],
  );

  const retryDetail = useCallback(() => {
    if (selection?.kind === 'movie' && selection.movie) {
      void loadMovieDetail(selection.movie);
      return;
    }

    if (selection?.kind === 'series' && selection.series) {
      void loadSeriesDetail(selection.series);
    }
  }, [loadMovieDetail, loadSeriesDetail, selection]);

  // search-live-unified-direct-v2
  const startLivePlayback = useCallback(
    (result: LiveSearchResult) => {
      if (!bundle || playbackActive || playbackClosing) {
        return false;
      }

      const now = Date.now();
      if (now - lastPlaybackLaunchAtRef.current < 800) {
        return false;
      }

      // Search results already carry the provider stream id. Build the normal Xtream Live URL
      // directly from that id so Search does not need to mount Live TV, load a category, or wait
      // for preview playback before entering fullscreen.
      const streamUrl = buildLiveChannelPlaybackUrl(bundle, {
        id: result.id,
        containerExtension: result.containerExtension,
        streamUrl: result.streamUrl,
      });
      if (!streamUrl) {
        return false;
      }

      lastPlaybackLaunchAtRef.current = now;
      // A Live result must return to Search itself, never reopen a stale movie/series detail.
      reopenDetailAfterPlaybackRef.current = false;

      void recordRecentItem({
        providerId,
        mediaType: 'live',
        contentId: result.id,
        title: result.title,
        artworkUrl: result.logoUrl,
        categoryId: result.categoryId,
      });

      void launchPlayback(
        {
          id: result.id,
          mediaType: 'live',
          title: result.title,
          subtitle: result.currentProgram ?? result.subtitle,
          streamUrl,
          artworkUrl: result.logoUrl,
          channelNumber: result.channelNumber != null ? String(result.channelNumber) : undefined,
          isLive: true,
          providerId,
        },
        { launchSource: 'channel', contentFit: 'contain' },
      );

      return true;
    },
    [bundle, launchPlayback, playbackActive, playbackClosing, providerId],
  );

  const startMoviePlayback = useCallback(() => {
    if (!bundle || selection?.kind !== 'movie' || !selection.movie || playbackActive || playbackClosing) {
      return;
    }

    const now = Date.now();
    if (now - lastPlaybackLaunchAtRef.current < 800) {
      return;
    }

    const movie = selection.movie;
    const streamUrl = buildMoviePlaybackUrl(bundle, movie.id, movie.containerExtension ?? 'mp4');
    if (!streamUrl) {
      return;
    }

    lastPlaybackLaunchAtRef.current = now;
    reopenDetailAfterPlaybackRef.current = true;
    setDetailOpen(false);
    void launchPlayback(
      {
        id: movie.id,
        mediaType: 'movie',
        title: movie.title,
        streamUrl,
        artworkUrl: movie.posterUrl,
        isLive: false,
        providerId,
      },
      { launchSource: 'play', contentFit: 'contain' },
    );
  }, [bundle, launchPlayback, playbackActive, playbackClosing, providerId, selection]);

  const playEpisodeById = useCallback(
    async (episodeId: string, launchSource: 'play' | 'episode' = 'episode', resumePolicy?: 'silent' | 'prompt' | 'start') => {
      if (!bundle || !seriesDetail) {
        return;
      }

      const episode = Object.values(seriesDetail.episodesBySeason)
        .flat()
        .find((item) => item.id === episodeId);
      if (!episode) {
        return;
      }

      reopenDetailAfterPlaybackRef.current = true;
      setDetailOpen(false);
      await launchSeriesEpisodePlayback({
        bundle,
        providerId,
        episode,
        seriesTitle: seriesDetail.title,
        artworkUrl: seriesDetail.posterUrl,
        episodes: Object.values(seriesDetail.episodesBySeason).flat(),
        launchSource,
        resumePolicy,
        launchPlayback,
      });
    },
    [bundle, launchPlayback, providerId, seriesDetail],
  );

  const playFirstEpisode = useCallback(
    async (fromBeginning = false) => {
      if (!seriesDetail) {
        return;
      }

      const allEpisodes = Object.values(seriesDetail.episodesBySeason).flat();
      if (fromBeginning) {
        const first = sortEpisodesByNumber(allEpisodes)[0];
        if (first) {
          await playEpisodeById(first.id, 'play', 'start');
        }
        return;
      }

      const continueWatching = seriesLibrary.seriesContinueWatching(seriesDetail.seriesId);
      const target = resolveSeriesContinuePlayTarget({
        episodes: allEpisodes,
        continueWatching,
      });
      if (target.episode) {
        await playEpisodeById(
          target.episode.id,
          'play',
          target.mode === 'continue' ? undefined : 'start',
        );
      }
    },
    [playEpisodeById, seriesDetail, seriesLibrary],
  );

  const continueWatchingLabel = useMemo(() => {
    if (selection?.kind === 'movie' && selection.movie) {
      const entry = movieLibrary.state.watchHistory.find((item) => item.movieId === selection.movie?.id);
      return resolveContinueWatchingLabel(entry?.progressPercent, entry?.positionMs, entry?.durationMs);
    }

    if (selection?.kind === 'series' && selection.series) {
      const continueWatching = seriesLibrary.seriesContinueWatching(selection.series.seriesId);
      const target = resolveSeriesContinuePlayTarget({
        episodes: seriesDetail ? Object.values(seriesDetail.episodesBySeason).flat() : [],
        continueWatching,
      });
      return formatSeriesContinuePlayLabel(target);
    }

    return 'Play';
  }, [movieLibrary.state.watchHistory, selection, seriesDetail, seriesLibrary]);

  const handlePlaybackClosed = useCallback(() => {
    if (reopenDetailAfterPlaybackRef.current && selection) {
      reopenDetailAfterPlaybackRef.current = false;
      setDetailOpen(true);
    }
    finishUnifiedPlaybackClose();
  }, [selection]);

  const overlayDetail: MediaDetail | null =
    selection?.kind === 'movie' && selection.movie
      ? movieDetail?.id === selection.movie.id
        ? movieDetail
        : buildMoviePreviewDetail(selection.movie)
      : selection?.kind === 'series' && selection.series
        ? seriesDetail && seriesDetail.seriesId === selection.series.seriesId
          ? buildSeriesMediaDetail(seriesDetail)
          : buildSeriesOverlayPreview(selection.series)
        : null;

  return {
    detailOpen,
    detailLoading,
    detailError,
    overlayDetail,
    selection,
    selectedSeasonId,
    focusedEpisodeId,
    playbackActive,
    playbackClosing,
    didJustClose,
    movieLibrary,
    seriesLibrary,
    seriesDetail,
    openFromSearchResult,
    closeDetail,
    closePlayback,
    retryDetail,
    startLivePlayback,
    startMoviePlayback,
    continueWatchingLabel,
    playFirstEpisode,
    playEpisodeById,
    setSelectedSeasonId,
    setFocusedEpisodeId,
    handlePlaybackClosed,
    toggleMovieFavorite: (movieId: string) => {
      void toggleFavorite(providerId, movieId);
    },
    toggleMovieWatchlist: (movieId: string) => {
      void toggleWatchlist(providerId, movieId);
    },
    toggleSeriesFavorite: (seriesId: string, title: string, artworkUrl?: string) => {
      void toggleMediaFavorite(providerId, seriesId, 'series', { title, artworkUrl });
    },
    toggleSeriesWatchlist: (seriesId: string) => {
      void toggleMediaWatchlist(providerId, seriesId);
    },
  };
}
