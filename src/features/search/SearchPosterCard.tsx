import { memo, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { TvRemoteImage } from '@/components/media/TvRemoteImage';
import { novaTvFocus } from '@/components/nova/novaTvFocus';
import { displayStreamTitle, formatMediaMetaLabel } from '@/features/series/metadata/titleNormalization';
import { novaTheme } from '@/theme';

import { logSearchEvent } from './searchDiagnostics';
import type { MovieSearchResult, SeriesSearchResult } from './searchTypes';

type SearchPosterCardProps = {
  result: MovieSearchResult | SeriesSearchResult;
  onFocus?: () => void;
  onPress?: () => void;
  nextFocusUp?: number;
  nextFocusLeft?: number;
};

function makeInitials(title: string) {
  return title
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

function searchPosterCardPropsAreEqual(previous: SearchPosterCardProps, next: SearchPosterCardProps) {
  return (
    previous.result === next.result &&
    previous.nextFocusUp === next.nextFocusUp &&
    previous.nextFocusLeft === next.nextFocusLeft &&
    previous.onFocus === next.onFocus &&
    previous.onPress === next.onPress
  );
}

export const SearchPosterCard = memo(function SearchPosterCard({
  result,
  onFocus,
  onPress,
  nextFocusUp,
  nextFocusLeft,
}: SearchPosterCardProps) {
  const [posterFailed, setPosterFailed] = useState(false);
  const [nativeFocused, setNativeFocused] = useState(false);
  const showPosterArt = Boolean(result.posterUrl) && !posterFailed;
  const metaPrimary = formatMediaMetaLabel({
    year: result.year,
    rating: result.rating,
    genre: result.genres?.[0],
  });

  useEffect(() => {
    setPosterFailed(false);
  }, [result.id, result.posterUrl]);

  // FlatList recycles cells — clear stale focus chrome when the bound result changes.
  useEffect(() => {
    setNativeFocused(false);
  }, [result.id]);

  return (
    <Pressable
      focusable
      accessibilityRole="button"
      accessibilityLabel={`Open ${result.type} ${result.title}`}
      onFocus={() => {
        setNativeFocused(true);
        onFocus?.();
      }}
      onBlur={() => setNativeFocused(false)}
      onPress={onPress}
      {...(nextFocusUp ? { nextFocusUp } : null)}
      {...(nextFocusLeft ? { nextFocusLeft } : null)}
      style={[styles.card, novaTvFocus.base, nativeFocused && styles.cardFocused]}>
      <View style={[styles.poster, showPosterArt ? styles.posterWithArt : styles.posterFallback]}>
        {showPosterArt ? (
          <TvRemoteImage
            uri={result.posterUrl}
            style={styles.posterImage}
            onError={() => {
              setPosterFailed(true);
              logSearchEvent('search_poster_error', { type: result.type, id: result.id });
            }}
          />
        ) : (
          <Text style={styles.initials}>{makeInitials(result.title)}</Text>
        )}
      </View>
      <Text numberOfLines={2} style={[styles.title, nativeFocused && styles.titleFocused]}>
        {displayStreamTitle(result.title)}
      </Text>
      {metaPrimary ? (
        <Text numberOfLines={1} style={styles.meta}>
          {metaPrimary}
        </Text>
      ) : null}
    </Pressable>
  );
}, searchPosterCardPropsAreEqual);

const styles = StyleSheet.create({
  card: {
    flex: 1,
    minWidth: 0,
    padding: 4,
    borderRadius: 0,
  },
  cardFocused: {
    borderColor: 'transparent',
    shadowColor: novaTheme.colors.focusRing,
    shadowOpacity: 0.65,
    shadowRadius: 7,
  },
  poster: {
    aspectRatio: 2 / 3,
    borderRadius: 0,
    borderWidth: 1,
    borderColor: novaTheme.colors.borderSubtle,
    overflow: 'hidden',
    backgroundColor: '#0B1018',
    alignItems: 'center',
    justifyContent: 'center',
  },
  posterWithArt: {
    padding: 0,
  },
  posterFallback: {
    backgroundColor: '#11151C',
  },
  posterImage: {
    ...StyleSheet.absoluteFillObject,
  },
  initials: {
    color: novaTheme.colors.textSecondary,
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 1,
  },
  title: {
    marginTop: 4,
    color: novaTheme.colors.textPrimary,
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 14,
    minHeight: 28,
  },
  titleFocused: {
    color: novaTheme.colors.accentHover,
    textShadowColor: novaTheme.colors.focusRing,
    textShadowRadius: 8,
  },
  meta: {
    marginTop: 1,
    color: novaTheme.colors.textMuted,
    fontSize: 10,
    fontWeight: '600',
  },
});
