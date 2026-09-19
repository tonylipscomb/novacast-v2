/**
 * Shared Movies poster focus chrome — used by MoviePosterCard and SearchPosterCard.
 * Stage 3G.3: Search must not invent a separate pop-out focus treatment.
 */

import { StyleSheet } from 'react-native';

import { NOVA_OVERLAY_SHELL } from '@/components/nova/NovaOverlayShell';
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
    posterFocusHalo: {
      position: 'absolute',
      top: -3,
      right: -3,
      bottom: -3,
      left: -3,
      borderRadius: 5,
      borderWidth: 1,
      borderColor: 'rgba(130,145,220,0.20)',
      backgroundColor: 'transparent',
      shadowColor: NOVA_OVERLAY_SHELL.shadowColor,
      shadowOpacity: 0.12,
      shadowRadius: 4,
      shadowOffset: { width: 0, height: 0 },
      elevation: 2,
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
      borderColor: light ? theme.colors.focusRing : 'rgba(130,145,220,0.58)',
      borderWidth: 1,
      backgroundColor: 'transparent',
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
      color: theme.colors.textPrimary,
      fontWeight: '900',
      textShadowColor: 'rgba(190,175,255,0.45)',
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
