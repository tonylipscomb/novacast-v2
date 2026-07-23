import { Linking } from 'react-native';

import { MediaDetailOverlay } from '@/components/media/MediaDetailOverlay';

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

  return (
    <MediaDetailOverlay
      visible={detailOpen && !playbackUiActive && Boolean(overlayDetail)}
      detail={overlayDetail}
      detailError={detailError}
      detailLoading={detailLoading}
      continueWatchingLabel="Play"
      isFavorite={
        movie
          ? movieLibrary.isFavorite(movie.id)
          : series
            ? seriesLibrary.isFavorite(series.seriesId)
            : false
      }
      isWatchlisted={
        movie
          ? movieLibrary.isWatchlisted(movie.id)
          : series
            ? seriesLibrary.isWatchlisted(series.seriesId)
            : false
      }
      selectedSeasonNumber={Number(selectedSeasonId) || undefined}
      focusedEpisodeId={focusedEpisodeId}
      onClose={closeDetail}
      onRetry={retryDetail}
      onPlay={
        movie
          ? startMoviePlayback
          : seriesDetail && series && seriesDetail.seasons.length
            ? () => void playFirstEpisode()
            : undefined
      }
      onPlayFromBeginning={seriesDetail && series ? () => void playFirstEpisode(true) : undefined}
      onTrailerPress={
        overlayDetail?.trailerUrl
          ? () => {
              void Linking.openURL(overlayDetail.trailerUrl!);
            }
          : undefined
      }
      onFavoritePress={
        movie
          ? () => toggleMovieFavorite(movie.id)
          : seriesDetail && series
            ? () => toggleSeriesFavorite(seriesDetail.seriesId, seriesDetail.title, seriesDetail.posterUrl)
            : undefined
      }
      onWatchlistPress={
        movie
          ? () => toggleMovieWatchlist(movie.id)
          : seriesDetail && series
            ? () => toggleSeriesWatchlist(seriesDetail.seriesId)
            : undefined
      }
      onSeasonPress={(seasonNumber) => setSelectedSeasonId(String(seasonNumber))}
      onEpisodeFocus={setFocusedEpisodeId}
      onEpisodePress={(episode) => {
        setFocusedEpisodeId(episode.id);
        void playEpisodeById(episode.id, 'episode');
      }}
    />
  );
}
