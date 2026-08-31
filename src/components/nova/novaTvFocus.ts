import { Platform, StyleSheet, type TextStyle, type ViewStyle } from 'react-native';

import { novaTheme } from '@/theme';
import type { NovaTheme } from '@/theme/tokens';
import { NOVA_FOCUS } from './novaGlassTheme';

/** Fire TV / ONN sticks: skip scale + shadow (layout thrash / focus drops). */
export const NOVA_TV_LITE_FOCUS = Platform.isTV === true;

/**
 * Canonical TV focus glass — matches Movies Search Close:
 * translucent wash + bright border, fixed size, no shadow/scale/blue text.
 */
export const NOVA_TV_GLASS = {
  fill: 'rgba(18, 36, 72, 0.42)',
  fillLight: 'rgba(59, 130, 246, 0.14)',
  border: 'rgba(131, 180, 255, 0.72)',
  borderSoft: 'rgba(255, 255, 255, 0.28)',
} as const;

/** Static TV focus chrome (dark / Close-button look). Prefer createNovaTvFocusChrome(theme) when themed. */
export const novaTvFocus = StyleSheet.create({
  base: {
    borderWidth: 2,
    borderColor: 'transparent',
    borderRadius: 0,
  },
  active: {
    borderColor: NOVA_FOCUS.control.borderColor,
    backgroundColor: NOVA_FOCUS.control.backgroundColor,
    borderRadius: 0,
  },
});

/** Theme-aware glass box — same shape as Search Close on every control. */
export function createNovaTvFocusChrome(theme: NovaTheme) {
  const light = theme.scheme === 'light';
  return StyleSheet.create({
    base: {
      borderWidth: 2,
      borderColor: 'transparent',
      borderRadius: 0,
    },
    active: light
      ? {
          borderColor: theme.colors.focusRing,
          backgroundColor: theme.colors.surfaceFocused,
          borderRadius: 0,
      }
      : {
          borderColor: NOVA_FOCUS.control.borderColor,
          backgroundColor: NOVA_FOCUS.control.backgroundColor,
          borderRadius: 0,
        },
  });
}

/** Shared category/filter state chrome. State selection is owned by each caller. */
export function createNovaCategoryChrome() {
  return StyleSheet.create({
    default: {
      backgroundColor: NOVA_FOCUS.category.default.backgroundColor,
      borderColor: NOVA_FOCUS.category.default.borderColor,
      borderRadius: 10,
    },
    active: {
      backgroundColor: NOVA_FOCUS.category.active.backgroundColor,
      borderColor: NOVA_FOCUS.category.active.borderColor,
      borderBottomColor: NOVA_FOCUS.category.active.edgeColor,
      borderRadius: 12,
    },
    focused: {
      backgroundColor: NOVA_FOCUS.category.focused.backgroundColor,
      borderColor: NOVA_FOCUS.category.focused.borderColor,
      borderRadius: 12,
    },
    activeFocused: {
      backgroundColor: NOVA_FOCUS.category.activeFocused.backgroundColor,
      borderColor: NOVA_FOCUS.category.activeFocused.borderColor,
      borderBottomColor: NOVA_FOCUS.category.activeFocused.cyanEdge,
      borderRadius: 14,
    },
  });
}

/**
 * Absolute-fill glass overlay for poster / media cards.
 * pointerEvents should be "none" on the consuming View.
 */
export function createNovaTvGlassOverlayStyle(theme: NovaTheme): ViewStyle {
  const light = theme.scheme === 'light';
  return {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: light ? NOVA_TV_GLASS.fillLight : NOVA_TV_GLASS.fill,
    borderWidth: 1,
    borderColor: light ? theme.colors.focusRing : NOVA_TV_GLASS.border,
  };
}

type FocusTextStyles = {
  /** Primary label / title under focus. */
  title: TextStyle;
  /** Supporting line (meta, now-playing) under focus. */
  secondary: TextStyle;
  /** Numeric / count label under focus. */
  count: TextStyle;
};

/**
 * Shared focus text chrome used app-wide on TV.
 * Weight only — never blue/accent text (glass box carries focus).
 */
export function createNovaTvFocusTextStyles(theme: NovaTheme): FocusTextStyles {
  return {
    title: {
      color: theme.colors.textPrimary,
      fontWeight: '800',
    },
    secondary: {
      color: theme.colors.textSecondary,
      fontWeight: '700',
    },
    count: {
      color: theme.colors.textPrimary,
      fontWeight: '800',
    },
  };
}

/** @deprecated Use createNovaTvFocusChrome — kept for import stability. */
void novaTheme;
