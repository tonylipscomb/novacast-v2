import { Linking } from 'react-native';

import { MovieDetailPopupV2 } from '@/features/movies/components/MovieDetailPopupV2';
import { SeriesDetailPopupV2 } from '@/features/series/components/SeriesDetailPopupV2';

import type { useSearchMediaDetail } from './useSearchMediaDetail';

type SearchMediaDetailLayerProps = {
  media: ReturnType<typeof useSearchMediaDetail>;
};

export function SearchMediaDetailLayer({ media }: SearchMediaDetailLayerProps) {
  const {
    detailOpen,
    detailLoading,
    detailError,
    overlayDetail,
    selection,
    selectedSeasonId,
    focusedEpisodeId,
    playbackActive,
    playbackClosing,
    movieLibrary,
    seriesLibrary,
    seriesDetail,
    closeDetail,
    retryDetail,
    startMoviePlayback,
    continueWatchingLabel,
    playFirstEpisode,
    playEpisodeById,
    setSelectedSeasonId,
    setFocusedEpisodeId,
    toggleMovieFavorite,
    toggleMovieWatchlist,
    toggleSeriesFavorite,
    toggleSeriesWatchlist,
  } = media;

  const movie = selection?.kind === 'movie' ? selection.movie : null;
  const series = selection?.kind === 'series' ? selection.series : null;
  const playbackUiActive = playbackActive || playbackClosing;

  const visible = detailOpen && !playbackUiActive && Boolean(overlayDetail);

  if (movie) {
    return (
      <MovieDetailPopupV2
        visible={visible}
        movie={movie}
        detail={overlayDetail}
        loading={detailLoading}
        error={detailError}
        playLabel={continueWatchingLabel}
        isFavorite={movieLibrary.isFavorite(movie.id)}
        isWatchlisted={movieLibrary.isWatchlisted(movie.id)}
        onClose={closeDetail}
        onRetry={retryDetail}
        onPlay={startMoviePlayback}
        onToggleFavorite={() => toggleMovieFavorite(movie.id)}
        onToggleWatchlist={() => toggleMovieWatchlist(movie.id)}
        onTrailerPress={
          overlayDetail?.trailerUrl
            ? () => {
                void Linking.openURL(overlayDetail.trailerUrl!);
              }
            : undefined
        }
      />
    );
  }

  if (series) {
    return (
      <SeriesDetailPopupV2
        visible={visible}
        series={series}
        detail={overlayDetail}
        loading={detailLoading}
        error={detailError}
        playLabel={continueWatchingLabel}
        isFavorite={seriesLibrary.isFavorite(series.seriesId)}
        isWatchlisted={seriesLibrary.isWatchlisted(series.seriesId)}
        selectedSeasonNumber={Number(selectedSeasonId) || undefined}
        focusedEpisodeId={focusedEpisodeId}
        onClose={closeDetail}
        onRetry={retryDetail}
        onPlay={
          seriesDetail && seriesDetail.seasons.length
            ? () => void playFirstEpisode()
            : undefined
        }
        onToggleFavorite={() => toggleSeriesFavorite(series.seriesId, series.title, series.posterUrl)}
        onToggleWatchlist={() => toggleSeriesWatchlist(series.seriesId)}
        onSeasonPress={(seasonNumber) => setSelectedSeasonId(String(seasonNumber))}
        onEpisodeFocus={setFocusedEpisodeId}
        onEpisodePress={(episode) => {
          setFocusedEpisodeId(episode.id);
          void playEpisodeById(episode.id, 'episode');
        }}
      />
    );
  }

  return null;
}
