import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { ElementRef } from 'react';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { TvRemoteImage } from '@/components/media/TvRemoteImage';
import { novaTvFocus } from '@/components/nova/novaTvFocus';
import {
  displayStreamTitle,
  formatDisplayRating,
} from '@/features/series/metadata/titleNormalization';
import { novaTheme } from '@/theme';

import type { MovieSummary } from '../movieTypes';

type MovieDetailPanelProps = {
  movie: MovieSummary | null;
  isFavorite?: boolean;
  onPlay?: () => void;
  onFavoritePress?: () => void;
  onAddPress?: () => void;
  registerPlayRef?: (instance: ElementRef<typeof Pressable> | null) => void;
};

const DETAIL_THEMES: Record<string, { background: string; glow: string; accent: string; accentSoft: string }> = {
  ember: { background: '#171117', glow: 'rgba(255,134,74,0.18)', accent: '#FF9A52', accentSoft: 'rgba(255,154,82,0.18)' },
  signal: { background: '#121722', glow: 'rgba(97,165,255,0.18)', accent: '#5FA8FF', accentSoft: 'rgba(95,168,255,0.18)' },
  glacier: { background: '#111C1F', glow: 'rgba(78,208,192,0.18)', accent: '#72E5D6', accentSoft: 'rgba(114,229,214,0.18)' },
  orbit: { background: '#161420', glow: 'rgba(140,110,255,0.18)', accent: '#B28BFF', accentSoft: 'rgba(178,139,255,0.18)' },
  midnight: { background: '#11131A', glow: 'rgba(255,255,255,0.08)', accent: '#E0E6FF', accentSoft: 'rgba(255,255,255,0.12)' },
  onyx: { background: '#101317', glow: 'rgba(255,255,255,0.08)', accent: '#AEB8C8', accentSoft: 'rgba(174,184,200,0.12)' },
  aurora: { background: '#111A1D', glow: 'rgba(87,255,205,0.14)', accent: '#6FFFCB', accentSoft: 'rgba(111,255,203,0.16)' },
  dune: { background: '#1A1511', glow: 'rgba(255,197,110,0.16)', accent: '#FFD07A', accentSoft: 'rgba(255,208,122,0.16)' },
};

function getTheme(movie: MovieSummary | null) {
  return DETAIL_THEMES[movie?.posterStyleKey ?? 'midnight'] ?? DETAIL_THEMES.midnight;
}

function formatRuntime(minutes?: number) {
  if (!minutes) {
    return '';
  }

  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h ${String(mins).padStart(2, '0')}m`;
}

function buildDetailMeta(movie: MovieSummary) {
  const parts = [
    movie.year ? String(movie.year) : '',
    formatRuntime(movie.durationMinutes),
    formatDisplayRating(movie.rating) ? `★ ${formatDisplayRating(movie.rating)}` : '',
  ].filter(Boolean);

  return parts.join(' · ');
}

export function MovieDetailPanel({ movie, isFavorite = false, onPlay, onFavoritePress, onAddPress, registerPlayRef }: MovieDetailPanelProps) {
  const [focusedAction, setFocusedAction] = useState<'play' | 'add' | 'favorite' | null>(null);
  const [posterFailed, setPosterFailed] = useState(false);
  const theme = getTheme(movie);
  const showPosterArt = Boolean(movie?.posterUrl) && !posterFailed;

  if (!movie) {
    return (
      <View style={styles.panel}>
        <Text style={styles.emptyTitle}>Focus a movie</Text>
        <Text style={styles.emptyCopy}>The detail panel updates as you move through the grid.</Text>
      </View>
    );
  }

  const title = displayStreamTitle(movie.title);
  const metaLine = buildDetailMeta(movie);
  const genres = movie.genres.filter((genre) => genre && genre.toLowerCase() !== 'feature');
  const showScore = typeof movie.score === 'number' && movie.score > 0;
  const showAudience = typeof movie.audienceScore === 'number' && movie.audienceScore > 0;
  const showExternal = typeof movie.externalScore === 'number' && movie.externalScore > 0;
  const hasScoreRow = showScore || showAudience || showExternal;

  return (
    <View style={styles.panel}>
      <View style={styles.artFrame}>
        <View style={[styles.artCanvas, { backgroundColor: theme.background }]}>
          {showPosterArt ? (
            <TvRemoteImage uri={movie.posterUrl} style={styles.artPosterImage} onError={() => setPosterFailed(true)} />
          ) : (
            <>
              <View style={[styles.artGlow, { backgroundColor: theme.glow }]} />
              <View style={[styles.artGlowSecondary, { backgroundColor: theme.accentSoft }]} />
              <View style={[styles.artLine, { borderColor: theme.accent }]} />
              <Text style={[styles.artInitials, { color: theme.accent }]}>
                {title
                  .split(' ')
                  .slice(0, 2)
                  .map((word) => word[0])
                  .join('')}
              </Text>
            </>
          )}
        </View>
      </View>

      <Text numberOfLines={2} style={styles.title}>
        {title}
      </Text>
      {metaLine ? <Text style={styles.meta}>{metaLine}</Text> : null}

      <View style={styles.actionRow}>
        <Pressable
          ref={(instance) => registerPlayRef?.(instance)}
          focusable
          accessibilityLabel="Play"
          onFocus={() => setFocusedAction('play')}
          onBlur={() => setFocusedAction(null)}
          onPress={onPlay}
          style={[styles.playButton, novaTvFocus.base, focusedAction === 'play' && novaTvFocus.active]}>
          <MaterialCommunityIcons name="play" size={22} color="#FFFFFF" />
          <Text style={styles.playText}>Play</Text>
        </Pressable>
        <Pressable
          focusable
          onFocus={() => setFocusedAction('add')}
          onBlur={() => setFocusedAction(null)}
          onPress={onAddPress}
          style={[styles.iconButton, novaTvFocus.base, focusedAction === 'add' && novaTvFocus.active]}>
          <MaterialCommunityIcons name="plus" size={22} color={novaTheme.colors.textPrimary} />
        </Pressable>
        <Pressable
          focusable
          accessibilityLabel={isFavorite ? 'Remove from Favorites' : 'Add to Favorites'}
          onFocus={() => setFocusedAction('favorite')}
          onBlur={() => setFocusedAction(null)}
          onPress={onFavoritePress}
          style={[styles.iconButton, novaTvFocus.base, focusedAction === 'favorite' && novaTvFocus.active]}>
          <MaterialCommunityIcons
            name={isFavorite ? 'heart' : 'heart-outline'}
            size={21}
            color={isFavorite ? '#FF6B8A' : novaTheme.colors.textPrimary}
          />
        </Pressable>
      </View>

      <ScrollView style={styles.detailsScroll} contentContainerStyle={styles.detailsScrollContent} showsVerticalScrollIndicator={false}>
        {genres.length ? <Text style={styles.genres}>{genres.join(', ')}</Text> : null}

        {hasScoreRow ? (
          <View style={styles.scoreRow}>
            {showScore ? (
              <View style={styles.scorePill}>
                <MaterialCommunityIcons name="star" size={14} color="#F6C85F" />
                <Text style={styles.scoreText}>{movie.score!.toFixed(1)}/10</Text>
              </View>
            ) : null}
            {showAudience ? (
              <View style={styles.scorePill}>
                <MaterialCommunityIcons name="account-group" size={14} color="#FF8650" />
                <Text style={styles.scoreText}>{movie.audienceScore}%</Text>
              </View>
            ) : null}
            {showExternal ? (
              <View style={styles.scorePill}>
                <MaterialCommunityIcons name="movie-open" size={14} color={novaTheme.colors.accentHover} />
                <Text style={styles.scoreText}>{movie.externalScore!.toFixed(1)}</Text>
              </View>
            ) : null}
          </View>
        ) : null}

        {movie.description ? <Text style={styles.description}>{movie.description}</Text> : null}

        {movie.director ? (
          <View style={styles.detailBlock}>
            <Text style={styles.detailLabel}>Director</Text>
            <Text style={styles.detailValue}>{movie.director}</Text>
          </View>
        ) : null}
        {movie.cast?.length ? (
          <View style={styles.detailBlock}>
            <Text style={styles.detailLabel}>Cast</Text>
            <Text style={styles.detailValue}>{movie.cast.join(', ')}</Text>
          </View>
        ) : null}
        {movie.audio ? (
          <View style={styles.detailBlock}>
            <Text style={styles.detailLabel}>Audio</Text>
            <Text style={styles.detailValue}>{movie.audio}</Text>
          </View>
        ) : null}
        {movie.subtitles ? (
          <View style={styles.detailBlock}>
            <Text style={styles.detailLabel}>Subtitles</Text>
            <Text style={styles.detailValue}>{movie.subtitles}</Text>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    width: 352,
    minWidth: 312,
    maxWidth: 368,
    flex: 1,
    minHeight: 0,
    borderRadius: novaTheme.radius.lg,
    borderWidth: 1,
    borderColor: novaTheme.colors.borderSubtle,
    backgroundColor: novaTheme.colors.backgroundRaised,
    padding: 14,
  },
  artFrame: {
    height: 156,
    borderRadius: novaTheme.radius.lg,
    overflow: 'hidden',
    marginBottom: 12,
  },
  artCanvas: {
    flex: 1,
    borderRadius: novaTheme.radius.lg,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
  },
  artPosterImage: {
    ...StyleSheet.absoluteFill,
  },
  artGlow: {
    position: 'absolute',
    width: 220,
    height: 220,
    borderRadius: 110,
    top: -40,
    right: -56,
  },
  artGlowSecondary: {
    position: 'absolute',
    width: 170,
    height: 170,
    borderRadius: 85,
    left: -46,
    bottom: -40,
  },
  artLine: {
    position: 'absolute',
    left: -20,
    right: -20,
    top: '52%',
    borderTopWidth: 8,
    transform: [{ rotate: '-10deg' }],
    opacity: 0.28,
  },
  artInitials: {
    fontSize: 28,
    fontWeight: '900',
    letterSpacing: 1.5,
  },
  title: {
    color: novaTheme.colors.textPrimary,
    fontSize: 20,
    fontWeight: '900',
    letterSpacing: -0.4,
  },
  meta: {
    marginTop: 6,
    color: novaTheme.colors.textSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
  genres: {
    marginTop: 2,
    color: novaTheme.colors.textPrimary,
    fontSize: 13,
    fontWeight: '700',
  },
  scoreRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  scorePill: {
    minHeight: 36,
    borderRadius: novaTheme.radius.md,
    borderWidth: 1,
    borderColor: novaTheme.colors.borderSubtle,
    backgroundColor: novaTheme.colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
  },
  scoreText: {
    color: novaTheme.colors.textPrimary,
    fontSize: 12,
    fontWeight: '800',
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 12,
  },
  playButton: {
    minHeight: 50,
    borderRadius: 0,
    borderWidth: 1,
    borderColor: 'transparent',
    backgroundColor: novaTheme.colors.accent,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 18,
  },
  playText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
  },
  iconButton: {
    width: 50,
    height: 50,
    borderRadius: 0,
    borderWidth: 1,
    borderColor: novaTheme.colors.borderSubtle,
    backgroundColor: novaTheme.colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  description: {
    marginTop: 14,
    color: novaTheme.colors.textSecondary,
    fontSize: 12,
    lineHeight: 19,
  },
  detailsScroll: {
    flex: 1,
    minHeight: 0,
    marginTop: 4,
  },
  detailsScrollContent: {
    paddingBottom: 12,
  },
  detailBlock: {
    marginTop: 12,
  },
  detailLabel: {
    color: novaTheme.colors.textMuted,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  detailValue: {
    marginTop: 4,
    color: novaTheme.colors.textPrimary,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '600',
  },
  emptyTitle: {
    color: novaTheme.colors.textPrimary,
    fontSize: 24,
    fontWeight: '900',
  },
  emptyCopy: {
    marginTop: 6,
    color: novaTheme.colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
  },
});
