import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { ElementRef } from 'react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { findNodeHandle, Pressable, StyleSheet, Text, View } from 'react-native';

import { TvRemoteImage } from '@/components/media/TvRemoteImage';
import {
  isOnnMoviesTraceEnabled,
  noteOnnMoviesRender,
  traceOnnMoviesEvent,
} from '@/features/diagnostics/onnMoviesTrace';
import { recordFocusAudit } from '@/features/navigation/focusRequestAudit';
import { displayStreamTitle, formatMediaMetaLabel } from '@/features/series/metadata/titleNormalization';
import { useAppTheme } from '@/theme/AppThemeProvider';
import type { NovaTheme } from '@/theme/tokens';

import { createMoviePosterFocusChrome } from '../moviePosterFocusChrome';
import type { MovieSummary } from '../movieTypes';

let posterInstanceSequence = 0;

type MoviePosterCardProps = {
  movie: MovieSummary;
  hasPreferredFocus?: boolean;
  /**
   * Stage 3D.3: keep focus chrome visible during viewport correction / post-restore
   * even if native onBlur fires. Does not request focus.
   */
  forceFocused?: boolean;
  /** Audit-only: count renders for the currently selected poster. */
  auditSelected?: boolean;
  onFocus: (movie: MovieSummary) => void;
  onPress?: (movie: MovieSummary) => void;
  registerRef?: (instance: ElementRef<typeof Pressable> | null, instanceToken: string) => void;
  isDiscover?: boolean;
  focusable?: boolean;
  /** When true, Down stays on this card (last row) instead of jumping to categories/nav. */
  trapFocusDown?: boolean;
};

const POSTER_THEMES: Record<
  string,
  { background: string; glow: string; accent: string; accentSoft: string; secondary: string }
> = {
  ember: { background: '#101318', glow: 'rgba(255,134,74,0.20)', accent: '#FF9A52', accentSoft: 'rgba(255,154,82,0.24)', secondary: '#FF6F61' },
  signal: { background: '#0E1420', glow: 'rgba(97,165,255,0.20)', accent: '#5FA8FF', accentSoft: 'rgba(95,168,255,0.22)', secondary: '#8B7BFF' },
  glacier: { background: '#10161A', glow: 'rgba(78,208,192,0.18)', accent: '#72E5D6', accentSoft: 'rgba(114,229,214,0.22)', secondary: '#B1F0EA' },
  orbit: { background: '#11131D', glow: 'rgba(140,110,255,0.20)', accent: '#B28BFF', accentSoft: 'rgba(178,139,255,0.22)', secondary: '#68B7FF' },
  midnight: { background: '#111217', glow: 'rgba(255,255,255,0.10)', accent: '#E0E6FF', accentSoft: 'rgba(255,255,255,0.14)', secondary: '#81A8FF' },
  onyx: { background: '#0D1117', glow: 'rgba(255,255,255,0.08)', accent: '#AEB8C8', accentSoft: 'rgba(174,184,200,0.16)', secondary: '#6B7A90' },
  aurora: { background: '#10161D', glow: 'rgba(87,255,205,0.16)', accent: '#6FFFCB', accentSoft: 'rgba(111,255,203,0.18)', secondary: '#80A8FF' },
  dune: { background: '#121118', glow: 'rgba(255,197,110,0.18)', accent: '#FFD07A', accentSoft: 'rgba(255,208,122,0.2)', secondary: '#FF9F6B' },
};

function getPosterColors(key: string) {
  return POSTER_THEMES[key] ?? POSTER_THEMES.midnight;
}

function makeInitials(title: string) {
  return title
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

function moviePosterCardPropsAreEqual(previous: MoviePosterCardProps, next: MoviePosterCardProps) {
  return (
    previous.movie === next.movie &&
    previous.hasPreferredFocus === next.hasPreferredFocus &&
    previous.forceFocused === next.forceFocused &&
    previous.auditSelected === next.auditSelected &&
    previous.focusable === next.focusable &&
    previous.isDiscover === next.isDiscover &&
    previous.trapFocusDown === next.trapFocusDown &&
    previous.onFocus === next.onFocus &&
    previous.onPress === next.onPress
    // registerRef intentionally ignored — ref wiring must not invalidate memo.
  );
}

export const MoviePosterCard = memo(function MoviePosterCard({
  movie,
  hasPreferredFocus,
  forceFocused = false,
  auditSelected = false,
  onFocus,
  onPress,
  registerRef,
  isDiscover = false,
  focusable = true,
  trapFocusDown = false,
}: MoviePosterCardProps) {
  void isDiscover;
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [isFocused, setIsFocused] = useState(false);
  const showFocused = isFocused || forceFocused;
  const [failedPosterKey, setFailedPosterKey] = useState<string | null>(null);
  const [selfFocusHandle, setSelfFocusHandle] = useState<number | undefined>();
  const nativeHandleRef = useRef<number | null>(null);
  const instanceToken = useMemo(() => `movie-poster-${++posterInstanceSequence}-${movie.id}`, [movie.id]);
  const posterColors = getPosterColors(movie.posterStyleKey);
  const initials = makeInitials(movie.title);
  const posterKey = `${movie.id}:${movie.posterUrl ?? ''}`;
  const posterFailed = failedPosterKey === posterKey;
  const showPosterArt = Boolean(movie.posterUrl) && !posterFailed;
  const metaPrimary = formatMediaMetaLabel({
    year: movie.year,
    rating: movie.rating,
    genre: movie.genres[0],
  });

  if (isOnnMoviesTraceEnabled() && auditSelected) {
    noteOnnMoviesRender('MoviePosterCard:selected');
  }

  // FlatList recycles cells without always firing blur — clear stale focus chrome.
  useEffect(() => {
    setIsFocused(false);
  }, [movie.id]);

  useEffect(() => {
    if (hasPreferredFocus) {
      recordFocusAudit({
        component: 'MoviePosterCard',
        action: 'hasTVPreferredFocus',
        itemId: movie.id,
      });
    }
  }, [hasPreferredFocus, movie.id]);

  const bindRef = useCallback(
    (instance: ElementRef<typeof Pressable> | null) => {
      registerRef?.(instance, instanceToken);
      const handle = instance ? findNodeHandle(instance) ?? null : null;
      nativeHandleRef.current = handle;
      if (!trapFocusDown) {
        setSelfFocusHandle((prev) => (prev === undefined ? prev : undefined));
        return;
      }
      setSelfFocusHandle((prev) => (prev === (handle ?? undefined) ? prev : handle ?? undefined));
    },
    [instanceToken, registerRef, trapFocusDown],
  );

  return (
    <Pressable
      ref={bindRef}
      focusable={focusable}
      disabled={!focusable}
      hasTVPreferredFocus={hasPreferredFocus}
      {...(trapFocusDown && selfFocusHandle != null ? { nextFocusDown: selfFocusHandle } : null)}
      onFocus={() => {
        recordFocusAudit({ component: 'MoviePosterCard', action: 'focus-received', itemId: movie.id });
        if (isOnnMoviesTraceEnabled()) {
          traceOnnMoviesEvent('Focus', 'poster_card_on_focus', {
            movieId: movie.id,
            nativeHandle: nativeHandleRef.current,
          });
        }
        setIsFocused(true);
        onFocus(movie);
      }}
      onBlur={() => {
        // Local native focus cleared; forceFocused may still pin chrome during correction.
        setIsFocused(false);
      }}
      onPress={() => onPress?.(movie)}
      style={styles.card}>
      <View style={[styles.posterShell, showFocused && styles.posterShellFocused]}>
        <View
          style={[
            styles.poster,
            showPosterArt ? styles.posterWithArt : { backgroundColor: posterColors.background },
            showFocused && styles.posterFocused,
          ]}>
          {showPosterArt ? (
            <>
              <TvRemoteImage uri={movie.posterUrl} style={styles.posterImage} onError={() => setFailedPosterKey(posterKey)} />
              {movie.rating ? (
                <View style={styles.ratingBadge}>
                  <MaterialCommunityIcons name="star" size={10} color="#F6C85F" />
                  <Text style={styles.ratingText}>{movie.rating}</Text>
                </View>
              ) : null}
            </>
          ) : (
            <>
              <View style={[styles.posterFrame, { borderColor: posterColors.accentSoft }]} />
              <View style={styles.posterHeader}>
                <Text style={[styles.posterTag, { color: posterColors.secondary }]}>FEATURE</Text>
                <Text style={[styles.posterYear, { color: posterColors.secondary }]}>{metaPrimary}</Text>
              </View>
              <View style={styles.posterCenter}>
                <Text style={[styles.initials, { color: posterColors.accent }]}>{initials}</Text>
                <Text numberOfLines={1} style={[styles.posterGenre, { color: posterColors.accentSoft }]}>
                  {movie.genres[0] ?? 'Feature'}
                </Text>
              </View>
              <View style={styles.posterFooter}>
                <Text numberOfLines={1} style={styles.posterFooterLabel}>
                  {displayStreamTitle(movie.title)}
                </Text>
              </View>
              {movie.rating ? (
                <View style={styles.ratingBadge}>
                  <MaterialCommunityIcons name="star" size={10} color={posterColors.accent} />
                  <Text style={styles.ratingText}>{movie.rating}</Text>
                </View>
              ) : null}
            </>
          )}
</View>
      </View>

      <Text numberOfLines={1} style={[styles.title, showFocused && styles.titleFocused]}>
        {displayStreamTitle(movie.title)}
      </Text>
      <View style={styles.metaRow}>
        {metaPrimary ? <Text style={styles.meta}>{metaPrimary}</Text> : null}
        {metaPrimary && movie.genres[0] ? <View style={styles.metaDot} /> : null}
        <Text style={styles.meta}>{movie.genres[0] ?? 'Feature'}</Text>
      </View>
    </Pressable>
  );
}, moviePosterCardPropsAreEqual);

function createStyles(theme: NovaTheme) {
  const focusChrome = createMoviePosterFocusChrome(theme);
  return StyleSheet.create({
    card: focusChrome.card,
    posterShell: focusChrome.posterShell,
    posterShellFocused: focusChrome.posterShellFocused,
    poster: focusChrome.poster,
    posterFocused: focusChrome.posterFocused,
    posterWithArt: focusChrome.posterWithArt,
    posterImage: focusChrome.posterImage,
    posterFrame: {
      position: 'absolute',
      top: 10,
      right: 10,
      bottom: 10,
      left: 10,
      borderWidth: 1,
      borderRadius: theme.radius.sm,
      opacity: 0.9,
    },
    posterHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    posterTag: {
      fontSize: 9,
      fontWeight: '900',
      letterSpacing: 1.2,
    },
    posterYear: {
      fontSize: 9,
      fontWeight: '800',
      letterSpacing: 0.6,
    },
    posterCenter: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 3,
    },
    initials: {
      fontSize: 26,
      fontWeight: '900',
      letterSpacing: 1.2,
    },
    posterGenre: {
      fontSize: 10,
      fontWeight: '700',
      letterSpacing: 0.8,
      textTransform: 'uppercase',
    },
    posterFooter: {
      minHeight: 20,
      justifyContent: 'flex-end',
    },
    posterFooterLabel: {
      color: theme.colors.textPrimary,
      fontSize: 11,
      fontWeight: '800',
      letterSpacing: 0.2,
    },
    ratingBadge: {
      position: 'absolute',
      top: 8,
      right: 8,
      borderRadius: 8,
      backgroundColor: 'rgba(5,9,15,0.78)',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: 7,
      paddingVertical: 4,
      zIndex: 2,
    },
    ratingText: {
      color: theme.colors.textPrimary,
      fontSize: 10,
      fontWeight: '800',
    },
    title: focusChrome.title,
    titleFocused: focusChrome.titleFocused,
    metaRow: {
      marginTop: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
    },
    meta: focusChrome.meta,
    metaDot: {
      width: 3,
      height: 3,
      borderRadius: 99,
      backgroundColor: theme.colors.textMuted,
    },
  });
}
