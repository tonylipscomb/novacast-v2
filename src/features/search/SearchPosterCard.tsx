import { memo, useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { TvRemoteImage } from '@/components/media/TvRemoteImage';
import { NovaPosterFocusOverlay } from '@/components/nova/NovaPosterFocusOverlay';
import { createMoviePosterFocusChrome } from '@/features/movies/moviePosterFocusChrome';
import { displayStreamTitle, formatMediaMetaLabel } from '@/features/series/metadata/titleNormalization';
import { useAppTheme } from '@/theme/AppThemeProvider';

import { logSearchEvent } from './searchDiagnostics';
import {
  getActiveMoviesSearchRequestId,
  markMoviesSearchPosterReady,
  noteMoviesSearchFocusRender,
  noteMoviesSearchPosterMount,
  noteMoviesSearchPosterRender,
} from './moviesSearchPerfDiagnostics';
import {
  confirmMoviesSearchResultFocused,
  registerMoviesSearchResultTarget,
  unregisterMoviesSearchResultTarget,
} from './moviesSearchFocus';
import {
  confirmMoviesSearchInputHandoff,
  notifyMoviesSearchInputTargetsChanged,
} from './moviesSearchInputHandoff';
import type { MovieSearchResult, SeriesSearchResult } from './searchTypes';

type SearchPosterCardProps = {
  result: MovieSearchResult | SeriesSearchResult;
  focused?: boolean;
  onFocus?: () => void;
  onPress?: () => void;
  nextFocusUp?: number;
  nextFocusLeft?: number;
  searchQuery?: string;
  restoreTargetRef?: MutableRefObject<View | null>;
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
    previous.focused === next.focused &&
    previous.nextFocusUp === next.nextFocusUp &&
    previous.nextFocusLeft === next.nextFocusLeft &&
    previous.onFocus === next.onFocus &&
    previous.onPress === next.onPress &&
    previous.searchQuery === next.searchQuery
    && previous.restoreTargetRef === next.restoreTargetRef
  );
}

export const SearchPosterCard = memo(function SearchPosterCard({
  result,
  focused = false,
  onFocus,
  onPress,
  nextFocusUp,
  nextFocusLeft,
  searchQuery = '',
  restoreTargetRef,
}: SearchPosterCardProps) {
  const { theme } = useAppTheme();
  const focusChrome = useMemo(() => createMoviePosterFocusChrome(theme), [theme]);
  const cardFocused = focusChrome.posterFocused;
  const cardRef = useRef<View>(null);
  const [posterFailed, setPosterFailed] = useState(false);
  const [nativeFocused, setNativeFocused] = useState(false);
  const showPosterArt = Boolean(result.posterUrl) && !posterFailed;
  const showFocused = focused || nativeFocused;
  const setCardRef = useCallback((node: View | null) => {
    cardRef.current = node;
    if (restoreTargetRef) {
      restoreTargetRef.current = node;
    }
  }, [restoreTargetRef]);
  const metaPrimary = formatMediaMetaLabel({
    year: result.year,
    rating: result.rating,
    genre: result.genres?.[0],
  });

  useEffect(() => {
    setPosterFailed(false);
  }, [result.id, result.posterUrl]);

  useEffect(() => {
    setNativeFocused(false);
  }, [result.id]);

  useEffect(() => {
    if (result.type !== 'movie') {
      return;
    }
    registerMoviesSearchResultTarget(result.id, cardRef);
    notifyMoviesSearchInputTargetsChanged();
    const requestId = getActiveMoviesSearchRequestId();
    if (requestId) {
      noteMoviesSearchPosterMount(requestId);
      noteMoviesSearchPosterRender(requestId);
    }
    return () => {
      unregisterMoviesSearchResultTarget(result.id, cardRef);
      notifyMoviesSearchInputTargetsChanged();
    };
  }, [result.id, result.type]);

  return (
    <Pressable
      ref={setCardRef}
      focusable
      accessibilityRole="button"
      accessibilityLabel={`Open ${result.type} ${result.title}`}
      onFocus={() => {
        setNativeFocused(true);
        if (result.type === 'movie') {
          const requestId = getActiveMoviesSearchRequestId();
          if (requestId) {
            noteMoviesSearchFocusRender(requestId);
            confirmMoviesSearchResultFocused({
              requestId,
              query: searchQuery,
              movieId: result.id,
              searchInputFocused: false,
            });
          }
          confirmMoviesSearchInputHandoff({
            movieId: result.id,
            requestId,
            inputFocused: false,
          });
        }
        onFocus?.();
      }}
      onBlur={() => setNativeFocused(false)}
      onPress={onPress}
      {...(nextFocusUp ? { nextFocusUp } : null)}
      {...(nextFocusLeft ? { nextFocusLeft } : null)}
      style={[focusChrome.card, styles.searchCard]}>
      <View style={[focusChrome.posterShell, showFocused && focusChrome.posterShellFocused]}>
        <View
          style={[
            focusChrome.poster,
            showPosterArt ? focusChrome.posterWithArt : styles.posterFallback,
                showFocused && cardFocused,
          ]}>
          {showPosterArt ? (
            <TvRemoteImage
              uri={result.posterUrl}
              style={focusChrome.posterImage}
              onLoadEnd={() => {
                if (result.type === 'movie') {
                  const requestId = getActiveMoviesSearchRequestId();
                  if (requestId) {
                    markMoviesSearchPosterReady(requestId);
                  }
                }
              }}
              onError={() => {
                setPosterFailed(true);
                logSearchEvent('search_poster_error', { type: result.type, id: result.id });
              }}
            />
          ) : (
            <View style={styles.fallbackCenter}>
              <Text style={styles.initials}>{makeInitials(result.title)}</Text>
            </View>
          )}
          {showFocused ? <NovaPosterFocusOverlay /> : null}
        </View>
      </View>
      <Text numberOfLines={1} style={[focusChrome.title, showFocused && focusChrome.titleFocused]}>
        {displayStreamTitle(result.title)}
      </Text>
          {metaPrimary ? (
        <Text numberOfLines={1} style={[focusChrome.meta, showFocused && styles.metaFocused]}>
          {metaPrimary}
        </Text>
      ) : null}
    </Pressable>
  );
}, searchPosterCardPropsAreEqual);

const styles = StyleSheet.create({
  searchCard: {
    padding: 4,
  },
  posterFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#101318',
    padding: 10,
  },
  fallbackCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initials: {
    color: '#E0E6FF',
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: 1.2,
  },
  metaFocused: {
    color: '#E9E8FF',
    fontWeight: '800',
  },
});
