import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { ElementRef } from 'react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, findNodeHandle, Pressable, StyleSheet, Text, View } from 'react-native';

import { TvRemoteImage } from '@/components/media/TvRemoteImage';
import { NovaPosterFocusOverlay } from '@/components/nova/NovaPosterFocusOverlay';
import { formatRatingOneDecimal } from '@/features/media-browser/ratingNormalization';
import type { SeriesSummary } from '@/features/media-browser/mediaTypes';
import { displayStreamTitle, formatMediaMetaLabel } from '@/features/series/metadata/titleNormalization';
import { useAppTheme } from '@/theme/AppThemeProvider';
import type { NovaTheme } from '@/theme/tokens';
import { createMoviePosterFocusChrome } from '@/features/movies/moviePosterFocusChrome';

type SeriesPosterCardProps = {
  series: SeriesSummary;
  hasPreferredFocus?: boolean;
  onFocus: (series: SeriesSummary) => void;
  onPress?: (series: SeriesSummary) => void;
  registerRef?: (instance: ElementRef<typeof Pressable> | null) => void;
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

function seriesPosterCardPropsAreEqual(previous: SeriesPosterCardProps, next: SeriesPosterCardProps) {
  return (
    previous.series === next.series &&
    previous.hasPreferredFocus === next.hasPreferredFocus &&
    previous.focusable === next.focusable &&
    previous.trapFocusDown === next.trapFocusDown &&
    previous.onFocus === next.onFocus &&
    previous.onPress === next.onPress
    // registerRef intentionally ignored ΓÇö ref wiring must not invalidate memo.
  );
}

export const SeriesPosterCard = memo(function SeriesPosterCard({
  series,
  hasPreferredFocus,
  onFocus,
  onPress,
  registerRef,
  focusable = true,
  trapFocusDown = false,
}: SeriesPosterCardProps) {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [isFocused, setIsFocused] = useState(false);
  const focusScale = useRef(new Animated.Value(1)).current;
  const [failedPosterKey, setFailedPosterKey] = useState<string | null>(null);
  const [selfFocusHandle, setSelfFocusHandle] = useState<number | undefined>();
  // series-pagination-focus-v6_3-lookahead-native-stable
  const nativePressableRef = useRef<ElementRef<typeof Pressable> | null>(null);
  const registerRefRef = useRef(registerRef);
  const trapFocusDownRef = useRef(trapFocusDown);
  registerRefRef.current = registerRef;
  trapFocusDownRef.current = trapFocusDown;
  const posterColors = getPosterColors(series.posterStyleKey);
  const initials = makeInitials(series.title);
  const posterKey = `${series.id}:${series.posterUrl ?? ''}`;
  const posterFailed = failedPosterKey === posterKey;
  const showPosterArt = Boolean(series.posterUrl) && !posterFailed;
  const displayRating = formatRatingOneDecimal(series.rating);
  const metaPrimary = formatMediaMetaLabel({
    year: series.year,
    rating: series.rating,
    genre: series.genres[0],
  });

  useEffect(() => {
    setIsFocused(false);
  }, [series.id]);

  const bindRef = useCallback((instance: ElementRef<typeof Pressable> | null) => {
    nativePressableRef.current = instance;
    registerRefRef.current?.(instance);

    // If this card mounts as the safety-fence row, capture its native handle
    // immediately. The callback itself never changes when pagination appends.
    if (instance && trapFocusDownRef.current) {
      const handle = findNodeHandle(instance) ?? undefined;
      setSelfFocusHandle((prev) => (prev === handle ? prev : handle));
    }
  }, []);

  useEffect(() => {
    if (!trapFocusDown) {
      return;
    }
    const handle = nativePressableRef.current
      ? findNodeHandle(nativePressableRef.current) ?? undefined
      : undefined;
    setSelfFocusHandle((prev) => (prev === handle ? prev : handle));
  }, [trapFocusDown]);

  return (
    <Pressable
      ref={bindRef}
      focusable={focusable}
      disabled={!focusable}
      hasTVPreferredFocus={hasPreferredFocus}
      {...(trapFocusDown && selfFocusHandle != null ? { nextFocusDown: selfFocusHandle } : null)}
      onFocus={() => {
        setIsFocused(true);
        Animated.timing(focusScale, {
          toValue: 1.025,
          duration: 120,
          useNativeDriver: true,
        }).start();
        onFocus(series);
      }}
      onBlur={() => {
        setIsFocused(false);
        Animated.timing(focusScale, {
          toValue: 1,
          duration: 90,
          useNativeDriver: true,
        }).start();
      }}
      onPress={() => onPress?.(series)}
      style={styles.card}>
      <Animated.View
        style={[
          styles.posterShell,
          isFocused && styles.posterShellFocused,
          { transform: [{ scale: focusScale }] },
        ]}>
        <View
          style={[
            styles.poster,
            showPosterArt ? styles.posterWithArt : { backgroundColor: posterColors.background },
            isFocused && styles.posterFocused,
          ]}>
          {showPosterArt ? (
            <>
              <TvRemoteImage uri={series.posterUrl} style={styles.posterImage} onError={() => setFailedPosterKey(posterKey)} />
              {displayRating ? (
                <View style={styles.ratingBadge}>
                  <MaterialCommunityIcons name="star" size={10} color="#F6C85F" />
                  <Text style={styles.ratingText}>{displayRating}</Text>
                </View>
              ) : null}
            </>
          ) : (
            <>
              <View style={[styles.posterFrame, { borderColor: posterColors.accentSoft }]} />
              <View style={styles.posterHeader}>
                <Text style={[styles.posterTag, { color: posterColors.secondary }]}>SERIES</Text>
                <Text style={[styles.posterYear, { color: posterColors.secondary }]}>{metaPrimary}</Text>
              </View>
              <View style={styles.posterCenter}>
                <Text style={[styles.initials, { color: posterColors.accent }]}>{initials}</Text>
                <Text numberOfLines={1} style={[styles.posterGenre, { color: posterColors.accentSoft }]}>
                  {series.genres[0] ?? 'Series'}
                </Text>
              </View>
              <View style={styles.posterFooter}>
                <Text numberOfLines={1} style={styles.posterFooterLabel}>
                  {displayStreamTitle(series.title)}
                </Text>
              </View>
              {displayRating ? (
                <View style={styles.ratingBadge}>
                  <MaterialCommunityIcons name="star" size={10} color={posterColors.accent} />
                  <Text style={styles.ratingText}>{displayRating}</Text>
                </View>
              ) : null}
            </>
          )}
          {isFocused ? <NovaPosterFocusOverlay /> : null}
        </View>
      </Animated.View>

      <Text numberOfLines={1} style={[styles.title, isFocused && styles.titleFocused]}>
        {displayStreamTitle(series.title)}
      </Text>
      <View style={styles.metaRow}>
        {metaPrimary ? <Text style={[styles.meta, isFocused && styles.metaFocused]}>{metaPrimary}</Text> : null}
        {metaPrimary && series.genres[0] ? <View style={styles.metaDot} /> : null}
        <Text style={styles.meta}>{series.genres[0] ?? 'Series'}</Text>
      </View>
    </Pressable>
  );
}, seriesPosterCardPropsAreEqual);

function createStyles(theme: NovaTheme) {
  const focusChrome = createMoviePosterFocusChrome(theme);
  return StyleSheet.create({
    ...focusChrome,
    card: {
      ...focusChrome.card,
      width: '100%',
      flexGrow: 0,
      flexShrink: 0,
      minWidth: 0,
    },
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
    metaFocused: {
      color: theme.colors.textSecondary,
      fontWeight: '800',
    },
    metaDot: {
      width: 3,
      height: 3,
      borderRadius: 99,
      backgroundColor: theme.colors.textMuted,
    },
  });
}
