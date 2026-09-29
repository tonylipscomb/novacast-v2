/**
 * Shared Movies poster focus chrome — used by MoviePosterCard and SearchPosterCard.
 * Stage 3G.3: Search must not invent a separate pop-out focus treatment.
 */

import { StyleSheet } from 'react-native';

import type { NovaTheme } from '@/theme/tokens';
import { NOVA_FOCUS } from '@/components/nova/novaGlassTheme';

export function createMoviePosterFocusChrome(theme: NovaTheme) {
  const light = theme.scheme === 'light';
  const focusEdge = light ? '#7756D9' : NOVA_FOCUS.poster.violetEdge;
  const focusBackground = light ? 'rgba(95, 70, 220, 0.18)' : 'rgba(35,20,85,0.34)';
  return StyleSheet.create({
    card: {
      flex: 1,
      minWidth: 0,
      borderRadius: 0,
      padding: 6,
    },
    posterShell: {
      borderRadius: 10,
      borderWidth: 1,
      borderColor: 'rgba(150,170,220,0.18)',
      backgroundColor: 'rgba(5,10,24,0.28)',
      padding: 2,
      transform: [{ scale: 1 }],
    },
    posterShellFocused: {
      borderColor: focusEdge,
      backgroundColor: focusBackground,
      shadowColor: focusEdge,
      shadowOpacity: light ? 0.62 : 0.78,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 0 },
      elevation: 6,
      transform: [{ scale: 1 }],
    },
    poster: {
      aspectRatio: 2 / 3,
      borderRadius: 8,
      borderWidth: 2,
      borderColor: theme.colors.borderSubtle,
      overflow: 'hidden',
      padding: 10,
    },
    posterFocused: {
      borderColor: light ? '#7756D9' : NOVA_FOCUS.poster.borderColor,
      borderWidth: 2,
      backgroundColor: light ? 'rgba(95, 70, 220, 0.12)' : NOVA_FOCUS.poster.backgroundColor,
    },
    posterWithArt: {
      padding: 0,
      backgroundColor: '#0B1018',
    },
    posterImage: {
      ...StyleSheet.absoluteFillObject,
    },
    title: {
      marginTop: 4,
      color: theme.colors.textPrimary,
      fontSize: 11,
      fontWeight: '700',
    },
    titleFocused: {
      color: light ? '#063B5C' : theme.colors.textPrimary,
      fontWeight: '900',
    },
    meta: {
      color: theme.colors.textMuted,
      fontSize: 9,
      fontWeight: '600',
    },
  });
}

/** Marker for Stage 3G.3 shared-chrome tests. */
export const MOVIE_POSTER_FOCUS_CHROME_MARKER = 'stage3g3-shared-movie-poster-focus-chrome-v1';
