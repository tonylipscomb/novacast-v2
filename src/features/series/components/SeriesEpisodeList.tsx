import { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { novaTvFocus } from '@/components/nova/novaTvFocus';
import { displayStreamTitle } from '@/features/series/metadata/titleNormalization';
import type { SeriesEpisodeSummary, SeriesSeasonSummary } from '@/features/media-browser/mediaTypes';
import { useAppTheme } from '@/theme/AppThemeProvider';
import type { NovaTheme } from '@/theme/tokens';

type SeriesEpisodeListProps = {
  seasons: SeriesSeasonSummary[];
  episodes: SeriesEpisodeSummary[];
  selectedSeasonId: string;
  onSelectSeason: (seasonId: string) => void;
  onPlayEpisode: (episode: SeriesEpisodeSummary) => void;
  focusedEpisodeId?: string | null;
  onFocusEpisode?: (episodeId: string) => void;
};

export function SeriesEpisodeList({
  seasons,
  episodes,
  selectedSeasonId,
  onSelectSeason,
  onPlayEpisode,
  focusedEpisodeId,
  onFocusEpisode,
}: SeriesEpisodeListProps) {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [focusedSeasonId, setFocusedSeasonId] = useState<string | null>(null);

  return (
    <View style={styles.root}>
      <View style={styles.seasonRail}>
        {seasons.map((season) => {
          const selected = season.id === selectedSeasonId;
          const focused = season.id === focusedSeasonId;
          return (
            <Pressable
              key={season.id}
              focusable
              onFocus={() => setFocusedSeasonId(season.id)}
              onBlur={() => setFocusedSeasonId(null)}
              onPress={() => onSelectSeason(season.id)}
              style={[
                styles.seasonChip,
                novaTvFocus.base,
                selected && styles.seasonChipSelected,
                focused && (theme.scheme === 'light' ? styles.seasonChipFocusedLight : novaTvFocus.active),
              ]}>
              <Text style={[styles.seasonChipText, selected && styles.seasonChipTextSelected]}>{season.label}</Text>
              <Text style={styles.seasonCount}>{season.episodeCount}</Text>
            </Pressable>
          );
        })}
      </View>

      <FlatList
        data={episodes}
        keyExtractor={(item) => item.id}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.episodeList}
        removeClippedSubviews
        windowSize={7}
        initialNumToRender={24}
        maxToRenderPerBatch={24}
        renderItem={({ item }) => {
          const focused = focusedEpisodeId === item.id;
          return (
            <Pressable
              focusable
              onFocus={() => onFocusEpisode?.(item.id)}
              onPress={() => onPlayEpisode(item)}
              style={[
                styles.episodeRow,
                novaTvFocus.base,
                focused && (theme.scheme === 'light' ? styles.episodeRowFocusedLight : novaTvFocus.active),
              ]}>
              <View style={styles.episodeCopy}>
                <Text style={styles.episodeNumber}>E{item.episodeNumber}</Text>
                <Text numberOfLines={1} style={styles.episodeTitle}>
                  {displayStreamTitle(item.title)}
                </Text>
              </View>
              <MaterialCommunityIcons name="play-circle-outline" size={20} color={theme.colors.accentHover} />
            </Pressable>
          );
        }}
      />
    </View>
  );
}

function createStyles(theme: NovaTheme) {
  return StyleSheet.create({
    root: {
      flex: 1,
      minHeight: 0,
      gap: 8,
    },
    seasonRail: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
    },
    seasonChip: {
      minHeight: 34,
      borderRadius: 0,
      borderWidth: 1,
      borderColor: 'transparent',
      backgroundColor: theme.colors.surface,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 10,
    },
    seasonChipSelected: {
      borderColor: theme.colors.accent,
      backgroundColor: theme.colors.surfaceMuted,
    },
    seasonChipFocusedLight: {
      borderColor: theme.colors.focusRing,
      backgroundColor: theme.colors.surfaceFocused,
    },
    seasonChipText: {
      color: theme.colors.textPrimary,
      fontSize: 12,
      fontWeight: '700',
    },
    seasonChipTextSelected: {
      color: theme.colors.accentHover,
    },
    seasonCount: {
      color: theme.colors.textMuted,
      fontSize: 10,
      fontWeight: '700',
    },
    episodeList: {
      gap: 6,
      paddingBottom: 8,
    },
    episodeRow: {
      minHeight: 44,
      borderRadius: 0,
      borderWidth: 1,
      borderColor: 'transparent',
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 10,
      backgroundColor: theme.colors.surface,
    },
    episodeRowFocusedLight: {
      borderColor: theme.colors.focusRing,
      backgroundColor: theme.colors.surfaceFocused,
    },
    episodeCopy: {
      flex: 1,
      minWidth: 0,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    episodeNumber: {
      color: theme.colors.textMuted,
      fontSize: 11,
      fontWeight: '800',
      width: 28,
    },
    episodeTitle: {
      flex: 1,
      color: theme.colors.textPrimary,
      fontSize: 12,
      fontWeight: '700',
    },
  });
}
