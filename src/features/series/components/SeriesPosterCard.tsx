import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { ElementRef } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { TvRemoteImage } from '@/components/media/TvRemoteImage';
import type { SeriesSummary } from '@/features/media-browser/mediaTypes';
import { displayStreamTitle, formatMediaMetaLabel } from '@/features/series/metadata/titleNormalization';
import { useAppTheme } from '@/theme/AppThemeProvider';
import type { NovaTheme } from '@/theme/tokens';

type SeriesPosterCardProps = {
  series: SeriesSummary;
  hasPreferredFocus?: boolean;
  onFocus: (series: SeriesSummary) => void;
  onPress?: (series: SeriesSummary) => void;
  registerRef?: (instance: ElementRef<typeof Pressable> | null) => void;
  focusable?: boolean;
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

export function SeriesPosterCard({
  series,
  hasPreferredFocus,
  onFocus,
  onPress,
  registerRef,
  focusable = true,
}: SeriesPosterCardProps) {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [isFocused, setIsFocused] = useState(false);
  const [failedPosterKey, setFailedPosterKey] = useState<string | null>(null);
  const posterColors = getPosterColors(series.posterStyleKey);
  const initials = makeInitials(series.title);
  const posterKey = `${series.id}:${series.posterUrl ?? ''}`;
  const posterFailed = failedPosterKey === posterKey;
  const showPosterArt = Boolean(series.posterUrl) && !posterFailed;
  const metaPrimary = formatMediaMetaLabel({
    year: series.year,
    rating: series.rating,
    genre: series.genres[0],
  });

  // FlatList recycles cells without always firing blur — clear stale focus chrome.
  useEffect(() => {
    setIsFocused(false);
  }, [series.id]);

  return (
    <Pressable
      ref={registerRef}
      focusable={focusable}
      disabled={!focusable}
      hasTVPreferredFocus={hasPreferredFocus}
      onFocus={() => {
        setIsFocused(true);
        onFocus(series);
      }}
      onBlur={() => setIsFocused(false)}
      onPress={() => onPress?.(series)}
      style={styles.card}>
      <View style={[styles.posterShell, isFocused && styles.posterShellFocused]}>
        <View style={[styles.poster, showPosterArt ? styles.posterWithArt : { backgroundColor: posterColors.background }, isFocused && styles.posterFocused]}>
          {showPosterArt ? (
            <>
              <TvRemoteImage uri={series.posterUrl} style={styles.posterImage} onError={() => setFailedPosterKey(posterKey)} />
              {series.rating ? (
                <View style={styles.ratingBadge}>
                  <MaterialCommunityIcons name="star" size={10} color="#F6C85F" />
                  <Text style={styles.ratingText}>{series.rating}</Text>
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
              {series.rating ? (
                <View style={styles.ratingBadge}>
                  <MaterialCommunityIcons name="star" size={10} color={posterColors.accent} />
                  <Text style={styles.ratingText}>{series.rating}</Text>
                </View>
              ) : null}
            </>
          )}
        </View>
      </View>

      <Text numberOfLines={1} style={[styles.title, isFocused && styles.titleFocused]}>
        {displayStreamTitle(series.title)}
      </Text>
      <View style={styles.metaRow}>
        {metaPrimary ? <Text style={styles.meta}>{metaPrimary}</Text> : null}
        {metaPrimary && series.genres[0] ? <View style={styles.metaDot} /> : null}
        <Text style={styles.meta}>{series.genres[0] ?? 'Series'}</Text>
      </View>
    </Pressable>
  );
}

function createStyles(theme: NovaTheme) {
  return StyleSheet.create({
    card: {
      flex: 1,
      minWidth: 0,
      borderRadius: 0,
      padding: 4,
    },
    posterShell: {
      borderRadius: 2,
    },
    posterShellFocused:
      theme.scheme === 'light'
        ? {
            transform: [{ scale: 1.06 }],
          }
        : {
            transform: [{ scale: 1.06 }],
            shadowColor: theme.colors.focusRing,
            shadowOpacity: 0.85,
            shadowRadius: 16,
            shadowOffset: { width: 0, height: 0 },
            elevation: 10,
          },
    poster: {
      aspectRatio: 2 / 3,
      borderRadius: 2,
      borderWidth: 2,
      borderColor: theme.colors.borderSubtle,
      overflow: 'hidden',
      padding: 10,
    },
    posterFocused:
      theme.scheme === 'light'
        ? {
            borderColor: theme.colors.focusRing,
          }
        : {
            borderColor: 'rgba(255,255,255,0.42)',
          },
    posterWithArt: {
      padding: 0,
      backgroundColor: '#0B1018',
    },
    posterImage: {
      ...StyleSheet.absoluteFill,
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
    },
    ratingText: {
      color: theme.colors.textPrimary,
      fontSize: 10,
      fontWeight: '800',
    },
    title: {
      marginTop: 4,
      color: theme.colors.textPrimary,
      fontSize: 11,
      fontWeight: '700',
    },
    titleFocused:
      theme.scheme === 'light'
        ? {
            color: theme.colors.accent,
            fontSize: 12,
            fontWeight: '800',
            transform: [{ scale: 1.05 }],
          }
        : {
            color: theme.colors.accentHover,
            fontSize: 12,
            fontWeight: '800',
            textShadowColor: theme.colors.focusRing,
            textShadowRadius: 8,
            transform: [{ scale: 1.05 }],
          },
    metaRow: {
      marginTop: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
    },
    meta: {
      color: theme.colors.textMuted,
      fontSize: 9,
      fontWeight: '600',
    },
    metaDot: {
      width: 3,
      height: 3,
      borderRadius: 99,
      backgroundColor: theme.colors.textMuted,
    },
  });
}
