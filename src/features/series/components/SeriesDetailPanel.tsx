import type { ElementRef } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { MediaDetailPanel } from '@/features/media-browser/MediaDetailPanel';
import type { ContinueWatchingEntry, SeriesDetail } from '@/features/media-browser/mediaTypes';

import { SeriesEpisodeList } from './SeriesEpisodeList';

type SeriesDetailPanelProps = {
  detail: SeriesDetail | null;
  selectedSeasonId: string;
  onSelectSeason: (seasonId: string) => void;
  onPlayEpisode: (episodeId: string) => void;
  onPlayFromBeginning?: () => void;
  onFavoritePress?: () => void;
  isFavorite?: boolean;
  continueWatching?: ContinueWatchingEntry | null;
  registerPlayRef?: (instance: ElementRef<typeof Pressable> | null) => void;
  focusedEpisodeId?: string | null;
  onFocusEpisode?: (episodeId: string) => void;
};

export function SeriesDetailPanel({
  detail,
  selectedSeasonId,
  onSelectSeason,
  onPlayEpisode,
  onPlayFromBeginning,
  onFavoritePress,
  isFavorite,
  continueWatching,
  registerPlayRef,
  focusedEpisodeId,
  onFocusEpisode,
}: SeriesDetailPanelProps) {
  const episodes = detail?.episodesBySeason[selectedSeasonId] ?? [];
  const continueLabel = continueWatching ? 'Resume' : 'Play';

  const seasonSelector = detail?.seasons.length ? (
      <View style={styles.seasonSelector}>
        <SeriesEpisodeList
          seasons={detail.seasons}
          episodes={episodes}
          selectedSeasonId={selectedSeasonId}
          onSelectSeason={onSelectSeason}
          onPlayEpisode={(episode) => onPlayEpisode(episode.id)}
          focusedEpisodeId={focusedEpisodeId}
          onFocusEpisode={onFocusEpisode}
        />
      </View>
    ) : null;

  return (
    <MediaDetailPanel
      title={detail?.title}
      description={detail?.description}
      year={detail?.year}
      rating={detail?.rating}
      runtimeLabel={detail?.runtimeMinutes ? `${detail.runtimeMinutes}m` : undefined}
      genres={detail?.genres}
      posterUrl={detail?.posterUrl}
      backdropUrl={detail?.backdropUrl}
      kind="series"
      emptyTitle="Focus a series"
      emptyCopy="Select a show to browse seasons and episodes."
      continueWatchingLabel={continueLabel}
      onPlay={
        detail
          ? () => {
              const target =
                continueWatching && episodes.find((episode) => episode.id === continueWatching.episodeId)
                  ? continueWatching.episodeId
                  : episodes[0]?.id;
              if (target) {
                onPlayEpisode(target);
              }
            }
          : undefined
      }
      onPlayFromBeginning={onPlayFromBeginning}
      onFavoritePress={onFavoritePress}
      isFavorite={isFavorite}
      registerPlayRef={registerPlayRef}
      seasonSelector={seasonSelector}
    />
  );
}

const styles = StyleSheet.create({
  seasonSelector: {
    flex: 1,
    minHeight: 180,
  },
});
