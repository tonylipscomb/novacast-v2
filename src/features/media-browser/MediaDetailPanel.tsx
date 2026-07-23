import type { ElementRef, ReactNode } from 'react';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { TvRemoteImage } from '@/components/media/TvRemoteImage';
import { novaTvFocus } from '@/components/nova/novaTvFocus';
import { displayStreamTitle } from '@/features/series/metadata/titleNormalization';
import { novaTheme } from '@/theme';

import { MediaArtworkFallback } from './MediaArtworkFallback';

type MediaDetailPanelProps = {
  title?: string;
  description?: string;
  year?: string;
  rating?: string;
  runtimeLabel?: string;
  genres?: string[];
  posterUrl?: string;
  backdropUrl?: string;
  kind?: 'movie' | 'series';
  emptyTitle?: string;
  emptyCopy?: string;
  continueWatchingLabel?: string;
  onPlay?: () => void;
  onPlayFromBeginning?: () => void;
  onFavoritePress?: () => void;
  isFavorite?: boolean;
  registerPlayRef?: (instance: ElementRef<typeof Pressable> | null) => void;
  seasonSelector?: ReactNode;
  children?: ReactNode;
};

export function MediaDetailPanel({
  title,
  description,
  year,
  rating,
  runtimeLabel,
  genres = [],
  posterUrl,
  backdropUrl,
  kind = 'movie',
  emptyTitle = 'Focus an item',
  emptyCopy = 'The detail panel updates as you move through the grid.',
  continueWatchingLabel,
  onPlay,
  onPlayFromBeginning,
  onFavoritePress,
  isFavorite = false,
  registerPlayRef,
  seasonSelector,
  children,
}: MediaDetailPanelProps) {
  const [posterFailed, setPosterFailed] = useState(false);
  const [focusedAction, setFocusedAction] = useState<'play' | 'restart' | 'favorite' | null>(null);
  const showPoster = Boolean(posterUrl) && !posterFailed;

  const displayTitle = title ? displayStreamTitle(title) : undefined;

  if (!displayTitle) {
    return (
      <View style={styles.panel}>
        <Text style={styles.emptyTitle}>{emptyTitle}</Text>
        <Text style={styles.emptyCopy}>{emptyCopy}</Text>
      </View>
    );
  }

  return (
    <View style={styles.panel}>
      <View style={styles.posterRow}>
        <View style={styles.posterFrame}>
          {showPoster ? (
            <TvRemoteImage uri={posterUrl} style={styles.posterImage} onError={() => setPosterFailed(true)} />
          ) : (
            <MediaArtworkFallback title={displayTitle} kind={kind} subtitle={year} compact />
          )}
        </View>
        <View style={styles.metaBlock}>
          <Text numberOfLines={2} style={styles.title}>
            {displayTitle}
          </Text>
          <View style={styles.metaRow}>
            {year ? <Text style={styles.metaChip}>{year}</Text> : null}
            {rating ? (
              <View style={styles.ratingChip}>
                <MaterialCommunityIcons name="star" size={11} color="#F6C85F" />
                <Text style={styles.ratingText}>{rating}</Text>
              </View>
            ) : null}
            {runtimeLabel ? <Text style={styles.metaChip}>{runtimeLabel}</Text> : null}
          </View>
          {genres.length ? (
            <Text numberOfLines={1} style={styles.genres}>
              {genres.join(' · ')}
            </Text>
          ) : null}
        </View>
      </View>

      {description ? (
        <Text numberOfLines={4} style={styles.description}>
          {description}
        </Text>
      ) : null}

      <View style={styles.actions}>
        {onPlay ? (
          <Pressable
            ref={registerPlayRef}
            focusable
            onFocus={() => setFocusedAction('play')}
            onBlur={() => setFocusedAction(null)}
            onPress={onPlay}
            style={[
              styles.actionButton,
              styles.actionPrimary,
              novaTvFocus.base,
              focusedAction === 'play' && novaTvFocus.active,
            ]}>
            <MaterialCommunityIcons name="play" size={18} color="#FFFFFF" />
            <Text style={styles.actionPrimaryText}>{continueWatchingLabel ?? 'Play'}</Text>
          </Pressable>
        ) : null}
        {onPlayFromBeginning ? (
          <Pressable
            focusable
            onFocus={() => setFocusedAction('restart')}
            onBlur={() => setFocusedAction(null)}
            onPress={onPlayFromBeginning}
            style={[styles.actionButton, novaTvFocus.base, focusedAction === 'restart' && novaTvFocus.active]}>
            <MaterialCommunityIcons name="restart" size={16} color={novaTheme.colors.textPrimary} />
            <Text style={styles.actionText}>From Beginning</Text>
          </Pressable>
        ) : null}
        {onFavoritePress ? (
          <Pressable
            focusable
            accessibilityLabel={isFavorite ? 'Remove from Favorites' : 'Add to Favorites'}
            onFocus={() => setFocusedAction('favorite')}
            onBlur={() => setFocusedAction(null)}
            onPress={onFavoritePress}
            style={[styles.actionButton, novaTvFocus.base, focusedAction === 'favorite' && novaTvFocus.active]}>
            <MaterialCommunityIcons
              name={isFavorite ? 'heart' : 'heart-outline'}
              size={16}
              color={isFavorite ? '#FF6B8A' : novaTheme.colors.textPrimary}
            />
          </Pressable>
        ) : null}
      </View>

      {seasonSelector}

      <ScrollView style={styles.contentScroll} contentContainerStyle={styles.contentScrollInner} showsVerticalScrollIndicator={false}>
        {children}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    width: 360,
    minWidth: 320,
    borderRadius: novaTheme.radius.lg,
    borderWidth: 1,
    borderColor: novaTheme.colors.borderSubtle,
    backgroundColor: novaTheme.colors.backgroundRaised,
    padding: 12,
    gap: 10,
  },
  emptyTitle: {
    color: novaTheme.colors.textPrimary,
    fontSize: 18,
    fontWeight: '800',
  },
  emptyCopy: {
    marginTop: 6,
    color: novaTheme.colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
  },
  backdropFrame: {
    height: 120,
    borderRadius: novaTheme.radius.md,
    overflow: 'hidden',
    backgroundColor: '#0B1018',
  },
  backdropImage: {
    ...StyleSheet.absoluteFillObject,
  },
  backdropScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(3,7,12,0.45)',
  },
  posterRow: {
    flexDirection: 'row',
    gap: 10,
  },
  posterFrame: {
    width: 84,
    aspectRatio: 2 / 3,
    borderRadius: novaTheme.radius.sm,
    overflow: 'hidden',
    backgroundColor: '#0B1018',
  },
  posterImage: {
    ...StyleSheet.absoluteFillObject,
  },
  metaBlock: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
    gap: 4,
  },
  title: {
    color: novaTheme.colors.textPrimary,
    fontSize: 18,
    fontWeight: '800',
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
  },
  metaChip: {
    color: novaTheme.colors.textMuted,
    fontSize: 11,
    fontWeight: '700',
  },
  ratingChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderRadius: 8,
    backgroundColor: 'rgba(5,9,15,0.62)',
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  ratingText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '800',
  },
  genres: {
    color: novaTheme.colors.textSecondary,
    fontSize: 11,
    fontWeight: '600',
  },
  description: {
    color: novaTheme.colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  actionButton: {
    minHeight: 40,
    borderRadius: 0,
    borderWidth: 1,
    borderColor: 'transparent',
    backgroundColor: novaTheme.colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
  },
  actionPrimary: {
    backgroundColor: novaTheme.colors.accent,
  },
  actionPrimaryText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },
  actionText: {
    color: novaTheme.colors.textPrimary,
    fontSize: 12,
    fontWeight: '700',
  },
  contentScroll: {
    flex: 1,
    minHeight: 0,
  },
  contentScrollInner: {
    gap: 8,
    paddingBottom: 8,
  },
});
