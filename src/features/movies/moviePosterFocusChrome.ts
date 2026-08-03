/**
 * Shared Movies poster focus chrome — used by MoviePosterCard and SearchPosterCard.
 * Stage 3G.3: Search must not invent a separate pop-out focus treatment.
 */

import { StyleSheet } from 'react-native';

import type { NovaTheme } from '@/theme/tokens';

export function createMoviePosterFocusChrome(theme: NovaTheme) {
  const light = theme.scheme === 'light';
  return StyleSheet.create({
    card: {
      flex: 1,
      minWidth: 0,
      borderRadius: 0,
      padding: 6,
    },
    posterShell: {
      borderRadius: 2,
      transform: [{ scale: 1 }],
    },
    posterShellFocused: {
      transform: [{ scale: 1.025 }],
    },
    poster: {
      aspectRatio: 2 / 3,
      borderRadius: 2,
      borderWidth: 2,
      borderColor: theme.colors.borderSubtle,
      overflow: 'hidden',
      padding: 10,
    },
    posterFocused: {
      borderColor: light ? theme.colors.focusRing : '#8FE9FF',
      borderWidth: 4,
      backgroundColor: 'rgba(7,15,24,0.96)',
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
      color: '#BFF4FF',
      fontWeight: '900',
      textShadowColor: 'rgba(143,233,255,0.65)',
      textShadowOffset: { width: 0, height: 0 },
      textShadowRadius: 4,
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
