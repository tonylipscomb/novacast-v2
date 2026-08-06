/**
 * Stage 4.2M — Thin Series adapter over MediaDetailOverlayShell.
 * Same popup behavior as Movies; only data/actions differ.
 */
import { useMemo, useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import type { MediaDetail, MediaDetailEpisode } from '@/features/media-browser/mediaTypes.ts';
import {
  MediaDetailOverlayShell,
  adaptMediaDetailToOverlayModel,
  type MediaDetailAction,
} from '@/features/media-detail';
import { novaTheme } from '@/theme';

export type SeriesDetailOverlayProps = {
  visible: boolean;
  detail: MediaDetail | null;
  detailLoading?: boolean;
  detailError?: string | null;
  continueWatchingLabel?: string;
  isFavorite?: boolean;
  isWatchlisted?: boolean;
  selectedSeasonNumber?: number;
  focusedEpisodeId?: string | null;
  onClose: () => void;
  onRetry?: () => void;
  onPlay?: () => void;
  onPlayFromBeginning?: () => void;
  onFavoritePress?: () => void;
  onWatchlistPress?: () => void;
  onSeasonPress?: (seasonNumber: number) => void;
  onEpisodePress?: (episode: MediaDetailEpisode) => void;
  onEpisodeFocus?: (episodeId: string) => void;
};

export function SeriesDetailOverlay({
  visible,
  detail,
  detailLoading = false,
  detailError = null,
  continueWatchingLabel,
  isFavorite = false,
  isWatchlisted = false,
  selectedSeasonNumber,
  focusedEpisodeId = null,
  onClose,
  onRetry,
  onPlay,
  onPlayFromBeginning,
  onFavoritePress,
  onWatchlistPress,
  onSeasonPress,
  onEpisodePress,
  onEpisodeFocus,
}: SeriesDetailOverlayProps) {
  const [showEpisodes, setShowEpisodes] = useState(true);
  const model = useMemo(
    () => (detail ? adaptMediaDetailToOverlayModel(detail) : null),
    [detail],
  );

  const seasons = detail?.seasons ?? [];
  const episodes = detail?.episodes ?? [];
  const activeSeason =
    selectedSeasonNumber ??
    seasons[0]?.seasonNumber ??
    null;
  const seasonEpisodes = episodes.filter(
    (episode) => episode.seasonNumber === activeSeason,
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
    if (onPlayFromBeginning) {
      next.push({
        id: 'restart',
        label: 'From start',
        icon: 'restart',
        onPress: onPlayFromBeginning,
      });
    }
    if (seasons.length > 0) {
      next.push({
        id: 'episodes',
        label: showEpisodes ? 'Hide episodes' : 'Episodes',
        icon: 'playlist-play',
        onPress: () => setShowEpisodes((value) => !value),
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
    onPlayFromBeginning,
    onRetry,
    onWatchlistPress,
    seasons.length,
    showEpisodes,
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
      testID="series-detail-overlay"
      traceId={detail?.id ?? undefined}>
      {showEpisodes && seasons.length > 0 ? (
        <View style={styles.episodesBlock}>
          <ScrollView
            horizontal
            focusable={false}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.seasonRow}>
            {seasons.map((season) => {
              const selected = season.seasonNumber === activeSeason;
              return (
                <Pressable
                  key={`season-${season.seasonNumber}`}
                  focusable
                  onPress={() => onSeasonPress?.(season.seasonNumber)}
                  {...(Platform.isTV
                    ? { onClick: () => onSeasonPress?.(season.seasonNumber) }
                    : {})}
                  style={[styles.seasonChip, selected && styles.seasonChipSelected]}>
                  <Text style={[styles.seasonChipText, selected && styles.seasonChipTextSelected]}>
                    {season.name ?? `Season ${season.seasonNumber}`}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
          <ScrollView
            horizontal
            focusable={false}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.episodeRow}>
            {seasonEpisodes.slice(0, 24).map((episode) => {
              const focused = focusedEpisodeId === episode.id;
              return (
                <Pressable
                  key={episode.id}
                  focusable
                  onFocus={() => onEpisodeFocus?.(episode.id)}
                  onPress={() => onEpisodePress?.(episode)}
                  {...(Platform.isTV ? { onClick: () => onEpisodePress?.(episode) } : {})}
                  style={[styles.episodeChip, focused && styles.episodeChipFocused]}>
                  <Text style={styles.episodeChipText} numberOfLines={1}>
                    E{episode.episodeNumber} · {episode.title}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      ) : null}
    </MediaDetailOverlayShell>
  );
}

const styles = StyleSheet.create({
  episodesBlock: {
    gap: 8,
  },
  seasonRow: {
    gap: 8,
    paddingVertical: 2,
  },
  seasonChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  seasonChipSelected: {
    borderColor: novaTheme.colors.focusRing,
    backgroundColor: 'rgba(59, 130, 246, 0.28)',
  },
  seasonChipText: {
    color: novaTheme.colors.textSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
  seasonChipTextSelected: {
    color: novaTheme.colors.textPrimary,
  },
  episodeRow: {
    gap: 8,
    paddingVertical: 2,
  },
  episodeChip: {
    maxWidth: 220,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  episodeChipFocused: {
    borderColor: novaTheme.colors.focusRing,
  },
  episodeChipText: {
    color: novaTheme.colors.textPrimary,
    fontSize: 13,
  },
});
